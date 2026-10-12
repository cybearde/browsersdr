import { expect, it } from "vitest";
import fixture from "../testing/fixtures/atlas/browsersdr-public-station-search-v1.json";
import {
  parsePublicPage,
  parsePublicDetail,
  publicQueryParams,
  safePublicSourceUrl,
} from "./publicStations";
it("accepts every portable list/detail wire example without importing sibling source", () => {
  for (const query of fixture.queries)
    expect(parsePublicPage(query.response)).toEqual(query.response);
  for (const [id, detail] of Object.entries(fixture.details))
    expect(parsePublicDetail(detail, id)).toEqual(detail);
});
it("rejects private fields, wrong versions, malformed sizes/IDs/dates and forged match IDs", () => {
  const original = fixture.queries[0]!.response;
  for (const mutate of [
    (p: typeof original) =>
      Object.assign(p.items[0]!.station, { reception: {} }),
    (p: typeof original) => {
      p.contract_version = "other";
    },
    (p: typeof original) => {
      p.items[0]!.match.reference_ids = [];
    },
    (p: typeof original) => {
      p.items[0]!.station.sources[0]!.retrieved_at = "2026-02-30T00:00:00Z";
    },
    (p: typeof original) => {
      p.items[0]!.station.sources[0]!.url = "https://127.0.0.1/private";
    },
    (p: typeof original) => {
      p.items = Array(51).fill(p.items[0]);
    },
  ]) {
    const page = structuredClone(original);
    mutate(page);
    expect(() => parsePublicPage(page)).toThrow(/Malformed/);
  }
  const detail = Object.values(fixture.details)[0]!;
  expect(() =>
    parsePublicDetail(detail, "00000000-0000-4000-8000-000000000099"),
  ).toThrow(/Malformed/);
});
it("bounds query/target/cursors and preserves literal text", () => {
  expect(publicQueryParams({ q: "100%_radio" }).get("q")).toBe("100%_radio");
  expect(
    publicQueryParams({ cursor: "x".repeat(2048) }).get("cursor"),
  ).toHaveLength(2048);
  expect(() => publicQueryParams({ cursor: "x".repeat(2049) })).toThrow();
  expect(() => publicQueryParams({ q: "x".repeat(201) })).toThrow();
  expect(() =>
    publicQueryParams({ min_frequency_hz: NaN, max_frequency_hz: 100 }),
  ).toThrow();
  expect(() => publicQueryParams({ min_frequency_hz: 10 })).toThrow();
  expect(safePublicSourceUrl("https://example.org/source")).toBe(true);
  for (const url of [
    "javascript:alert(1)",
    "https://a.local/path",
    "https://example.org/?token=secret",
    "https://user:pass@example.org/",
    "https://2130706433/",
  ])
    expect(safePublicSourceUrl(url)).toBe(false);
});
