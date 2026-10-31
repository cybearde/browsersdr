import { decodeCi8Into } from "../radio/ci8Samples";
import { ChannelCaptureFilter } from "../radio/channelRecording";
import { decodeRecordingSamples, validateSampleEncoding, type RecordingSampleFormat } from "../radio/iqRecording";
import { CHANNEL_MAX_SAMPLES } from "../radio/widebandChannel";
import type { ChannelRecordingInput, ChannelRecordingOutput } from "../radio/channelRecordingWorker";
import { recordingKernels } from "../radio/recordingConvolver";

let filter: ChannelCaptureFilter;
let encoding: RecordingSampleFormat;
let stride: 2 | 4;
// Private synchronous scratch; output is encoded before the next block reuses it.
const scratchI = new Float32Array(CHANNEL_MAX_SAMPLES);
const scratchQ = new Float32Array(CHANNEL_MAX_SAMPLES);
function post(message: ChannelRecordingOutput, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer });
}
function process(I: Float32Array, Q: Float32Array, limit: number, emit: (bytes: Uint8Array<ArrayBuffer>) => void): number {
  const result = filter.processOwned(I, Q);
  const count = Math.min(limit, result.I.length);
  const bytes = new Uint8Array(count * stride);
  const view = new DataView(bytes.buffer);
  for (let n = 0; n < count; n++) {
    if (stride === 4) {
      view.setInt16(n * 4, Math.max(-32768, Math.min(32767, Math.round(result.I[n]! * 32768))), true);
      view.setInt16(n * 4 + 2, Math.max(-32768, Math.min(32767, Math.round(result.Q[n]! * 32768))), true);
    } else {
      view.setInt8(n * 2, Math.max(-128, Math.min(127, Math.round(result.I[n]! * 128))));
      view.setInt8(n * 2 + 1, Math.max(-128, Math.min(127, Math.round(result.Q[n]! * 128))));
    }
  }
  if (count) emit(bytes);
  return count;
}
type DataInput = Extract<ChannelRecordingInput, { type: "bytes" | "normalized" }>;
function processInput(message: DataInput, emit: (bytes: Uint8Array<ArrayBuffer>) => void): number {
  let remaining = message.outputLimit;
  if (message.type === "bytes") {
    const inputStride = encoding.bytesPerComplexSample;
    for (let offset = 0; offset < message.bytes.length; offset += CHANNEL_MAX_SAMPLES * inputStride) {
      const bytes = message.bytes.subarray(offset, offset + CHANNEL_MAX_SAMPLES * inputStride);
      if (encoding.format === "browsersdr-ci8-v2") {
        const count = decodeCi8Into(bytes, scratchI, scratchQ);
        remaining -= process(scratchI.subarray(0, count), scratchQ.subarray(0, count), remaining, emit);
      } else {
        const decoded = decodeRecordingSamples(bytes, encoding);
        remaining -= process(decoded.I, decoded.Q, remaining, emit);
      }
    }
    return message.bytes.byteLength;
  }
  for (let offset = 0; offset < message.I.length; offset += CHANNEL_MAX_SAMPLES)
    remaining -= process(message.I.subarray(offset, offset + CHANNEL_MAX_SAMPLES), message.Q.subarray(offset, offset + CHANNEL_MAX_SAMPLES), remaining, emit);
  return message.I.byteLength + message.Q.byteLength;
}
self.onmessage = (event: MessageEvent<ChannelRecordingInput>) => {
  try {
    const message = event.data;
    if (message.type === "configure") { validateSampleEncoding(message.encoding); filter = new ChannelCaptureFilter(message.plan, recordingKernels); encoding = message.encoding; stride = message.stride; }
    else if (message.type === "reset") filter.reset();
    else if (message.type === "finish") post({ type: "finished" });
    else if (message.type === "batch") {
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let inputBytes = 0;
      for (const block of message.blocks)
        inputBytes += processInput({ type: "bytes", ...block }, bytes => chunks.push(bytes));
      post({ type: "batch", chunks, inputBytes }, chunks.map(bytes => bytes.buffer));
    }
    else {
      const inputBytes = processInput(message, bytes => post({ type: "bytes", bytes }, [bytes.buffer]));
      post({ type: "consumed", inputBytes });
    }
  } catch (error) { post({ type: "error", message: error instanceof Error ? error.message : String(error) }); }
};
