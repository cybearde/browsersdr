import { afterEach, expect, it, vi } from "vitest";
import { ChannelRecordingWorker, CHANNEL_RECORDING_QUEUE_MAX_BYTES, type ChannelRecordingInput, type ChannelRecordingOutput } from "./channelRecordingWorker";
import { CU8_FORMAT, IqRecorder } from "./iqRecording";
import { planChannelCapture } from "./channelRecording";

const plan = planChannelCapture({ actualSampleRateHz: 2_400_000, hardwareCenterFrequencyHz: 100_000_000,
  selectedChannelFrequencyHz: 100_000_000, channelBandwidthHz: 150_000, mode: "WBFM" });
class FakeWorker {
  onmessage?: (event: MessageEvent<ChannelRecordingOutput>) => void;
  onerror?: (event: ErrorEvent) => void;
  postMessage = vi.fn<(message: ChannelRecordingInput, transfers?: Transferable[]) => void>();
  terminate = vi.fn();
  emit(message: ChannelRecordingOutput) { this.onmessage?.({ data: message } as MessageEvent<ChannelRecordingOutput>); }
}
it("copies borrowed input, bounds the queue and drains accepted output before finishing", async () => {
  const port = new FakeWorker(), output = vi.fn();
  const worker = new ChannelRecordingWorker(plan, CU8_FORMAT, 2, output, () => port as unknown as Worker);
  const input = Uint8Array.of(1, 2, 3, 4);
  expect(worker.appendBytes(input, 1)).toBe(true);
  input.fill(0);
  expect(worker.appendBytes(new Uint8Array(CHANNEL_RECORDING_QUEUE_MAX_BYTES), 1)).toBe(false);
  let settled = false;
  const done = worker.finish().then(() => { settled = true; });
  const sent = port.postMessage.mock.calls.find(([message]) => message.type === "batch")![0];
  expect(sent).toMatchObject({ type: "batch", blocks: [{ bytes: Uint8Array.of(1, 2, 3, 4), outputLimit: 1 }] });
  await Promise.resolve(); expect(settled).toBe(false);
  port.emit({ type: "bytes", bytes: Uint8Array.of(5, 6) });
  port.emit({ type: "consumed", inputBytes: 4 });
  port.emit({ type: "finished" });
  await done;
  expect(output).toHaveBeenCalledWith(Uint8Array.of(5, 6));
  expect(port.terminate).toHaveBeenCalledOnce();
  expect(worker.appendBytes(input, 1)).toBe(false);
});
it("rejects finalization after a worker or storage callback failure", async () => {
  const port = new FakeWorker();
  const worker = new ChannelRecordingWorker(plan, CU8_FORMAT, 2, () => { throw new Error("storage queue full"); }, () => port as unknown as Worker);
  port.emit({ type: "bytes", bytes: Uint8Array.of(1, 2) });
  expect(worker.failed).toBe(true);
  await expect(worker.finish()).rejects.toThrow("storage queue full");
  expect(port.terminate).toHaveBeenCalledOnce();
});

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("discloses an early processing-queue stop and excludes rejected input from export", async () => {
  const port = new FakeWorker();
  vi.stubGlobal("Worker", class { constructor() { return port; } });
  const recorder = new IqRecorder({ source: "rtl-sdr", sessionGeneration: 1,
    requestedSampleRateHz: 2_400_000, actualSampleRateHz: 2_400_000,
    hardwareCenterFrequencyHz: 100_000_000, selectedChannelFrequencyHz: 100_000_000,
    mode: "WBFM", channelBandwidthHz: 150_000, squelch: 0, gainDb: null,
    sampleFormat: "planar-f32-iq-normalized" }, undefined, undefined, undefined, undefined,
    CU8_FORMAT, "memory", { captureCurrentChannel: true });
  recorder.appendCu8(new Uint8Array(CHANNEL_RECORDING_QUEUE_MAX_BYTES + 2));
  expect(recorder.status()).toMatchObject({ state: "capacity-reached", sampleCount: 0 });
  const recording = recorder.finish();
  expect(recording.metadata.captureWarning).toContain("channel processing could not keep up");
  port.emit({ type: "finished" });
  expect((await recording.dataBlob!)!.size).toBe(0);
});

it("coalesces a native burst without losing block limits and returns credit with output", async () => {
  vi.useFakeTimers();
  const port = new FakeWorker(), output = vi.fn();
  const worker = new ChannelRecordingWorker(plan, CU8_FORMAT, 2, output, () => port as unknown as Worker);
  const first = Uint8Array.of(1, 2), second = Uint8Array.of(3, 4);
  expect(worker.appendBytes(first, 1)).toBe(true);
  expect(worker.appendBytes(second, 0)).toBe(true);
  first.fill(0); second.fill(0);
  expect(port.postMessage).toHaveBeenCalledTimes(1);
  vi.runOnlyPendingTimers();
  expect(port.postMessage).toHaveBeenCalledTimes(2);
  expect(port.postMessage.mock.calls[1]![0]).toEqual({type:"batch", blocks:[
    {bytes:Uint8Array.of(1,2),outputLimit:1},
    {bytes:Uint8Array.of(3,4),outputLimit:0},
  ]});
  port.emit({type:"batch",chunks:[Uint8Array.of(5,6)],inputBytes:4});
  expect(output).toHaveBeenCalledWith(Uint8Array.of(5,6));
  // Without the acknowledged credit this exact bounded input must be rejected.
  expect(worker.appendBytes(new Uint8Array(CHANNEL_RECORDING_QUEUE_MAX_BYTES),1)).toBe(true);
  port.emit({type:"consumed",inputBytes:CHANNEL_RECORDING_QUEUE_MAX_BYTES});
  const done=worker.finish();port.emit({type:"finished"});await done;
});

it("bounds batches while retaining the same total acquisition queue limit", async () => {
  vi.useFakeTimers();
  const port=new FakeWorker();
  const worker=new ChannelRecordingWorker(plan,CU8_FORMAT,2,()=>{},()=>port as unknown as Worker);
  const input=new Uint8Array(768*1024);
  for(let n=0;n<42;n++)expect(worker.appendBytes(input,1)).toBe(true);
  expect(worker.appendBytes(input,1)).toBe(false);
  const done=worker.finish();
  const batches=port.postMessage.mock.calls.map(([m])=>m).filter(m=>m.type==="batch");
  expect(batches).toHaveLength(42);
  for(const batch of batches){
    const bytes=batch.blocks.reduce((total,block)=>total+block.bytes.byteLength,0);
    expect(bytes).toBeLessThanOrEqual(1024*1024);
    port.emit({type:"batch",chunks:[],inputBytes:bytes});
  }
  port.emit({type:"finished"});await done;
});

it("flushes partial native bursts before reset, normalized input and finish", async () => {
  vi.useFakeTimers();
  const port=new FakeWorker();
  const worker=new ChannelRecordingWorker(plan,CU8_FORMAT,2,()=>{},()=>port as unknown as Worker);
  worker.appendBytes(Uint8Array.of(1,2),1);worker.reset();
  worker.appendBytes(Uint8Array.of(3,4),1);worker.appendNormalized(Float32Array.of(1),Float32Array.of(0),1);
  worker.appendBytes(Uint8Array.of(5,6),1);const done=worker.finish();
  expect(port.postMessage.mock.calls.map(([m])=>m.type)).toEqual(["configure","batch","reset","batch","normalized","batch","finish"]);
  port.emit({type:"finished"});await done;
});

it("rejects a batched storage failure and never sends pending input after worker failure", async () => {
  vi.useFakeTimers();
  const port=new FakeWorker();
  const worker=new ChannelRecordingWorker(plan,CU8_FORMAT,2,()=>{throw new Error("storage queue full");},()=>port as unknown as Worker);
  worker.appendBytes(Uint8Array.of(1,2),1);
  vi.runOnlyPendingTimers();
  worker.appendBytes(Uint8Array.of(5,6),1);
  port.emit({type:"batch",chunks:[Uint8Array.of(3,4)],inputBytes:2});
  vi.runOnlyPendingTimers();
  expect(port.postMessage).toHaveBeenCalledTimes(2);
  expect(worker.appendBytes(Uint8Array.of(1,2),1)).toBe(false);
  await expect(worker.finish()).rejects.toThrow("storage queue full");
  expect(port.terminate).toHaveBeenCalledOnce();
});
