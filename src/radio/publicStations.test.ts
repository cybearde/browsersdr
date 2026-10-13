import { expect, it } from "vitest";
import fixture from "../testing/fixtures/atlas/browsersdr-public-station-search-v2.json";
import {
  parsePublicPage,
  parsePublicDetail,
  parsePublicTransmissions,
  publicQueryParams,
  safePublicSourceUrl,
} from "./publicStations";
const id = "00000000-0000-4000-8000-000000000001";
it("accepts pinned v2 headers and transmission pages without sibling imports", () => {
  expect(parsePublicDetail(fixture.responses[0], id)).toEqual(
    fixture.responses[0],
  );
  expect(parsePublicPage(fixture.responses[1])).toEqual(fixture.responses[1]);
  expect(parsePublicTransmissions(fixture.responses[2], id)).toEqual(
    fixture.responses[2],
  );
});
it("rejects private fields, embedded arrays, wrong versions, IDs, counts, dates and cursor shapes", () => {
  const original = parsePublicPage(fixture.responses[1]);
  for (const mutate of [
    (p: typeof original) =>
      Object.assign(p.items[0]!.station, { reception: {} }),
    (p: typeof original) =>
      Object.assign(p.items[0]!.station, { transmissions: [] }),
    (p: typeof original) =>
      Object.assign(p, {
        contract_version: "browsersdr-public-station-search/1",
      }),
    (p: typeof original) => {
      p.items[0]!.match.matching_transmission_count = 3;
    },
    (p: typeof original) => {
      p.items[0]!.station.transmission_count = -1;
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
    (p: typeof original) => {
      p.next_cursor = "bad cursor";
    },
  ]) {
    const page = structuredClone(original);
    mutate(page);
    expect(() => parsePublicPage(page)).toThrow(/Malformed/);
  }
  const refs = parsePublicTransmissions(fixture.responses[2], id);
  for (const value of [
    { ...refs, station_id: "other" },
    { ...refs, total: 1 },
    { ...refs, items: [refs.items[0], refs.items[0]] },
    { ...refs, items: [], next_cursor: "more" },
    { ...refs, items: [{ ...refs.items[0], coordinates: {} }] },
  ])
    expect(() => parsePublicTransmissions(value, id)).toThrow(/Malformed/);
  expect(() =>
    parsePublicDetail(
      fixture.responses[0],
      "00000000-0000-4000-8000-000000000099",
    ),
  ).toThrow(/Malformed/);
});
it("bounds query/target/cursors and preserves literal text", () => {
  expect(publicQueryParams({ q: "100%_radio" }).get("q")).toBe("100%_radio");
  expect(
    publicQueryParams({ cursor: "x".repeat(2048) }).get("cursor"),
  ).toHaveLength(2048);
  for (const query of [
    { cursor: "x".repeat(2049) },
    { q: "x".repeat(201) },
    { min_frequency_hz: NaN, max_frequency_hz: 100 },
    { min_frequency_hz: 10 },
  ])
    expect(() => publicQueryParams(query)).toThrow();
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
