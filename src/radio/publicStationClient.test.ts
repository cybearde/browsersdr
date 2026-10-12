import { afterEach, expect, it, vi } from "vitest";
import fixture from "../testing/fixtures/atlas/browsersdr-public-station-search-v1.json";
import { PublicStationClient } from "./publicStationClient";
import { PublicStationSearch } from "./publicStationSearch";
import { parsePublicPage } from "./publicStations";
const page = parsePublicPage(fixture.queries[0]!.response);
afterEach(() => vi.useRealTimers());
it("uses only exact anonymous same-origin GETs, omits credentials and never follows login redirects", async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) =>
    Response.json(
      String(input).includes("/stations/")
        ? Object.values(fixture.details)[0]
        : page,
    ),
  );
  const client = new PublicStationClient(fetcher);
  await client.list({ q: "energy" });
  await client.detail(page.items[0]!.station.id);
  for (const [url, options] of fetcher.mock.calls) {
    expect(String(url)).toMatch(/^\/api\/v1\/public\/stations[?/]/);
    expect(options).toMatchObject({
      method: "GET",
      credentials: "omit",
      mode: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
    });
    expect(Object.keys(options!.headers!)).toEqual(["Accept"]);
  }
  expect(() => client.detail("../session")).toThrow();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("honors Retry-After without retrying or exposing server error text", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json(
        { secret: "private detail" },
        { status: 429, headers: { "Retry-After": "7" } },
      ),
    )
    .mockImplementation(async () => Response.json(page));
  const client = new PublicStationClient(fetcher);
  await expect(client.list({})).rejects.toThrow(/7 seconds/);
  await expect(client.list({})).rejects.toThrow(/7 seconds/);
  expect(fetcher).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(7000);
  await client.list({});
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("rejects HTML, oversized streaming responses, malformed JSON and hanging responses within the deadline", async () => {
  for (const response of [
    new Response("<html>"),
    Response.json({}),
    new Response("{", { headers: { "Content-Type": "application/json" } }),
    new Response(new Uint8Array(1024 * 1024 + 1), {
      headers: { "Content-Type": "application/json" },
    }),
  ]) {
    await expect(
      new PublicStationClient(async () => response).list({}),
    ).rejects.toThrow(/Malformed/);
  }
  const client = new PublicStationClient(
    async () =>
      new Response(new ReadableStream({ start() {} }), {
        headers: { "Content-Type": "application/json" },
      }),
    10,
  );
  await expect(client.list({})).rejects.toThrow(/timed out/);
});
it("discards stale requests and bounds paging without sharing a personal session", async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockImplementation(async () =>
      Response.json({ ...page, items: [], next_cursor: null }),
    );
  const search = new PublicStationSearch(new PublicStationClient(fetcher));
  const first = search.search({ q: "slow" });
  search.clear();
  await search.search({ q: "empty" });
  resolve(Response.json(page));
  await first;
  expect(search.getSnapshot().page!.items).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("clears obsolete pages on changed catalogs and stops repeated cursors", async () => {
  const client = new PublicStationClient(async () => Response.json(page)),
    search = new PublicStationSearch(client);
  await search.search({ q: "energy" });
  await search.next();
  expect(search.getSnapshot().next).toBe(false);
  expect(search.getSnapshot().message).toMatch(/Repeated/);
  vi.spyOn(client, "list").mockResolvedValueOnce({
    ...page,
    catalog_revision: "00000000-0000-4000-8000-000000000999",
  });
  await search.previous();
  expect(search.getSnapshot().status).toBe("ready");
  vi.spyOn(client, "list").mockResolvedValueOnce(page);
  await search.next();
  expect(search.getSnapshot().status).toBe("error");
  expect(search.getSnapshot().page).toBeUndefined();
});
