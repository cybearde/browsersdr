import { describe, expect, it } from "vitest";
import type { ReceiverSnapshot } from "../radio/receiverController";
import type { DigitalProvenance } from "../digital";
import type { AdsbTarget } from "../adsb/adsbReceiver";
import { defaultTextModemSettings } from "../textmodem/settings";
import {
  DECODER_EXPORT_MAX_BYTES,
  decoderIdentity,
  decoderRecords,
  decoderViewExport,
} from "./decoderViewModel";

it("shows transmitted DAB service format/bitrate/protection without repeated missing-clock prose", () => {
  const snapshot: ReceiverSnapshot = { lifecycle: "idle", message: "Retained", sessionGeneration: 1,
    dab: { state: "synchronized", message: "Found", frameCount: 1, nullSymbolCount: 1, estimatedSnrDb: null, coarseFrequencyOffsetHz: null,
      stations: [{ key: "1:0", serviceId: 1, subchannelId: 0, primary: true, dabPlus: true, playable: true, bitrateKbps: 72, protection: "EEP 2-B" }] } };
  const record = decoderRecords(snapshot, "DAB")[0]!;
  expect(record.clock).toContain("HE-AAC · DAB+");
  expect(record.clock).toContain("72 kbit/s");
  expect(record.clock).toContain("EEP 2-B");
  expect(record.clock).not.toContain("receive times");
  expect(record.fields).toContainEqual(["Protection", "EEP 2-B"]);
});

const provenance: DigitalProvenance = {
  generation: 3,
  firstInputSampleIndex: 10,
  lastInputSampleIndex: 200,
  actualInputSampleRateHz: 1_024_000,
  selectedChannelOffsetHz: 37_000,
};
const initial: ReceiverSnapshot = {
  lifecycle: "idle",
  message: "Replay finished",
  sessionGeneration: 3,
  session: {
    source: "replay",
    sessionGeneration: 3,
    requestedSampleRateHz: 1_024_000,
    actualSampleRateHz: 1_024_000,
    hardwareCenterFrequencyHz: 144_353_000,
    selectedChannelFrequencyHz: 144_390_000,
    mode: "APRS",
    channelBandwidthHz: 15_000,
    squelch: 0,
    gainDb: null,
    sampleFormat: "planar-f32-iq-normalized",
  },
};
const address = { callsign: "N0CALL", ssid: 1, repeated: false };

it("retains decoder inspection across EOF cleanup but clears it for a new acquisition", () => {
  const running: ReceiverSnapshot = {
    ...initial,
    lifecycle: "running",
    message: "Replaying",
    session: { ...initial.session!, mode: "RS41" },
  };
  const closing: ReceiverSnapshot = {
    ...running,
    lifecycle: "stopping",
    sessionGeneration: 4,
    message: "Closing the completed replay…",
  };
  const finished: ReceiverSnapshot = {
    ...closing,
    lifecycle: "idle",
    message: "Replay reached end of file. Final spectrum retained.",
  };
  const identity = decoderIdentity(running, "RS41", "replay");
  expect(decoderIdentity(closing, "RS41", "replay")).toBe(identity);
  expect(decoderIdentity(finished, "RS41", "replay")).toBe(identity);
  expect(decoderIdentity({
    ...running,
    sessionGeneration: 5,
    session: { ...running.session!, sessionGeneration: 5 },
  }, "RS41", "replay")).not.toBe(identity);
  expect(decoderIdentity({ ...finished, session: undefined }, "RS41", "replay")).not.toBe(identity);
});

it.each(["DAB", "RTTY", "WEFAX"] as const)("retains %s record keys at EOF and changes them for a new acquisition", (mode) => {
  const running: ReceiverSnapshot = {
    ...initial,
    lifecycle: "running",
    session: { ...initial.session!, mode },
    dab: { state: "synchronized", message: "Found", frameCount: 1, nullSymbolCount: 1, estimatedSnrDb: null, coarseFrequencyOffsetHz: null,
      stations: [{ key: "1:0", serviceId: 1, subchannelId: 0, primary: true, dabPlus: true, playable: true, bitrateKbps: 72, protection: "EEP 2-B" }] },
    textModem: {
      mode: mode === "DAB" ? "RTTY" : mode,
      settings: defaultTextModemSettings(),
      text: "TEST",
      messages: [{ sequence: 1, text: "TEST", integrity: "No checksum", complete: false, provenance }],
      status: "decoding", signalLevel: 1, confidence: 1, frequencyErrorHz: 0, markHz: null, spaceHz: null,
      counters: { characters: 4, accepted: 4, rejected: 0, framingErrors: 0, corrected: 0, discontinuities: 0 },
      image: { id: 1, mode: "WEFAX", width: 904, height: 800, channels: 1, rows: 1, complete: false, reason: "Receiving", provenance },
    },
  };
  const closing: ReceiverSnapshot = { ...running, lifecycle: "stopping", sessionGeneration: 4 };
  const finished: ReceiverSnapshot = { ...closing, lifecycle: "idle" };
  const records = decoderRecords(running, mode);
  expect(records).toHaveLength(1);
  const retainedKey = records[0]!.key;
  for (const snapshot of [closing, finished]) {
    expect(decoderIdentity(snapshot, mode, "replay")).toBe(decoderIdentity(running, mode, "replay"));
    expect(decoderRecords(snapshot, mode)[0]!.key).toBe(retainedKey);
  }
  const restarted: ReceiverSnapshot = { ...running, sessionGeneration: 5, session: { ...running.session!, sessionGeneration: 5 } };
  expect(decoderRecords(restarted, mode)[0]!.key).not.toBe(retainedKey);
  expect(decoderRecords({ ...finished, session: undefined }, mode)[0]!.key).not.toBe(retainedKey);
});

describe("decoder review evidence", () => {
  it("exports a full bounded aircraft collection without duplicating map history", () => {
    const targets: AdsbTarget[] = Array.from({ length: 50 }, (_, index) => ({
      icao: index.toString(16).padStart(6, "0"),
      callsign: "TEST1234",
      category: "A7",
      latitude: 52.12345678901234,
      longitude: 13.12345678901234,
      altitudeFt: 35000,
      groundSpeedKt: 450,
      trackDegrees: 90,
      verticalRateFpm: 1000,
      emergency: null,
      messages: 1000,
      lastSeenMs: 123456789.123456,
      track: Array.from({ length: 32 }, (_, n) => ({
        latitude: 52.12345678901234 + n / 1000,
        longitude: 13.12345678901234,
        timeMs: 123456789.123456 + n * 1000,
      })),
    }));
    const receiver: ReceiverSnapshot = {
      ...initial,
      adsb: {
        frames: 1,
        preamblesDetected: 1,
        validFrames: 1,
        crcValidFrames: 1,
        unsupportedFrames: 0,
        crcFailures: 0,
        ambiguousFrames: 0,
        rejectedFrames: 0,
        message: "Fixture",
        targets,
      },
    };
    const records = decoderRecords(receiver, "ADS-B");
    const exported = JSON.parse(
      decoderViewExport(receiver, "ADS-B", records, "retained", true),
    );
    expect(exported.records).toHaveLength(50);
    expect(exported.records[0].map).toBeUndefined();
    expect(exported.records[0].raw.track).toHaveLength(32);
    expect(exported.records[0].raw.category).toBe("A7");
  });
  it("keeps APRS ambiguity out of exact map points and preserves literal bytes and input provenance", () => {
    const receiver: ReceiverSnapshot = {
      ...initial,
      aprs: {
        configured: true,
        counters: {
          hdlcCandidates: 1,
          validAx25Frames: 1,
          invalidFcsFrames: 0,
          malformedAx25Frames: 0,
          decodedAprsPackets: 1,
          unsupportedAprsPackets: 0,
          duplicatePackets: 0,
        },
        stations: [
          {
            key: "N0CALL-1",
            source: address,
            destination: address,
            path: [],
            packets: 1,
            lastHeard: provenance,
            position: {
              latitudeDegrees: 50,
              longitudeDegrees: 8,
              ambiguityDigits: 2,
              format: "uncompressed",
              precisionMeters: null,
              symbolTable: "/",
              symbolCode: ">",
            },
          },
        ],
        recentPackets: [
          {
            sequence: 1,
            frame: {
              source: address,
              destination: address,
              path: [],
              control: 3,
              pid: 240,
              information: new Uint8Array([60, 62]),
            },
            payload: { kind: "status", text: "<script>literal text</script>" },
            provenance,
          },
        ],
      },
    };
    expect(decoderRecords(receiver, "APRS")[0]).not.toHaveProperty(
      "latitude",
      50,
    );
    const records = decoderRecords(receiver, "APRS", true);
    const exported = JSON.parse(
      decoderViewExport(receiver, "APRS", records, "selected", true),
    );
    expect(exported.records[0].summary).toBe("<script>literal text</script>");
    expect(exported.records[0].raw.frame.information).toEqual([60, 62]);
    expect(exported.records[0].raw.provenance).toEqual(provenance);
    expect(exported.acquisition.generation).toBe(3);
    expect(exported.display).toBe("frozen snapshot");
    expect(exported.clock).toContain("export time is not receive time");
    expect(decoderIdentity(receiver, "APRS", "replay")).not.toBe(
      decoderIdentity({
        ...receiver,
        sessionGeneration: 4,
        session: { ...receiver.session!, sessionGeneration: 4 },
      }, "APRS", "replay"),
    );
  });

  it("never exports identity/position from a rejected RS41 frame", () => {
    const receiver: ReceiverSnapshot = {
      ...initial,
      rs41: {
        configured: true,
        sondes: [],
        recentFrames: [
          {
            variant: "standard",
            fecStatus: "rejected",
            correctedErrors: 0,
            subblockIntegrity: {
              status: false,
              ptu: false,
              gpsInfo: false,
              gpsRaw: false,
              gpsPosition: false,
            },
            sondeId: "UNVERIFIED",
            provenance,
            invertedPolarity: false,
          },
        ],
        counters: {
          synchronizedFrames: 1,
          uncorrectedFrames: 0,
          correctedFrames: 0,
          rejectedFrames: 1,
          correctedSymbols: 0,
          unsupportedVariants: 0,
          badStatusSubblocks: 1,
          badGpsInfoSubblocks: 1,
          badGpsPositionSubblocks: 1,
        },
      },
    };
    const records = decoderRecords(receiver, "RS41", true);
    expect(records[0]?.label).toBe("Rejected frame");
    expect(
      decoderViewExport(receiver, "RS41", records, "retained", false),
    ).not.toContain("UNVERIFIED");
  });

  it("rejects oversized JSON and excludes unpublished broadcast media", () => {
    const records = [
      {
        key: "large",
        label: "large",
        summary: "",
        integrity: "",
        clock: "",
        fields: [],
        raw: "x".repeat(DECODER_EXPORT_MAX_BYTES),
      },
    ];
    expect(() =>
      decoderViewExport(initial, "APRS", records, "selected", false),
    ).toThrow("256 KiB");
    const exported = JSON.parse(
      decoderViewExport(initial, "APRS", [], "retained", false),
    );
    expect(exported).not.toHaveProperty("audio");
    expect(exported).not.toHaveProperty("programmeMetadata");
    expect(exported.limits.maximumExportBytes).toBe(DECODER_EXPORT_MAX_BYTES);
  });
});

it("uses qualified aircraft keys and exposes reported address/quality without an ICAO claim", () => {
  const targets: AdsbTarget[] = ["icao", "other"].map((type) => ({
    id: `18:1:${type}:ABCDEF`, address: "ABCDEF", icao: type === "icao" ? "ABCDEF" : null,
    addressType: type as "icao" | "other", origin: "ads-b", downlinkFormat: 18, controlField: 1,
    callsign: null, onGround: true, surfaceSpeedRangeKt: [175, null],
    altitudeFt: null, latitude: null, longitude: null, groundSpeedKt: null,
    trackDegrees: null, verticalRateFpm: null, emergency: null, messages: 1, lastSeenMs: 1000,
    quality: { version: 2, nacP: 9, sil: 2, silBasis: "per-hour", reportedAtMs: 1000 },
  }));
  const receiver = { ...initial, adsb: { frames: 2, preamblesDetected: 2, validFrames: 2, crcValidFrames: 2, unsupportedFrames: 0, crcFailures: 0, ambiguousFrames: 0, rejectedFrames: 0, targets, message: "" } };
  const records = decoderRecords(receiver, "ADS-B");
  expect(new Set(records.map(r => r.key)).size).toBe(2);
  const nonIcao = records.find(r => (r.raw as AdsbTarget).icao === null)!;
  expect(nonIcao.fields).toContainEqual(["Reported address", "ABCDEF"]);
  expect(nonIcao.fields).not.toContainEqual(["ICAO address", "ABCDEF"]);
  expect(nonIcao.fields).toContainEqual(["Reported SIL", "2 · per-hour"]);
  expect(nonIcao.summary).toBe("On ground · ≥175 kt");
  expect(JSON.parse(decoderViewExport(receiver, "ADS-B", records, "retained", false)).records).toHaveLength(2);
});

it("exposes APRS packet categories and retained weather with units without inventing missing readings", () => {
  const snapshot: ReceiverSnapshot = { ...initial, aprs: { configured: true, stations: [], counters: { hdlcCandidates: 2, validAx25Frames: 2, invalidFcsFrames: 0, malformedAx25Frames: 0, decodedAprsPackets: 2, unsupportedAprsPackets: 0, duplicatePackets: 0 }, recentPackets: [
    { sequence: 1, frame: { source: address, destination: address, path: [], control: 0x03, pid: 0xf0, information: new Uint8Array() }, payload: { kind: "weather", comment: "", weather: { temperatureCelsius: 0, humidityPercent: 82 } }, provenance },
    { sequence: 2, frame: { source: address, destination: address, path: [], control: 0x03, pid: 0xf0, information: new Uint8Array() }, payload: { kind: "message", addressee: "N0CALL", text: "<script>literal</script>" }, provenance },
  ] } };
  const records = decoderRecords(snapshot, "APRS", true);
  expect(records[0]).toMatchObject({ category: "messages", summary: "<script>literal</script>" });
  expect(records[1]).toMatchObject({ category: "weather", hasWeather: true });
  expect(records[1]!.fields).toContainEqual(["Weather · Temperature", "0 °C · retained"]);
  expect(records[1]!.fields.some(([name]) => name.includes("Pressure"))).toBe(false);
});
