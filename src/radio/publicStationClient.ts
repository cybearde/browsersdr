import {
  PUBLIC_UUID,
  malformedPublicResponse,
  parsePublicDetail,
  parsePublicPage,
  publicQueryParams,
  type PublicStationQuery,
} from "./publicStations";
const PATH = "/api/v1/public/stations";
const MAX_BYTES = 1024 * 1024;
function boundedWait<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted));
  });
}
export class PublicCatalogError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(
      status === 429
        ? `Public search is rate limited. Retry after ${retryAfterSeconds ?? 1} seconds.`
        : status === 404
          ? "Station unavailable. Search again; the public reference may have been withdrawn."
          : status === 409
            ? "The catalog or page cursor changed. Search again to refresh the results."
            : status === 422
              ? "Search filters or cursor were rejected. Use at least two text characters, check the window, or narrow the search."
              : "Public catalog unavailable. Retry later; local guides and favorites remain available.",
    );
  }
}
/** No configurable remote origin, credential/session dependency, retries, cache or login. */
export class PublicStationClient {
  private active = 0;
  private retryAt = 0;
  private retryStatus = 429;
  constructor(
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
    private readonly timeoutMs = 5000,
  ) {}
  list(query: PublicStationQuery, signal?: AbortSignal) {
    return this.request(`${PATH}?${publicQueryParams(query)}`, signal).then(
      parsePublicPage,
    );
  }
  detail(id: string, signal?: AbortSignal) {
    if (!PUBLIC_UUID.test(id)) throw new Error("Invalid public station ID.");
    return this.request(`${PATH}/${id}`, signal).then((value) =>
      parsePublicDetail(value, id),
    );
  }
  private async request(path: string, caller?: AbortSignal): Promise<unknown> {
    if (Date.now() < this.retryAt)
      throw new PublicCatalogError(
        this.retryStatus,
        "public_rate_limited",
        Math.ceil((this.retryAt - Date.now()) / 1000),
      );
    if (this.active >= 2) throw new PublicCatalogError(429, "public_busy", 1);
    const aborter = new AbortController();
    const abort = () => aborter.abort(caller?.reason);
    caller?.throwIfAborted();
    caller?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () =>
        aborter.abort(
          new DOMException("Public search timed out", "TimeoutError"),
        ),
      this.timeoutMs,
    );
    this.active++;
    try {
      const response = await boundedWait(
        this.fetcher(path, {
          method: "GET",
          credentials: "omit",
          mode: "same-origin",
          redirect: "error",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          headers: { Accept: "application/json" },
          signal: aborter.signal,
        }),
        aborter.signal,
      );
      aborter.signal.throwIfAborted();
      if (!response.ok) {
        const raw = response.headers.get("Retry-After");
        const retry =
          raw && /^\d+$/.test(raw)
            ? Math.min(86400, Math.max(1, Number(raw)))
            : 1;
        if (response.status === 429 || response.status === 503) {
          this.retryAt = Date.now() + retry * 1000;
          this.retryStatus = response.status;
        }
        // Server error text is never shown or logged. Status determines safe recovery.
        await response.body?.cancel();
        throw new PublicCatalogError(
          response.status,
          "public_request_failed",
          retry,
        );
      }
      if (
        !response.headers
          .get("Content-Type")
          ?.toLowerCase()
          .startsWith("application/json") ||
        Number(response.headers.get("Content-Length")) > MAX_BYTES ||
        !response.body
      ) {
        await response.body?.cancel();
        return malformedPublicResponse();
      }
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await boundedWait(
            reader.read(),
            aborter.signal,
          );
          aborter.signal.throwIfAborted();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) return malformedPublicResponse();
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      try {
        return JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch {
        return malformedPublicResponse();
      }
    } catch (error) {
      if (caller?.aborted) throw caller.reason;
      if (error instanceof PublicCatalogError) throw error;
      if (error instanceof Error && error.message.startsWith("Malformed"))
        throw error;
      throw new Error(
        "Public catalog unavailable or timed out. Retry later; local guides and favorites remain available.",
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener("abort", abort);
      this.active--;
    }
  }
}
