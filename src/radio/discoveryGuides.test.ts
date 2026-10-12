import { describe, expect, it } from "vitest";
import {
  discoveryQuery,
  guideBookmark,
  matchingGuides,
  parseDiscoveryFrequency,
} from "./discoveryGuides";
import { DAB_BAND_III_CHANNELS } from "../dab/channels";
describe("local discovery interpretation", () => {
  it.each(["ads", "adsb", "ads-b", "ADS B"])(
    "suggests 1090ES for %s and labels UAT separately",
    (query) => {
      const found = matchingGuides(query);
      expect(found[0]!.id).toBe("adsb");
      expect(found.find((g) => g.id === "uat")).toMatchObject({
        frequencyHz: 978e6,
      });
      expect(found.find((g) => g.id === "uat")!.mode).toBeUndefined();
      expect(found[0]).toMatchObject({ frequencyHz: 1090e6, mode: "ADS-B" });
    },
  );
  it.each([
    ["1090", 1090e6],
    ["103,4", 103.4e6],
    ["978 MHz", 978e6],
    ["1.09 GHz", 1090e6],
    ["144800 kHz", 144.8e6],
    ["100 Hz", 100],
  ])("parses %s without hidden unit conversion", (value, frequencyHz) =>
    expect(parseDiscoveryFrequency(String(value)).frequencyHz).toBe(
      frequencyHz,
    ),
  );
  it("uses all existing DAB block definitions and no programme identifiers", () => {
    for (const block of DAB_BAND_III_CHANNELS)
      expect(parseDiscoveryFrequency(block.label.toLowerCase())).toMatchObject({
        frequencyHz: block.frequencyHz,
        block: block.label,
      });
    expect(parseDiscoveryFrequency("dab 11C").frequencyHz).toBe(220352000);
  });
  it.each(["1,090.0", "1e9", "-100", "0", "103,4,5", "1000001 MHz", "0.1 Hz"])(
    "rejects ambiguous/malformed numeric %s",
    (query) => expect(parseDiscoveryFrequency(query).error).toBeTruthy(),
  );
  it("shows the ±500Hz half-open window and allows numeric station names through Text", () => {
    expect(discoveryQuery("103,4", "auto", "", "")).toEqual({
      min_frequency_hz: 103399500,
      max_frequency_hz: 103400500,
    });
    expect(discoveryQuery("103,4", "text", "", "")).toEqual({ q: "103,4" });
    expect(() => discoveryQuery("1090", "auto", "100", "101")).toThrow(/Clear/);
    expect(() => discoveryQuery("energy", "text", "", "101")).toThrow(/both/);
    expect(discoveryQuery("energy", "auto", "103,4", "104")).toEqual({
      q: "energy",
      min_frequency_hz: 103400000,
      max_frequency_hz: 104000000,
    });
  });
  it("contains guides only, no pretend ENERGY inventory, and no station identity in guide presets", () => {
    expect(matchingGuides("energy")).toEqual([]);
    expect(
      guideBookmark("ADS-B", "ADS-B", 1090e6).atlasReference,
    ).toBeUndefined();
    expect(matchingGuides("978")[0]!.mode).toBeUndefined();
  });
});
