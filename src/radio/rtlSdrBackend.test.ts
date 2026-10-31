import { afterEach, describe, expect, it, vi } from "vitest";
import type { SignalSource } from "@jtarrio/signals/radio/signal_source.js";
import { RadioError, RadioErrorType } from "@jtarrio/webrtlsdr/errors.js";
import {
  ReceiverController,
  type ReceiverBackendEvents,
  type ReceiverStartOptions,
} from "./receiverController";
import { RtlSdrBackend, type RtlSdrBackendDependencies } from "./rtlSdrBackend";

const OPTIONS: ReceiverStartOptions = {
  channelFrequencyHz: 100_000_000,
  volume: 0.5,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sourceWith(
  close: () => Promise<void>,
  startReceiving: () => Promise<void> = async () => {},
) {
  return {
    setSampleRate: async (rate: number) => rate,
    setCenterFrequency: async (frequency: number) => frequency,
    setParameter: async <V>(_parameter: string, value: V) => value,
    startReceiving,
    readSamples: () => new Promise<never>(() => undefined),
    close,
  } as SignalSource;
}

function audioContextWith(
  close: () => Promise<void>,
  initialState: AudioContextState = "suspended",
) {
  let state = initialState;
  return {
    get state() {
      return state;
    },
    sampleRate: 48_000,
    currentTime: 0,
    destination: {},
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    resume: vi.fn(async () => {
      state = "running";
    }),
    suspend: vi.fn(async () => {
      state = "suspended";
    }),
    close: vi.fn(async () => {
      await close();
      state = "closed";
    }),
  } as unknown as AudioContext;
}

function events(): ReceiverBackendEvents {
  return {
    permissionGranted() {},
    runtimeError() {},
    audioStateChanged() {},
    sourceEnded() {},
    rdsChanged() {},
  };
}

function dependencies(
  source: SignalSource,
  audioContext: AudioContext,
): RtlSdrBackendDependencies {
  return {
    createAudioContext: () => audioContext,
    createSourceProvider: () => ({ get: async () => source }),
  };
}

afterEach(() => vi.unstubAllGlobals());

it("preserves a verified tuner family through connection and rate reconfiguration without inferring the board", async () => {
  vi.stubGlobal("navigator", { usb: {} });
  const source = Object.assign(sourceWith(async () => undefined), { rtlTuner: "R828D" });
  const backend = new RtlSdrBackend(events(), undefined, 1, 100_000_000,
    dependencies(source, audioContextWith(async () => undefined)));
  try {
    expect(await backend.connect(OPTIONS)).toMatchObject({ source: "rtl-sdr", rtlTuner: "R828D" });
    expect(await backend.connect({ ...OPTIONS, sampleRateHz: 2_400_000 })).toMatchObject({ rtlTuner: "R828D", actualSampleRateHz: 2_400_000 });
  } finally { await backend.disconnect(); }
});

describe("RTL sample-rate transitions", () => {
  type Block = import("@jtarrio/signals/radio/sample_block.js").SampleBlock;
  const block = (value = 0.25): Block => ({
    I: new Float32Array([value, value]), Q: new Float32Array([0, 0]), frequency: OPTIONS.channelFrequencyHz,
  });
  async function flush() { for (let i = 0; i < 25; i++) await Promise.resolve(); }
  function fixture() {
    vi.stubGlobal("navigator", { usb: {} });
    const reads: { length: number; pending: ReturnType<typeof deferred<Block>> }[] = [];
    let capture: (data: ArrayBuffer) => void = () => {};
    const source = sourceWith(vi.fn(async () => {}), vi.fn(async () => {}));
    source.setSampleRate = vi.fn(async (rate: number) => rate);
    source.setCenterFrequency = vi.fn(async (frequency: number) => frequency);
    source.readSamples = (length) => {
      const pending = deferred<Block>(); reads.push({ length, pending });
      return pending.promise.then((value) => {
        capture(new Uint8Array([128, 128, 140, 128]).buffer);
        return value;
      });
    };
    const audio = audioContextWith(vi.fn(async () => {}));
    const receiveSamples = vi.fn();
    const analysis = {
      begin: vi.fn(() => ({ setSampleRate: vi.fn(), receiveSamples })),
      retune: vi.fn(), stop: vi.fn(), markDiscontinuity: vi.fn(),
    };
    const demodulator = {
      setMode: vi.fn(), setVolume: vi.fn(), setFrequencyOffset: vi.fn(),
      setSampleRate: vi.fn(), expectFrequencyAndSetOffset: vi.fn(), receiveSamples: vi.fn(),
    };
    const providerGet = vi.fn(async () => source);
    const backend = new RtlSdrBackend(events(), analysis as unknown as import("../dsp/analysisPipeline").AnalysisPipeline,
      1, OPTIONS.channelFrequencyHz, {
        createAudioContext: () => audio, createDemodulator: () => demodulator,
        createSourceProvider: (_permission, captureBytes) => { capture = captureBytes; return { get: providerGet }; },
      });
    const drain = () => { for (const read of reads.splice(0)) read.pending.resolve(block(0.75)); };
    const close = async () => { const closing = backend.disconnect(); drain(); await closing; };
    return { backend, source, reads, drain, close, audio, providerGet, analysis, receiveSamples, demodulator };
  }

  it("drains stale reads, flushes FIFO and delivers only fresh samples at the acknowledged rate", async () => {
    const f = fixture();
    await f.backend.start(OPTIONS, 1);
    expect(f.reads).toHaveLength(2);
    const switching = f.backend.configureSampleRate(2_400_000, 2);
    await flush();
    expect(f.source.setSampleRate).toHaveBeenCalledTimes(1); // startup only
    f.drain();
    const accepted = await switching;
    expect(accepted.actualSampleRateHz).toBe(2_400_000);
    expect(f.receiveSamples).not.toHaveBeenCalled();
    expect(f.source.startReceiving).toHaveBeenCalledTimes(2);
    expect(f.source.setCenterFrequency).toHaveBeenCalledTimes(1);
    expect(f.providerGet).toHaveBeenCalledTimes(1);
    expect(f.audio.resume).toHaveBeenCalledTimes(1);
    expect(f.audio.suspend).not.toHaveBeenCalled();
    expect(f.analysis.retune).toHaveBeenCalledWith(expect.objectContaining({ actualSampleRateHz: 2_400_000, sessionGeneration: 2 }));
    expect(f.reads.map((read) => read.length)).toEqual([120_320, 120_320]);
    f.reads.shift()!.pending.resolve(block());
    await flush();
    expect(f.receiveSamples).toHaveBeenCalledTimes(1);
    const shrinking = f.backend.configureSampleRate(1_024_000, 3);
    f.drain(); await shrinking;
    expect(f.reads.map((read) => read.length)).toEqual([51_200, 51_200]);
    await f.close();
  });

  it.each([[1_024_000, 3_200_000], [2_400_000, 3_200_000], [3_200_000, 1_024_000], [3_200_000, 2_400_000]])("switches %i → %i with correct read sizes, capture boundaries and admitted-input accounting", async (from, to) => {
    const f = fixture();
    await f.backend.start({ ...OPTIONS, sampleRateHz: from }, 1);
    f.backend.startRecording(undefined, { storageMode: "memory" });
    f.reads.shift()!.pending.resolve(block()); await flush();
    const original = f.backend.stopRecording("metadata-change")!;
    expect(original.metadata).toMatchObject({ sampleRateHz: from, sampleCount: 2 });
    const switching = f.backend.configureSampleRate(to, 2);
    f.drain();
    expect(await switching).toMatchObject({ actualSampleRateHz: to, requestedSampleRateHz: to });
    expect(f.backend.getIngressDiagnostics().rtl?.deliveredSamples).toBe(0);
    expect(f.reads.map(r => r.length)).toEqual([512 * Math.ceil(to / 20 / 512), 512 * Math.ceil(to / 20 / 512)]);
    f.backend.startRecording(undefined, { storageMode: "memory" });
    f.reads.shift()!.pending.resolve(block()); await flush();
    const next = f.backend.stopRecording("user")!;
    expect(next.metadata).toMatchObject({ sampleRateHz: to, sampleCount: 2 });
    expect(f.backend.getIngressDiagnostics().rtl?.deliveredBytes).toBe(4);
    expect(f.providerGet).toHaveBeenCalledOnce();
    expect(f.audio.resume).toHaveBeenCalledOnce();
    await f.close();
  });

  it("rejects an inexact experimental readback before resetting FIFO or exposing samples", async () => {
    const f = fixture();
    await f.backend.start(OPTIONS, 1);
    f.source.setSampleRate = vi.fn(async () => 3_200_001);
    const switching = f.backend.configureSampleRate(3_200_000, 2);
    f.drain();
    await expect(switching).rejects.toThrow(/exact experimental/);
    expect(f.source.startReceiving).toHaveBeenCalledTimes(1);
    expect(f.receiveSamples).not.toHaveBeenCalled();
    expect(f.reads).toHaveLength(0);
    await f.close();
  });

  it("retains the selected channel and recenters only when the smaller span requires it", async () => {
    const f = fixture();
    await f.backend.start({ ...OPTIONS, sampleRateHz: 2_400_000 }, 1);
    await f.backend.tune(100_800_000, 2);
    const switching = f.backend.configureSampleRate(1_024_000, 3, { autoRecenter: true });
    f.drain();
    const accepted = await switching;
    expect(accepted).toMatchObject({ hardwareCenterFrequencyHz: 100_800_000, selectedChannelFrequencyHz: 100_800_000 });
    await f.close();
  });

  it("Stop during a register write retains the accepted rate without launching more reads", async () => {
    const f = fixture();
    await f.backend.start(OPTIONS, 1);
    const rate = deferred<number>();
    f.source.setSampleRate = vi.fn(() => rate.promise);
    const switching = f.backend.configureSampleRate(2_400_000, 2);
    f.drain(); await flush();
    const stopping = f.backend.stop();
    rate.resolve(2_400_000);
    expect((await switching).actualSampleRateHz).toBe(2_400_000);
    await stopping;
    expect(f.reads).toHaveLength(0);
    expect(f.audio.suspend).toHaveBeenCalledTimes(1);
    expect(f.source.close).not.toHaveBeenCalled();
    await f.close();
  });

  it("Disconnect during a register write drains the operation and never resumes acquisition", async () => {
    const f = fixture();
    await f.backend.start(OPTIONS, 1);
    const rate = deferred<number>();
    f.source.setSampleRate = vi.fn(() => rate.promise);
    const switching = f.backend.configureSampleRate(2_400_000, 2);
    const rejected = expect(switching).rejects.toMatchObject({ name: "AbortError" });
    f.drain(); await flush();
    const closing = f.backend.disconnect();
    rate.resolve(2_400_000);
    await rejected; await closing;
    expect(f.reads).toHaveLength(0);
    expect(f.source.close).toHaveBeenCalledTimes(1);
  });

  it("failed register writes leave no new reads or falsely accepted metadata", async () => {
    const f = fixture();
    await f.backend.start(OPTIONS, 1);
    f.source.setSampleRate = vi.fn(async () => { throw new Error("Rate write failed"); });
    const switching = f.backend.configureSampleRate(2_400_000, 2);
    f.drain();
    await expect(switching).rejects.toThrow("Rate write failed");
    expect(f.analysis.retune).not.toHaveBeenCalled();
    expect(f.reads).toHaveLength(0);
    await f.close();
  });

  it("a failed in-flight USB read aborts the change before programming the new rate", async () => {
    const f = fixture();
    await f.backend.start(OPTIONS, 1);
    const switching = f.backend.configureSampleRate(2_400_000, 2);
    const rejected = expect(switching).rejects.toThrow("USB drain failed");
    f.reads.shift()!.pending.reject(new Error("USB drain failed"));
    f.drain(); await rejected;
    expect(f.source.setSampleRate).toHaveBeenCalledTimes(1);
    expect(f.analysis.retune).not.toHaveBeenCalled();
    await f.close();
  });

  it("waits for a pending gain command and retains its acknowledgement before rate writes", async () => {
    const f = fixture();
    await f.backend.start(OPTIONS, 1);
    const gain = deferred<number>();
    f.source.setParameter = (() => gain.promise) as SignalSource["setParameter"];
    const gaining = f.backend.setGain(15);
    const switching = f.backend.configureSampleRate(2_400_000, 2);
    f.drain(); await flush();
    expect(f.source.setSampleRate).toHaveBeenCalledTimes(1);
    gain.resolve(15);
    await gaining;
    expect(await switching).toMatchObject({ actualSampleRateHz: 2_400_000, gainDb: 15 });
    await f.close();
  });

  it("retains old-rate capture bytes and excludes stale reads from the next recording", async () => {
    const f = fixture();
    await f.backend.start({ ...OPTIONS, modeSettings: { mode: "OFF", bandwidthHz: 1, squelch: 0 } }, 1);
    f.backend.startRecording();
    f.reads.shift()!.pending.resolve(block()); await flush();
    const old = f.backend.stopRecording("metadata-change")!;
    const switching = f.backend.configureSampleRate(2_400_000, 2);
    f.drain(); await switching;
    expect(old.metadata).toMatchObject({ sampleRateHz: 1_024_000, sampleCount: 2, stopReason: "metadata-change" });
    f.backend.startRecording();
    expect(f.backend.getRecordingStatus()?.sampleCount).toBe(0);
    f.reads.shift()!.pending.resolve(block()); await flush();
    const next = f.backend.stopRecording("user")!;
    expect(next.metadata).toMatchObject({ sampleRateHz: 2_400_000, sampleCount: 2 });
    await f.close();
  });
});

describe("RtlSdrBackend teardown", () => {
  it("keeps raw spectrum analysis active without feeding the demodulator in OFF mode", async () => {
    vi.stubGlobal("navigator", { usb: {} });
    type Block = import("@jtarrio/signals/radio/sample_block.js").SampleBlock;
    const reads: ReturnType<typeof deferred<Block>>[] = [];
    const source = sourceWith(async () => {});
    source.readSamples = () => {
      const read = deferred<Block>();
      reads.push(read);
      return read.promise;
    };
    const raw: number[] = [];
    const analysis = {
      begin: vi.fn(() => ({
        setSampleRate: vi.fn(),
        receiveSamples: (block: Block) => raw.push(block.I[0]!),
      })),
      stop: vi.fn(),
    };
    const demodulator = {
      setMode: vi.fn(),
      setVolume: vi.fn(),
      setFrequencyOffset: vi.fn(),
      setSampleRate: vi.fn(),
      expectFrequencyAndSetOffset: vi.fn(),
      receiveSamples: vi.fn(),
    };
    const backend = new RtlSdrBackend(
      events(),
      analysis as unknown as import("../dsp/analysisPipeline").AnalysisPipeline,
      1,
      OPTIONS.channelFrequencyHz,
      {
        ...dependencies(source, audioContextWith(async () => {})),
        createDemodulator: () => demodulator,
      },
    );

    await backend.start({
      ...OPTIONS,
      modeSettings: { mode: "OFF", bandwidthHz: 1, squelch: 0 },
    });
    reads.shift()!.resolve({
      I: new Float32Array([0.25]),
      Q: new Float32Array([0.5]),
      frequency: OPTIONS.channelFrequencyHz,
    });
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    expect(raw).toEqual([0.25]);
    expect(demodulator.setMode).not.toHaveBeenCalled();
    expect(demodulator.receiveSamples).not.toHaveBeenCalled();
    // The same ownership gate also applies when leaving a playing channel to
    // explore another capture window, not just when starting in OFF mode.
    await backend.configureMode({mode: "WBFM", bandwidthHz: 150_000, squelch: 0}, 2);
    reads.shift()!.resolve({I: new Float32Array([0.5]), Q: new Float32Array([0]), frequency: OPTIONS.channelFrequencyHz});
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    expect(demodulator.receiveSamples).toHaveBeenCalledOnce();
    await backend.configureMode({mode: "OFF", bandwidthHz: 1, squelch: 0}, 3);
    await backend.tune(110e6, 3, {centerFrequencyHz: 110e6});
    reads.shift()!.resolve({I: new Float32Array([0.75]), Q: new Float32Array([0]), frequency: 110e6});
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    expect(raw).toEqual([0.25, 0.5, 0.75]);
    expect(demodulator.receiveSamples).toHaveBeenCalledOnce();
    const disconnecting = backend.disconnect();
    for (const read of reads.splice(0))
      read.resolve({
        I: new Float32Array([0]),
        Q: new Float32Array([0]),
        frequency: OPTIONS.channelFrequencyHz,
      });
    await disconnecting;
  });

  it("passes an already-authorized device to the provider without a chooser", async () => {
    vi.stubGlobal("navigator", { usb: {} });
    const granted = { vendorId: 0x0bda, productId: 0x2838 } as USBDevice;
    const createSourceProvider = vi.fn(
      (_permission, _capture, _device?: USBDevice) => ({
        get: async () => sourceWith(async () => {}),
      }),
    );
    const backend = new RtlSdrBackend(
      events(),
      undefined,
      1,
      OPTIONS.channelFrequencyHz,
      {
        createAudioContext: () => audioContextWith(async () => {}),
        createSourceProvider,
      },
    );

    await backend.connectGranted(OPTIONS, granted);

    expect(createSourceProvider).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.any(Function),
      granted,
    );
    await backend.disconnect();
  });

  it("shares an in-flight source close and retries ownership after a rejection", async () => {
    vi.stubGlobal("navigator", { usb: {} });
    const firstClose = deferred<void>();
    let attempts = 0;
    const close = vi.fn(() =>
      ++attempts === 1 ? firstClose.promise : Promise.resolve(),
    );
    const audioClose = vi.fn(async () => {});
    const backend = new RtlSdrBackend(
      events(),
      undefined,
      1,
      OPTIONS.channelFrequencyHz,
      dependencies(sourceWith(close), audioContextWith(audioClose)),
    );
    await backend.connect(OPTIONS);

    const first = backend.disconnect();
    const concurrent = backend.disconnect();
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    firstClose.reject(new Error("USB close failed"));
    await expect(first).rejects.toThrow("USB close failed");
    await expect(concurrent).rejects.toThrow("USB close failed");
    expect(audioClose).toHaveBeenCalledOnce();

    await backend.disconnect();
    expect(close).toHaveBeenCalledTimes(2);
    expect(audioClose).toHaveBeenCalledOnce();
  });

  it("releases ownership when graceful close fails after physical removal", async () => {
    vi.stubGlobal("navigator", { usb: {} });
    const close = vi.fn(async () => {
      throw new RadioError(
        "setRegBuffer failed block=0x1 reg=120",
        RadioErrorType.UsbTransferError,
      );
    });
    const source = sourceWith(close);
    source.readSamples = async () => {
      throw new DOMException(
        "Failed to execute 'transferIn' on 'USBDevice': A transfer error has occurred.",
        "NetworkError",
      );
    };
    const backendEvents = events();
    backendEvents.runtimeError = vi.fn();
    const backend = new RtlSdrBackend(
      backendEvents,
      undefined,
      1,
      OPTIONS.channelFrequencyHz,
      dependencies(source, audioContextWith(async () => {})),
    );

    await backend.start(OPTIONS);
    await vi.waitFor(() =>
      expect(backendEvents.runtimeError).toHaveBeenCalledWith(
        expect.objectContaining({ name: "NetworkError" }),
      ),
    );

    await expect(backend.disconnect()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });

  it("releases a stale device when setup and graceful close both report transfer failure", async () => {
    vi.stubGlobal("navigator", { usb: {} });
    let creations = 0;
    const staleClose = vi.fn(async () => {
      throw new RadioError(
        "setRegBuffer failed block=0x1 reg=120",
        RadioErrorType.UsbTransferError,
      );
    });
    const controller = new ReceiverController(
      (backendEvents, options, generation) => {
        creations += 1;
        const source = sourceWith(
          creations === 1 ? staleClose : async () => {},
        );
        if (creations === 1)
          source.setSampleRate = async () => {
            throw new RadioError(
              "setRegBuffer failed block=0x1 reg=9f20",
              RadioErrorType.UsbTransferError,
            );
          };
        return new RtlSdrBackend(
          backendEvents,
          undefined,
          generation,
          options.channelFrequencyHz,
          dependencies(source, audioContextWith(async () => {})),
        );
      },
    );

    await controller.connect(OPTIONS);
    expect(controller.getSnapshot()).toMatchObject({
      lifecycle: "error",
      cleanupRequired: false,
    });
    expect(staleClose).toHaveBeenCalledOnce();

    await controller.connect(OPTIONS);
    expect(creations).toBe(2);
    expect(controller.getSnapshot()).toMatchObject({ lifecycle: "connected" });
    await controller.disconnect();
    expect(controller.getSnapshot()).toMatchObject({ lifecycle: "idle" });
  });

  it("lets the controller return to idle after an unplugged stream", async () => {
    vi.stubGlobal("navigator", { usb: {} });
    type Block = import("@jtarrio/signals/radio/sample_block.js").SampleBlock;
    const read = deferred<Block>();
    const close = vi.fn(async () => {
      throw new RadioError(
        "setRegBuffer failed block=0x1 reg=120",
        RadioErrorType.UsbTransferError,
      );
    });
    const source = sourceWith(close);
    source.readSamples = () => read.promise;
    const controller = new ReceiverController(
      (backendEvents, options, generation) =>
        new RtlSdrBackend(
          backendEvents,
          undefined,
          generation,
          options.channelFrequencyHz,
          dependencies(source, audioContextWith(async () => {})),
        ),
    );

    await controller.start(OPTIONS);
    read.reject(
      new DOMException(
        "Failed to execute 'transferIn' on 'USBDevice': A transfer error has occurred.",
        "NetworkError",
      ),
    );
    await vi.waitFor(() =>
      expect(controller.getSnapshot()).toMatchObject({
        lifecycle: "error",
        cleanupRequired: false,
      }),
    );

    await controller.disconnect();
    expect(controller.getSnapshot()).toMatchObject({ lifecycle: "idle" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("attempts audio cleanup independently and retries only the failed audio release", async () => {
    vi.stubGlobal("navigator", { usb: {} });
    const sourceClose = vi.fn(async () => {});
    let audioAttempts = 0;
    const audioClose = vi.fn(async () => {
      if (++audioAttempts === 1) throw new Error("Audio close failed");
    });
    const backend = new RtlSdrBackend(
      events(),
      undefined,
      1,
      OPTIONS.channelFrequencyHz,
      dependencies(sourceWith(sourceClose), audioContextWith(audioClose)),
    );
    await backend.connect(OPTIONS);

    await expect(backend.disconnect()).rejects.toThrow("Audio close failed");
    expect(sourceClose).toHaveBeenCalledOnce();
    await backend.disconnect();
    expect(sourceClose).toHaveBeenCalledOnce();
    expect(audioClose).toHaveBeenCalledTimes(2);
  });

  it("closes a source that arrives after pending startup is cancelled", async () => {
    vi.stubGlobal("navigator", { usb: {} });
    const acquired = deferred<SignalSource>();
    const sourceClose = vi.fn(async () => {});
    const audioClose = vi.fn(async () => {});
    const startReceiving = vi.fn(async () => {});
    const backend = new RtlSdrBackend(
      events(),
      undefined,
      1,
      OPTIONS.channelFrequencyHz,
      {
        createAudioContext: () => audioContextWith(audioClose),
        createSourceProvider: () => ({ get: () => acquired.promise }),
      },
    );

    const starting = backend.start(OPTIONS, 1);
    const startOutcome = starting.then(
      () => "resolved",
      (error: Error) => error.name,
    );
    const disconnecting = backend.disconnect();
    expect(audioClose).toHaveBeenCalledOnce();
    acquired.resolve(sourceWith(sourceClose, startReceiving));

    await expect(disconnecting).resolves.toBeUndefined();
    expect(await startOutcome).toBe("AbortError");
    expect(startReceiving).not.toHaveBeenCalled();
    expect(sourceClose).toHaveBeenCalledOnce();
    expect(audioClose).toHaveBeenCalledOnce();
  });

  it("does not reactivate reception when transfer startup completes after cancellation", async () => {
    vi.stubGlobal("navigator", { usb: {} });
    const receiving = deferred<void>();
    const sourceClose = vi.fn(async () => {});
    const startReceiving = vi.fn(() => receiving.promise);
    const backendEvents = events();
    backendEvents.runtimeError = vi.fn();
    const backend = new RtlSdrBackend(
      backendEvents,
      undefined,
      1,
      OPTIONS.channelFrequencyHz,
      dependencies(
        sourceWith(sourceClose, startReceiving),
        audioContextWith(async () => {}),
      ),
    );

    const starting = backend.start(OPTIONS, 1);
    const startOutcome = starting.then(
      () => "resolved",
      (error: Error) => error.name,
    );
    await vi.waitFor(() => expect(startReceiving).toHaveBeenCalledOnce());
    const disconnecting = backend.disconnect();
    receiving.resolve();

    await expect(disconnecting).resolves.toBeUndefined();
    expect(await startOutcome).toBe("AbortError");
    expect(sourceClose).toHaveBeenCalledOnce();
    expect(backendEvents.runtimeError).not.toHaveBeenCalled();
  });

  it("keeps the controller's single owner until real teardown retry succeeds", async () => {
    vi.stubGlobal("navigator", { usb: {} });
    let creations = 0;
    let closeAttempts = 0;
    const controller = new ReceiverController(
      (backendEvents, options, generation) => {
        creations += 1;
        const close = vi.fn(async () => {
          if (creations === 1 && ++closeAttempts === 1)
            throw new Error("USB close failed");
        });
        return new RtlSdrBackend(
          backendEvents,
          undefined,
          generation,
          options.channelFrequencyHz,
          dependencies(
            sourceWith(close),
            audioContextWith(async () => {}),
          ),
        );
      },
    );

    await controller.connect(OPTIONS);
    await controller.disconnect();
    expect(controller.getSnapshot()).toMatchObject({
      lifecycle: "error",
      cleanupRequired: true,
    });
    await controller.connect(OPTIONS);
    expect(creations).toBe(1);

    await controller.disconnect();
    expect(controller.getSnapshot()).toMatchObject({ lifecycle: "idle" });
    await controller.connect(OPTIONS);
    expect(creations).toBe(2);
    await controller.disconnect();
  });
});

it("keeps RTL raw fan-out, acknowledged centers and route validation through the shared pipeline", async () => {
  vi.stubGlobal("navigator", { usb: {} });
  type Block = import("@jtarrio/signals/radio/sample_block.js").SampleBlock;
  const reads: ReturnType<typeof deferred<Block>>[] = [];
  const source = sourceWith(async () => {});
  source.readSamples = () => {
    const read = deferred<Block>();
    reads.push(read);
    return read.promise;
  };
  source.setCenterFrequency = async (frequency) => frequency + 17;
  const raw: number[] = [];
  const analysis = {
    begin: vi.fn(() => ({
      setSampleRate: vi.fn(),
      receiveSamples: (block: Block) => raw.push(block.I[0]!),
    })),
    retune: vi.fn(),
    stop: vi.fn(),
  };
  const demodulator = {
    setMode: vi.fn(),
    setVolume: vi.fn(),
    setFrequencyOffset: vi.fn(),
    setSampleRate: vi.fn(),
    expectFrequencyAndSetOffset: vi.fn(),
    receiveSamples: vi.fn((block: Block) => block.I.fill(99)),
  };
  const backend = new RtlSdrBackend(
    events(),
    analysis as unknown as import("../dsp/analysisPipeline").AnalysisPipeline,
    1,
    OPTIONS.channelFrequencyHz,
    {
      ...dependencies(
        source,
        audioContextWith(async () => {}),
      ),
      createDemodulator: () => demodulator,
    },
  );
  const metadata = await backend.start(OPTIONS);
  expect(metadata.hardwareCenterFrequencyHz).toBe(100_000_017);
  expect(demodulator.setFrequencyOffset).toHaveBeenLastCalledWith(-17);
  const block = (frequency: number) => ({
    I: new Float32Array([0.25]),
    Q: new Float32Array([0.5]),
    frequency,
  });
  reads.shift()!.resolve(block(100_000_017));
  for (let n = 0; n < 10; n++) await Promise.resolve();
  expect(raw).toEqual([0.25]);
  expect(demodulator.receiveSamples).toHaveBeenCalledOnce();
  const modeCount = demodulator.setMode.mock.calls.length;
  await expect(
    backend.configureMode(
      { mode: "DAB", bandwidthHz: 1_536_000, squelch: 0 },
      2,
    ),
  ).rejects.toThrow();
  expect(demodulator.setMode).toHaveBeenCalledTimes(modeCount);
  await backend.tune(101_000_000, 3);
  expect(demodulator.setFrequencyOffset).toHaveBeenLastCalledWith(-17);
  reads.shift()!.resolve(block(100_000_017));
  for (let n = 0; n < 10; n++) await Promise.resolve();
  expect(raw).toHaveLength(1);
  reads.shift()!.resolve(block(101_000_017));
  for (let n = 0; n < 10; n++) await Promise.resolve();
  expect(raw).toEqual([0.25, 0.25]);
  const centered = await backend.tune(101_000_000, 4, { centerFrequencyHz: 101_200_000 });
  expect(centered).toMatchObject({
    hardwareCenterFrequencyHz: 101_200_017,
    selectedChannelFrequencyHz: 101_000_000,
  });
  expect(demodulator.setFrequencyOffset).toHaveBeenLastCalledWith(-200_017);
  const lateTune = deferred<number>();
  source.setCenterFrequency = () => lateTune.promise;
  const tuning = backend.tune(102_000_000, 5);
  const rejected = expect(tuning).rejects.toMatchObject({ name: "AbortError" });
  const disconnecting = backend.disconnect();
  for (const read of reads.splice(0)) read.resolve(block(101_000_017));
  await disconnecting;
  const begins = analysis.begin.mock.calls.length;
  lateTune.resolve(102_000_017);
  await rejected;
  expect(analysis.begin).toHaveBeenCalledTimes(begins);
});

it.each([1_024_000, 2_400_000])("records only the selected RTL channel at source rate %i", async (rate) => {
  vi.stubGlobal("navigator", { usb: {} });
  type Block = import("@jtarrio/signals/radio/sample_block.js").SampleBlock;
  const reads: ReturnType<typeof deferred<Block>>[] = [];
  const source = sourceWith(async () => {});
  source.readSamples = () => { const read = deferred<Block>(); reads.push(read); return read.promise; };
  let capture!: (input: ArrayBuffer) => void;
  const backend = new RtlSdrBackend(events(), undefined, 1, OPTIONS.channelFrequencyHz, {
    ...dependencies(source, audioContextWith(async () => {})),
    createSourceProvider: (_permission, callback) => { capture = callback!; return { get: async () => source }; },
  });
  await backend.start({ ...OPTIONS, sampleRateHz: rate, modeSettings: { mode: "AM", bandwidthHz: 15_000, squelch: 0 } });
  backend.startRecording(undefined, { captureCurrentChannel: true });
  capture(new Uint8Array(65_536).fill(140).buffer);
  const recording = backend.stopRecording()!;
  expect(recording.metadata).toMatchObject({ format: "browsersdr-channel-iq-v1", source: "rtl-sdr", centerFrequencyHz: OPTIONS.channelFrequencyHz });
  expect(recording.data.length).toBeLessThan(65_536 / 8);
  const disconnecting = backend.disconnect();
  for (const read of reads.splice(0)) read.resolve({ I: new Float32Array(0), Q: new Float32Array(0), frequency: OPTIONS.channelFrequencyHz });
  await disconnecting;
});
