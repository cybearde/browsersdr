import { expect, it, vi } from "vitest";
import { publicStationFixture as fixture } from "../testing/publicStationFixture";
import { PublicCatalogError, PublicStationClient } from "./publicStationClient";
import { PublicTransmissionSearch } from "./publicTransmissionSearch";
import { PublicStationSearch } from "./publicStationSearch";
const header = {
  ...fixture.details["00000000-0000-4000-8000-000000000001"]!.station,
  transmission_count: 61,
};
const rows = Array.from({ length: 61 }, (_, n) => ({
  ...fixture.references.items[0]!,
  id: `00000000-0000-4000-8000-${String(n + 100).padStart(12, "0")}`,
  frequency_hz: 100e6 + n * 1e5,
}));
function setup(total = 61) {
  const queries: URL[] = [];
  const client = new PublicStationClient(async (input) => {
    const url = new URL(String(input), "https://example.org");
    queries.push(url);
    if (!url.pathname.endsWith("/transmissions"))
      return Response.json({
        ...fixture.details[header.id],
        station: { ...header, transmission_count: total },
      });
    const offset = Number(url.searchParams.get("cursor") ?? 0);
    return Response.json({
      ...fixture.references,
      station_id: header.id,
      total,
      items: rows.slice(offset, Math.min(offset + 25, total)),
      next_cursor: offset + 25 < total ? String(offset + 25) : null,
    });
  });
  const pager = new PublicTransmissionSearch(
    client,
    header,
    fixture.references.catalog_revision,
    total,
    { q: "FM", min_frequency_hz: 100e6, max_frequency_hz: 110e6 },
  );
  return { client, pager, queries };
}
it("lazily enumerates more than 50 references with exact counts, filters and previous pages", async () => {
  const { pager, queries } = setup();
  expect(queries).toEqual([]);
  await pager.load();
  expect(pager.getSnapshot().page!.items).toEqual(rows.slice(0, 25));
  await pager.next();
  await pager.next();
  expect(pager.getSnapshot()).toMatchObject({
    pageIndex: 2,
    next: false,
    previous: true,
  });
  expect(pager.getSnapshot().page!.items).toEqual(rows.slice(50));
  await pager.previous();
  expect(pager.getSnapshot().page!.items).toEqual(rows.slice(25, 50));
  for (const url of queries)
    expect([...url.searchParams.entries()]).toEqual(
      expect.arrayContaining([
        ["q", "FM"],
        ["limit", "50"],
        ["min_frequency_hz", "100000000"],
        ["max_frequency_hz", "110000000"],
      ]),
    );
});
it("resolves exact later-page UUIDs with one header generation and no first-page fallback", async () => {
  const { client, queries } = setup();
  const selected = await client.reference(header.id, rows[60]!.id);
  expect(selected.transmissions).toEqual([rows[60]]);
  expect(queries).toHaveLength(4);
  await expect(
    client.reference(header.id, "00000000-0000-4000-8000-000000999999"),
  ).rejects.toMatchObject({ status: 404 });
});
it("retries a failed continuation at the same cursor, without losing pages or filter scope", async () => {
  const { client, pager } = setup();
  await pager.load();
  const spy = vi
    .spyOn(client, "transmissions")
    .mockRejectedValueOnce(new PublicCatalogError(503, "public_busy", 1));
  await pager.next();
  expect(pager.getSnapshot()).toMatchObject({
    status: "error",
    pageIndex: 1,
    restart: false,
  });
  await pager.retry();
  expect(spy.mock.calls[1]![1]!.cursor).toBe("25");
  expect(pager.getSnapshot().status).toBe("ready");
});
it.each([404, 409, 422])(
  "discards unavailable/stale/expired or rejected cursors (%s) and requires a fresh search",
  async (status) => {
    const { client, pager } = setup();
    await pager.load();
    vi.spyOn(client, "transmissions").mockRejectedValueOnce(
      new PublicCatalogError(status, "cursor_expired"),
    );
    await pager.next();
    expect(pager.getSnapshot()).toMatchObject({
      status: "error",
      restart: true,
    });
    expect(pager.getSnapshot().page).toBeUndefined();
    await pager.retry();
    expect(pager.getSnapshot().status).toBe("error");
  },
);
it.each([
  "generation",
  "version",
  "count",
  "truncation",
  "duplicate",
  "cursor",
])("refuses mixed or truncated reference pages: %s", async (fault) => {
  const { client, pager } = setup();
  await pager.load();
  const bad = {
    ...fixture.references,
    total: 61,
    items: rows.slice(25, 50),
    next_cursor: "50",
  };
  if (fault === "generation")
    bad.catalog_revision = "00000000-0000-4000-8000-000000000999";
  if (fault === "version") bad.publication_version++;
  if (fault === "count") bad.total++;
  if (fault === "truncation") bad.next_cursor = null as unknown as string;
  if (fault === "duplicate") bad.items[0] = rows[0]!;
  if (fault === "cursor") bad.next_cursor = "25";
  vi.spyOn(client, "transmissions").mockResolvedValueOnce(bad);
  await pager.next();
  expect(pager.getSnapshot().status).toBe("error");
  expect(pager.getSnapshot().page).toBeUndefined();
});
it("rejects late responses after cancellation or replacement", async () => {
  const { client, pager } = setup();
  let resolve!: (value: typeof fixture.references) => void;
  vi.spyOn(client, "transmissions").mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = pager.load();
  pager.cancel();
  resolve(fixture.references);
  await pending;
  expect(pager.getSnapshot().page).toBeUndefined();
});
it("header continuation has no old 20-page cap and retains generation on backward navigation", async () => {
  let index = 0;
  const client = new PublicStationClient(async () =>
    Response.json({
      ...fixture.queries[0]!.response,
      items: [],
      next_cursor: `cursor_${++index}`,
    }),
  );
  const search = new PublicStationSearch(client);
  await search.search({});
  for (let n = 0; n < 24; n++) await search.next();
  expect(search.getSnapshot()).toMatchObject({
    status: "ready",
    pageIndex: 24,
    next: true,
  });
  vi.spyOn(client, "list").mockResolvedValueOnce({
    ...fixture.queries[0]!.response,
    catalog_revision: "00000000-0000-4000-8000-000000000999",
  });
  await search.previous();
  expect(search.getSnapshot().status).toBe("error");
});
