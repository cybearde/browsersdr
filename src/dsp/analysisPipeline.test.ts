import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisWorkerInput,
  AnalysisWorkerOutput,
} from "./spectrumProtocol";
import {
  AnalysisPipeline,
  ANALYSIS_MAX_BLOCK_SAMPLES,
  ANALYSIS_DISPLAY_QUEUE_CAPACITY,
  ANALYSIS_WIDEBAND_INPUT_SLOTS,
  analysisInputSlots,
} from "./analysisPipeline";

import { collectSpectrumMeasurement } from "../radio/spectrumScan";
import { WaterfallHistory } from "../graphics/waterfallHistory";
import { RECEIVER_MODES } from "../radio/receiverConfig";

class FakeWorker {
  onmessage: ((event: MessageEvent<AnalysisWorkerOutput>) => void) | null =
    null;
  readonly sent: AnalysisWorkerInput[] = [];
  postMessage(message: AnalysisWorkerInput): void {
    this.sent.push(message);
  }
  terminate(): void {}
  emit(message: AnalysisWorkerOutput): void {
    this.onmessage?.({ data: message } as MessageEvent<AnalysisWorkerOutput>);
  }
}

const METADATA = {
  source: "synthetic" as const,
  sessionGeneration: 7,
  requestedSampleRateHz: 1_024_000,
  actualSampleRateHz: 1_024_000,
  hardwareCenterFrequencyHz: 100_000_000,
  selectedChannelFrequencyHz: 100_125_000,
  mode: "WBFM" as const,
  channelBandwidthHz: 150_000,
  squelch: 0,
  gainDb: null,
  sampleFormat: "planar-f32-iq-normalized" as const,
};

it("bounds and cancels signal probes, ignores stale replies and rejects them on retune", async () => {
  vi.useFakeTimers();
  const worker = new FakeWorker(), pipeline = new AnalysisPipeline(worker as unknown as Worker);
  try {
    pipeline.begin(METADATA);
    const config = { sampleRateHz: 1_024_000, centerFrequencyHz: 100e6, frequencyHz: 100.125e6, bandwidthHz: 180e3, seconds: 12 };
    const abort = new AbortController(), progress = vi.fn();
    const pending = pipeline.analyzeSignal(config, abort.signal, progress);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const request = worker.sent.find(m => m.type === "probe-start")!;
    if (request.type !== "probe-start") throw new Error("Missing request");
    worker.emit({ type: "probe-progress", sessionGeneration: 6, requestId: request.requestId, sampledSeconds: 1 });
    expect(progress).not.toHaveBeenCalled();
    worker.emit({ type: "probe-progress", sessionGeneration: 7, requestId: request.requestId, sampledSeconds: 1 });
    expect(progress).toHaveBeenCalledWith(1);
    abort.abort(); await rejected;
    expect(worker.sent.some(m => m.type === "probe-cancel")).toBe(true);
    const next = pipeline.analyzeSignal(config, new AbortController().signal);
    const retuned = expect(next).rejects.toThrow("settings changed");
    pipeline.retune({ ...METADATA, sessionGeneration: 8 }); await retuned;
    const timeout = pipeline.analyzeSignal(config, new AbortController().signal);
    const timedOut = expect(timeout).rejects.toThrow("No analysis samples");
    await vi.advanceTimersByTimeAsync(10_001); await timedOut;
  } finally { pipeline.dispose(); vi.useRealTimers(); }
});

it("measures current raw input before worker backpressure, rejects stale generations and clears clipping on retune/stop", () => {
  const worker = new FakeWorker(), pipeline = new AnalysisPipeline(worker as unknown as Worker);
  pipeline.begin({ ...METADATA, source: "hackrf" });
  const bytes = new Uint8Array(512).fill(127);
  pipeline.receiveCi8(bytes, 100e6, 6);
  expect(pipeline.getInputClipping()).toBeUndefined();
  for (let n = 0; n < 5; n++) pipeline.receiveCi8(bytes, 100e6, 7);
  expect(pipeline.getInputClipping()?.clippedFraction).toBe(1);
  expect(pipeline.getDiagnostics().skippedInputBlocks).toBe(1);
  pipeline.retune({ ...METADATA, source: "rtl-sdr", sessionGeneration: 8 });
  expect(pipeline.getInputClipping()).toBeUndefined();
  pipeline.receiveCi8(bytes, 100e6, 7);
  expect(pipeline.getInputClipping()).toBeUndefined();
  const receiver = pipeline.begin({ ...METADATA, source: "rtl-sdr", sessionGeneration: 9 });
  receiver.receiveSamples({ I: new Float32Array(128).fill(127.5 / 128), Q: new Float32Array(128), frequency: 100e6 });
  expect(pipeline.getInputClipping()?.clippedFraction).toBe(0.5);
  pipeline.stop();
  expect(pipeline.getInputClipping()).toBeUndefined();
});

afterEach(() => vi.unstubAllGlobals());

const RECEIVER_RATE_BURSTS = [
  { source: "rtl-sdr", rates: [1_024_000, 2_400_000], input: "samples", burst: 4 },
  { source: "hackrf", rates: [1_024_000], input: "samples", burst: 4 },
  { source: "hackrf", rates: [2_400_000, 4_800_000, 9_600_000, 19_200_000], input: "ci8", burst: 64 },
  { source: "bladerf", rates: [2_400_000, 4_800_000, 9_600_000], input: "sc16", burst: 64 },
  { source: "bladerf", rates: [19_200_000], input: "sc16", burst: 368 },
  { source: "usrp-b205", rates: [4_800_000, 9_600_000, 19_200_000], input: "usrp-sc16", burst: 4 },
] as const;

const RECEIVER_MODE_RATE_MATRIX = RECEIVER_RATE_BURSTS.flatMap(profile =>
  profile.rates.flatMap(rate => RECEIVER_MODES.map(mode => ({ ...profile, rate, mode }))));

describe("AnalysisPipeline credits", () => {
  it.each(RECEIVER_MODE_RATE_MATRIX)(
    "keeps $source $rate $mode analysis lossless across its bounded callback burst",
    ({ source, rate, mode, input, burst }) => {
      const worker = new FakeWorker(), pipeline = new AnalysisPipeline(worker as unknown as Worker);
      const receiver = pipeline.begin({
        ...METADATA, source, mode, requestedSampleRateHz: rate, actualSampleRateHz: rate,
      });
      for (let index = 0; index < burst; index += 1) {
        if (input === "ci8") pipeline.receiveCi8(Uint8Array.of(128, 128), 100_000_000, 7);
        else if (input === "sc16") pipeline.receiveSc16(Uint8Array.of(0, 0, 0, 0), 100_000_000, 7);
        else if (input === "usrp-sc16") pipeline.receiveUsrpSc16(Uint8Array.of(0, 0, 0, 0), 100_000_000, 7);
        else receiver.receiveSamples({ I: new Float32Array(1), Q: new Float32Array(1), frequency: 100_000_000 });
      }
      expect(pipeline.getDiagnostics()).toMatchObject({
        skippedInputBlocks: 0,
        knownApplicationDiscontinuities: 0,
      });
      expect(worker.sent.filter(message => message.type.startsWith("samples")).length).toBe(burst);
      pipeline.stop();
    },
  );

  it.each([
    [1_024_000, 4],
    [2_400_000, 4],
    [4_800_000, 96],
    [9_600_000, 96],
    [19_200_000, 128],
  ])("bounds the %i samples/s analysis input pool to %i blocks", (rate, slots) => {
    expect(analysisInputSlots(rate)).toBe(slots);
  });

  it.each([
    ["rtl-sdr", 2_400_000, 4],
    ["hackrf", 1_024_000, 4],
    ["hackrf", 2_400_000, 96],
    ["hackrf", 4_800_000, 96],
    ["hackrf", 9_600_000, 96],
    ["hackrf", 19_200_000, 96],
    ["bladerf", 2_400_000, 96],
    ["bladerf", 4_800_000, 96],
    ["bladerf", 9_600_000, 96],
    ["bladerf", 19_200_000, 512],
    ["usrp-b205", 4_800_000, 96],
    ["usrp-b205", 9_600_000, 96],
    ["usrp-b205", 19_200_000, 128],
  ] as const)("uses a source-aware %s %i samples/s pool of %i blocks", (source, rate, slots) => {
    expect(analysisInputSlots(rate, source)).toBe(slots);
  });

  it("buffers the bounded wideband credit window before marking overflow", () => {
    const worker = new FakeWorker();
    const pipeline = new AnalysisPipeline(worker as unknown as Worker);
    const receiver = pipeline.begin({
      ...METADATA,
      source: "hackrf",
      requestedSampleRateHz: 4_800_000,
      actualSampleRateHz: 4_800_000,
    });
    const block = {
      I: new Float32Array(8),
      Q: new Float32Array(8),
      frequency: 100_000_000,
    };
    for (let index = 0; index <= ANALYSIS_WIDEBAND_INPUT_SLOTS; index++)
      receiver.receiveSamples(block);

    expect(
      worker.sent.filter((message) => message.type === "samples"),
    ).toHaveLength(ANALYSIS_WIDEBAND_INPUT_SLOTS);
    expect(pipeline.getDiagnostics()).toMatchObject({
      skippedInputBlocks: 1,
      skippedInputSamples: 8,
    });
  });

  it("rejects oversized blocks before allocating a worker copy", () => {
    const worker = new FakeWorker();
    const pipeline = new AnalysisPipeline(worker as unknown as Worker);
    const receiver = pipeline.begin(METADATA);
    const I = new Float32Array(ANALYSIS_MAX_BLOCK_SAMPLES + 1);
    receiver.receiveSamples({ I, Q: I, frequency: 100_000_000 });
    expect(
      worker.sent.filter((message) => message.type === "samples"),
    ).toHaveLength(0);
    expect(pipeline.getDiagnostics().skippedInputSamples).toBe(I.length);
  });

  it("does not let old acknowledgements grant new-generation credits", () => {
    const worker = new FakeWorker();
    const pipeline = new AnalysisPipeline(worker as unknown as Worker);
    const receiver = pipeline.begin(METADATA);
    const block = {
      I: new Float32Array(8),
      Q: new Float32Array(8),
      frequency: 100_000_000,
    };
    receiver.receiveSamples(block);
    const old = worker.sent.find((message) => message.type === "samples")!;
    if (old.type !== "samples") throw new Error("missing sample");
    pipeline.retune({ ...METADATA, sessionGeneration: 8 });
    for (let index = 0; index < 4; index++) receiver.receiveSamples(block);
    worker.emit({
      type: "samples-ack",
      sessionGeneration: 7,
      processingTimeMs: 1,
      backend: "JavaScript reference",
      backendStartupMs: 0,
      I: old.I,
      Q: old.Q,
    });
    receiver.receiveSamples(block);
    expect(
      worker.sent.filter((message) => message.type === "samples"),
    ).toHaveLength(5);
    expect(pipeline.getDiagnostics().skippedInputBlocks).toBe(1);
  });

  it("feeds the GPU tap independently of worker credits and forwards only source gaps", () => {
    const worker = new FakeWorker();
    const pipeline = new AnalysisPipeline(worker as unknown as Worker);
    const received: { discontinuity: boolean; missingSamples: number }[] = [];
    const detach = pipeline.attachGpuTap((block) =>
      received.push({
        discontinuity: block.discontinuity,
        missingSamples: block.missingSamples,
      }),
    );
    const receiver = pipeline.begin(METADATA);
    const block = {
      I: new Float32Array(8),
      Q: new Float32Array(8),
      frequency: 100_000_000,
    };
    receiver.receiveSamples(block);
    receiver.receiveSamples(block);
    pipeline.markDiscontinuity(123);
    receiver.receiveSamples(block);
    receiver.receiveSamples(block);
    expect(received).toEqual([
      { discontinuity: false, missingSamples: 0 },
      { discontinuity: false, missingSamples: 0 },
      { discontinuity: true, missingSamples: 123 },
      { discontinuity: false, missingSamples: 0 },
    ]);
    expect(
      worker.sent.filter((message) => message.type === "samples"),
    ).toHaveLength(4);
    detach();
    receiver.receiveSamples(block);
    expect(received).toHaveLength(4);
  });
  it("rejects old source callbacks even after a new source begins", () => {
    const worker = new FakeWorker();
    const pipeline = new AnalysisPipeline(worker as unknown as Worker);
    const old = pipeline.begin(METADATA);
    pipeline.stop();
    pipeline.begin({ ...METADATA, sessionGeneration: 8 });
    old.setSampleRate(42);
    old.receiveSamples({
      I: new Float32Array(8),
      Q: new Float32Array(8),
      frequency: 1,
    });
    expect(
      worker.sent.filter((message) => message.type === "samples"),
    ).toHaveLength(0);
    expect(pipeline.getDiagnostics().receivedComplexSamples).toBe(0);
  });

  it("keeps recorded gap lengths on the analysis source clock", () => {
    const worker = new FakeWorker();
    const pipeline = new AnalysisPipeline(worker as unknown as Worker);
    const receiver = pipeline.begin(METADATA);
    pipeline.markDiscontinuity(400);
    receiver.receiveSamples({
      I: new Float32Array(8),
      Q: new Float32Array(8),
      frequency: 100_000_000,
    });
    expect(
      worker.sent.find((message) => message.type === "samples"),
    ).toMatchObject({ discontinuity: true, droppedInputSamples: 400 });
  });
  it("absorbs a four-block burst and marks overflow as a discontinuity", () => {
    const worker = new FakeWorker();
    const pipeline = new AnalysisPipeline(worker as unknown as Worker);
    const receiver = pipeline.begin(METADATA);
    const block = {
      I: new Float32Array(8),
      Q: new Float32Array(8),
      frequency: 100_000_000,
    };
    for (let index = 0; index < 5; index++) receiver.receiveSamples(block);
    expect(
      worker.sent.filter((message) => message.type === "samples"),
    ).toHaveLength(4);
    const first = worker.sent.find((message) => message.type === "samples");
    if (!first || first.type !== "samples")
      throw new Error("Missing sample message");
    worker.emit({
      type: "samples-ack",
      sessionGeneration: 7,
      processingTimeMs: 1.25,
      backend: "WebAssembly · RustFFT",
      backendStartupMs: 2,
      I: first.I,
      Q: first.Q,
    });
    receiver.receiveSamples(block);
    const samples = worker.sent.filter((message) => message.type === "samples");
    expect(samples).toHaveLength(5);
    expect(samples[4]).toMatchObject({
      discontinuity: true,
      droppedInputBlocks: 1,
    });
    expect(pipeline.getDiagnostics()).toMatchObject({
      receivedComplexSamples: 48,
      receivedBytes: null,
      processedBlocks: 1,
      processingTimeAverageMs: 1.25,
      skippedInputBlocks: 1,
      skippedInputSamples: 8,
      knownApplicationDiscontinuities: 1,
      analysisBackend: "WebAssembly · RustFFT",
      backendStartupMs: 2,
    });
  });

  it("delivers measurements and returns batched credits after display animation drains", () => {
    const worker = new FakeWorker();
    let animationCallback: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      animationCallback = callback;
      return 1;
    });
    const pipeline = new AnalysisPipeline(worker as unknown as Worker);
    pipeline.begin(METADATA);
    const listener = vi.fn();
    const measurement = vi.fn();
    pipeline.subscribe(listener);
    pipeline.subscribeMeasurements(measurement);
    worker.emit({
      type: "spectrum",
      sessionGeneration: 7,
      sequence: 0,
      timestampMs: 1,
      centerFrequencyHz: 100_000_000,
      sampleRateHz: 1_024_000,
      sampleIndex: 16_384,
      bins: new Float32Array(4096).buffer,
      droppedFramesBefore: 0,
      skippedSpectrumFramesBefore: 0,
      missingSamplesBefore: 123,
    });
    expect(measurement).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
    expect(
      worker.sent.filter((message) => message.type === "spectrum-credit"),
    ).toHaveLength(0);
    worker.emit({
      type: "spectrum",
      sessionGeneration: 7,
      sequence: 1,
      timestampMs: 2,
      centerFrequencyHz: 100_000_000,
      sampleRateHz: 1_024_000,
      sampleIndex: 32_768,
      bins: new Float32Array(4096).buffer,
      droppedFramesBefore: 0,
      skippedSpectrumFramesBefore: 0,
    });
    expect(measurement).toHaveBeenCalledTimes(2);
    expect(
      worker.sent.filter((message) => message.type === "spectrum-credit"),
    ).toHaveLength(0);
    animationCallback?.(2);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      sequence: 1,
      missingSamplesBefore: 123,
    });
    expect(measurement.mock.calls[1]?.[0]).toMatchObject({
      missingSamplesBefore: 0,
    });
    expect(
      worker.sent.filter((message) => message.type === "spectrum-credit"),
    ).toEqual([{ type: "spectrum-credit", sessionGeneration: 7, credits: 2 }]);
  });

  it("rejects stale worker frames after a retune generation", () => {
    const worker = new FakeWorker();
    let animationCallback: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      animationCallback = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const pipeline = new AnalysisPipeline(worker as unknown as Worker);
    pipeline.begin(METADATA);
    const listener = vi.fn();
    pipeline.subscribe(listener);
    pipeline.retune({
      ...METADATA,
      sessionGeneration: 8,
      hardwareCenterFrequencyHz: 101_000_000,
    });
    worker.emit({
      type: "spectrum",
      sessionGeneration: 7,
      sequence: 4,
      timestampMs: 2,
      sampleIndex: 16_384,
      centerFrequencyHz: 100_000_000,
      sampleRateHz: 1_024_000,
      bins: new Float32Array(4096).buffer,
      droppedFramesBefore: 0,
      skippedSpectrumFramesBefore: 0,
    });
    animationCallback?.(3);
    expect(listener).not.toHaveBeenCalled();
    worker.emit({
      type: "spectrum",
      sessionGeneration: 8,
      sequence: 0,
      timestampMs: 3,
      sampleIndex: 16_384,
      centerFrequencyHz: 101_000_000,
      sampleRateHz: 1_024_000,
      bins: new Float32Array(4096).buffer,
      droppedFramesBefore: 0,
      skippedSpectrumFramesBefore: 0,
    });
    animationCallback?.(4);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

it.each([
  { rate: 9_600_000, slots: analysisInputSlots(9_600_000) },
  { rate: 19_200_000, slots: analysisInputSlots(19_200_000) },
])(
  "bounds $rate analysis bursts to $slots credits and rejects stale acknowledgements",
  ({ rate, slots }) => {
    const worker = new FakeWorker(),
      pipeline = new AnalysisPipeline(worker as unknown as Worker);
    const metadata = {
      ...METADATA,
      actualSampleRateHz: rate,
      requestedSampleRateHz: rate,
    };
    const receiver = pipeline.begin(metadata);
    const block = {
      I: new Float32Array(32768),
      Q: new Float32Array(32768),
      frequency: 100e6,
    };
    for (let n = 0; n < slots + 1; n++) receiver.receiveSamples(block);
    const messages = worker.sent.filter(
      (message) => message.type === "samples",
    );
    expect(messages).toHaveLength(slots);
    expect(pipeline.getDiagnostics().skippedInputBlocks).toBe(1);
    const first = messages[0]!;
    worker.emit({
      type: "samples-ack",
      sessionGeneration: 7,
      processingTimeMs: 1,
      backend: "JavaScript reference",
      backendStartupMs: 0,
      I: first.I,
      Q: first.Q,
    });
    receiver.receiveSamples(block);
    expect(
      worker.sent.filter((message) => message.type === "samples"),
    ).toHaveLength(slots + 1);
    pipeline.retune({ ...metadata, sessionGeneration: 8 });
    for (let n = 0; n < slots; n++) receiver.receiveSamples(block);
    worker.emit({
      type: "samples-ack",
      sessionGeneration: 7,
      processingTimeMs: 1,
      backend: "JavaScript reference",
      backendStartupMs: 0,
      I: first.I,
      Q: first.Q,
    });
    receiver.receiveSamples(block);
    expect(pipeline.getDiagnostics().skippedInputBlocks).toBe(1);
    pipeline.stop();
  },
);

it("keeps native bytes compact with bounded credits, exact gap lengths and stale-ack filtering", () => {
  const worker = new FakeWorker();
  const pipeline = new AnalysisPipeline(worker as unknown as Worker);
  pipeline.begin({ ...METADATA, actualSampleRateHz: 19_200_000 });
  const bytes = Uint8Array.of(128, 255, 0, 127);
  const gpu = vi.fn(),
    planar = vi.fn();
  pipeline.attachGpuTap(planar, gpu);
  const slots = analysisInputSlots(19_200_000);
  for (let n = 0; n <= slots; n++) pipeline.receiveCi8(bytes, 100e6, 7);
  const sent = worker.sent.filter((m) => m.type === "samples-ci8");
  expect(sent).toHaveLength(slots);
  expect(new Uint8Array(sent[0]!.bytes)).toEqual(bytes);
  bytes.fill(0);
  expect([...new Uint8Array(sent[0]!.bytes)]).toEqual([128, 255, 0, 127]);
  expect(planar).not.toHaveBeenCalled();
  expect(gpu).toHaveBeenCalledTimes(slots + 1);
  worker.emit({
    type: "samples-ci8-ack",
    sessionGeneration: 7,
    bytes: sent[0]!.bytes,
    processingTimeMs: 1,
    backend: "JavaScript reference",
    backendStartupMs: 0,
  });
  pipeline.receiveCi8(bytes, 100e6, 7);
  expect(worker.sent.at(-1)).toMatchObject({
    type: "samples-ci8",
    discontinuity: true,
    droppedInputBlocks: 1,
    droppedInputSamples: 2,
  });
  pipeline.retune({
    ...METADATA,
    sessionGeneration: 8,
    actualSampleRateHz: 19_200_000,
  });
  for (let n = 0; n < slots; n++) pipeline.receiveCi8(bytes, 100e6, 8);
  worker.emit({
    type: "samples-ci8-ack",
    sessionGeneration: 7,
    bytes: sent[1]!.bytes,
    processingTimeMs: 1,
    backend: "JavaScript reference",
    backendStartupMs: 0,
  });
  pipeline.receiveCi8(bytes, 100e6, 8);
  expect(pipeline.getDiagnostics().skippedInputBlocks).toBe(1);
  pipeline.stop();
  pipeline.receiveCi8(bytes, 100e6, 8);
});

it("keeps bladeRF SC16 native through the spectrum-worker boundary", () => {
  const worker = new FakeWorker();
  const pipeline = new AnalysisPipeline(worker as unknown as Worker);
  pipeline.begin({
    ...METADATA,
    source: "bladerf",
    actualSampleRateHz: 9_600_000,
  });
  const bytes = Uint8Array.of(0, 4, 0, 252);
  pipeline.receiveSc16(bytes, 100e6, 7);
  const sent = worker.sent.find((message) => message.type === "samples-sc16");
  expect(sent).toBeDefined();
  if (!sent || sent.type !== "samples-sc16")
    throw new Error("Missing SC16 worker message");
  expect([...new Uint8Array(sent.bytes)]).toEqual([0, 4, 0, 252]);
  expect(pipeline.getDiagnostics()).toMatchObject({
    receivedComplexSamples: 1,
    receivedBytes: 4,
  });
  worker.emit({
    type: "samples-sc16-ack",
    sessionGeneration: 7,
    bytes: sent.bytes,
    processingTimeMs: 1,
    backend: "JavaScript reference",
    backendStartupMs: 0,
  });
  expect(pipeline.getDiagnostics().processedBlocks).toBe(1);
});

it("keeps USRP Q/I SC16 distinct through the spectrum-worker boundary", () => {
  const worker = new FakeWorker();
  const pipeline = new AnalysisPipeline(worker as unknown as Worker);
  pipeline.begin({
    ...METADATA,
    source: "usrp-b205",
    actualSampleRateHz: 19_200_000,
  });
  const bytes = Uint8Array.of(0, 192, 0, 64);
  pipeline.receiveUsrpSc16(bytes, 100e6, 7);
  const sent = worker.sent.find(
    (message) => message.type === "samples-usrp-sc16",
  );
  expect(sent).toBeDefined();
  if (!sent || sent.type !== "samples-usrp-sc16")
    throw new Error("Missing USRP SC16 worker message");
  expect([...new Uint8Array(sent.bytes)]).toEqual([0, 192, 0, 64]);
  worker.emit({
    type: "samples-usrp-sc16-ack",
    sessionGeneration: 7,
    bytes: sent.bytes,
    processingTimeMs: 1,
    backend: "JavaScript reference",
    backendStartupMs: 0,
  });
  expect(pipeline.getDiagnostics()).toMatchObject({
    receivedComplexSamples: 1,
    receivedBytes: 4,
    processedBlocks: 1,
  });
});


describe("batched waterfall delivery", () => {
  function setup() {
    const worker = new FakeWorker();
    let animationCallback: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      animationCallback = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const pipeline = new AnalysisPipeline(worker as unknown as Worker);
    pipeline.begin(METADATA);
    const listener = vi.fn();
    pipeline.subscribe(listener);
    const emit = (sequence: number, missingSamplesBefore = 0) => worker.emit({
      type: "spectrum", sessionGeneration: 7, sequence, timestampMs: sequence * 40,
      centerFrequencyHz: 100_000_000, sampleRateHz: 4_800_000,
      sampleIndex: (sequence + 1) * 192512, hopSamples: 192512,
      bins: new Float32Array(4096).fill(sequence).buffer,
      droppedFramesBefore: 0, skippedSpectrumFramesBefore: 0, missingSamplesBefore,
    });
    return { pipeline, listener, emit, flush: () => animationCallback?.(0) };
  }

  it("keeps every row through a 120 ms rendering delay and publishes once", () => {
    const { pipeline, listener, emit, flush } = setup();
    const history = new WaterfallHistory(240);
    history.reset(7);
    emit(0); flush();
    history.append(listener.mock.calls[0]![1][0]);
    listener.mockClear();
    emit(1); emit(2); emit(3);
    expect(listener).not.toHaveBeenCalled();
    flush();
    expect(listener).toHaveBeenCalledOnce();
    const [latest, frames] = listener.mock.calls[0]!;
    expect(latest.sequence).toBe(3);
    expect(frames.map((frame: { sequence: number }) => frame.sequence)).toEqual([1, 2, 3]);
    expect(frames.flatMap((frame: Parameters<typeof history.append>[0]) => history.append(frame)).map((row: { kind: string }) => row.kind)).toEqual(["spectrum", "spectrum", "spectrum"]);
    expect(pipeline.getDiagnostics()).toMatchObject({ deliveredDisplayFrames: 4, skippedSpectrumFrames: 0 });
  });

  it("bounds the backlog and marks overflow while preserving actual sample loss", () => {
    const { pipeline, listener, emit, flush } = setup();
    const history = new WaterfallHistory(240);
    history.reset(7);
    emit(0); flush();
    history.append(listener.mock.calls[0]![1][0]);
    listener.mockClear();
    for (let sequence = 1; sequence <= ANALYSIS_DISPLAY_QUEUE_CAPACITY + 2; sequence++) emit(sequence, sequence === 1 ? 123 : 0);
    flush();
    const [latest, frames] = listener.mock.calls[0]!;
    expect(frames).toHaveLength(ANALYSIS_DISPLAY_QUEUE_CAPACITY);
    expect(frames[0]).toMatchObject({ sequence: 3, missingSamplesBefore: 123, droppedFramesBefore: 2 });
    expect(latest.sequence).toBe(ANALYSIS_DISPLAY_QUEUE_CAPACITY + 2);
    expect(history.append(frames[0]).map(row => row.kind)).toEqual(["gap", "gap", "spectrum"]);
    expect(pipeline.getDiagnostics().skippedSpectrumFrames).toBe(2);
  });

  it.each(["stop", "retune", "begin"] as const)("clears queued rows on %s", action => {
    const { pipeline, listener, emit, flush } = setup();
    emit(0); emit(1);
    if (action === "stop") pipeline.stop();
    else pipeline[action]({ ...METADATA, sessionGeneration: 8 });
    flush();
    expect(listener).not.toHaveBeenCalled();
  });
});


it("replaces a crashed worker, discards late replies and restores credits for the active source", () => {
  const old = new FakeWorker(), replacement = new FakeWorker();
  const factory = vi.fn(() => replacement as unknown as Worker);
  const pipeline = new AnalysisPipeline(old as unknown as Worker, "javascript", factory);
  const receiver = pipeline.begin(METADATA);
  const block = { I: new Float32Array(8), Q: new Float32Array(8), frequency: METADATA.hardwareCenterFrequencyHz };
  receiver.receiveSamples(block);
  (old as unknown as Worker).onerror?.({ message: "crash" } as ErrorEvent);
  expect(factory).toHaveBeenCalledOnce();
  expect(old.onmessage).toBeNull();
  expect(replacement.sent[0]).toMatchObject({ type: "configure", sessionGeneration: 7 });
  receiver.receiveSamples(block);
  expect(replacement.sent.at(-1)).toMatchObject({ type: "samples", sessionGeneration: 7 });
  expect(pipeline.getDiagnostics().knownApplicationDiscontinuities).toBe(1);
  pipeline.dispose();
});

describe("on-demand signal centering", () => {
  it("excludes samples queued before click and ignores cancelled result IDs", async () => {
    const worker = new FakeWorker(), pipeline = new AnalysisPipeline(worker as unknown as Worker);
    const receiver = pipeline.begin(METADATA);
    receiver.receiveSamples({ I: new Float32Array(10), Q: new Float32Array(10), frequency: METADATA.hardwareCenterFrequencyHz });
    const pending = pipeline.measureSignalCenter(METADATA);
    const request = worker.sent.find(message => message.type === "center-start")!;
    expect(request).toMatchObject({ minimumSampleIndex: 10 });
    if (request.type !== "center-start") throw new Error("Missing request");
    pipeline.cancelSignalCenter();
    expect((await pending).kind).toBe("failure");
    worker.emit({ type: "center-result", sessionGeneration: 7, requestId: request.requestId, result: { kind: "estimate", offsetHz: 2000, toleranceHz: 50, message: "OK" } });
    const second = pipeline.measureSignalCenter(METADATA);
    const next = worker.sent.filter(message => message.type === "center-start").at(-1)!;
    if (next.type !== "center-start") throw new Error("Missing request");
    worker.emit({ type: "center-result", sessionGeneration: 7, requestId: request.requestId, result: { kind: "estimate", offsetHz: 8000, message: "old" } });
    worker.emit({ type: "center-result", sessionGeneration: 7, requestId: next.requestId, result: { kind: "estimate", offsetHz: 2000, message: "fresh" } });
    expect((await second).message).toBe("fresh"); pipeline.dispose();
  });
  it.each(["retune", "gap", "stop"])("invalidates a measurement on %s", async operation => {
    const worker = new FakeWorker(), pipeline = new AnalysisPipeline(worker as unknown as Worker); pipeline.begin(METADATA);
    const pending = pipeline.measureSignalCenter(METADATA);
    if (operation === "retune") pipeline.retune({ ...METADATA, sessionGeneration: 8 });
    else if (operation === "gap") pipeline.markDiscontinuity(10);
    else pipeline.stop();
    expect((await pending).kind).toBe("failure"); pipeline.dispose();
  });
  it("returns an actionable failure if fresh data never arrives", async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker(), pipeline = new AnalysisPipeline(worker as unknown as Worker); pipeline.begin(METADATA);
      const pending = pipeline.measureSignalCenter(METADATA); await vi.advanceTimersByTimeAsync(4000);
      expect((await pending).message).toContain("Check reception"); pipeline.dispose();
    } finally { vi.useRealTimers(); }
  });
  it("keeps native CI8 measurement ingress with a WebGPU tap attached", () => {
    const worker = new FakeWorker(), pipeline = new AnalysisPipeline(worker as unknown as Worker); pipeline.begin({ ...METADATA, source: "hackrf" });
    const tap = vi.fn(); pipeline.attachGpuTap(vi.fn(), tap);
    pipeline.receiveCi8(new Uint8Array(16), METADATA.hardwareCenterFrequencyHz, 7);
    expect(tap).toHaveBeenCalledTimes(1);
    expect(worker.sent.find(message => message.type === "samples-ci8")).toMatchObject({ sampleIndex: 0 }); pipeline.dispose();
  });
});

it("background sharing returns spectrum credits without animation and preserves the bounded local queue", () => {
  const worker = new FakeWorker();
  let animationCallback: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { animationCallback = callback; return 1; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const pipeline = new AnalysisPipeline(worker as unknown as Worker); pipeline.begin(METADATA);
  const display = vi.fn(), measurement = vi.fn(); pipeline.subscribe(display);
  const emit = (sequence: number) => worker.emit({ type: "spectrum", sessionGeneration: 7, sequence,
    timestampMs: sequence * 40, centerFrequencyHz: 100e6, sampleRateHz: 1_024_000,
    sampleIndex: (sequence + 1) * 40960, bins: new Float32Array(4096).buffer,
    droppedFramesBefore: 0, skippedSpectrumFramesBefore: 0 });
  for (let i = 0; i < 32; i++) emit(i);
  const credits = () => worker.sent.reduce((sum, message) => sum + (message.type === "spectrum-credit" ? message.credits : 0), 0);
  expect(credits()).toBe(0);
  const unsubscribe = pipeline.subscribeMeasurements(measurement, true);
  expect(credits()).toBe(32);
  for (let i = 32; i < 96; i++) emit(i);
  expect(credits()).toBe(96); expect(measurement).toHaveBeenCalledTimes(64); expect(display).not.toHaveBeenCalled();
  animationCallback?.(0);
  expect(display).toHaveBeenCalledOnce(); expect(display.mock.calls[0]![1]).toHaveLength(ANALYSIS_DISPLAY_QUEUE_CAPACITY);
  expect(credits()).toBe(96);
  unsubscribe(); unsubscribe(); emit(96); expect(credits()).toBe(96);
  animationCallback?.(0); expect(credits()).toBe(97); pipeline.dispose();
});


it("releases exhausted display credits for a source-clock dwell without animation frames", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  class CreditedWorker extends FakeWorker {
    credits = 32;
    sampleIndex = 0;
    override postMessage(message: AnalysisWorkerInput): void {
      super.postMessage(message);
      if (message.type === "spectrum-credit") this.credits = Math.min(32, this.credits + message.credits);
    }
    step(): boolean {
      if (!this.credits) return false;
      this.credits--; this.sampleIndex += 40960;
      this.emit({ type: "spectrum", sessionGeneration: 7, sequence: this.sampleIndex / 40960,
        timestampMs: this.sampleIndex / 1024, centerFrequencyHz: 100e6, sampleRateHz: 1_024_000,
        sampleIndex: this.sampleIndex, hopSamples: 40960, bins: new Float32Array(4096).buffer,
        droppedFramesBefore: 0, skippedSpectrumFramesBefore: 0, missingSamplesBefore: 0 });
      return true;
    }
  }
  const worker = new CreditedWorker();
  const pipeline = new AnalysisPipeline(worker as unknown as Worker);
  const abort = new AbortController();
  try {
    pipeline.begin(METADATA);
    for (let i = 0; i < 32; i++) expect(worker.step()).toBe(true);
    expect(worker.step()).toBe(false);
    const pending = collectSpectrumMeasurement(pipeline, { generation: 7, centerFrequencyHz: 100e6,
      sampleRateHz: 1_024_000, dwellMs: 350, signal: abort.signal });
    const outcome = pending.then(value => ({value}), error => ({error: String(error)}));
    for (let i = 0; i < 12; i++) worker.step();
    await vi.advanceTimersByTimeAsync(1500);
    expect(await outcome).toMatchObject({value:{status:"complete",coverage:1,targetSamples:358400}});
    expect(worker.credits).toBeLessThanOrEqual(32);
  } finally { abort.abort(); pipeline.dispose(); vi.useRealTimers(); }
});
