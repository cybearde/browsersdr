import { describe, expect, it, vi } from "vitest";
import {
  describeReceiverError,
  ReceiverController,
  type ReceiverBackend,
  type ReceiverBackendEvents,
  type ReceiverStartOptions,
} from "./receiverController";
import { createDeterministicRecordingFixture } from "../testing/recordingFixture";
import { planChannelTune, type ReceiverModeSettings } from "./receiverConfig";

const OPTIONS: ReceiverStartOptions = {
  channelFrequencyHz: 100_000_000,
  volume: 0.5,
};
const METADATA = {
  source: "rtl-sdr" as const,
  requestedSampleRateHz: 1_024_000,
  actualSampleRateHz: 1_024_000,
  hardwareCenterFrequencyHz: 100_000_000,
  selectedChannelFrequencyHz: 100_000_000,
  mode: "WBFM" as const,
  channelBandwidthHz: 150_000,
  squelch: 0,
  gainDb: null,
  sampleFormat: "planar-f32-iq-normalized" as const,
};

it("describes an unplugged WebUSB transfer as device loss", () => {
  expect(
    describeReceiverError(
      new DOMException(
        "Failed to execute 'transferIn' on 'USBDevice': A transfer error has occurred.",
        "NetworkError",
      ),
    ),
  ).toBe("The sample transfer stopped.");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeBackend(
  events: ReceiverBackendEvents,
  start: ReceiverBackend["start"],
  stopped: () => void,
): ReceiverBackend {
  let stopPromise: Promise<void> | undefined;
  return {
    start: async (options) => {
      events.permissionGranted();
      return start(options);
    },
    stop: () => {
      if (!stopPromise) {
        stopped();
        stopPromise = Promise.resolve();
      }
      return stopPromise;
    },
    setVolume: () => undefined,
    tune: async (channelFrequencyHz) => ({
      ...METADATA,
      hardwareCenterFrequencyHz: channelFrequencyHz,
      selectedChannelFrequencyHz: channelFrequencyHz,
    }),
    configureMode: async (settings) => ({
      ...METADATA,
      mode: settings.mode,
      channelBandwidthHz: settings.bandwidthHz,
      squelch: settings.squelch,
    }),
    setGain: async (gainDb) => gainDb,
  };
}

describe("live RTL rate changes", () => {
  function fixture(metadata = METADATA) {
    const changed = deferred<typeof METADATA>();
    const configureSampleRate = vi.fn(() => changed.promise);
    const stopRecording = vi.fn();
    const stop = vi.fn(async () => {});
    const disconnect = vi.fn(async () => {});
    const controller = new ReceiverController((events) => ({
      ...fakeBackend(
        events,
        async () => metadata,
        () => {},
      ),
      stop,
      disconnect,
      stopRecording,
      configureSampleRate,
    }));
    return {
      controller,
      changed,
      configureSampleRate,
      stopRecording,
      stop,
      disconnect,
    };
  }

  it("validates before capture completion and preserves invalid/no-op sessions", async () => {
    const f = fixture();
    await f.controller.start(OPTIONS);
    const generation = f.controller.getSnapshot().sessionGeneration;
    await f.controller.configureSampleRate(123);
    await f.controller.configureSampleRate(1_024_000);
    expect(f.configureSampleRate).not.toHaveBeenCalled();
    expect(f.stopRecording).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot()).toMatchObject({
      lifecycle: "running",
      sessionGeneration: generation,
    });
  });

  it("rejects a shrinking passband with Follow channel off before changing generation", async () => {
    const f = fixture({
      ...METADATA,
      requestedSampleRateHz: 2_400_000,
      actualSampleRateHz: 2_400_000,
      selectedChannelFrequencyHz: 100_800_000,
    });
    await f.controller.start(OPTIONS);
    f.controller.setAutoRecenter(false);
    await f.controller.configureSampleRate(1_024_000);
    expect(f.configureSampleRate).not.toHaveBeenCalled();
    expect(f.stopRecording).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().message).toContain("Follow channel");
  });

  it("rejects a rate incompatible with the active decoder before finishing its recording", async () => {
    const configureSampleRate = vi.fn();
    const stopRecording = vi.fn();
    const controller = new ReceiverController((events) => ({
      ...fakeBackend(
        events,
        async () => ({
          ...METADATA,
          mode: "DAB",
          channelBandwidthHz: 1_536_000,
          requestedSampleRateHz: 2_400_000,
          actualSampleRateHz: 2_400_000,
        }),
        () => {},
      ),
      configureSampleRate,
      stopRecording,
    }));
    await controller.start({
      ...OPTIONS,
      sampleRateHz: 2_400_000,
      modeSettings: { mode: "DAB", bandwidthHz: 1_536_000, squelch: 0 },
    });
    await controller.configureSampleRate(1_024_000);
    expect(configureSampleRate).not.toHaveBeenCalled();
    expect(stopRecording).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      lifecycle: "running",
      session: { mode: "DAB", actualSampleRateHz: 2_400_000 },
    });
  });

  it("retains the old recording, serializes commands and publishes only acknowledged metadata", async () => {
    const f = fixture();
    await f.controller.start(OPTIONS);
    const recording = createDeterministicRecordingFixture();
    f.stopRecording.mockReturnValue(recording);
    const switching = f.controller.configureSampleRate(2_400_000);
    expect(f.stopRecording).toHaveBeenCalledWith("metadata-change");
    expect(f.controller.getSnapshot()).toMatchObject({
      lifecycle: "tuning",
      session: { actualSampleRateHz: 1_024_000 },
    });
    await f.controller.configureSampleRate(1_024_000);
    expect(f.configureSampleRate).toHaveBeenCalledTimes(1);
    f.changed.resolve({
      ...METADATA,
      requestedSampleRateHz: 2_400_000,
      actualSampleRateHz: 2_400_002,
    });
    await switching;
    expect(f.controller.getSnapshot()).toMatchObject({
      lifecycle: "running",
      session: { actualSampleRateHz: 2_400_002 },
    });
    expect(f.controller.takeCompletedRecording()).toBe(recording);
    expect(f.disconnect).not.toHaveBeenCalled();
  });

  it("Stop waits for accepted rate metadata without resurrecting reception", async () => {
    const f = fixture();
    await f.controller.start(OPTIONS);
    const switching = f.controller.configureSampleRate(2_400_000);
    const stopping = f.controller.stop();
    f.changed.resolve({
      ...METADATA,
      requestedSampleRateHz: 2_400_000,
      actualSampleRateHz: 2_400_000,
    });
    await Promise.all([switching, stopping]);
    expect(f.controller.getSnapshot()).toMatchObject({
      lifecycle: "connected",
      session: { actualSampleRateHz: 2_400_000 },
    });
    expect(f.disconnect).not.toHaveBeenCalled();
  });

  it("closes a failed rate command instead of claiming the old rate is still valid", async () => {
    const f = fixture();
    await f.controller.start(OPTIONS);
    const switching = f.controller.configureSampleRate(2_400_000);
    f.changed.reject(new Error("Rate register write failed"));
    await switching;
    expect(f.controller.getSnapshot()).toMatchObject({ lifecycle: "error" });
    expect(f.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("ReceiverController", () => {
  it("publishes squelch telemetry only to its dedicated subscribers", async () => {
    let backendEvents!: ReceiverBackendEvents;
    const controller = new ReceiverController((events) => {
      backendEvents = events;
      return fakeBackend(
        events,
        async () => ({
          ...METADATA,
          mode: "AM",
          channelBandwidthHz: 15_000,
        }),
        () => undefined,
      );
    });
    const receiverListener = vi.fn();
    const meterListener = vi.fn();
    controller.subscribe(receiverListener);
    controller.subscribeSquelchMeter(meterListener);
    await controller.start({
      ...OPTIONS,
      modeSettings: { mode: "AM", bandwidthHz: 15_000, squelch: 2 },
    });
    receiverListener.mockClear();

    backendEvents.squelchChanged?.({ level: 1.2, peak: 2.4, open: false });

    expect(receiverListener).not.toHaveBeenCalled();
    expect(meterListener).toHaveBeenCalledOnce();
    expect(controller.getSquelchMeterSnapshot()).toEqual({
      level: 1.2,
      peak: 2.4,
      open: false,
    });
    expect(controller.getSnapshot()).not.toHaveProperty("squelchMeter");
  });

  it("connects an already-authorized device without using the chooser path", async () => {
    const granted = { vendorId: 0x0bda, productId: 0x2838 } as USBDevice;
    const connect = vi.fn(async () => METADATA);
    const connectGranted = vi.fn(async () => METADATA);
    const controller = new ReceiverController((events) => ({
      ...fakeBackend(
        events,
        async () => METADATA,
        () => undefined,
      ),
      connect,
      connectGranted,
      disconnect: async () => undefined,
    }));

    await controller.connectGranted(OPTIONS, granted);

    expect(connect).not.toHaveBeenCalled();
    expect(connectGranted).toHaveBeenCalledWith(OPTIONS, granted);
    expect(controller.getSnapshot()).toMatchObject({ lifecycle: "connected" });
    await controller.disconnect();
  });

  it.each(["tune", "configureMode"] as const)(
    "waits for failed %s cleanup before allowing restart",
    async (command) => {
      const closing = deferred<void>();
      let creations = 0;
      const controller = new ReceiverController((events) => {
        creations++;
        return {
          ...fakeBackend(
            events,
            async () => METADATA,
            () => undefined,
          ),
          stop: () => closing.promise,
          [command]: async () => {
            throw new Error("Rejected configuration");
          },
        };
      });
      await controller.start(OPTIONS);
      const failed =
        command === "tune"
          ? controller.tune(200_000_000)
          : controller.configureMode({
              mode: "AM",
              bandwidthHz: 8000,
              squelch: 0,
            });
      await vi.waitFor(() =>
        expect(controller.getSnapshot().lifecycle).toBe("stopping"),
      );
      await controller.start(OPTIONS);
      expect(creations).toBe(1);
      closing.resolve();
      await failed;
      expect(controller.getSnapshot()).toMatchObject({
        lifecycle: "error",
        cleanupRequired: false,
      });
      await controller.start(OPTIONS);
      expect(creations).toBe(2);
      await controller.stop();
    },
  );

  it("retains a backend whose close failed and allows only cleanup retry", async () => {
    let creations = 0,
      attempts = 0;
    const controller = new ReceiverController((events) => {
      creations++;
      return {
        ...fakeBackend(
          events,
          async () => METADATA,
          () => undefined,
        ),
        stop: async () => {
          if (++attempts === 1) throw new Error("Close failed");
        },
      };
    });
    await controller.start(OPTIONS);
    await controller.stop();
    expect(controller.getSnapshot()).toMatchObject({
      lifecycle: "error",
      cleanupRequired: true,
    });
    await controller.start(OPTIONS);
    expect(creations).toBe(1);
    await controller.stop();
    expect(controller.getSnapshot().lifecycle).toBe("idle");
    await controller.start(OPTIONS);
    expect(creations).toBe(2);
    await controller.stop();
  });

  it("handles EOF during a tune without resurrecting the completed backend", async () => {
    let events!: ReceiverBackendEvents;
    let stops = 0;
    const tuning = deferred<typeof METADATA>();
    const controller = new ReceiverController((e) => {
      events = e;
      return {
        ...fakeBackend(
          e,
          async () => METADATA,
          () => {
            stops++;
          },
        ),
        tune: () => tuning.promise,
      };
    });
    await controller.start(OPTIONS);
    const pending = controller.tune(100_100_000);
    events.sourceEnded();
    await vi.waitFor(() =>
      expect(controller.getSnapshot().lifecycle).toBe("idle"),
    );
    tuning.resolve(METADATA);
    await pending;
    expect(stops).toBe(1);
    expect(controller.getSnapshot().message).toContain("end of file");
    expect(controller.getSnapshot().session).toMatchObject({
      selectedChannelFrequencyHz: 100_100_000,
      sessionGeneration: 2,
    });
  });

  it("rejects late telemetry from a replaced backend but accepts it after a mode change", async () => {
    const events: ReceiverBackendEvents[] = [];
    const controller = new ReceiverController((e) => {
      events.push(e);
      return fakeBackend(
        e,
        async () => METADATA,
        () => undefined,
      );
    });
    await controller.start(OPTIONS);
    await controller.stop();
    await controller.start(OPTIONS);
    await controller.configureMode({
      mode: "AM",
      bandwidthHz: 8000,
      squelch: 0,
    });
    events[1]!.audioStateChanged("suspended");
    events[0]!.audioStateChanged("running");
    expect(controller.getSnapshot().audioState).toBe("suspended");
    await controller.stop();
  });
  it("reports permission cancellation and cleans up", async () => {
    let stops = 0;
    const error = Object.assign(new Error("No device was selected"), {
      name: "RadioError.NoDeviceSelected",
    });
    const controller = new ReceiverController((events) =>
      fakeBackend(
        events,
        () => Promise.reject(error),
        () => {
          stops += 1;
        },
      ),
    );

    await controller.start(OPTIONS);

    expect(controller.getSnapshot().lifecycle).toBe("error");
    expect(controller.getSnapshot().message).toContain("cancelled");
    expect(stops).toBe(1);
  });

  it("coalesces rapid double starts", async () => {
    let creations = 0;
    const pending = deferred<typeof METADATA>();
    const controller = new ReceiverController((events) => {
      creations += 1;
      return fakeBackend(
        events,
        () => pending.promise,
        () => undefined,
      );
    });

    const first = controller.start(OPTIONS);
    const second = controller.start(OPTIONS);
    pending.resolve(METADATA);
    await Promise.all([first, second]);

    expect(creations).toBe(1);
    expect(controller.getSnapshot().lifecycle).toBe("running");
  });

  it("cleans up after a failed start", async () => {
    let stops = 0;
    const controller = new ReceiverController((events) =>
      fakeBackend(
        events,
        () => Promise.reject(new Error("configuration failed")),
        () => {
          stops += 1;
        },
      ),
    );

    await controller.start(OPTIONS);

    expect(stops).toBe(1);
    expect(controller.getSnapshot().lifecycle).toBe("error");
    expect(controller.getSnapshot().session).toBeUndefined();
  });

  it("does not publish a stale running state when stopped during start", async () => {
    let stops = 0;
    const pending = deferred<typeof METADATA>();
    const controller = new ReceiverController((events) =>
      fakeBackend(
        events,
        () => pending.promise,
        () => {
          stops += 1;
        },
      ),
    );

    const starting = controller.start(OPTIONS);
    await controller.stop();
    pending.resolve(METADATA);
    await starting;

    expect(stops).toBe(1);
    expect(controller.getSnapshot().lifecycle).toBe("idle");
  });

  it("retunes the running backend with a new display generation", async () => {
    let tunedGeneration = 0;
    const controller = new ReceiverController((events) => ({
      ...fakeBackend(
        events,
        () => Promise.resolve(METADATA),
        () => undefined,
      ),
      tune: async (channelFrequencyHz, generation) => {
        tunedGeneration = generation;
        return {
          ...METADATA,
          hardwareCenterFrequencyHz: channelFrequencyHz,
          selectedChannelFrequencyHz: channelFrequencyHz,
        };
      },
    }));
    await controller.start(OPTIONS);
    const initialGeneration = controller.getSnapshot().sessionGeneration;
    await controller.tune(101_300_000);
    expect(tunedGeneration).toBeGreaterThan(initialGeneration);
    expect(controller.getSnapshot()).toMatchObject({
      lifecycle: "running",
      sessionGeneration: tunedGeneration,
      session: {
        hardwareCenterFrequencyHz: 101_300_000,
        selectedChannelFrequencyHz: 101_300_000,
      },
    });
  });

  it("uses an explicit acquisition-center retune for spectrum scanning", async () => {
    const fixture = createDeterministicRecordingFixture(16);
    const scanCenters: number[] = [];
    const recordingStops: string[] = [];
    const controller = new ReceiverController((events) => ({
      ...fakeBackend(
        events,
        () => Promise.resolve(METADATA),
        () => undefined,
      ),
      scanTune: async (centerFrequencyHz) => {
        scanCenters.push(centerFrequencyHz);
        return {
          ...METADATA,
          hardwareCenterFrequencyHz: centerFrequencyHz,
          selectedChannelFrequencyHz: centerFrequencyHz,
        };
      },
      stopRecording: (reason = "user") => {
        recordingStops.push(reason);
        return {
          ...fixture,
          metadata: { ...fixture.metadata, stopReason: reason },
        };
      },
    }));
    await controller.start(OPTIONS);
    const initialGeneration = controller.getSnapshot().sessionGeneration;
    const session = await controller.scanTune(102_400_000);
    expect(scanCenters).toEqual([102_400_000]);
    expect(recordingStops).toEqual(["metadata-change"]);
    expect(session).toMatchObject({
      hardwareCenterFrequencyHz: 102_400_000,
      selectedChannelFrequencyHz: 102_400_000,
      sessionGeneration: expect.any(Number),
    });
    expect(session!.sessionGeneration).toBeGreaterThan(initialGeneration);
    expect(controller.getSnapshot()).toMatchObject({
      lifecycle: "running",
      session,
    });
  });

  it("publishes changed mode metadata and a serialized gain result", async () => {
    const controller = new ReceiverController((events) => ({
      ...fakeBackend(
        events,
        () => Promise.resolve(METADATA),
        () => undefined,
      ),
      configureMode: async (settings) => ({
        ...METADATA,
        mode: settings.mode,
        channelBandwidthHz: settings.bandwidthHz,
        squelch: settings.squelch,
      }),
      setGain: async (gainDb) => gainDb,
    }));
    await controller.start(OPTIONS);
    await controller.configureMode({
      mode: "AM",
      bandwidthHz: 8_000,
      squelch: 1.5,
    });
    expect(controller.getSnapshot()).toMatchObject({
      lifecycle: "running",
      session: { mode: "AM", channelBandwidthHz: 8_000, squelch: 1.5 },
    });
    await controller.setGain(24.7);
    expect(controller.getSnapshot().session?.gainDb).toBe(24.7);
  });

  it.each([false, true])(
    "updates same-mode analog settings and ends only channel captures (channel = %s)",
    async (channel) => {
      const analog = {
        ...METADATA,
        mode: "AM" as const,
        channelBandwidthHz: 10_000,
      };
      const updateAnalogMode = vi.fn((settings: ReceiverModeSettings) => ({
        ...analog,
        channelBandwidthHz: settings.bandwidthHz,
        squelch: settings.squelch,
      }));
      const configureMode = vi.fn(async () => analog);
      const stopRecording = vi.fn(() => undefined);
      const controller = new ReceiverController((events) => ({
        ...fakeBackend(
          events,
          async () => analog,
          () => undefined,
        ),
        updateAnalogMode,
        configureMode,
        stopRecording,
        getRecordingStatus: () => ({
          state: "recording",
          sampleCount: 0,
          bytes: 0,
          maxBytes: 1024,
          captureCurrentChannel: channel,
        }),
      }));
      await controller.start({
        ...OPTIONS,
        modeSettings: { mode: "AM", bandwidthHz: 10_000, squelch: 0 },
      });
      const generation = controller.getSnapshot().sessionGeneration;

      controller.updateAnalogMode({
        mode: "AM",
        bandwidthHz: 4_000,
        squelch: 2.2,
      });

      expect(updateAnalogMode).toHaveBeenCalledWith({
        mode: "AM",
        bandwidthHz: 4_000,
        squelch: 2.2,
      });
      expect(configureMode).not.toHaveBeenCalled();
      if (channel)
        expect(stopRecording).toHaveBeenCalledWith("metadata-change");
      else expect(stopRecording).not.toHaveBeenCalled();
      expect(controller.getSnapshot()).toMatchObject({
        lifecycle: "running",
        sessionGeneration: generation,
        session: {
          sessionGeneration: generation,
          mode: "AM",
          channelBandwidthHz: 4_000,
          squelch: 2.2,
        },
      });
    },
  );

  it("completes ten start/stop cycles without duplicate backend cleanup", async () => {
    let creations = 0;
    let stops = 0;
    const controller = new ReceiverController((events) => {
      creations += 1;
      return fakeBackend(
        events,
        () => Promise.resolve(METADATA),
        () => {
          stops += 1;
        },
      );
    });
    for (let cycle = 0; cycle < 10; cycle += 1) {
      await controller.start(OPTIONS);
      expect(controller.getSnapshot().lifecycle).toBe("running");
      await controller.stop();
      expect(controller.getSnapshot().lifecycle).toBe("idle");
    }
    expect(creations).toBe(10);
    expect(stops).toBe(10);
  });

  it("stops and restarts a persistent RTL connection without reconnecting hardware", async () => {
    let creations = 0,
      connects = 0,
      starts = 0,
      stops = 0,
      disconnects = 0;
    const controller = new ReceiverController((events) => {
      creations += 1;
      return {
        ...fakeBackend(
          events,
          async () => {
            starts += 1;
            return METADATA;
          },
          () => undefined,
        ),
        connect: async () => {
          connects += 1;
          events.permissionGranted();
          return METADATA;
        },
        stop: async () => {
          stops += 1;
        },
        disconnect: async () => {
          disconnects += 1;
        },
      };
    });

    await controller.connect(OPTIONS);
    expect(controller.getSnapshot().lifecycle).toBe("connected");
    await controller.start(OPTIONS);
    await controller.stop();
    expect(controller.getSnapshot()).toMatchObject({
      lifecycle: "connected",
      message: expect.stringContaining("remains connected"),
    });
    await controller.start(OPTIONS);
    await controller.stop();
    await controller.disconnect();

    expect({ creations, connects, starts, stops, disconnects }).toEqual({
      creations: 1,
      connects: 1,
      starts: 2,
      stops: 2,
      disconnects: 1,
    });
    expect(controller.getSnapshot().lifecycle).toBe("idle");
  });

  it("rejects a non-positive running retune without losing the active session", async () => {
    let tunes = 0;
    const controller = new ReceiverController((events) => ({
      ...fakeBackend(
        events,
        () => Promise.resolve(METADATA),
        () => undefined,
      ),
      tune: async () => {
        tunes += 1;
        return METADATA;
      },
    }));
    await controller.start(OPTIONS);
    await controller.tune(0);
    expect(tunes).toBe(0);
    expect(controller.getSnapshot()).toMatchObject({
      lifecycle: "running",
      message:
        "Choose a channel frequency above 0 Hz; the connected tuner's limits are detected when tuning.",
      session: { selectedChannelFrequencyHz: 100_000_000 },
    });
  });

  it("ends and exposes the current recording segment before metadata changes", async () => {
    const fixture = createDeterministicRecordingFixture(32);
    const reasons: string[] = [];
    const controller = new ReceiverController((events) => ({
      ...fakeBackend(
        events,
        () => Promise.resolve(METADATA),
        () => undefined,
      ),
      startRecording: () => ({
        state: "recording",
        bytes: 0,
        maxBytes: 1024,
        sampleCount: 0,
      }),
      stopRecording: (reason = "user") => {
        reasons.push(reason);
        return {
          ...fixture,
          metadata: { ...fixture.metadata, stopReason: reason },
        };
      },
    }));
    await controller.start(OPTIONS);
    expect(controller.startRecording()?.state).toBe("recording");
    await controller.tune(101_000_000);
    expect(reasons).toEqual(["metadata-change"]);
    expect(controller.takeCompletedRecording()?.metadata.stopReason).toBe(
      "metadata-change",
    );
  });

  it("finalizes a capacity-reached recording only once for automatic export", async () => {
    const fixture = createDeterministicRecordingFixture(32);
    let stops = 0;
    let recordingActive = true;
    const controller = new ReceiverController((events) => ({
      ...fakeBackend(
        events,
        () => Promise.resolve(METADATA),
        () => undefined,
      ),
      getRecordingStatus: () =>
        recordingActive
          ? {
              state: "capacity-reached",
              bytes: 64,
              maxBytes: 64,
              sampleCount: 32,
            }
          : undefined,
      stopRecording: () => {
        stops += 1;
        recordingActive = false;
        return {
          ...fixture,
          metadata: { ...fixture.metadata, stopReason: "capacity" },
        };
      },
    }));
    await controller.start(OPTIONS);
    expect(controller.finalizeCapacityRecording()?.metadata.stopReason).toBe(
      "capacity",
    );
    expect(controller.finalizeCapacityRecording()).toBeUndefined();
    expect(controller.takeCompletedRecording()?.metadata.sampleCount).toBe(32);
    expect(stops).toBe(1);
  });

  it("does not start or overwrite another segment while completion ownership is pending", async () => {
    const first = createDeterministicRecordingFixture(32);
    const second = createDeterministicRecordingFixture(16);
    let starts = 0;
    let completion = first;
    const controller = new ReceiverController((events) => ({
      ...fakeBackend(
        events,
        () => Promise.resolve(METADATA),
        () => undefined,
      ),
      startRecording: () => {
        starts += 1;
        return { state: "recording", bytes: 0, maxBytes: 64, sampleCount: 0 };
      },
      stopRecording: () => completion,
    }));
    await controller.start(OPTIONS);
    expect(controller.startRecording()).toBeDefined();
    controller.stopRecording();
    completion = second;
    expect(controller.startRecording()).toBeUndefined();
    controller.stopRecording();
    expect(controller.takeCompletedRecording()?.metadata.sampleCount).toBe(
      first.metadata.sampleCount,
    );
    expect(starts).toBe(1);
  });

  it("retains a source-failure segment until the completion owner takes it", async () => {
    const fixture = createDeterministicRecordingFixture(24);
    let backendEvents!: ReceiverBackendEvents;
    const controller = new ReceiverController((events) => {
      backendEvents = events;
      return {
        ...fakeBackend(
          events,
          () => Promise.resolve(METADATA),
          () => undefined,
        ),
        stopRecording: (reason = "user") => ({
          ...fixture,
          metadata: { ...fixture.metadata, stopReason: reason },
        }),
      };
    });
    await controller.start(OPTIONS);
    backendEvents.runtimeError(new Error("USB read failed"));
    await vi.waitFor(() =>
      expect(controller.getSnapshot().lifecycle).toBe("error"),
    );
    expect(controller.takeCompletedRecording()?.metadata).toMatchObject({
      sampleCount: 24,
      stopReason: "source-stop",
    });
    expect(controller.takeCompletedRecording()).toBeUndefined();
  });
});

it("retains ingress failure timing after backend cleanup and clears it for a new source", async () => {
  let events!: ReceiverBackendEvents,
    created = 0;
  const telemetry = {
    debtMs: 26,
    budgetMs: 25.6,
    stages: {
      "USB callback": {
        count: 256,
        meanMs: 0.1,
        p99Ms: 2,
        maxMs: 27,
        lifetimeMaxMs: 27,
      },
    },
  };
  const controller = new ReceiverController((e) => {
    events = e;
    created++;
    return {
      ...fakeBackend(
        e,
        async () => METADATA,
        () => {},
      ),
      getIngressDiagnostics: () => (created === 1 ? telemetry : undefined),
    };
  });
  await controller.start(OPTIONS);
  events.runtimeError(new Error("lag exhausted"));
  await vi.waitFor(() =>
    expect(controller.getSnapshot().lifecycle).toBe("error"),
  );
  expect(controller.getIngressDiagnostics()).toEqual(telemetry);
  await controller.start(OPTIONS);
  expect(controller.getIngressDiagnostics()).toBeUndefined();
  await controller.stop();
});

it("selects only playable discovered DAB stations without an RF tune", async () => {
  let events!: ReceiverBackendEvents;
  const select = vi.fn(),
    tune = vi.fn();
  const controller = new ReceiverController((value) => {
    events = value;
    return {
      ...fakeBackend(
        value,
        async () => ({ ...METADATA, mode: "DAB", actualSampleRateHz: 2400000 }),
        () => undefined,
      ),
      selectDabService: select,
      tune,
    };
  });
  await controller.start({
    ...OPTIONS,
    sampleRateHz: 2400000,
    modeSettings: { mode: "DAB", bandwidthHz: 1536000, squelch: 0 },
  });
  events.dabChanged?.({
    state: "synchronized",
    frameCount: 12,
    nullSymbolCount: 12,
    estimatedSnrDb: null,
    coarseFrequencyOffsetHz: null,
    message: "Receiving",
    stations: [
      {
        key: "1:0",
        serviceId: 1,
        subchannelId: 0,
        primary: true,
        dabPlus: true,
        playable: true,
      },
      {
        key: "2:1",
        serviceId: 2,
        subchannelId: 1,
        primary: true,
        dabPlus: false,
        playable: false,
      },
    ],
  });
  controller.selectDabService("missing");
  controller.selectDabService("2:1");
  controller.selectDabService("1:0");
  expect(select).toHaveBeenCalledExactlyOnceWith("1:0");
  expect(tune).not.toHaveBeenCalled();
  await controller.stop();
  controller.selectDabService("1:0");
  expect(select).toHaveBeenCalledTimes(1);
});

describe("receiver center and channel policy", () => {
  function tuningFixture(source: "rtl-sdr" | "replay" | "hackrf" = "rtl-sdr", override: Partial<import("./types").SourceSessionMetadata> = {}) {
    let metadata: Omit<import("./types").SourceSessionMetadata, "sessionGeneration"> = { ...METADATA, source, ...override };
    const stopRecording = vi.fn<NonNullable<ReceiverBackend["stopRecording"]>>(() => undefined);
    const tune = vi.fn<ReceiverBackend["tune"]>(
      async (channel, _generation, options) => {
        const plan = planChannelTune(
          metadata.hardwareCenterFrequencyHz,
          channel,
          metadata.actualSampleRateHz,
          metadata.channelBandwidthHz,
          options,
        );
        metadata = {
          ...metadata,
          hardwareCenterFrequencyHz: plan.hardwareCenterFrequencyHz,
          selectedChannelFrequencyHz: channel,
        };
        return metadata;
      },
    );
    const configureMode = vi.fn<ReceiverBackend["configureMode"]>(async settings => {
      metadata = {...metadata, mode: settings.mode, channelBandwidthHz: settings.bandwidthHz, squelch: settings.squelch};
      return metadata;
    });
    const controller = new ReceiverController((events) => ({
      ...fakeBackend(
        events,
        async () => metadata,
        () => undefined,
      ),
      tune,
      configureMode,
      stopRecording,
    }));
    return { controller, tune, stopRecording, configureMode };
  }
  it("preserves channel selection for Set and To channel", async () => {
    const f = tuningFixture();
    await f.controller.start(OPTIONS);
    await f.controller.tune(100.1e6);
    await f.controller.tuneCenter(100.2e6);
    expect(f.controller.getSnapshot().session).toMatchObject({
      hardwareCenterFrequencyHz: 100.2e6,
      selectedChannelFrequencyHz: 100.1e6,
    });
    await f.controller.tuneCenter(100.1e6);
    expect(f.controller.getSnapshot().session).toMatchObject({
      hardwareCenterFrequencyHz: 100.1e6,
      selectedChannelFrequencyHz: 100.1e6,
    });
  });
  it("rejects invalid receiver moves without ending reception or a recording", async () => {
    const f = tuningFixture();
    await f.controller.start(OPTIONS);
    const before = f.controller.getSnapshot().sessionGeneration;
    for (const center of [0, NaN, -1, Infinity]) await f.controller.tuneCenter(center);
    expect(f.tune).not.toHaveBeenCalled();
    expect(f.stopRecording).not.toHaveBeenCalled();
    expect(f.configureMode).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot()).toMatchObject({
      lifecycle: "running",
      sessionGeneration: before,
      session: {
        hardwareCenterFrequencyHz: 100e6,
        selectedChannelFrequencyHz: 100e6,
      },
    });
  });
  it.each([false, true])("clears an out-of-window channel without blocking center exploration (Follow=%s)", async follow => {
    const f = tuningFixture();
    await f.controller.start(OPTIONS);
    f.controller.setAutoRecenter(follow);
    await f.controller.tuneCenter(110e6);
    expect(f.configureMode).toHaveBeenCalledWith(expect.objectContaining({mode: "OFF"}), expect.any(Number));
    expect(f.stopRecording).toHaveBeenCalledWith("metadata-change");
    expect(f.controller.getSnapshot()).toMatchObject({
      lifecycle: "running", channelSelectionWarning: expect.stringContaining("100.000000 MHz"),
      session: {hardwareCenterFrequencyHz: 110e6, selectedChannelFrequencyHz: 110e6, mode: "OFF"},
    });
    await f.controller.tuneCenter(120e6);
    expect(f.controller.getSnapshot().session?.hardwareCenterFrequencyHz).toBe(120e6);
    await f.controller.configureMode({mode: "WBFM", bandwidthHz: 150000, squelch: 0});
    expect(f.controller.getSnapshot().channelSelectionWarning).toBeUndefined();
  });
  it("Stop cancels the second step of clearing a channel without a late retune", async () => {
    const f = tuningFixture();
    await f.controller.start(OPTIONS);
    const mode = deferred<Omit<import("./types").SourceSessionMetadata, "sessionGeneration">>();
    f.configureMode.mockReturnValueOnce(mode.promise);
    const moving = f.controller.tuneCenter(110e6);
    await f.controller.stop();
    mode.resolve({...METADATA, mode: "OFF", channelBandwidthHz: 1});
    await moving;
    expect(f.tune).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot().lifecycle).toBe("idle");
  });
  it("finishes and retains the original recording before clearing a channel", async () => {
    const f = tuningFixture();
    await f.controller.start(OPTIONS);
    const recording = createDeterministicRecordingFixture();
    f.stopRecording.mockReturnValueOnce(recording);
    await f.controller.tuneCenter(110e6);
    expect(f.controller.takeCompletedRecording()).toBe(recording);
    expect(recording.metadata.selectedChannelFrequencyHz).not.toBe(110e6);
    expect(f.stopRecording.mock.invocationCallOrder[0]).toBeLessThan(f.configureMode.mock.invocationCallOrder[0]!);
  });
  it("validates declared Q-branch limits before disturbing the active channel", async () => {
    const f = tuningFixture("rtl-sdr", {hardwareCenterFrequencyHz: 4.583e6, selectedChannelFrequencyHz: 4.583e6,
      rtlInput: {profile: "nesdr-smart-v5", directSampling: "q", converterOffsetHz: 0, biasTee: false}});
    await f.controller.start({...OPTIONS, channelFrequencyHz: 4.583e6});
    await f.controller.tuneCenter(80e6);
    expect(f.controller.getSnapshot().message).toContain("0.1–24 MHz");
    expect(f.configureMode).not.toHaveBeenCalled();
    expect(f.tune).not.toHaveBeenCalled();
    expect(f.stopRecording).not.toHaveBeenCalled();
    await f.controller.tuneCenter(6e6);
    expect(f.controller.getSnapshot().session).toMatchObject({mode: "OFF", hardwareCenterFrequencyHz: 6e6});
  });
  it("clears a centered low-rate decoder even when the occupied passband would fit", async () => {
    const f = tuningFixture("hackrf", {hardwareCenterFrequencyHz: 1090e6, selectedChannelFrequencyHz: 1090e6,
      mode: "ADS-B", channelBandwidthHz: 2e6, actualSampleRateHz: 2.4e6, requestedSampleRateHz: 2.4e6});
    await f.controller.start({...OPTIONS, source: "hackrf", channelFrequencyHz: 1090e6, sampleRateHz: 2.4e6});
    await f.controller.tuneCenter(1090.1e6);
    expect(f.controller.getSnapshot()).toMatchObject({lifecycle: "running", channelSelectionWarning: expect.any(String), session: {mode: "OFF", hardwareCenterFrequencyHz: 1090.1e6}});
  });
  it("moves the receiver only when the complete channel no longer fits, and honors the lock", async () => {
    const f = tuningFixture();
    await f.controller.start(OPTIONS);
    f.controller.setAutoRecenter(false);
    await f.controller.tune(100.1e6);
    expect(f.controller.getSnapshot().session?.hardwareCenterFrequencyHz).toBe(
      100e6,
    );
    const calls = f.tune.mock.calls.length;
    await f.controller.tune(101e6);
    expect(f.tune).toHaveBeenCalledTimes(calls);
    expect(f.controller.getSnapshot()).toMatchObject({
      lifecycle: "running",
      message: expect.stringContaining("Follow channel"),
    });
    f.controller.setAutoRecenter(true);
    await f.controller.tune(101e6);
    expect(f.controller.getSnapshot().session).toMatchObject({
      hardwareCenterFrequencyHz: 101e6,
      selectedChannelFrequencyHz: 101e6,
    });
  });
  it("keeps replay running when a requested tune is outside the recording", async () => {
    const f = tuningFixture("replay");
    await f.controller.start({ ...OPTIONS, source: "replay" });
    await f.controller.tuneCenter(100.1e6);
    await f.controller.tune(101e6);
    expect(f.tune).not.toHaveBeenCalled();
    expect(f.controller.getSnapshot()).toMatchObject({
      lifecycle: "running",
      message: expect.stringContaining("fixed during replay"),
    });
  });
});

it("clears stabilized FM reception on retune/stop and rejects stopped backend updates", async () => {
  let events!: ReceiverBackendEvents;
  const controller = new ReceiverController((e) => {
    events = e;
    return fakeBackend(
      e,
      async () => METADATA,
      () => {},
    );
  });
  await controller.start(OPTIONS);
  const listener = vi.fn();
  controller.subscribe(listener);
  events.fmStereoReceptionChanged?.("stereo");
  events.fmStereoReceptionChanged?.("stereo");
  expect(listener).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot().fmStereoReception).toBe("stereo");
  await controller.tune(100_100_000);
  expect(controller.getSnapshot().fmStereoReception).toBeUndefined();
  events.fmStereoReceptionChanged?.("mono");
  expect(controller.getSnapshot().fmStereoReception).toBe("mono");
  events.fmStereoReceptionChanged?.("intermittent");
  expect(controller.getSnapshot().fmStereoReception).toBe("intermittent");
  events.fmStereoReceptionChanged?.(undefined);
  expect(controller.getSnapshot().fmStereoReception).toBeUndefined();
  await controller.stop();
  events.fmStereoReceptionChanged?.("stereo");
  expect(controller.getSnapshot().fmStereoReception).toBeUndefined();
});
