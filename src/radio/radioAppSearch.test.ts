import { afterEach, expect, it, vi } from "vitest";
import { RadioAppSearch, channelEvidence } from "./radioAppSearch";
import {
  ReceiverController,
  type ReceiverBackendEvents,
  type ReceiverStartOptions,
} from "./receiverController";
import { defaultModeSettings } from "./receiverConfig";
import type { SourceSessionMetadata, SpectrumFrame } from "./types";
import type { AnalysisPipeline } from "../dsp/analysisPipeline";
async function harness(mode: "WBFM" | "RS41" = "WBFM") {
  let events!: ReceiverBackendEvents,
    metadata!: Omit<SourceSessionMetadata, "sessionGeneration">;
  const tune = vi.fn(),
    stop = vi.fn(),
    onTuned = vi.fn(),
    volumes = vi.fn();
  const controller = new ReceiverController((e) => {
    events = e;
    return {
      start: async (o: ReceiverStartOptions) => {
        e.permissionGranted();
        metadata = {
          source: "rtl-sdr",
          selectedChannelFrequencyHz: o.channelFrequencyHz,
          hardwareCenterFrequencyHz: o.channelFrequencyHz,
          requestedSampleRateHz: 1_024_000,
          actualSampleRateHz: 1_024_000,
          mode,
          channelBandwidthHz: defaultModeSettings(mode).bandwidthHz,
          squelch: 0,
          gainDb: null,
          sampleFormat: "planar-f32-iq-normalized",
        };
        return metadata;
      },
      stop: async () => {
        stop();
      },
      tune: async (frequency) => {
        tune(frequency);
        metadata = {
          ...metadata,
          selectedChannelFrequencyHz: frequency,
          hardwareCenterFrequencyHz: frequency,
        };
        return metadata;
      },
      configureMode: async (settings) => {
        metadata = {
          ...metadata,
          mode: settings.mode,
          channelBandwidthHz: settings.bandwidthHz,
        };
        return metadata;
      },
      setVolume: volumes,
      setGain: async (gain) => gain,
    };
  });
  await controller.start({
    source: "rtl-sdr",
    channelFrequencyHz: mode === "WBFM" ? 100e6 : 402e6,
    sampleRateHz: 1_024_000,
    modeSettings: defaultModeSettings(mode),
    volume: 0.7,
  });
  const listeners = new Set<(f: SpectrumFrame) => void>();
  const analysis = {
    subscribeMeasurements(listener: (f: SpectrumFrame) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as AnalysisPipeline;
  const search = new RadioAppSearch(controller, analysis, () => {}, onTuned, {
    channelWallMs: 100,
    fmSeconds: 2,
    balloonSeconds: 3,
    fmTotalWallMs: 500,
    balloonTotalWallMs: 500,
  });
  const clock = (
    seconds: number,
    generation = controller.getSnapshot().sessionGeneration,
  ) => {
    for (const listener of listeners)
      listener({
        sessionGeneration: generation,
        sampleIndex: seconds * 1_024_000,
        sampleRateHz: 1_024_000,
      } as SpectrumFrame);
  };
  return {
    controller,
    events: () => events,
    search,
    tune,
    stop,
    onTuned,
    clock,
    listeners,
    volumes,
  };
}
const settle = async () => {
  for (let n = 0; n < 30; n++) await Promise.resolve();
};
afterEach(() => vi.useRealTimers());
it("uses acquired time, completes a bounded noise search and restores the original channel/audio", async () => {
  const h = await harness(),
    task = h.search.run([100.1e6, 100.2e6], "WBFM");
  await settle();
  h.clock(0);
  h.clock(1);
  expect(h.search.getSnapshot().visited).toBe(0);
  h.clock(2);
  await settle();
  h.clock(0);
  h.clock(2);
  await task;
  expect(h.search.getSnapshot()).toMatchObject({
    status: "complete",
    visited: 2,
  });
  expect(h.tune.mock.calls.map(([f]) => f)).toEqual([100.1e6, 100.2e6, 100e6]);
  expect(h.listeners.size).toBe(0);
  expect(h.volumes).toHaveBeenLastCalledWith(0.7);
});
it("stops at fresh validated RDS and ignores stale-generation clock ticks", async () => {
  const h = await harness(),
    generation = h.controller.getSnapshot().sessionGeneration,
    task = h.search.run([100.1e6, 100.2e6], "WBFM");
  await settle();
  h.clock(0, generation);
  h.clock(10, generation);
  expect(h.search.getSnapshot().visited).toBe(0);
  h.events().rdsChanged({
    pi: "C201",
    programmeService: "TEST FM",
    radioText: null,
    validGroups: 4,
  });
  await task;
  expect(h.search.getSnapshot()).toMatchObject({ status: "found", visited: 1 });
  expect(h.tune).toHaveBeenCalledOnce();
  expect(h.listeners.size).toBe(0);
});
it("cancels a dwell and restores without starting a new acquisition", async () => {
  const h = await harness(),
    task = h.search.run([100.1e6], "WBFM");
  await settle();
  await h.search.cancel();
  await task;
  expect(h.search.getSnapshot().status).toBe("cancelled");
  expect(h.controller.getSnapshot().session?.selectedChannelFrequencyHz).toBe(
    100e6,
  );
  expect(h.listeners.size).toBe(0);
});
it("does not restore after global Stop or a changed generation", async () => {
  const h = await harness(),
    task = h.search.run([100.1e6], "WBFM");
  await settle();
  const cancel = h.search.cancel(false);
  await h.controller.stop();
  await cancel;
  await task;
  expect(h.controller.getSnapshot().lifecycle).toBe("idle");
  expect(h.tune).toHaveBeenCalledOnce();
  expect(h.listeners.size).toBe(0);
  const other = await harness(),
    otherTask = other.search.run([100.1e6], "WBFM");
  await settle();
  await other.controller.tune(101e6);
  await otherTask;
  expect(
    other.controller.getSnapshot().session?.selectedChannelFrequencyHz,
  ).toBe(101e6);
  expect(other.search.getSnapshot().status).toBe("error");
});
it("requires validated RS41 STATUS and accepts an identity without GPS", async () => {
  const h = await harness("RS41"),
    task = h.search.run([402.025e6], "RS41");
  await settle();
  const bad = {
    configured: true as const,
    sondes: [],
    counters: {},
    recentFrames: [
      {
        fecStatus: "rejected",
        sondeId: "EVIL",
        subblockIntegrity: { status: true },
      },
    ],
  };
  expect(
    channelEvidence(
      { ...h.controller.getSnapshot(), rs41: bad as never },
      "RS41",
    ),
  ).toBeUndefined();
  h.events().rs41Changed?.(
    {
      ...bad,
      recentFrames: [
        {
          fecStatus: "uncorrected",
          sondeId: "TEST1234",
          variant: "standard",
          provenance: {
            generation: h.controller.getSnapshot().sessionGeneration,
          },
          subblockIntegrity: { status: true },
        },
      ],
    } as never,
    { generation: h.controller.getSnapshot().sessionGeneration } as never,
  );
  await task;
  expect(h.search.getSnapshot().message).toContain("TEST1234");
  expect(h.search.getSnapshot().status).toBe("found");
});
it("times out stalled acquisition and removes subscriptions; malformed bounds never tune", async () => {
  vi.useFakeTimers();
  const h = await harness(),
    task = h.search.run([100.1e6], "WBFM");
  await settle();
  await vi.advanceTimersByTimeAsync(101);
  await task;
  expect(h.search.getSnapshot().status).toBe("error");
  expect(h.listeners.size).toBe(0);
  expect(h.controller.getSnapshot().session?.selectedChannelFrequencyHz).toBe(
    100e6,
  );
  await expect(h.search.run([], "WBFM")).rejects.toThrow();
  expect(h.tune).toHaveBeenCalledTimes(2);
});
