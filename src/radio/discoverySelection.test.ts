import { expect, it, vi } from "vitest";
import { publicStationFixture as fixture } from "../testing/publicStationFixture";
import {
  publicReceptionCandidate,
  unchangedPublicReference,
  previewDiscovery,
} from "./discoverySelection";
import { guideBookmark } from "./discoveryGuides";
import { ReceiverController } from "./receiverController";
const id = "00000000-0000-4000-8000-000000000001";
const station = fixture.selected;
it("retains exact public IDs, rejects digital/retired/changed references rather than guessing", () => {
  expect(
    publicReceptionCandidate(station, station.transmissions[0]!.id),
  ).toMatchObject({
    station_id: id,
    transmission_id: station.transmissions[0]!.id,
    mode: "WBFM",
    frequency_hz: 103400000,
  });
  expect(() =>
    publicReceptionCandidate(station, station.transmissions[1]!.id),
  ).toThrow(/no supported station handoff/);
  expect(() => publicReceptionCandidate(station, "other")).toThrow(/no longer/);
  expect(() =>
    unchangedPublicReference(
      station,
      { ...station, publication_version: 2 },
      station.transmissions[0]!.id,
    ),
  ).toThrow(/changed/);
  expect(() =>
    unchangedPublicReference(
      station,
      { ...station, transmissions: [] },
      station.transmissions[0]!.id,
    ),
  ).toThrow(/retired/);
});
it("previews stopped source/rate/bandwidth before mutation, and rejects incompatible sources and windows", () => {
  const factory = vi.fn(),
    controller = new ReceiverController(factory);
  const bookmark = guideBookmark("ADS-B", "ADS-B", 1090e6);
  expect(
    previewDiscovery(controller, bookmark, {
      source: "rtl-sdr",
      channelFrequencyHz: 100e6,
      sampleRateHz: 1024000,
    }),
  ).toMatch(/2.4 MS\/s/);
  expect(factory).not.toHaveBeenCalled();
  expect(controller.getSnapshot().lifecycle).toBe("idle");
  expect(() =>
    previewDiscovery(controller, bookmark, {
      source: "synthetic",
      channelFrequencyHz: 100e6,
    }),
  ).toThrow(/compatible/);
  expect(() =>
    previewDiscovery(controller, bookmark, {
      source: "replay",
      channelFrequencyHz: 100e6,
    }),
  ).toThrow(/Finish/);
  expect(() =>
    previewDiscovery(controller, guideBookmark("HF", "AM", 1e6), {
      source: "bladerf",
      channelFrequencyHz: 100e6,
    }),
  ).toThrow();
  vi.spyOn(controller, "getRecordingStatus").mockReturnValue(
    {} as NonNullable<ReturnType<ReceiverController["getRecordingStatus"]>>,
  );
  expect(() =>
    previewDiscovery(controller, bookmark, {
      source: "rtl-sdr",
      channelFrequencyHz: 100e6,
    }),
  ).toThrow(/Finish/);
});
