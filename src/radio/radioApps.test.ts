import { DEFAULT_AIRSPY_SETTINGS } from "./airspySettings";
import { describe, expect, it, vi } from "vitest";
import { defaultModeSettings } from "./receiverConfig";
import {
  ReceiverController,
  type ReceiverBackendEvents,
  type ReceiverBackend,
  type ReceiverStartOptions,
} from "./receiverController";
import {
  planRadioApp,
  matchingRadioApps,
  loadRadioAppPreferences,
  saveRadioAppPreferences,
} from "./radioApps";
import {
  RadioAppSession,
  type AppConfiguration,
  type RadioAppHost,
} from "./radioAppSession";
import type { AnalysisPipeline } from "../dsp/analysisPipeline";
import type { SourceSessionMetadata } from "./types";

function harness(tuneBarrier?: () => Promise<void>) {
  let metadata: Omit<SourceSessionMetadata, "sessionGeneration">;
  let events!: ReceiverBackendEvents;
  const setVolume = vi.fn(),
    stop = vi.fn(),
    tune = vi.fn();
  const controller = new ReceiverController((e) => {
    events = e;
    const backend: ReceiverBackend = {
      start: async (options) => {
        e.permissionGranted();
        metadata = makeMetadata(options);
        return metadata;
      },
      stop: async () => {
        stop();
      },
      setVolume,
      setGain: async (gain) => gain,
      tune: async (frequency, _generation, options) => {
        tune(frequency);
        await tuneBarrier?.();
        metadata = {
          ...metadata,
          selectedChannelFrequencyHz: frequency,
          hardwareCenterFrequencyHz: options?.centerFrequencyHz ?? frequency,
        };
        return metadata;
      },
      configureMode: async (settings) => {
        metadata = {
          ...metadata,
          mode: settings.mode,
          channelBandwidthHz: settings.bandwidthHz,
          srd: settings.srd,
          textModem: settings.textModem,
        };
        return metadata;
      },
      selectDabService: (key) => {
        const s = controller.getSnapshot().dab;
        const station = s?.stations?.find((row) => row.key === key);
        if (s && station)
          e.dabChanged?.({
            ...s,
            serviceId: station.serviceId,
            subchannelId: station.subchannelId,
          });
      },
    };
    return backend;
  });
  let config: AppConfiguration = {
    source: "rtl-sdr",
    channelFrequencyHz: 100e6,
    sampleRateHz: 1_024_000,
    modeSettings: defaultModeSettings("WBFM"),
  };
  let volume = 0.5,
    block: string | undefined;
  const open = vi.fn();
  const host = (): RadioAppHost => ({
    configuration: config,
    volume,
    remote: false,
    blockedReason: block,
    validateOperation() {
      if (block) throw new Error(block);
    },
    applyDraft(next) {
      config = next;
    },
    startReception: () => controller.start({ ...config, volume }),
    stopReception: () => controller.stop(),
    appChanged: vi.fn(),
    openDecoder: open,
    busyChanged() {},
    scanChanged() {},
    volumeChanged(value) {
      volume = value;
      controller.setVolume(value);
    },
  });
  const session = new RadioAppSession(
    controller,
    { subscribeMeasurements: () => () => {} } as unknown as AnalysisPipeline,
    host,
  );
  session.attach();
  return {
    controller,
    session,
    open,
    tune,
    stop,
    setVolume,
    host,
    config: () => config,
    events: () => events,
    setBlock(value?: string) {
      block = value;
    },
    start: async (rate = 1_024_000) => {
      config = { ...config, sampleRateHz: rate };
      await controller.start({ ...config, volume });
    },
  };
}
function makeMetadata(
  options: ReceiverStartOptions,
): Omit<SourceSessionMetadata, "sessionGeneration"> {
  const settings = options.modeSettings ?? defaultModeSettings("WBFM");
  return {
    source: options.source ?? "rtl-sdr",
    selectedChannelFrequencyHz: options.channelFrequencyHz,
    hardwareCenterFrequencyHz: options.channelFrequencyHz,
    requestedSampleRateHz: options.sampleRateHz ?? 1_024_000,
    actualSampleRateHz: options.sampleRateHz ?? 1_024_000,
    mode: settings.mode,
    channelBandwidthHz: settings.bandwidthHz,
    squelch: settings.squelch,
    srd: settings.srd,
    textModem: settings.textModem,
    gainDb: null,
    sampleFormat: "planar-f32-iq-normalized",
  };
}
describe("Radio Apps launch", () => {
  it("starts only on the explicit app action and stops the shared receiver", async () => {
    const h = harness(),
      start = vi.spyOn(h.controller, "start");
    await h.session.launch("aircraft", "5C");
    expect(start).not.toHaveBeenCalled();
    await h.session.start();
    expect(start).toHaveBeenCalledOnce();
    expect(h.controller.getSnapshot()).toMatchObject({
      lifecycle: "running",
      session: { mode: "ADS-B", selectedChannelFrequencyHz: 1090e6 },
    });
    await h.session.start();
    expect(start).toHaveBeenCalledOnce();
    await h.session.stop();
    expect(h.stop).toHaveBeenCalledOnce();
    expect(h.controller.getSnapshot().lifecycle).toBe("idle");
    expect(h.session.getSnapshot()).toMatchObject({
      app: "aircraft",
      busy: false,
      issue: "",
    });
    h.session.dispose();
  });
  it("checks current ownership and configuration again on Start", async () => {
    const h = harness(),
      start = vi.spyOn(h.controller, "start");
    await h.session.launch("ships", "5C");
    h.setBlock("recording pending");
    await h.session.start();
    expect(start).not.toHaveBeenCalled();
    expect(h.session.getSnapshot().issue).toContain("recording pending");
    h.setBlock();
    h.host().applyDraft({ ...h.config(), channelFrequencyHz: 100e6 });
    await h.session.start();
    expect(start).not.toHaveBeenCalled();
    expect(h.session.getSnapshot().issue).toContain("settings changed");
    h.session.dispose();
  });
  it("shows a permission failure and permits an explicit retry", async () => {
    const h = harness();
    const start = vi
      .spyOn(h.controller, "start")
      .mockRejectedValueOnce(new Error("USB selection cancelled"));
    await h.session.launch("ships", "5C");
    await h.session.start();
    expect(h.session.getSnapshot()).toMatchObject({
      busy: false,
      issue: "USB selection cancelled",
    });
    await h.session.start();
    expect(start).toHaveBeenCalledTimes(2);
    expect(h.session.getSnapshot().issue).toBe("");
    expect(h.controller.getSnapshot().lifecycle).toBe("running");
    h.session.dispose();
  });
  it("does not let an obsolete Start completion overwrite Stop or a subsequent Start", async () => {
    const h = harness();
    let finish!: () => void;
    vi.spyOn(h.controller, "start").mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await h.session.launch("aircraft", "5C");
    const pending = h.session.start();
    expect(h.session.getSnapshot().busy).toBe(true);
    await h.session.stop();
    await h.session.start();
    finish();
    await pending;
    expect(h.controller.getSnapshot().lifecycle).toBe("running");
    expect(h.session.getSnapshot()).toMatchObject({ busy: false, issue: "" });
    h.session.dispose();
  });
  it("Stop cancels a pending app move without replacing the selected app or reporting an obsolete failure", async () => {
    let finish!: () => void;
    const h = harness(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await h.session.launch("fm", "5C");
    await h.session.start();
    const original = h.config();
    const changing = h.session.launch("aprs", "5C");
    await h.session.stop();
    await h.session.start();
    finish();
    expect(await changing).toBe(false);
    expect(h.config()).toEqual(original);
    expect(h.session.getSnapshot()).toMatchObject({
      app: "fm",
      busy: false,
      issue: "",
    });
    expect(h.controller.getSnapshot().session?.mode).toBe("WBFM");
    h.session.dispose();
  });
  it("Stop suppresses an obsolete Restore completion", async () => {
    const h = harness();
    await h.session.launch("ships", "5C");
    await h.session.start();
    const stop = h.controller.stop.bind(h.controller);
    let finish!: () => void;
    vi.spyOn(h.controller, "stop").mockImplementationOnce(async () => {
      await stop();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const restoring = h.session.restore();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await h.session.stop();
    await h.session.start();
    finish();
    await restoring;
    expect(h.session.getSnapshot()).toMatchObject({
      app: "ships",
      busy: false,
      issue: "",
      canRestore: true,
    });
    expect(h.config().modeSettings.mode).toBe("AIS");
    h.session.dispose();
  });
  it("Stop cancels pending DAB Play without a stale failure or held audio gate", async () => {
    const h = harness();
    await h.session.launch("dab", "5C");
    await h.session.start();
    const playing = h.session.play({
      key: "test",
      serviceId: 1,
      subchannelId: 1,
      frequencyHz: 178_352_000,
      block: "5C",
      ensembleId: 1,
      label: "Test",
      ensembleLabel: "Test",
      dabPlus: true,
      playable: true,
    });
    await vi.waitFor(() => expect(h.session.getSnapshot().busy).toBe(true));
    await h.session.stop();
    await playing;
    expect(h.session.getSnapshot()).toMatchObject({
      app: "dab",
      busy: false,
      issue: "",
      awaitingProgramme: false,
    });
    expect(h.controller.getSnapshot().lifecycle).toBe("idle");
    h.session.dispose();
  });
  it("switches sensor family at the same live frequency and does not accept the old protocol as ready", async () => {
    const h = harness();
    const { defaultRadioAppSetup } = await import("./radioAppSetup");
    await h.session.launch("sensors", "5C", defaultRadioAppSetup("sensors"));
    await h.session.start();
    expect(h.controller.getSnapshot().session?.srd?.protocol).toBe(
      "fineoffset-wh2",
    );
    const setup = {
      ...defaultRadioAppSetup("sensors"),
      sensorProtocol: "fineoffset-wh51" as const,
    };
    expect(h.session.plan("sensors", "5C", setup).action).toBe("live");
    await h.session.launch("sensors", "5C", setup);
    expect(h.controller.getSnapshot().session?.srd).toMatchObject({
      protocol: "fineoffset-wh51",
      modulation: "2fsk",
    });
    h.session.dispose();
  });
  it("prepares ordinary RTL ADS-B without connecting or starting, and restores the original setup across app switches", async () => {
    const h = harness();
    expect(await h.session.launch("aircraft", "5C")).toBe(true);
    expect(h.controller.getSnapshot().lifecycle).toBe("idle");
    expect(h.config()).toMatchObject({
      channelFrequencyHz: 1090e6,
      sampleRateHz: 2_400_000,
      modeSettings: { mode: "ADS-B" },
    });
    await h.session.launch("ships", "5C");
    await h.session.restore();
    expect(h.config()).toMatchObject({
      channelFrequencyHz: 100e6,
      sampleRateHz: 1_024_000,
      modeSettings: { mode: "WBFM" },
    });
    expect(h.session.getSnapshot().canRestore).toBe(false);
    expect(h.tune).not.toHaveBeenCalled();
    h.session.dispose();
  });
  it("explicitly stops an incompatible live rate without restarting, and preserves a compatible live rate", async () => {
    const h = harness();
    await h.start();
    expect(h.session.plan("aircraft", "5C").action).toBe("stop");
    await h.session.launch("aircraft", "5C");
    expect(h.stop).toHaveBeenCalledOnce();
    expect(h.controller.getSnapshot().lifecycle).toBe("idle");
    await h.start(2_400_000);
    const generation = h.controller.getSnapshot().sessionGeneration;
    await h.session.launch("aircraft", "5C");
    expect(h.controller.getSnapshot().sessionGeneration).toBe(generation);
    await h.session.launch("ships", "5C");
    expect(h.controller.getSnapshot()).toMatchObject({
      lifecycle: "running",
      session: {
        mode: "AIS",
        selectedChannelFrequencyHz: 162e6,
        requestedSampleRateHz: 2_400_000,
      },
    });
    h.session.dispose();
  });
  it("rechecks operation ownership before applying settings", async () => {
    const h = harness();
    h.session.plan("ships", "5C");
    h.setBlock("recording pending");
    await expect(h.session.launch("ships", "5C")).rejects.toThrow(
      "recording pending",
    );
    expect(h.config().modeSettings.mode).toBe("WBFM");
    expect(h.open).not.toHaveBeenCalled();
    h.session.dispose();
  });
  it("does not report success when the controller refuses a live tune", async () => {
    const h = harness();
    await h.start(2_400_000);
    vi.spyOn(h.controller, "tune").mockResolvedValue();
    await expect(h.session.launch("aircraft", "5C")).rejects.toThrow(/accept/);
    expect(h.open).not.toHaveBeenCalled();
    expect(h.session.getSnapshot().canRestore).toBe(true);
    h.session.dispose();
  });
  it("suppresses audio by scoped ownership while retaining user mute and start volume", async () => {
    const h = harness();
    await h.start();
    const a = h.controller.suppressAudio(),
      b = h.controller.suppressAudio();
    h.controller.setVolume(0.8);
    expect(h.setVolume).toHaveBeenLastCalledWith(0);
    a();
    a();
    expect(h.setVolume).toHaveBeenLastCalledWith(0);
    h.controller.setVolume(0);
    b();
    expect(h.setVolume).toHaveBeenLastCalledWith(0);
    const c = h.controller.suppressAudio();
    h.controller.setVolume(0.6);
    c();
    expect(h.setVolume).toHaveBeenLastCalledWith(0.6);
    h.session.dispose();
  });
  it("refuses to restore onto a different connection of the same source type", async () => {
    const h = harness();
    await h.start(2_400_000);
    await h.session.launch("ships", "5C");
    await h.controller.disconnect();
    await h.start(2_400_000);
    await h.session.restore();
    expect(h.session.getSnapshot().issue).toMatch(
      /previous receiver connection/,
    );
    expect(h.session.getSnapshot().canRestore).toBe(true);
    h.session.dispose();
  });
  it("closing during an acknowledged launch suppresses stale navigation", async () => {
    const h = harness();
    await h.start(2_400_000);
    const tune = h.controller.tune.bind(h.controller);
    vi.spyOn(h.controller, "tune").mockImplementation(async (...args) => {
      await tune(...args);
      h.session.cancelNavigation();
    });
    expect(await h.session.launch("ships", "5C")).toBe(false);
    expect(h.open).not.toHaveBeenCalled();
    expect(h.session.getSnapshot().app).toBe("ships");
    h.session.dispose();
  });
  it("restores an offset capture center only after the user manually starts the restored profile", async () => {
    const h = harness();
    await h.start(2_400_000);
    await h.controller.tune(100e6, { centerFrequencyHz: 99.8e6 });
    await h.session.launch("ships", "5C");
    await h.session.restore();
    expect(h.controller.getSnapshot().lifecycle).toBe("idle");
    await h.start(2_400_000);
    await vi.waitFor(() =>
      expect(
        h.controller.getSnapshot().session?.hardwareCenterFrequencyHz,
      ).toBe(99.8e6),
    );
    h.session.dispose();
  });
});
describe("Radio Apps discovery and capability boundaries", () => {
  it("keeps UAT, airband listening and numeric guide queries distinct", () => {
    expect(matchingRadioApps("planes").map((a) => a.id)).toEqual(["aircraft"]);
    expect(matchingRadioApps("boats").map((a) => a.id)).toEqual(["ships"]);
    expect(matchingRadioApps("digital radio").map((a) => a.id)).toEqual([
      "dab",
    ]);
    expect(matchingRadioApps("ACARS").map((app) => app.id)).toEqual(["acars"]);
    for (const q of ["978", "airband", "11C", "103.4"])
      expect(matchingRadioApps(q)).toEqual([]);
  });
  it("rejects generated sources and incompatible replay while allowing an already decoded replay view", () => {
    const h = harness();
    expect(() =>
      planRadioApp(
        "ships",
        { ...h.config(), source: "synthetic" },
        h.controller.getSnapshot(),
      ),
    ).toThrow(/demo/);
    expect(() =>
      planRadioApp(
        "ships",
        { ...h.config(), source: "replay" },
        h.controller.getSnapshot(),
      ),
    ).toThrow(/recording/);
    const metadata = makeMetadata({
      ...h.config(),
      source: "replay",
      channelFrequencyHz: 162e6,
      modeSettings: defaultModeSettings("AIS"),
      volume: 0.5,
    });
    expect(
      planRadioApp(
        "ships",
        { ...h.config(), source: "replay" },
        {
          lifecycle: "idle",
          sessionGeneration: 1,
          message: "EOF",
          session: { ...metadata, sessionGeneration: 1 },
        },
      ).action,
    ).toBe("replay");
    h.session.dispose();
  });
  it("bounds and validates optional preferences without auto-launch state", () => {
    expect(
      loadRadioAppPreferences({
        getItem: () =>
          '{"version":1,"block":"99Z","lastApp":"evil","serviceKey":"x"}',
      }),
    ).toEqual({
      block: "5C",
      lastApp: undefined,
      serviceKey: undefined,
      ensembleId: undefined,
    });
    expect(
      loadRadioAppPreferences({
        getItem: () => {
          throw new Error("denied");
        },
      }),
    ).toEqual({ block: "5C" });
    expect(() =>
      saveRadioAppPreferences(
        {
          setItem: () => {
            throw new Error("full");
          },
        },
        { block: "5C" },
      ),
    ).not.toThrow();
  });
});

it("keeps Airspy's native input rate while validating its existing filtered digital route", () => {
  const h = harness();
  const plan = planRadioApp(
    "aircraft",
    {
      ...h.config(),
      source: "airspy",
      sampleRateHz: 2_500_000,
      airspySettings: { ...DEFAULT_AIRSPY_SETTINGS },
    },
    h.controller.getSnapshot(),
  );
  expect(plan.configuration.sampleRateHz).toBe(2_500_000);
  expect(plan.configuration.modeSettings?.mode).toBe("ADS-B");
  h.session.dispose();
});
