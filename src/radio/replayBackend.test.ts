import { textModemRecordingFixture } from "../testing/textModemRecordingFixture";
import { Rs41DigitalReceiver } from "../rs41/rs41DigitalReceiver";
import { packetRecordingFixture } from "../testing/packetRecordingFixture";
import { createDabEnsembleFixture } from "../testing/dabEnsembleFixture";
import { readFile } from "node:fs/promises";
import { WasmChannelFilter, type ChannelExports } from "./wasmChannel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReplayBackend } from "./replayBackend";
import { ReceiverController, type ReceiverBackendEvents } from "./receiverController";
import { createDeterministicRecordingFixture } from "../testing/recordingFixture";
import type { AnalysisPipeline } from "../dsp/analysisPipeline";
import type { SampleBlock } from "@jtarrio/signals/radio/sample_block.js";
import { SpectrumAccumulator } from "../dsp/spectrumMath";
import { IqRecorder, type IqRecording } from "./iqRecording";
import { defaultModeSettings } from "./receiverConfig";
import { CI8_RECORDING_FORMAT } from "./ci8Recording";
import type { SourceSessionMetadata } from "./types";

class TestAudioContext extends EventTarget {
  static instances: TestAudioContext[] = [];
  state: AudioContextState = "running";
  static rate = 48_000;
  sampleRate = TestAudioContext.rate;
  destination = {};
  constructor() { super(); TestAudioContext.instances.push(this); }
  get currentTime() { return performance.now() / 1000; }
  async resume() {}
  async close() { this.state = "closed"; }
  createGain() { return { gain: { value: 0 }, connect() {} }; }
}

beforeEach(() => {
  TestAudioContext.instances = [];
  TestAudioContext.rate = 48_000;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("AudioContext", TestAudioContext);
  vi.stubGlobal("AudioBuffer", class {
    length: number;
    constructor(options: { length: number }) { this.length = options.length; }
    copyToChannel() {}
  });
  vi.stubGlobal("AudioBufferSourceNode", class { connect() {} start() {} });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function setupRecording(recording: IqRecording, compiledChannel?: (rate: number) => Promise<WasmChannelFilter>) {
  const samples: SampleBlock[] = [];
  const analysis = {
    begin: vi.fn(() => ({ setSampleRate() {}, receiveSamples: (block: SampleBlock) => samples.push({ ...block, I: block.I.slice(), Q: block.Q.slice() }) })),
    retune: vi.fn(), stop: vi.fn(), markDiscontinuity: vi.fn(),
  };
  const events: ReceiverBackendEvents = {
    permissionGranted: vi.fn(), runtimeError: vi.fn(), audioStateChanged: vi.fn(), sourceEnded: vi.fn(), rdsChanged: vi.fn(),
    dabChanged: vi.fn(), adsbChanged: vi.fn(), aisChanged: vi.fn(), aprsChanged: vi.fn(), rs41Changed: vi.fn(), textModemChanged: vi.fn(),
  };
  const backend = new ReplayBackend(events, analysis as unknown as AnalysisPipeline, recording, 1, compiledChannel ?? (async rate => {
    const { instance } = await WebAssembly.instantiate(await readFile(new URL("../wasm/pkg/spectrum_analysis.wasm", import.meta.url)), {});
    return new WasmChannelFilter(instance.exports as ChannelExports, rate);
  }));
  const options = { source: "replay" as const, channelFrequencyHz: recording.metadata.selectedChannelFrequencyHz, volume: 0 };
  return { recording, samples, analysis, events, backend, options };
}

function setup(sampleCount = 24_000) { return setupRecording(createDeterministicRecordingFixture(sampleCount)); }

function recordingAt(sampleRateHz: number, centerFrequencyHz: number, I: Float32Array, Q: Float32Array, selectedChannelFrequencyHz = centerFrequencyHz): IqRecording {
  const mode = defaultModeSettings("AM");
  const session: SourceSessionMetadata = {
    source: "synthetic", sessionGeneration: 1, requestedSampleRateHz: sampleRateHz, actualSampleRateHz: sampleRateHz,
    hardwareCenterFrequencyHz: centerFrequencyHz, selectedChannelFrequencyHz,
    mode: mode.mode, channelBandwidthHz: mode.bandwidthHz, squelch: mode.squelch, gainDb: null,
    sampleFormat: "planar-f32-iq-normalized",
  };
  const recorder = new IqRecorder(session, "2026-09-23T00:00:00.000Z", I.length * 2 + 2, "Deterministic transition fixture; no hardware.");
  recorder.appendNormalized({ I, Q });
  return recorder.finish("user");
}

function aisPositionFrame(): Uint8Array {
  const bits = new Array<number>(168).fill(0);
  const write = (start: number, length: number, value: number) => {
    for (let bit = 0; bit < length; bit += 1) bits[start + bit] = (value >> (length - bit - 1)) & 1;
  };
  write(0, 6, 1); write(8, 30, 211_234_567); write(38, 4, 0); write(50, 10, 123);
  write(61, 28, Math.round(11.58 * 600_000)); write(89, 27, Math.round(48.14 * 600_000)); write(116, 12, 875); write(128, 9, 88);
  const payload = new Uint8Array(21);
  for (let bit = 0; bit < bits.length; bit += 1) payload[bit >> 3] = (payload[bit >> 3] ?? 0) | (bits[bit]! << (7 - (bit & 7)));
  let crc = 0xffff;
  for (const byte of payload) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >> 1) ^ 0x8408 : crc >> 1; }
  crc ^= 0xffff;
  return Uint8Array.from([...payload, crc & 0xff, crc >> 8]);
}

function aisSignal(sampleRateHz: number, centerOffsetHz = 0): { I: Float32Array; Q: Float32Array } {
  const frame = aisPositionFrame(), flag = [0, 1, 1, 1, 1, 1, 1, 0], payloadBits: number[] = [];
  let ones = 0;
  for (const byte of frame) for (let bit = 0; bit < 8; bit += 1) {
    const value = (byte >> bit) & 1; payloadBits.push(value);
    if (value) { ones += 1; if (ones === 5) { payloadBits.push(0); ones = 0; } } else ones = 0;
  }
  const bits = [...Array.from({ length: 24 }, (_, index) => index & 1), ...flag, ...payloadBits, ...flag, 1, 1, 1];
  const samplesPerSymbol = sampleRateHz / 9_600;
  const I = new Float32Array(bits.length * samplesPerSymbol), Q = new Float32Array(I.length);
  let level = 1, phase = 0, position = 0;
  for (const bit of bits) {
    if (bit === 0) level ^= 1;
    const frequency = centerOffsetHz - 25_000 + (level ? 2_400 : -2_400);
    for (let sample = 0; sample < samplesPerSymbol; sample += 1) {
      phase += 2 * Math.PI * frequency / sampleRateHz;
      I[position] = Math.cos(phase); Q[position] = Math.sin(phase); position += 1;
    }
  }
  return { I, Q };
}

function dabTransitionSignal(): { I: Float32Array; Q: Float32Array } {
  // At 2.4 MS/s this deliberately long null is inside the receiver's tolerance;
  // it is outside the constructor-default 2.048 MS/s tolerance.
  const sections = [{ length: 24_000, amplitude: 0.7 }, { length: 4_200, amplitude: 0.01 }, { length: 3_500, amplitude: 0.7 }];
  const length = sections.reduce((sum, section) => sum + section.length, 0);
  const I = new Float32Array(length), Q = new Float32Array(length);
  let position = 0, phase = 0;
  for (const section of sections) for (let index = 0; index < section.length; index += 1) {
    I[position] = section.amplitude * Math.cos(phase); Q[position] = section.amplitude * Math.sin(phase);
    phase += 0.17; position += 1;
  }
  return { I, Q };
}

describe("real replay backend integration", () => {
  it.each([false, true])("catches up after clamped timers at 2.4 MS/s (Blob=%s) and reaches EOF", async blob => {
    const count = 8192 * 40;
    const recording = recordingAt(2_400_000, 1_090_000_000, new Float32Array(count), new Float32Array(count));
    recording.metadata.mode = "OFF";
    recording.metadata.channelBandwidthHz = defaultModeSettings("OFF").bandwidthHz;
    if (blob) {
      recording.dataBlob = new Blob([recording.data.slice()]);
      recording.data = new Uint8Array();
    }
    const schedule = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, delay, ...args) => schedule(callback, Math.max(20, delay ?? 0), ...args));
    const f = setupRecording(recording);
    await f.backend.start(f.options);
    await vi.advanceTimersByTimeAsync(160);
    expect(f.backend.getReplayPosition()).toBe(count);
    expect(f.events.sourceEnded).toHaveBeenCalledOnce();
    expect(f.samples.reduce((sum, block) => sum + block.I.length, 0)).toBe(count);
    expect(f.events.runtimeError).not.toHaveBeenCalled();
    await f.backend.stop();
  });

  it("uses the canonical CU8 endpoint normalization", async () => {
    const recording = createDeterministicRecordingFixture(1);
    recording.data.set([0, 255]);
    const imported = setupRecording(recording);
    await imported.backend.start(imported.options);
    await vi.advanceTimersByTimeAsync(1);
    expect(imported.samples[0]?.I[0]).toBe(-0.99609375);
    expect(imported.samples[0]?.Q[0]).toBe(0.99609375);
    await imported.backend.stop();
  });

  it("starts, performs a no-op and in-span tune, preserves raw RF bins, then stops", async () => {
    const { backend, options, samples, analysis } = setup();
    await backend.start(options);
    await backend.tune(10_006_000, 2);
    await backend.tune(10_007_000, 3);
    await vi.advanceTimersByTimeAsync(1);
    const block = samples[0]!;
    const bins = new SpectrumAccumulator(4096, 1).addWindow(block.I.subarray(0, 4096), block.Q.subarray(0, 4096))!;
    expect((bins.indexOf(Math.max(...bins)) - 2048) * 48_000 / 4096).toBe(6000);
    await backend.stop();
    expect(analysis.stop).toHaveBeenLastCalledWith(3);
    expect(TestAudioContext.instances[0]!.state).toBe("closed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("validates mode changes before mutation and rejects capture-edge tunes", async () => {
    const { backend, options, analysis } = setup();
    await backend.start(options);
    await expect(backend.configureMode({ mode: "WBFM", bandwidthHz: 150000, squelch: 0 }, 2)).rejects.toThrow(/bandwidth/);
    const unchanged = await backend.tune(10_006_000, 3);
    expect(unchanged.mode).toBe("AM");
    expect(unchanged.channelBandwidthHz).toBe(15000);
    await expect(backend.tune(11_000_000, 4)).rejects.toThrow(/capture span/);
    await backend.stop();
    expect(analysis.stop).toHaveBeenLastCalledWith(3);
  });

  it("changes a persisted CW beat tone without moving the selected RF frequency", async () => {
    const fixture = createDeterministicRecordingFixture(8_192);
    fixture.metadata.mode = "CW";
    fixture.metadata.channelBandwidthHz = 500;
    fixture.metadata.squelch = 0;
    fixture.metadata.beatToneHz = 600;
    const { backend, options } = setupRecording(fixture);
    const started = await backend.start(options);
    const changed = await backend.configureMode({ mode: "CW", bandwidthHz: 250, squelch: 0, beatToneHz: 900 }, 2);
    expect(changed).toMatchObject({
      selectedChannelFrequencyHz: started.selectedChannelFrequencyHz,
      mode: "CW",
      channelBandwidthHz: 250,
      beatToneHz: 900,
    });
    await backend.stop();
  });

  it("configures every supported analog/digital route transition at the captured rate", async () => {
    const I = new Float32Array(32), Q = new Float32Array(32);
    const { backend, options } = setupRecording(recordingAt(2_400_000, 162_000_000, I, Q));
    await backend.start(options);

    expect((await backend.configureMode(defaultModeSettings("AIS"), 2)).mode).toBe("AIS");
    expect((await backend.configureMode(defaultModeSettings("DAB"), 3)).mode).toBe("DAB");
    expect((await backend.configureMode(defaultModeSettings("AM"), 4)).mode).toBe("AM");
    expect((await backend.configureMode(defaultModeSettings("DAB"), 5)).mode).toBe("DAB");
    expect((await backend.configureMode(defaultModeSettings("SRD"), 6)).mode).toBe("SRD");
    expect((await backend.configureMode(defaultModeSettings("AM"), 7)).mode).toBe("AM");
    expect((await backend.configureMode(defaultModeSettings("APRS"), 8)).mode).toBe("APRS");
    expect((await backend.configureMode(defaultModeSettings("RS41"), 9)).mode).toBe("RS41");
    await backend.stop();
  });

  it("attaches SRD at a nonzero selected-channel offset and preserves its settings", async () => {
    const { backend, options } = setupRecording(
      recordingAt(1_024_000, 433_920_000, new Float32Array(64), new Float32Array(64), 433_932_000),
    );
    await backend.start(options);
    const settings = defaultModeSettings("SRD");
    settings.srd = { ...settings.srd!, modulation: "2fsk", protocol: "fineoffset-wh51" };
    const configured = await backend.configureMode(settings, 2);
    expect(configured).toMatchObject({
      mode: "SRD",
      selectedChannelFrequencyHz: 433_932_000,
      srd: { modulation: "2fsk", protocol: "fineoffset-wh51" },
    });
    await backend.stop();
  });

  it("decodes AIS after an analog transition using the nondefault replay rate", async () => {
    const signal = aisSignal(192_000, 10_000);
    const { backend, options, events } = setupRecording(recordingAt(192_000, 162_000_000, signal.I, signal.Q, 162_010_000));
    await backend.start(options);
    await backend.configureMode(defaultModeSettings("AIS"), 2);
    await expect(backend.configureMode(defaultModeSettings("DAB"), 3)).rejects.toThrow(/2.048 MS\/s/);
    await vi.advanceTimersByTimeAsync(100);

    const updates = vi.mocked(events.aisChanged!).mock.calls.map(([snapshot]) => snapshot);
    expect(updates.at(-1)).toMatchObject({ validFrames: 1, targets: [{ mmsi: 211_234_567 }] });
    expect((await backend.tune(options.channelFrequencyHz, 4)).mode).toBe("AIS");
    await backend.stop();
  });

  it("propagates 2.4 MS/s through an analog-to-DAB attachment before its first samples", async () => {
    const signal = dabTransitionSignal();
    const { backend, options, events } = setupRecording(recordingAt(2_400_000, 220_352_000, signal.I, signal.Q));
    await backend.start(options);
    await backend.configureMode(defaultModeSettings("DAB"), 2);
    await vi.advanceTimersByTimeAsync(100);

    const updates = vi.mocked(events.dabChanged!).mock.calls.map(([snapshot]) => snapshot);
    expect(updates.at(-1)).toMatchObject({ state: "searching", ficBlockCount: 0 });
    await backend.stop();
  });

  it("resets the active digital decoder at a replay discontinuity", async () => {
    const first = aisSignal(192_000), second = aisSignal(192_000);
    const I = new Float32Array(first.I.length + second.I.length), Q = new Float32Array(I.length);
    I.set(first.I); I.set(second.I, first.I.length); Q.set(first.Q); Q.set(second.Q, first.Q.length);
    const recording = recordingAt(192_000, 162_000_000, I, Q);
    recording.metadata.mode = "AIS";
    recording.metadata.channelBandwidthHz = defaultModeSettings("AIS").bandwidthHz;
    recording.metadata.knownGaps = [{ afterSample: first.I.length, missingSamples: null, reason: "fixture discontinuity" }];
    const { backend, options, events } = setupRecording(recording);
    await backend.start(options);
    await vi.advanceTimersByTimeAsync(150);

    const validCounts = vi.mocked(events.aisChanged!).mock.calls.map(([snapshot]) => snapshot.validFrames);
    const firstDecoded = validCounts.indexOf(1);
    const reset = validCounts.indexOf(0, firstDecoded + 1);
    const decodedAgain = validCounts.indexOf(1, reset + 1);
    expect(firstDecoded).toBeGreaterThanOrEqual(0);
    expect(reset).toBeGreaterThan(firstDecoded);
    expect(decodedAgain).toBeGreaterThan(reset);
    await backend.stop();
  });

  it("rejects an unsupported transition without replacing the analog route", async () => {
    const { backend, options } = setup();
    await backend.start(options);
    await expect(backend.configureMode(defaultModeSettings("AIS"), 2)).rejects.toThrow(/192 ksample\/s/);
    const unchanged = await backend.tune(options.channelFrequencyHz, 3);
    expect(unchanged).toMatchObject({ mode: "AM", channelBandwidthHz: 15_000 });
    await backend.stop();
  });

  it("preserves known gap time, same-position gaps and EOF gaps without repeating samples", async () => {
    const { backend, options, recording, samples, analysis, events } = setup();
    recording.metadata.knownGaps = [
      { afterSample: 8192, missingSamples: 4800, reason: "100 ms" },
      { afterSample: 8192, missingSamples: null, reason: "unknown" },
      { afterSample: 24000, missingSamples: 4800, reason: "100 ms tail" },
    ];
    await backend.start(options);
    await vi.advanceTimersByTimeAsync(200);
    expect(samples).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(events.sourceEnded).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(events.sourceEnded).toHaveBeenCalledOnce();
    expect(samples.reduce((sum, block) => sum + block.I.length, 0)).toBe(24000);
    expect(analysis.markDiscontinuity.mock.calls).toEqual([[4800], [0], [4800]]);
    await backend.stop();
  });

  it("reports asynchronous sample-processing errors to the controller and closes audio", async () => {
    const { recording, analysis, options } = setup();
    // Remove the unused setup backend's audio context from this case.
    await TestAudioContext.instances[0]!.close();
    analysis.begin.mockImplementation(() => ({ setSampleRate() {}, receiveSamples() { throw new Error("DSP failed"); } }));
    const controller = new ReceiverController((events, _options, generation) => new ReplayBackend(events, analysis as unknown as AnalysisPipeline, recording, generation));
    await controller.start(options);
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.getSnapshot()).toMatchObject({ lifecycle: "error", cleanupRequired: false });
    expect(controller.getSnapshot().message).toContain("DSP failed");
    expect(TestAudioContext.instances.every((context) => context.state === "closed")).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

it.each([0x0109, 0x0110, 0x0113].flatMap(api => ([1_024_000, 2_400_000, 4_800_000, 9_600_000, 19_200_000] as const).flatMap(rate => [48_000, 44_100].map(audioRate => ({ api, rate, audioRate })))))("replays and re-records native CI8 $api at $rate samples/s with $audioRate Hz audio", async ({ api, rate, audioRate }) => {
  TestAudioContext.rate = audioRate;
  const { hackrfRecordingFixture } = await import("../testing/hackrfRecordingFixture");
  const { decodeRecordingSamples } = await import("./iqRecording");
  const bytes = new Uint8Array(32_768);
  for (let n = 0; n < bytes.length; n++) bytes[n] = n % 256;
  const { recording } = await hackrfRecordingFixture(bytes, rate, api);
  recording.metadata.knownGaps = [{ afterSample: 100, missingSamples: 2400, reason: "known" }, { afterSample: 9000, missingSamples: null, reason: "unknown" }];
  const f = setupRecording(recording);
  await f.backend.start(f.options); f.backend.startRecording();
  await vi.advanceTimersByTimeAsync(100);
  expect(f.events.runtimeError).not.toHaveBeenCalled(); expect(f.events.sourceEnded).toHaveBeenCalledOnce();
  expect(f.samples.every(block => block.I.length <= 8192)).toBe(true);
  const decoded = decodeRecordingSamples(recording.data, recording.metadata);
  expect(f.samples.flatMap(block => [...block.I])).toEqual([...decoded.I]); expect(f.samples.flatMap(block => [...block.Q])).toEqual([...decoded.Q]);
  const result = f.backend.stopRecording()!;
  expect(result.data).toEqual(bytes);
  expect(result.metadata).toMatchObject({ source: "replay", captureStartedAt: recording.metadata.captureStartedAt, nativeSampleRateHz: rate, effectiveSampleRateHz: rate >= 4_800_000 ? 2_400_000 : rate });
  if (result.metadata.format !== CI8_RECORDING_FORMAT || recording.metadata.format !== CI8_RECORDING_FORMAT) throw new Error("Expected CI8");
  expect(result.metadata.hardware).toEqual(recording.metadata.hardware); expect(result.metadata.captureSettings).toEqual(recording.metadata.captureSettings);
  expect(result.metadata.knownGaps.map(g => [g.afterSample, g.missingSamples])).toEqual([[100, 2400], [9000, null]]);
  expect(result.metadata.provenance).toContain("No new hardware observation");
  expect(f.analysis.markDiscontinuity).toHaveBeenCalledWith(0);
  await f.backend.stop();
});

it("keeps external CI8 origin unknown when re-recorded, and rejects invalid encodings before audio allocation", async () => {
  const { importSigmfRecording } = await import("./sigmfImport");
  const text = JSON.stringify({ global: { "core:version": "1.2.6", "core:datatype": "ci8", "core:sample_rate": 48_000, "core:hw": "HackRF Pro (untrusted description)" },
    captures: [{ "core:sample_start": 0, "core:frequency": 10_000_000, "core:datetime": "2020-01-01T00:00:00.000Z" }], annotations: [] });
  const recording = await importSigmfRecording(text, Uint8Array.of(128, 127, 0, 0), { modeSettings: defaultModeSettings("AM") });
  const f = setupRecording(recording); await f.backend.start(f.options); f.backend.startRecording();
  await vi.advanceTimersByTimeAsync(5);
  const result = f.backend.stopRecording()!;
  expect(result.metadata).toMatchObject({ source: "replay", provenanceDetails: { originalSource: "unknown", hardwareValidation: "pending" } });
  expect(result.metadata).not.toHaveProperty("hardware"); expect(result.importedSigmf?.metadataText).toBe(text);
  await f.backend.stop();
  const before = TestAudioContext.instances.length;
  expect(() => setupRecording({ ...recording, metadata: { ...recording.metadata, sampleEncoding: "ci16" } as unknown as IqRecording["metadata"] })).toThrow();
  expect(TestAudioContext.instances).toHaveLength(before);
});

it("releases a compiled replay filter when stop wins asynchronous initialization", async () => {
  const { hackrfRecordingFixture } = await import("../testing/hackrfRecordingFixture");
  const { recording } = await hackrfRecordingFixture(new Uint8Array(4096), 19_200_000, 0x0110);
  let resolve!: (filter: WasmChannelFilter) => void;
  const pending = new Promise<WasmChannelFilter>(done => { resolve = done; });
  const f = setupRecording(recording, () => pending);
  const start = f.backend.start(f.options);
  const rejection = expect(start).rejects.toMatchObject({ name: "AbortError" });
  await f.backend.stop();
  const dispose = vi.fn();
  resolve({ dispose } as unknown as WasmChannelFilter);
  await rejection;
  expect(dispose).toHaveBeenCalledOnce();
  expect(f.analysis.begin).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("catches up 19.2 MS/s replay under 4 ms timer clamping with bounded blocks", async () => {
  const { hackrfRecordingFixture } = await import("../testing/hackrfRecordingFixture");
  const { recording } = await hackrfRecordingFixture(new Uint8Array(2 * 384_000), 19_200_000, 0x0110);
  const original = window.setTimeout;
  const timer = vi.spyOn(window, "setTimeout").mockImplementation(((callback: TimerHandler, delay?: number) => original(callback, Math.max(4, delay ?? 0))) as typeof window.setTimeout);
  try {
    const f = setupRecording(recording);
    await f.backend.start(f.options);
    await vi.advanceTimersByTimeAsync(28);
    expect(f.events.sourceEnded).toHaveBeenCalledOnce();
    expect(f.events.runtimeError).not.toHaveBeenCalled();
    expect(f.samples.reduce((sum, block) => sum + block.I.length, 0)).toBe(384_000);
    expect(f.samples.every(block => block.I.length <= 8192)).toBe(true);
    await f.backend.stop();
  } finally { timer.mockRestore(); }
});

it("replays and re-records bladeRF Q11 at nominal DSP rate while retaining accepted sample-time evidence", async () => {
  const { bladeRfRecordingFixture } = await import("../testing/bladerfRecordingFixture");
  const { recording } = await bladeRfRecordingFixture(undefined, 4_800_000, "xA9", 5, -1);
  const { backend, options, samples } = setupRecording(recording);
  const metadata = await backend.start(options);
  expect(metadata.actualSampleRateHz).toBe(4_800_000);
  expect(metadata.bladerf?.acceptedSampleRateHz).toBe(4_799_999);
  backend.startRecording();
  await vi.advanceTimersByTimeAsync(1);
  expect([...samples[0]!.I]).toEqual([-1, -0.5]);
  expect([...samples[0]!.Q]).toEqual([2047 / 2048, 0.5]);
  const rerecorded = backend.stopRecording()!;
  expect(rerecorded.data).toEqual(recording.data);
  expect(rerecorded.metadata).toMatchObject({ format: "browsersdr-bladerf-sc16-q11-v1", sampleRateHz: 4_799_999, nativeSampleRateHz: 4_800_000, source: "replay", normalization: "float = int16 / 2048" });
  await backend.stop();
});

it.each([48_000, 44_100])("replays and re-records processed channel I/Q at audio rate %i", async (audioRate) => {
  TestAudioContext.rate = audioRate;
  const input = { I: new Float32Array(32768).fill(0.3), Q: new Float32Array(32768).fill(-0.2) };
  for (const wide of [false, true]) {
    const fixture = wide ? await (await import("../testing/bladerfRecordingFixture")).bladeRfRecordingFixture() : undefined;
    const sourceSession: SourceSessionMetadata = fixture ? { ...fixture.session, mode: "AM", channelBandwidthHz: 15_000 } : {
      source: "synthetic", sessionGeneration: 1, requestedSampleRateHz: 1_024_000, actualSampleRateHz: 1_024_000,
      hardwareCenterFrequencyHz: 100_000_000, selectedChannelFrequencyHz: 100_000_000, mode: "AM", channelBandwidthHz: 15_000,
      squelch: 0, gainDb: null, sampleFormat: "planar-f32-iq-normalized",
    };
    const recorder = new IqRecorder(sourceSession, undefined, 131072, undefined, undefined, fixture?.format, "memory", { captureCurrentChannel: true });
    if (fixture) {
      const bytes = new Uint8Array(32768 * 4), view = new DataView(bytes.buffer);
      for (let n = 0; n < 32768; n++) { view.setInt16(n * 4, 614, true); view.setInt16(n * 4 + 2, -410, true); }
      recorder.appendBladeRfSc16(bytes);
    } else recorder.appendNormalized(input);
    const recording = recorder.finish();
    const f = setupRecording(recording);
    await f.backend.start(f.options);
    f.backend.startRecording();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.events.runtimeError).not.toHaveBeenCalled();
    expect(f.events.sourceEnded).toHaveBeenCalledOnce();
    expect(f.samples.reduce((sum, block) => sum + block.I.length, 0)).toBe(recording.metadata.sampleCount);
    expect(f.backend.stopRecording()!.data).toEqual(recording.data);
    await f.backend.stop();
  }
});

it.each(["AIS", "DAB"] as const)("routes %s samples through channel capture and rejects incomplete DAB frames", async (mode) => {
  const signal = mode === "AIS" ? aisSignal(2_400_000, 10_000) : dabTransitionSignal();
  const settings = defaultModeSettings(mode);
  const center = mode === "AIS" ? 162_000_000 : 220_352_000;
  const session: SourceSessionMetadata = {
    source: "synthetic", sessionGeneration: 1, requestedSampleRateHz: 2_400_000, actualSampleRateHz: 2_400_000,
    hardwareCenterFrequencyHz: center, selectedChannelFrequencyHz: center + (mode === "AIS" ? 10_000 : 0),
    mode, channelBandwidthHz: settings.bandwidthHz, squelch: 0, gainDb: null, sampleFormat: "planar-f32-iq-normalized",
  };
  const recorder = new IqRecorder(session, undefined, 262144, undefined, undefined, undefined, "memory", { captureCurrentChannel: true });
  recorder.appendNormalized(signal);
  const recording = recorder.finish();
  if (mode === "AIS") expect(recording.metadata.sampleRateHz).toBe(300_000);
  const f = setupRecording(recording);
  await f.backend.start(f.options);
  await vi.advanceTimersByTimeAsync(100);
  expect(f.events.runtimeError).not.toHaveBeenCalled();
  if (mode === "AIS") {
    const updates = vi.mocked(f.events.aisChanged!).mock.calls.map(([snapshot]) => snapshot);
    expect(updates.at(-1)).toMatchObject({ validFrames: 1, targets: [{ mmsi: 211_234_567 }] });
  } else {
    const updates = vi.mocked(f.events.dabChanged!).mock.calls.map(([snapshot]) => snapshot);
    expect(updates.at(-1)).toMatchObject({ state: "searching", ficBlockCount: 0 });
  }
  await f.backend.stop();
});


it("retains audio ownership on close failure and retries the same context", async () => {
  const f = setup();
  await f.backend.start(f.options);
  const context = TestAudioContext.instances[0]!;
  const close = vi.spyOn(context, "close").mockRejectedValueOnce(new Error("audio close failed"));
  await expect(f.backend.stop()).rejects.toThrow("audio close failed");
  expect(context.state).toBe("running");
  await f.backend.stop();
  expect(close).toHaveBeenCalledTimes(2);
  expect(context.state).toBe("closed");
});


it.each([2_400_000, 3_200_000])("decodes a complete DAB ensemble and programme through %i samples/s recorded I/Q replay", async rate => {
  const signal = createDabEnsembleFixture(rate);
  const recording = recordingAt(rate, 220_352_000, signal.I, signal.Q);
  recording.metadata.mode = "DAB";
  recording.metadata.channelBandwidthHz = defaultModeSettings("DAB").bandwidthHz;
  const f = setupRecording(recording);
  await f.backend.start(f.options);
  await vi.advanceTimersByTimeAsync(1_500);
  const snapshots = vi.mocked(f.events.dabChanged!).mock.calls.map(([snapshot]) => snapshot);
  expect(snapshots.some(snapshot => snapshot.serviceId === 0x1234 && (snapshot.ficBlockCount ?? 0) > 0)).toBe(true);
  expect(f.events.runtimeError).not.toHaveBeenCalled();
  expect(f.events.sourceEnded).toHaveBeenCalledOnce();
  await f.backend.stop();
}, 20_000);

it("keeps the acquisition site when replay recording is offered a new listener site", async () => {
  const original = { version: 1 as const, latitude: 48, longitude: 11, source: "manual" as const, observedAt: "2026-09-01T00:00:00.000Z", snapshotAt: "2026-09-08T00:00:00.000Z", stale: false };
  for (const known of [true, false]) {
    const f = setup();
    if (known) f.recording.metadata.receiverLocation = original;
    await f.backend.start(f.options);
    f.backend.startRecording({ site: { label: "Listener", latitude: 51, longitude: 13 } }, { receiverLocation: { version: 1, latitude: 51, longitude: 13, source: "browser", observedAt: new Date().toISOString() } });
    await vi.advanceTimersByTimeAsync(200);
    const result = f.backend.stopRecording()!;
    expect(result.metadata.receiverLocation).toEqual(known ? original : undefined);
    expect(result.metadata.survey?.site).toBeUndefined();
    await f.backend.stop();
  }
});


describe("packet decoder product replay", () => {
  it.each(["APRS", "RS41"] as const)("decodes %s at a nonzero offset, flushes EOF and rejects corrupt RF", async mode => {
    for (const rate of [1_024_000, 2_400_000, 3_200_000, 9_600_000]) {
      const fixture = packetRecordingFixture(mode, rate);
      const { backend, options, events } = setupRecording(fixture);
      await backend.start(options);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(events.runtimeError).not.toHaveBeenCalled();
      expect(events.sourceEnded).toHaveBeenCalledOnce();
      if (mode === "APRS") {
        expect(vi.mocked(events.aprsChanged!).mock.calls.at(-1)?.[0].stations[0]?.key).toBe("N0CALL-1");
        expect(vi.mocked(events.aprsChanged!).mock.calls.at(-1)?.[0].stations[0]?.position?.latitudeDegrees).toBeCloseTo(49.058333, 5);
      } else {
        expect(vi.mocked(events.rs41Changed!).mock.calls.at(-1)?.[0].sondes[0]?.sondeId).toBe("K1930293");
        expect(vi.mocked(events.rs41Changed!).mock.calls.at(-1)?.[0].sondes[0]?.position?.altitudeMeters).toBeCloseTo(28410.02, 1);
      }
      await backend.stop();
    }
    const { backend, options, events } = setupRecording(packetRecordingFixture(mode, 1_024_000, -37_000, true));
    await backend.start(options); await vi.advanceTimersByTimeAsync(2_000);
    if (mode === "APRS") expect(vi.mocked(events.aprsChanged!).mock.calls.at(-1)?.[0].stations).toHaveLength(0);
    else expect(vi.mocked(events.rs41Changed!).mock.calls.at(-1)?.[0].sondes).toHaveLength(0);
    await backend.stop();
  }, 30_000);

  it.each(["APRS", "RS41"] as const)("does not stitch %s across a replay gap", async mode => {
    const fixture = packetRecordingFixture(mode);
    fixture.metadata.knownGaps = [{ afterSample: Math.floor(fixture.metadata.sampleCount / 2), missingSamples: 102_400, reason: "test source discontinuity" }];
    const { backend, options, events } = setupRecording(fixture);
    await backend.start(options); await vi.advanceTimersByTimeAsync(2_000);
    const state = mode === "APRS" ? vi.mocked(events.aprsChanged!).mock.calls.at(-1)?.[0] : vi.mocked(events.rs41Changed!).mock.calls.at(-1)?.[0];
    expect(state && ("stations" in state ? state.stations : state.sondes)).toHaveLength(0);
    await backend.stop();
  });
});

it("plays a file-backed range, pauses the sample clock, and preserves gap reset semantics", async () => {
  const fixture = createDeterministicRecordingFixture(24000);
  fixture.metadata.knownGaps = [{ afterSample: 12000, missingSamples: 2400, reason: "fixture gap" }];
  const f = setupRecording({ ...fixture, data: new Uint8Array(), dataBlob: new Blob([fixture.data as Uint8Array<ArrayBuffer>]), replayRange: { startSample: 8000, endSample: 20000 } });
  await f.backend.start(f.options);
  f.backend.setReplayPaused(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.backend.getReplayPosition()).toBe(8000);
  f.backend.setReplayPaused(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.backend.getReplayPosition()).toBe(20000);
  expect(f.events.sourceEnded).toHaveBeenCalledOnce();
  expect(f.analysis.markDiscontinuity).toHaveBeenCalledWith(2400);
  expect(f.events.runtimeError).not.toHaveBeenCalled();
  await f.backend.stop();
});

it("does not deliver a late file read after stop", async () => {
  const fixture = createDeterministicRecordingFixture(24000);
  let resolve!: (blob: Blob) => void;
  const dataBlob = new Promise<Blob>(done => { resolve = done; });
  const f = setupRecording({ ...fixture, data: new Uint8Array(), dataBlob });
  await f.backend.start(f.options);
  await vi.advanceTimersByTimeAsync(1);
  await f.backend.stop();
  resolve(new Blob([fixture.data as Uint8Array<ArrayBuffer>]));
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.samples).toHaveLength(0);
  expect(f.events.sourceEnded).not.toHaveBeenCalled();
  expect(f.events.runtimeError).not.toHaveBeenCalled();
});


it("waits for a saturated packet decoder without advancing or losing file samples", async () => {
  const fixture = packetRecordingFixture("RS41", 1_024_000, 37_000);
  const f = setupRecording({ ...fixture, data: new Uint8Array(), dataBlob: new Blob([fixture.data as Uint8Array<ArrayBuffer>]) });
  let full = true;
  const queue = vi.spyOn(Rs41DigitalReceiver.prototype, "diagnostics", "get").mockImplementation(() => ({
    generation: 1, queuedBlocks: full ? 4 : 0, queueCapacityBlocks: 4,
    peakQueuedBlocks: 4, droppedInputBlocks: 0, droppedInputSamples: 0, staleResults: 0,
  }));
  try {
    await f.backend.start(f.options);
    await vi.advanceTimersByTimeAsync(500);
    expect(f.backend.getReplayPosition()).toBe(0);
    expect(f.samples).toHaveLength(0);
    full = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.backend.getReplayPosition()).toBe(fixture.metadata.sampleCount);
    expect(f.events.sourceEnded).toHaveBeenCalledOnce();
    expect(vi.mocked(f.events.rs41Changed!).mock.calls.at(-1)?.[0].sondes[0]?.sondeId).toBe("K1930293");
    expect(f.events.runtimeError).not.toHaveBeenCalled();
  } finally { queue.mockRestore(); await f.backend.stop(); }
});


describe("text modem product replay", () => {
  it.each(["RTTY", "PSK31", "NAVTEX", "ACARS"] as const)("decodes %s through the backend and flushes before EOF", async mode => {
    const fixture = textModemRecordingFixture(mode);
    const f = setupRecording(fixture);
    await f.backend.start(f.options);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.events.runtimeError).not.toHaveBeenCalled();
    expect(f.events.sourceEnded).toHaveBeenCalledOnce();
    const state = vi.mocked(f.events.textModemChanged!).mock.calls.at(-1)?.[0];
    expect(state?.text).toContain(fixture.expectedText);
    expect(state?.messages.length).toBeGreaterThan(0);
    if (mode === "ACARS") expect(state?.messages).toHaveLength(1);
    await f.backend.stop();
  }, 20_000);
  it.each([3_200_000, 9_600_000, 19_200_000])("decodes ACARS from native %s replay through its selected-channel route", async rate => {
    const fixture = textModemRecordingFixture("ACARS", rate);
    const f = setupRecording(fixture);
    await f.backend.start(f.options);
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.events.runtimeError).not.toHaveBeenCalled();
    expect(f.events.sourceEnded).toHaveBeenCalledOnce();
    const state = vi.mocked(f.events.textModemChanged!).mock.calls.at(-1)?.[0];
    expect(state?.text).toContain(fixture.expectedText);
    expect(state?.messages[0]?.provenance.actualInputSampleRateHz).toBe(rate === 3_200_000 ? rate : 2_400_000);
    await f.backend.stop();
  }, 20_000);
});

it("seeks in place without replacing the analysis session and preserves pause", async () => {
  const { backend, options, analysis, events } = setup(48_000 * 30);
  await backend.start(options);
  await vi.advanceTimersByTimeAsync(100);
  backend.setReplayPaused(true);
  await backend.seekReplay(48_000 * 15);
  expect(backend.getReplayPosition()).toBe(48_000 * 15);
  await vi.advanceTimersByTimeAsync(500);
  expect(backend.getReplayPosition()).toBe(48_000 * 15);
  await backend.seekReplay(48_000 * 5);
  expect(backend.getReplayPosition()).toBe(48_000 * 5);
  expect(analysis.begin).toHaveBeenCalledTimes(1);
  expect(analysis.stop).not.toHaveBeenCalled();
  expect(analysis.retune).not.toHaveBeenCalled();
  expect(events.sourceEnded).not.toHaveBeenCalled();
  backend.setReplayPaused(false);
  await vi.advanceTimersByTimeAsync(100);
  expect(backend.getReplayPosition()).toBeGreaterThan(48_000 * 5);
  expect(events.runtimeError).not.toHaveBeenCalled();
  await backend.stop();
});
