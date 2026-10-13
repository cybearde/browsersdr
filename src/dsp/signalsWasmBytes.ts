import {
  CONVOLVER as upstreamConvolver,
  FFT,
} from "@jtarrio/signals/wasm/wasm-bytes.js";
import { STANDARD_CONVOLVER } from "./signalsConvolverBytes";

// Signals compiles its convolver during module evaluation. Some Safari engines
// support standard SIMD but reject relaxed multiply-add, before React can mount.
// Retain the upstream kernel when supported; the fallback has the same ABI.
export const CONVOLVER = WebAssembly.validate(upstreamConvolver)
  ? upstreamConvolver
  : STANDARD_CONVOLVER;
export { FFT };
