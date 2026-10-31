import { afterEach, describe, expect, it, vi } from "vitest";
import { DabStationScan } from "./dabStationScan";
import { DAB_BAND_III_CHANNELS } from "../dab/channels";
import type {
  ReceiverController,
  ReceiverSnapshot,
} from "./receiverController";
import type { AnalysisPipeline } from "../dsp/analysisPipeline";
import type { SpectrumFrame } from "./types";
import type { DabSnapshot } from "../dab/dabReceiver";

function harness() {
  let snapshot: ReceiverSnapshot = {
    lifecycle: "running",
    sessionGeneration: 1,
    message: "DAB",
    session: {
      source: "rtl-sdr",
      sessionGeneration: 1,
      mode: "DAB",
      channelBandwidthHz: 1_536_000,
      selectedChannelFrequencyHz: 178_352_000,
      hardwareCenterFrequencyHz: 178_352_000,
      actualSampleRateHz: 2_400_000,
      requestedSampleRateHz: 2_400_000,
      squelch: 0,
      gainDb: null,
      sampleFormat: "planar-f32-iq-normalized",
    },
  };
  const listeners = new Set<() => void>(),
    measurements = new Set<(frame: SpectrumFrame) => void>();
  const notify = () => {
    for (const fn of listeners) fn();
  };
  const tune = vi.fn(async (hz: number) => {
    snapshot = {
      ...snapshot,
      sessionGeneration: snapshot.sessionGeneration + 1,
      dab: undefined,
      session: {
        ...snapshot.session!,
        sessionGeneration: snapshot.sessionGeneration + 1,
        selectedChannelFrequencyHz: hz,
        hardwareCenterFrequencyHz: hz,
      },
    };
    notify();
  });
  const controller = {
    getSnapshot: () => snapshot,
    stop: async () => {
      snapshot = {
        ...snapshot,
        lifecycle: "idle",
        sessionGeneration: snapshot.sessionGeneration + 1,
      };
      notify();
    },
    tune,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  } as unknown as ReceiverController;
  const analysis = {
    subscribeMeasurements: (fn: (frame: SpectrumFrame) => void) => {
      measurements.add(fn);
      return () => measurements.delete(fn);
    },
  } as Pick<AnalysisPipeline, "subscribeMeasurements">;
  const scanner = new DabStationScan(controller, analysis, () => {}, {
    minimumSeconds: 2,
    maximumSeconds: 6,
    stableSeconds: 1,
    blockWallMs: 15_000,
    totalWallMs: 600_000,
  });
  return {
    scanner,
    tune,
    publish(dab: DabSnapshot) {
      snapshot = { ...snapshot, dab };
      notify();
    },
    clock(seconds: number, generation = snapshot.sessionGeneration) {
      for (const fn of measurements)
        fn({
          sessionGeneration: generation,
          sampleIndex: seconds * 2_400_000,
          sampleRateHz: 2_400_000,
        } as SpectrumFrame);
    },
    stop() {
      snapshot = {
        ...snapshot,
        lifecycle: "idle",
        sessionGeneration: snapshot.sessionGeneration + 1,
      };
      notify();
    },
    async ready() {
      for (let n = 0; n < 30; n++) {
        if (listeners.size + measurements.size > 0) return;
        await Promise.resolve();
      }
      throw new Error("DAB observation did not start");
    },
    subscriptions: () => listeners.size + measurements.size,
  };
}
const dab = (count = 1): DabSnapshot => ({
  state: "synchronized",
  frameCount: 40,
  nullSymbolCount: 40,
  estimatedSnrDb: 20,
  coarseFrequencyOffsetHz: 0,
  ficBlockCount: 480,
  ensemble: { id: 0xcafe, label: "Test Ensemble", shortLabel: "Test" },
  stations: Array.from({ length: count }, (_, i) => ({
    key: `${4660 + i}:0`,
    serviceId: 4660 + i,
    subchannelId: 0,
    dabPlus: true,
    playable: true,
    primary: true,
    label: i ? `Station ${i}` : "Test Radio",
  })),
  message: "FIC",
});
afterEach(() => vi.useRealTimers());
describe("decoded DAB station scan", () => {
  it("visits an explicit block, collects stable decoded services and restores the original block", async () => {
    const h = harness(),
      task = h.scanner.run([DAB_BAND_III_CHANNELS.at(-1)!]);
    await h.ready();
    h.clock(0);
    h.publish(dab());
    h.clock(2);
    await task;
    expect(h.scanner.getSnapshot()).toMatchObject({
      status: "complete",
      visited: 1,
      services: [{ label: "Test Radio", block: "13F", ensembleId: 0xcafe }],
    });
    expect(h.tune.mock.calls.map(([hz]) => hz)).toEqual([
      239_200_000, 178_352_000,
    ]);
    expect(h.subscriptions()).toBe(0);
  });
  it("never turns spectrum activity or synchronization alone into a station", async () => {
    const h = harness(),
      task = h.scanner.run([DAB_BAND_III_CHANNELS[0]!]);
    await h.ready();
    h.clock(0);
    h.publish({ ...dab(), ficBlockCount: 0 });
    h.clock(6);
    await task;
    expect(h.scanner.getSnapshot().services).toEqual([]);
    expect(h.scanner.getSnapshot().status).toBe("complete");
  });
  it("cancels a dwell, retains partial results and removes subscriptions", async () => {
    const h = harness(),
      task = h.scanner.run([
        DAB_BAND_III_CHANNELS[0]!,
        DAB_BAND_III_CHANNELS[1]!,
      ]);
    await h.ready();
    h.clock(0);
    h.publish(dab());
    h.clock(2);
    await h.ready();
    await h.scanner.cancel();
    await task;
    expect(h.scanner.getSnapshot().status).toBe("cancelled");
    expect(h.scanner.getSnapshot().services.length).toBe(1);
    expect(h.subscriptions()).toBe(0);
  });
  it("does not restore or acquire another block after global Stop", async () => {
    const h = harness(),
      task = h.scanner.run([
        DAB_BAND_III_CHANNELS[0]!,
        DAB_BAND_III_CHANNELS[1]!,
      ]);
    await h.ready();
    h.stop();
    await task;
    expect(h.tune).toHaveBeenCalledOnce();
    expect(h.scanner.getSnapshot().status).toBe("error");
    expect(h.subscriptions()).toBe(0);
  });
  it("rejects a stale measurement generation and reports a wall timeout instead of no stations", async () => {
    vi.useFakeTimers();
    const h = harness(),
      task = h.scanner.run([DAB_BAND_III_CHANNELS[0]!]);
    await h.ready();
    h.clock(0, 1);
    h.clock(20, 1);
    h.publish(dab());
    await vi.advanceTimersByTimeAsync(15_000);
    await task;
    expect(h.scanner.getSnapshot()).toMatchObject({
      status: "error",
      services: [],
    });
    expect(h.scanner.getSnapshot().message).toMatch(/Timed out/);
    expect(h.subscriptions()).toBe(0);
  });
  it("bounds service results and preserves different IDs sharing the same label", async () => {
    const h = harness(),
      task = h.scanner.run([DAB_BAND_III_CHANNELS[0]!]);
    await h.ready();
    h.clock(0);
    h.publish(dab(300));
    h.clock(2);
    await task;
    expect(h.scanner.getSnapshot().services).toHaveLength(256);
    expect(h.scanner.getSnapshot().overflow).toBe(true);
    expect(
      JSON.stringify(h.scanner.getSnapshot().services).length,
    ).toBeLessThan(128 * 1024);
  });
  it("bounds an unacknowledged tune and never restores after its timeout", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.tune.mockImplementation(() => new Promise<void>(() => {}));
    const task = h.scanner.run([DAB_BAND_III_CHANNELS[0]!]);
    await vi.advanceTimersByTimeAsync(15_000);
    await task;
    expect(h.scanner.getSnapshot().status).toBe("error");
    expect(h.scanner.getSnapshot().message).toMatch(/tuning timed out/);
    expect(h.tune).toHaveBeenCalledOnce();
  });
  it("disposal cancellation never restores a block after the owner leaves", async () => {
    const h = harness(),
      task = h.scanner.run([DAB_BAND_III_CHANNELS[0]!]);
    await h.ready();
    await h.scanner.cancel(false);
    await task;
    expect(h.tune).toHaveBeenCalledOnce();
    expect(h.subscriptions()).toBe(0);
  });
});
