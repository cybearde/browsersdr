import { describe, expect, it } from "vitest";
import {
  defaultRadioAppSetup,
  normalizeRadioAppSetup,
  searchFrequencies,
  appModeSettings,
} from "./radioAppSetup";
import { planRadioApp, loadRadioAppPreferences } from "./radioApps";
import { defaultModeSettings } from "./receiverConfig";
import type { ReceiverSnapshot } from "./receiverController";
const idle = {
  lifecycle: "idle",
  sessionGeneration: 0,
  message: "",
} as ReceiverSnapshot;
const config = {
  source: "rtl-sdr" as const,
  channelFrequencyHz: 100e6,
  sampleRateHz: 1_024_000,
  modeSettings: defaultModeSettings("WBFM"),
};
describe("five app setup and presets", () => {
  it.each([
    ["fm", "WBFM", 100e6],
    ["aprs", "APRS", 144.8e6],
    ["balloons", "RS41", 402e6],
    ["acars", "ACARS", 131.725e6],
    ["sensors", "SRD", 433.92e6],
  ] as const)("prepares %s without acquisition", (id, mode, frequency) => {
    expect(planRadioApp(id, config, idle)).toMatchObject({
      action: "prepare",
      configuration: { channelFrequencyHz: frequency, modeSettings: { mode } },
    });
  });
  it("preserves in-band FM, accepts explicit regions/custom channels and rejects invalid frequencies", () => {
    expect(defaultRadioAppSetup("fm", 96.7e6).frequencyHz).toBe(96.7e6);
    expect(defaultRadioAppSetup("fm", 1090e6).frequencyHz).toBe(100e6);
    for (const [id, frequencyHz] of [
      ["aprs", 144.39e6],
      ["acars", 131.45e6],
      ["balloons", 405.1e6],
    ] as const)
      expect(
        planRadioApp(id, config, idle, "5C", {
          ...defaultRadioAppSetup(id),
          region: "us",
          frequencyHz,
        }).configuration.channelFrequencyHz,
      ).toBe(frequencyHz);
    for (const frequencyHz of [NaN, Infinity, 0, 1.5, 144e6])
      expect(() =>
        normalizeRadioAppSetup("fm", {
          ...defaultRadioAppSetup("fm"),
          frequencyHz,
        }),
      ).toThrow();
    expect(() =>
      normalizeRadioAppSetup("fm", {
        ...defaultRadioAppSetup("fm"),
        region: "us",
        frequencyHz: 88e6,
      }),
    ).toThrow();
  });
  it.each(["fineoffset-wh2", "acurite-592txr", "fineoffset-wh51"] as const)(
    "binds %s to its actual decoder/modulation",
    (sensorProtocol) => {
      const setup = { ...defaultRadioAppSetup("sensors"), sensorProtocol };
      const settings = planRadioApp("sensors", config, idle, "5C", setup)
        .configuration.modeSettings!;
      expect(settings.srd).toMatchObject({
        protocol: sensorProtocol,
        modulation: sensorProtocol === "fineoffset-wh51" ? "2fsk" : "ook",
      });
      expect(appModeSettings("SRD", setup)).toEqual(settings);
    },
  );
  it("bounds and wraps FM seek without checking a channel twice", () => {
    for (const region of ["eu", "us"] as const)
      for (const direction of [1, -1] as const) {
        const frequencies = searchFrequencies(
          "fm",
          {
            ...defaultRadioAppSetup("fm"),
            region,
            frequencyHz: region === "us" ? 99.9e6 : 100e6,
          },
          direction,
        );
        expect(frequencies).toHaveLength(region === "us" ? 100 : 206);
        expect(new Set(frequencies).size).toBe(frequencies.length);
        expect(
          frequencies.every(
            (f) =>
              f >= (region === "us" ? 88.1e6 : 87.5e6) &&
              f <= (region === "us" ? 107.9e6 : 108e6),
          ),
        ).toBe(true);
      }
  });
  it("limits RS41 windows to 64 channels and rejects inverted/oversized/out-of-band windows", () => {
    expect(
      searchFrequencies("balloons", defaultRadioAppSetup("balloons")),
    ).toHaveLength(41);
    for (const [scanStartHz, scanEndHz] of [
      [402e6, 405e6],
      [403e6, 402e6],
      [400e6, 400.5e6],
    ] as const)
      expect(() =>
        searchFrequencies("balloons", {
          ...defaultRadioAppSetup("balloons"),
          scanStartHz,
          scanEndHz,
        }),
      ).toThrow();
  });
  it("sanitizes optional per-app preferences without restoring acquisition state", () => {
    const valid = defaultRadioAppSetup("sensors");
    const loaded = loadRadioAppPreferences({
      getItem: () =>
        JSON.stringify({
          version: 1,
          block: "5C",
          running: true,
          setups: {
            sensors: { ...valid, injected: "discard" },
            fm: { ...valid, frequencyHz: "evil" },
          },
        }),
    });
    expect(loaded.setups).toEqual({ sensors: valid });
    expect(loaded).not.toHaveProperty("running");
  });
});
