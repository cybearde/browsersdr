// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AtlasClient, AtlasRequestError } from "./atlasClient";
import { AtlasCredentialStore, ATLAS_USER_TOKEN_KEY } from "./atlasCredentials";
import { AtlasConnection } from "./atlasConnection";
import { PublicStationClient } from "./publicStationClient";
import publicFixture from "../testing/fixtures/atlas/browsersdr-public-station-search-v1.json";

const TOKEN = "test-credential-".repeat(3);
const NEXT = "replacement-credential-".repeat(3);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function json(
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
class Peer {
  logins = 0;
  meReads = 0;
  logoutFails = false;
  loginStatus = 201;
  meStatus = 200;
  role: "operator" | "viewer" = "operator";
  holdLogin?: ReturnType<typeof deferred<Response>>;
  holdLogout?: ReturnType<typeof deferred<Response>>;
  readonly calls: Array<{ path: string; method: string; headers: Headers }> =
    [];
  session = () =>
    json(201, {
      operator_id: "user-a",
      expires_at: "2030-01-01T00:00:00Z",
      csrf_token: `csrf-${this.logins}`,
    });
  fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input),
      method = init.method ?? "GET",
      headers = new Headers(init.headers);
    this.calls.push({ path, method, headers });
    expect(init.credentials).toBe("same-origin");
    if (path === "/api/v1/session" && method === "POST") {
      this.logins++;
      expect(headers.has("X-CSRF-Token")).toBe(false);
      return this.holdLogin
        ? this.holdLogin.promise
        : this.loginStatus === 201
          ? this.session()
          : json(
              this.loginStatus,
              {
                error: { code: "invalid_authentication", message: "Rejected" },
              },
              { "Retry-After": "2" },
            );
    }
    if (path === "/api/v1/me") {
      this.meReads++;
      return this.meStatus === 200
        ? json(200, {
            id: "user-a",
            display_name: "User A",
            role: this.role,
            token_id: null,
            bootstrap: false,
          })
        : json(this.meStatus, {
            error: { code: "role_forbidden", message: "Forbidden" },
          });
    }
    if (path === "/api/v1/session" && method === "DELETE") {
      expect(headers.get("X-CSRF-Token")).toBe(`csrf-${this.logins}`);
      if (this.logoutFails) throw new TypeError("offline");
      return this.holdLogout ? this.holdLogout.promise : json(204, null);
    }
    if (path === "/api/v1/uploads") {
      expect(headers.get("X-CSRF-Token")).toBe(`csrf-${this.logins}`);
      return json(200, { id: "upload" });
    }
    throw new Error(`Unexpected route ${method} ${path}`);
  };
}
const owners: AtlasConnection[] = [];
function setup(peer = new Peer(), now?: () => number) {
  const store = new AtlasCredentialStore(localStorage, window);
  const client = new AtlasClient({ fetch: peer.fetch, retryAttempts: 1 });
  const connection = new AtlasConnection(store, client, now);
  owners.push(connection);
  return { store, peer, client, connection };
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  for (const owner of owners.splice(0)) {
    owner.dispose();
    owner.credentials.dispose();
  }
  vi.restoreAllMocks();
});

describe("Atlas shared credential storage", () => {
  it("loads legacy tokens without exchanging them, and rejects malformed stored lengths", () => {
    localStorage.setItem(ATLAS_USER_TOKEN_KEY, TOKEN);
    const { store, peer } = setup();
    expect(store.getSnapshot()).toMatchObject({
      token: TOKEN,
      persistence: "remembered",
    });
    expect(peer.calls).toHaveLength(0);
    for (const token of ["short", "x".repeat(4097)]) {
      localStorage.setItem(ATLAS_USER_TOKEN_KEY, token);
      window.dispatchEvent(
        new StorageEvent("storage", { key: ATLAS_USER_TOKEN_KEY }),
      );
      expect(store.getSnapshot().token).toBe("");
    }
  });
  it("keeps opaque tokens unchanged and opt-out removes an older persistent token", () => {
    const { store } = setup();
    const opaque = "  " + TOKEN + "  ";
    store.save(opaque, true);
    expect(localStorage.getItem(ATLAS_USER_TOKEN_KEY)).toBe(opaque);
    store.save(NEXT, false);
    expect(store.getSnapshot()).toMatchObject({
      token: NEXT,
      remember: false,
      persistence: "memory",
    });
    expect(localStorage.getItem(ATLAS_USER_TOKEN_KEY)).toBeNull();
    expect(new AtlasCredentialStore(localStorage).getSnapshot().token).toBe("");
  });
  it("validates both length bounds before touching saved credentials", () => {
    const { store } = setup();
    store.save(TOKEN);
    expect(() => store.save("short")).toThrow("32–4096");
    expect(() => store.save("x".repeat(4097))).toThrow("32–4096");
    expect(store.getSnapshot().token).toBe(TOKEN);
    store.save("x".repeat(4096));
    expect(store.getSnapshot().token).toHaveLength(4096);
  });
  it("notifies local subscribers, does not churn identical saves, and forgets", () => {
    const { store } = setup();
    const changed = vi.fn();
    const unsubscribe = store.subscribe(changed);
    store.save(TOKEN);
    store.save(TOKEN);
    expect(changed).toHaveBeenCalledTimes(1);
    store.forget();
    expect(store.getSnapshot().token).toBe("");
    expect(localStorage.getItem(ATLAS_USER_TOKEN_KEY)).toBeNull();
    unsubscribe();
  });
  it("retains in-memory access when browser storage cannot be read or written", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const { store } = setup();
    store.save(TOKEN);
    expect(store.getSnapshot()).toMatchObject({
      token: TOKEN,
      persistence: "unavailable",
    });
    store.forget();
    expect(store.getSnapshot().token).toBe("");
    expect(store.getSnapshot().notice).toContain(
      "previously saved token may remain",
    );
  });
});

describe("Atlas connection and session ownership", () => {
  it("public discovery leaves an authenticated transfer session and remembered credentials untouched", async () => {
    const { store, peer, client, connection } = setup();
    store.save(TOKEN);
    await connection.ensureAuthenticated();
    const hold = deferred<void>();
    const transfer = connection.withTransfer(
      TOKEN,
      () => hold.promise,
      new AbortController().signal,
    );
    const before = connection.getSnapshot();
    const publicFetch = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.credentials).toBe("omit");
      expect(init?.headers).toEqual({ Accept: "application/json" });
      return Response.json(publicFixture.queries[0]!.response);
    });
    try {
      await new PublicStationClient(publicFetch).list({ q: "energy" });
      expect(connection.getSnapshot()).toBe(before);
      expect(store.getSnapshot().token).toBe(TOKEN);
      expect(localStorage.getItem(ATLAS_USER_TOKEN_KEY)).toBe(TOKEN);
      expect(peer.logins).toBe(1);
      await client.createUpload(
        {},
        "after-public-search",
        new AbortController().signal,
      );
      expect(peer.calls.at(-1)!.headers.get("X-CSRF-Token")).toBe("csrf-1");
      expect(connection.getSnapshot().transferActive).toBe(true);
    } finally {
      hold.resolve();
      await transfer;
    }
  });
  it("deduplicates concurrent authentication and checks /me without IQ capabilities", async () => {
    const { store, peer, connection } = setup();
    store.save(TOKEN);
    await Promise.all([
      connection.ensureAuthenticated(),
      connection.ensureAuthenticated(),
    ]);
    expect(peer.logins).toBe(1);
    expect(peer.meReads).toBe(1);
    expect(connection.getSnapshot()).toMatchObject({
      status: "connected",
      user: { role: "operator" },
    });
    await connection.testConnection();
    expect(peer.logins).toBe(1);
    expect(peer.meReads).toBe(2);
  });
  it("cancelling one caller does not cancel a shared login or another waiter", async () => {
    const { store, peer, connection } = setup();
    store.save(TOKEN);
    peer.holdLogin = deferred<Response>();
    const caller = new AbortController();
    const first = connection.ensureAuthenticated(caller.signal);
    const second = connection.ensureAuthenticated();
    caller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    peer.holdLogin.resolve(peer.session());
    await expect(second).resolves.toMatchObject({ operator_id: "user-a" });
    expect(peer.logins).toBe(1);
  });
  it("rejects a late login after token replacement, even if the peer ignores abort", async () => {
    const { store, peer, client, connection } = setup();
    store.save(TOKEN);
    peer.holdLogin = deferred<Response>();
    const login = connection.ensureAuthenticated();
    connection.saveToken(NEXT, true);
    peer.holdLogin.resolve(peer.session());
    await expect(login).rejects.toMatchObject({ name: "AbortError" });
    expect(client.authenticated).toBe(false);
    expect(connection.getSnapshot().status).toBe("disconnected");
  });
  it("protects writes and shares CSRF instead of rotating login during a transfer", async () => {
    const { store, peer, client, connection } = setup();
    store.save(TOKEN);
    await connection.testConnection();
    const hold = deferred<void>();
    const transfer = connection.withTransfer(
      TOKEN,
      async (signal) => {
        await connection.authenticateTransfer(signal);
        await client.createUpload({}, "test", signal);
        await hold.promise;
      },
      new AbortController().signal,
    );
    expect(() => connection.saveToken(NEXT, true)).toThrow(
      "transfer is active",
    );
    await expect(connection.testConnection()).rejects.toMatchObject({
      code: "transfer_active",
    });
    await expect(connection.disconnect()).rejects.toMatchObject({
      code: "transfer_active",
    });
    await expect(connection.forgetToken()).rejects.toMatchObject({
      code: "transfer_active",
    });
    await connection.read((signal) => client.me(signal));
    expect(peer.logins).toBe(1);
    hold.resolve();
    await transfer;
    expect(connection.getSnapshot().transferActive).toBe(false);
  });
  it("cross-tab replacement cancels a transfer and suppresses late read publication", async () => {
    const { store, connection } = setup();
    store.save(TOKEN);
    await connection.ensureAuthenticated();
    const hold = deferred<string>();
    const read = connection.read(() => hold.promise);
    const transfer = connection.withTransfer(
      TOKEN,
      async (signal) => {
        await hold.promise;
        signal.throwIfAborted();
      },
      new AbortController().signal,
    );
    localStorage.setItem(ATLAS_USER_TOKEN_KEY, NEXT);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: ATLAS_USER_TOKEN_KEY,
        storageArea: localStorage,
      }),
    );
    hold.resolve("old data");
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
    await expect(transfer).rejects.toMatchObject({ name: "AbortError" });
    expect(store.getSnapshot().token).toBe(NEXT);
    expect(connection.getSnapshot()).toMatchObject({
      status: "disconnected",
      transferActive: false,
    });
  });
  it("reauthenticates a read once on 401, but never loops on 403", async () => {
    const { store, peer, connection } = setup();
    store.save(TOKEN);
    let attempts = 0;
    expect(
      await connection.read(async () => {
        if (!attempts++)
          throw new AtlasRequestError(401, "invalid_authentication", "expired");
        return "current";
      }),
    ).toBe("current");
    expect(peer.logins).toBe(2);
    await expect(
      connection.read(async () => {
        throw new AtlasRequestError(403, "role_forbidden", "denied");
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(peer.logins).toBe(2);
    await expect(
      connection.read(async () => {
        throw new AtlasRequestError(401, "invalid_authentication", "expired");
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(peer.logins).toBe(3);
  });
  it("a read cannot reauthenticate underneath an active transfer", async () => {
    const { store, peer, connection } = setup();
    store.save(TOKEN);
    await connection.ensureAuthenticated();
    const hold = deferred<void>();
    const transfer = connection.withTransfer(
      TOKEN,
      () => hold.promise,
      new AbortController().signal,
    );
    await expect(
      connection.read(async () => {
        throw new AtlasRequestError(401, "invalid_authentication", "expired");
      }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(connection.ensureAuthenticated()).rejects.toMatchObject({
      code: "transfer_active",
    });
    expect(peer.logins).toBe(1);
    hold.resolve();
    await transfer;
  });
  it("renews an expired session only on explicit use", async () => {
    let time = Date.parse("2026-10-05T12:00:00Z");
    const { store, peer, connection } = setup(undefined, () => time);
    store.save(TOKEN);
    await connection.ensureAuthenticated();
    time = Date.parse("2031-01-01T00:00:00Z");
    await expect(connection.ensureAuthenticated()).rejects.toThrow(
      "Invalid session identity or expiry",
    );
    expect(peer.logins).toBe(2);
  });
  it("disconnect sends CSRF, retains the token, and Forget clears it despite offline logout", async () => {
    const { store, peer, client, connection } = setup();
    store.save(TOKEN);
    await connection.ensureAuthenticated();
    await connection.disconnect();
    expect(store.getSnapshot().token).toBe(TOKEN);
    expect(client.authenticated).toBe(false);
    await connection.ensureAuthenticated();
    peer.logoutFails = true;
    await connection.forgetToken();
    expect(store.getSnapshot().token).toBe("");
    expect(localStorage.getItem(ATLAS_USER_TOKEN_KEY)).toBeNull();
    expect(connection.getSnapshot().message).toContain(
      "logout could not be confirmed",
    );
  });
  it("bad/revoked credentials and /me permission failures never retry login", async () => {
    const { store, peer, connection } = setup();
    store.save(TOKEN);
    peer.loginStatus = 401;
    await expect(connection.ensureAuthenticated()).rejects.toMatchObject({
      status: 401,
    });
    expect(peer.logins).toBe(1);
    peer.loginStatus = 201;
    peer.meStatus = 403;
    await expect(connection.ensureAuthenticated()).rejects.toMatchObject({
      status: 403,
    });
    expect(peer.logins).toBe(2);
    expect(connection.getSnapshot().user).toBeUndefined();
  });
  it("keeps viewer identity for feature permission gates", async () => {
    const { store, peer, connection } = setup();
    store.save(TOKEN);
    peer.role = "viewer";
    await connection.ensureAuthenticated();
    expect(connection.getSnapshot().user?.role).toBe("viewer");
  });

  it("late 401 from another read does not erase the newly authenticated session", async () => {
    const { store, peer, connection } = setup();
    store.save(TOKEN);
    await connection.ensureAuthenticated();
    const late = deferred<void>();
    let attempts = 0;
    const olderRead = connection.read(async () => {
      if (attempts++ === 0) {
        await late.promise;
        throw new AtlasRequestError(
          401,
          "invalid_authentication",
          "old session",
        );
      }
      return "older read retried";
    });
    await Promise.resolve();
    let freshAttempts = 0;
    await connection.read(async () => {
      if (freshAttempts++ === 0)
        throw new AtlasRequestError(401, "invalid_authentication", "expired");
      return "fresh";
    });
    late.resolve();
    expect(await olderRead).toBe("older read retried");
    expect(peer.logins).toBe(2);
    expect(connection.getSnapshot().status).toBe("connected");
  });

  it("cross-tab updates cannot start a new session while logout is still in flight", async () => {
    const { store, peer, connection } = setup();
    store.save(TOKEN);
    await connection.ensureAuthenticated();
    peer.holdLogout = deferred<Response>();
    const closing = connection.disconnect();
    localStorage.setItem(ATLAS_USER_TOKEN_KEY, NEXT);
    window.dispatchEvent(
      new StorageEvent("storage", { key: ATLAS_USER_TOKEN_KEY }),
    );
    await expect(connection.ensureAuthenticated()).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(connection.getSnapshot().status).toBe("disconnecting");
    peer.holdLogout.resolve(json(204, null));
    await closing;
    expect(peer.logins).toBe(1);
    expect(store.getSnapshot().token).toBe(NEXT);
  });

  it("honors login Retry-After without an automatic retry or an early explicit login", async () => {
    let time = Date.parse("2026-10-05T12:00:00Z");
    const { store, peer, connection } = setup(undefined, () => time);
    store.save(TOKEN);
    peer.loginStatus = 429;
    await expect(connection.ensureAuthenticated()).rejects.toMatchObject({
      status: 429,
    });
    peer.loginStatus = 201;
    await expect(connection.ensureAuthenticated()).rejects.toMatchObject({
      status: 429,
    });
    expect(peer.logins).toBe(1);
    time += 2001;
    await connection.ensureAuthenticated();
    expect(peer.logins).toBe(2);
  });

  it("expires visible session status without performing another login", async () => {
    vi.useFakeTimers();
    try {
      const { store, peer, connection } = setup();
      store.save(TOKEN);
      vi.setSystemTime(new Date("2029-12-31T23:59:59Z"));
      await connection.ensureAuthenticated();
      await vi.advanceTimersByTimeAsync(1001);
      expect(connection.getSnapshot().status).toBe("expired");
      expect(peer.logins).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
