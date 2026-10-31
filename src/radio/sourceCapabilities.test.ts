import { describe, expect, it } from "vitest";
import { defaultModeSettings, RECEIVER_MODES } from "./receiverConfig";
import { validateOptions } from "./receiverController";
import { IqRecorder } from "./iqRecording";
import { SYNTHETIC_DEMO_SESSION } from "../testing/syntheticTone";
import {
  DEFAULT_HACKRF_RX_SETTINGS, discoverHackrfCapabilities, sourceCapabilities,
  validateHackrfRxSettings, validateHackrfSessionDetails, validateSourceFrequency, validateSourceRoute,
  type HackrfRuntimeEvidence, type HackrfRxSettings, type HackrfSessionDetails,
} from "./sourceCapabilities";

const options = { channelFrequencyHz: 100_000_000, volume: 0.5 };
function evidence(): HackrfRuntimeEvidence {
  return {
    identity: { kind: "hackrf-pro", vendorId: 0x1d50, productId: 0x6089, boardId: 5,
      boardRevisionRaw: 0x89, usbApiVersion: 0x0113, firmwareVersion: "unrecognized-build",
      partIdWords: [0, 0xffffffff], serialWords: [0, 1, 2, 3], platformSupport: 0x10 },
    descriptorLayoutVerified: true, mandatoryQueriesVerified: true,
    standardImageIndex: 0, standardImageSelectionAcknowledged: true,
  };
}

function hackrfDetails(): HackrfSessionDetails {
  return {
    capabilities: discoverHackrfCapabilities(evidence()), nativeEncoding: "ci8",
    nativeSampleRateHz: 1_024_000, effectiveSampleRateHz: 1_024_000,
    adcSampleRateHz: 32_768_000, fpgaDecimationFactor: 32,
    hostResampling: { kind: "none", numerator: 1, denominator: 1 }, rateEvidence: "firmware-reported",
    captureSettings: { ...DEFAULT_HACKRF_RX_SETTINGS, requestedCenterFrequencyHz: 100_000_000,
      requestedSampleRateHz: 1_024_000, appliedRateFixed36: String(1_024_000n * 2n ** 36n),
      appliedRfFixed24: String(100_000_000n * 2n ** 24n), appliedRotation: 0,
      reportedBasebandBandwidthHz: 768_000, reportedAnalogLpfTargetHz: 768_000,
      settingsEvidence: "accepted-and-firmware-reported" },
  };
}

describe("source capabilities and requests", () => {
  it("keeps pre-connect defaults separate from verified identity", () => {
    expect(sourceCapabilities("hackrf")).toMatchObject({ requiresUsb: true, persistentConnection: true, gain: { kind: "hackrf-stages", lnaCodes: [0, 8, 16, 24, 32, 33, 40] }, rates: { defaultHz: 9_600_000 } });
    expect(sourceCapabilities("hackrf", evidence().identity).gain).toMatchObject({ lnaCodes: [0, 16, 33] });
    expect(sourceCapabilities("rtl-sdr").gain.kind).toBe("rtl-auto-manual");
    for (const source of ["synthetic", "replay"] as const) expect(sourceCapabilities(source)).toMatchObject({ requiresUsb: false, persistentConnection: false, gain: { kind: "none" } });
    expect(discoverHackrfCapabilities(evidence())).toMatchObject({ firmwareBuildValidation: "unvalidated", hardwareValidation: "pending", nativeEncoding: "ci8" });
  });
  it.each([9, 10, 11, 137, 138, 139])("accepts production revision %i", (revision) => {
    const input = evidence(); input.identity.boardRevisionRaw = revision;
    expect(() => discoverHackrfCapabilities(input)).not.toThrow();
  });
  it.each([
    { boardId: 2 }, { boardRevisionRaw: 6 }, { boardRevisionRaw: 0xfe }, { boardRevisionRaw: 0xff },
    { usbApiVersion: 0x0112 }, { usbApiVersion: 0x0114 }, { platformSupport: 0 },
    { vendorId: 0 }, { productId: 0x604b }, { firmwareVersion: "" }, { firmwareVersion: "a".repeat(32) },
    { firmwareVersion: "bad\n" },
  ])("rejects incompatible identity %j", (patch) => {
    const input = evidence(); Object.assign(input.identity, patch);
    expect(() => discoverHackrfCapabilities(input)).toThrow(/requires a supported profile/);
  });
  it.each([
    { descriptorLayoutVerified: false }, { mandatoryQueriesVerified: false },
    { standardImageIndex: 1 }, { standardImageSelectionAcknowledged: false },
  ])("rejects incomplete format/firmware evidence %j", (patch) => {
    expect(() => discoverHackrfCapabilities({ ...evidence(), ...patch })).toThrow();
  });
  it("copies identity words rather than retaining mutable probe buffers", () => {
    const input = evidence(); const result = discoverHackrfCapabilities(input);
    input.identity.serialWords = [99, 99, 99, 99];
    expect(result.identity.serialWords).toEqual([0, 1, 2, 3]);
  });
  it("preserves high frequencies and checks inclusive operating bounds", () => {
    for (const frequency of [100_000, 4_300_000_001, 6_000_000_000]) expect(() => validateSourceFrequency("hackrf", frequency)).not.toThrow();
    const high = { ...options, source: "hackrf" as const, channelFrequencyHz: 4_300_000_001 };
    validateOptions(high); expect(high.channelFrequencyHz).toBe(4_300_000_001);
    for (const frequency of [NaN, Infinity, -Infinity, -1, 99_999, 6_000_000_001, 4_300_000_000.5]) expect(() => validateSourceFrequency("hackrf", frequency)).toThrow();
    expect(() => validateOptions({ ...high, channelFrequencyHz: 100_000 })).toThrow(/passband/);
    expect(() => validateOptions({ ...high, channelFrequencyHz: 175_000 })).not.toThrow();
  });
  it("validates Pro stages without imposing RTL's gain range or AGC", () => {
    for (const rxLnaGainCode of [0, 16, 33] as const) {
      for (const rxVgaGainDb of [0, 12, 62]) expect(() => validateHackrfRxSettings({ ...DEFAULT_HACKRF_RX_SETTINGS, rxLnaGainCode, rxVgaGainDb, rfAmplifierEnabled: true })).not.toThrow();
    }
    expect(validateHackrfRxSettings({...DEFAULT_HACKRF_RX_SETTINGS, antennaPowerEnabled:true}).antennaPowerEnabled).toBe(true);
    for (const patch of [{ rxLnaGainCode: 32 }, { rxLnaGainCode: NaN }, { rxVgaGainDb: 1 }, { rxVgaGainDb: 64 }, { rxVgaGainDb: -2 }, { rxVgaGainDb: 2.5 }, { rxVgaGainDb: Infinity }, { antennaPowerEnabled: "on" }, { rfAmplifierEnabled: 1 }]) {
      expect(() => validateHackrfRxSettings({ ...DEFAULT_HACKRF_RX_SETTINGS, ...patch } as HackrfRxSettings)).toThrow();
    }
    expect(() => validateOptions({ ...options, source: "hackrf", gainDb: null })).toThrow(/stage/);
    expect(() => validateOptions({ ...options, source: "rtl-sdr", hardwareSettings: DEFAULT_HACKRF_RX_SETTINGS })).toThrow();
    for (const gainDb of [null, 0, 49.6]) expect(() => validateOptions({ ...options, gainDb })).not.toThrow();
    for (const gainDb of [-0.1, 50, NaN]) expect(() => validateOptions({ ...options, gainDb })).toThrow();
  });
  it("allows 9.6 MS/s only on HackRF or native CI8 replay routes", () => {
    for (const mode of RECEIVER_MODES) expect(() => validateOptions({ ...options, source: "hackrf", sampleRateHz: 9_600_000, modeSettings: defaultModeSettings(mode) })).not.toThrow();
    for (const source of ["rtl-sdr", "synthetic"] as const) expect(() => validateOptions({ ...options, source, sampleRateHz: 9_600_000 })).toThrow();
    for (const rate of [9_599_999, 9_600_001, 19_200_001]) expect(() => validateOptions({ ...options, source: "hackrf", sampleRateHz: rate })).toThrow();
  });
  it("exposes experimental 19.2 MS/s for bladeRF", () => {
    const rates = sourceCapabilities("bladerf").rates;
    expect(rates).toMatchObject({ valuesHz: [2_400_000, 4_800_000, 9_600_000, 19_200_000], experimentalHz: [19_200_000] });
    for (const mode of RECEIVER_MODES) expect(() => validateOptions({ ...options, source: "bladerf", sampleRateHz: 19_200_000, modeSettings: defaultModeSettings(mode) })).not.toThrow();
  });
  it("uses hardware mode/rate combinations and replay's own rate limits", () => {
    for (const source of ["rtl-sdr", "hackrf"] as const) {
      for (const mode of RECEIVER_MODES) {
        expect(() => validateOptions({ ...options, source, sampleRateHz: 2_400_000, modeSettings: defaultModeSettings(mode) })).not.toThrow();
        const run = () => validateOptions({ ...options, source, sampleRateHz: 1_024_000, modeSettings: defaultModeSettings(mode) });
        if (["DAB", "ADS-B"].includes(mode)) expect(run).toThrow(); else expect(run).not.toThrow();
      }
      for (const rate of [NaN, Infinity, 0, 8_000_000, 2_400_000.5]) expect(() => validateOptions({ ...options, source, sampleRateHz: rate })).toThrow();
    }
    expect(() => validateOptions({ ...options, source: "replay", sampleRateHz: 2_048_000, modeSettings: defaultModeSettings("DAB") })).not.toThrow();
    for (const rate of [7999, 3_200_001, NaN]) expect(() => validateOptions({ ...options, source: "replay", sampleRateHz: rate })).toThrow();
    expect(() => validateOptions({ ...options, source: "replay", sampleRateHz: 1_024_000, modeSettings: defaultModeSettings("DAB") })).not.toThrow();
    expect(() => validateSourceRoute("replay", defaultModeSettings("DAB"), 1_024_000, 200_000_000)).toThrow();
    // Existing UI passes a rate preference ignored by the fixed-rate demo.
    expect(() => validateOptions({ ...options, source: "synthetic", sampleRateHz: 2_400_000 })).not.toThrow();
    for (const mode of ["DAB", "ADS-B", "AIS"] as const) expect(() => validateOptions({ ...options, source: "synthetic", modeSettings: defaultModeSettings(mode) })).toThrow();
    expect(() => validateOptions({ ...options, source: "synthetic", modeSettings: defaultModeSettings("OFF") })).not.toThrow();
    expect(() => validateSourceRoute("hackrf", defaultModeSettings("DAB"), 2_399_999.75, 200_000_000)).not.toThrow();
  });
  it("preserves reported rate evidence and rejects inconsistent native/effective metadata", () => {
    const valid = hackrfDetails(); expect(() => validateHackrfSessionDetails(valid)).not.toThrow();
    for (const patch of [{ nativeSampleRateHz: NaN }, { effectiveSampleRateHz: 8_000_000 }, { adcSampleRateHz: 1_024_000 }, { fpgaDecimationFactor: 16 as const }]) {
      expect(() => validateHackrfSessionDetails({ ...valid, ...patch })).toThrow();
    }
    for (const appliedRateFixed36 of ["-1", "18446744073709551616", "1.5", "00", "1"]) expect(() => validateHackrfSessionDetails({ ...valid, captureSettings: { ...valid.captureSettings, appliedRateFixed36 } })).toThrow();
    expect(() => new IqRecorder({ ...SYNTHETIC_DEMO_SESSION, source: "hackrf" })).toThrow(/native signed/);
  });
});

it("offers owner-accepted 19.2 MS/s without an experimental label and restricts it to HackRF", () => {
 expect(sourceCapabilities("hackrf").rates).not.toHaveProperty("experimentalHz");
 for (const mode of RECEIVER_MODES) expect(() => validateOptions({ ...options, source: "hackrf", sampleRateHz: 19_200_000, modeSettings: defaultModeSettings(mode) })).not.toThrow();
 for (const source of ["rtl-sdr", "synthetic"] as const) expect(() => validateOptions({ ...options, source, sampleRateHz: 19_200_000 })).toThrow();
});
