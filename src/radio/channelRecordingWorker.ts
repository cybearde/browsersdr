import type { ChannelCapturePlan } from "./channelRecording";
import type { RecordingSampleFormat } from "./iqRecording";

export type ChannelRecordingInput =
  | { type: "configure"; plan: ChannelCapturePlan; encoding: RecordingSampleFormat; stride: 2 | 4 }
  | { type: "bytes"; bytes: Uint8Array<ArrayBuffer>; outputLimit: number }
  | { type: "batch"; blocks: { bytes: Uint8Array<ArrayBuffer>; outputLimit: number }[] }
  | { type: "normalized"; I: Float32Array<ArrayBuffer>; Q: Float32Array<ArrayBuffer>; outputLimit: number }
  | { type: "reset" }
  | { type: "finish" };
export type ChannelRecordingOutput =
  | { type: "bytes"; bytes: Uint8Array<ArrayBuffer> }
  | { type: "consumed"; inputBytes: number }
  | { type: "batch"; chunks: Uint8Array<ArrayBuffer>[]; inputBytes: number }
  | { type: "finished" }
  | { type: "error"; message: string };
export const CHANNEL_RECORDING_QUEUE_MAX_BYTES = 32 * 1024 * 1024;
const CHANNEL_RECORDING_BATCH_MAX_BYTES = 1024 * 1024;

/** Bounded acquisition-side queue: only ownership copies run on the USB/UI thread. */
export class ChannelRecordingWorker {
  private readonly worker: Worker;
  private queued = 0;
  private failure?: Error;
  private ending = false;
  private readonly completed: Promise<void>;
  private resolve!: () => void;
  private reject!: (error: Error) => void;
  private timeout?: ReturnType<typeof setTimeout>;
  private pending: { bytes: Uint8Array<ArrayBuffer>; outputLimit: number }[] = [];
  private pendingBytes = 0;
  private flushTimer?: ReturnType<typeof setTimeout>;
  constructor(plan: ChannelCapturePlan, encoding: RecordingSampleFormat, stride: 2 | 4,
    onBytes: (bytes: Uint8Array<ArrayBuffer>) => void,
    factory = () => new Worker(new URL("../workers/channelRecording.worker.ts", import.meta.url), { type: "module" })) {
    this.completed = new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    void this.completed.catch(() => undefined);
    this.worker = factory();
    this.worker.onerror = event => this.fail(new Error(event.message || "Channel recording worker failed."));
    this.worker.onmessageerror = () => this.fail(new Error("Channel recording worker returned an unreadable message."));
    this.worker.onmessage = (event: MessageEvent<ChannelRecordingOutput>) => {
      if (this.failure) return;
      try {
        const message = event.data;
        if (message.type === "bytes") onBytes(message.bytes);
        else if (message.type === "consumed") this.queued -= message.inputBytes;
        else if (message.type === "batch") {
          // Credit belongs to input the worker has already processed. Return it
          // in the same event as its output instead of behind another UI task.
          this.queued -= message.inputBytes;
          for (const bytes of message.chunks) onBytes(bytes);
        }
        else if (message.type === "error") this.fail(new Error(message.message));
        else { clearTimeout(this.timeout); this.worker.terminate(); this.resolve(); }
      } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    };
    this.worker.postMessage({ type: "configure", plan, encoding, stride } satisfies ChannelRecordingInput);
  }
  get failed(): boolean { return Boolean(this.failure); }
  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error; clearTimeout(this.timeout); clearTimeout(this.flushTimer);
    this.pending = []; this.pendingBytes = 0;
    this.worker.terminate(); this.reject(error);
  }
  private flush(): boolean {
    clearTimeout(this.flushTimer); this.flushTimer = undefined;
    if (this.failure) return false;
    if (!this.pending.length) return true;
    const blocks = this.pending; this.pending = []; this.pendingBytes = 0;
    try {
      this.worker.postMessage({ type: "batch", blocks } satisfies ChannelRecordingInput,
        blocks.map(block => block.bytes.buffer));
      return true;
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }
  appendBytes(input: Uint8Array, outputLimit: number): boolean {
    if (this.ending || this.failure || this.queued + input.byteLength > CHANNEL_RECORDING_QUEUE_MAX_BYTES) return false;
    if (this.pendingBytes + input.byteLength > CHANNEL_RECORDING_BATCH_MAX_BYTES && !this.flush()) return false;
    const bytes = Uint8Array.from(input); this.queued += bytes.byteLength;
    // Large original blocks keep incremental output. Small native USB blocks
    // retain their individual limits/boundaries inside a bounded batch.
    if (bytes.byteLength >= CHANNEL_RECORDING_BATCH_MAX_BYTES) {
      this.worker.postMessage({ type: "bytes", bytes, outputLimit } satisfies ChannelRecordingInput, [bytes.buffer]);
    } else {
      this.pending.push({ bytes, outputLimit }); this.pendingBytes += bytes.byteLength;
      if (this.pendingBytes >= CHANNEL_RECORDING_BATCH_MAX_BYTES) return this.flush();
      this.flushTimer ??= setTimeout(() => { this.flush(); }, 0);
    }
    return true;
  }
  appendNormalized(inputI: Float32Array, inputQ: Float32Array, outputLimit: number): boolean {
    if (this.ending || this.failure || this.queued + inputI.byteLength + inputQ.byteLength > CHANNEL_RECORDING_QUEUE_MAX_BYTES) return false;
    if (!this.flush()) return false;
    const I = Float32Array.from(inputI), Q = Float32Array.from(inputQ); this.queued += I.byteLength + Q.byteLength;
    this.worker.postMessage({ type: "normalized", I, Q, outputLimit } satisfies ChannelRecordingInput, [I.buffer, Q.buffer]);
    return true;
  }
  reset(): void { if (!this.ending && !this.failure && this.flush()) this.worker.postMessage({ type: "reset" } satisfies ChannelRecordingInput); }
  finish(): Promise<void> {
    if (!this.ending && !this.failure) {
      if (!this.flush()) return this.completed;
      this.ending = true;
      this.timeout = setTimeout(() => this.fail(new Error("Channel recording worker timed out; capture cannot be exported.")), 30_000);
      this.worker.postMessage({ type: "finish" } satisfies ChannelRecordingInput);
    }
    return this.completed;
  }
}
