import { afterEach, describe, expect, it, vi } from "vitest";
import { Convolver } from "@jtarrio/signals/wasm/convolver.js";
import {
  CONVOLVER as upstreamConvolver,
  FFT as upstreamFft,
} from "@jtarrio/signals/wasm/wasm-bytes.js";
import { STANDARD_CONVOLVER } from "./signalsConvolverBytes";

function convolver(bytes: Uint8Array<ArrayBuffer>): Convolver {
  const exports = new WebAssembly.Instance(new WebAssembly.Module(bytes))
    .exports;
  return new Convolver(exports as ConstructorParameters<typeof Convolver>[0]);
}
function signal(length: number): Float32Array {
  return Float32Array.from(
    { length },
    (_, i) => Math.sin(i * 0.31) * 0.6 + Math.cos(i * 0.13) * 0.3,
  );
}
function close(actual: Float32Array, expected: Float32Array): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < actual.length; i++)
    expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThan(2e-6);
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Signals standard-SIMD compatibility", () => {
  it("uses the original bytes on supported engines", async () => {
    const bytes = await import("./signalsWasmBytes");
    expect(bytes.CONVOLVER).toEqual(upstreamConvolver);
    expect(bytes.FFT).toEqual(upstreamFft);
  });

  it("loads the standard kernel when the relaxed kernel fails validation", async () => {
    const validate = WebAssembly.validate.bind(WebAssembly);
    vi.spyOn(WebAssembly, "validate").mockImplementation((bytes) => {
      if (
        bytes instanceof Uint8Array &&
        bytes.length === upstreamConvolver.length &&
        bytes.every((value, i) => value === upstreamConvolver[i])
      )
        return false;
      return validate(bytes);
    });
    const bytes = await import("./signalsWasmBytes");
    expect(bytes.CONVOLVER).toEqual(STANDARD_CONVOLVER);
    expect(WebAssembly.validate(bytes.CONVOLVER)).toBe(true);
    expect(() => new WebAssembly.Module(bytes.CONVOLVER)).not.toThrow();
    expect(bytes.FFT).toEqual(upstreamFft);
  });

  for (const taps of [3, 4, 5, 41, 205]) {
    it(`matches scalar convolution and upstream stride output with ${taps} taps`, () => {
      const kernel = Float32Array.from(
        { length: taps },
        (_, i) => Math.cos(i * 0.21) / taps,
      );
      const samples = signal(512 + taps);
      const standard = convolver(STANDARD_CONVOLVER),
        upstream = convolver(upstreamConvolver);
      standard.setCoefs(kernel);
      upstream.setCoefs(kernel);
      const output = standard.convolve(samples, 128).slice();
      const scalar = Float32Array.from({ length: 128 }, (_, i) =>
        kernel.reduce((sum, coef, j) => sum + coef * samples[i + j]!, 0),
      );
      close(output, scalar);
      close(output, upstream.convolve(samples, 128));
      close(
        standard.convolveWithStride(samples, 64, 3, 2),
        upstream.convolveWithStride(samples, 64, 3, 2),
      );
      // Reconfigure coefficients and grow the memory without retaining old views.
      standard.setCoefs(kernel);
      upstream.setCoefs(kernel);
      close(
        standard.convolve(signal(80_000), 70_000),
        upstream.convolve(signal(80_000), 70_000),
      );
    });
  }

  for (const ratio of [2, 5]) {
    it(`preserves expanding and fractional-resampling outputs at ratio ${ratio}`, () => {
      const groups = Array.from({ length: ratio }, (_, g) =>
        Float32Array.from(
          { length: 17 },
          (_, i) => Math.cos((i + g) * 0.31) / 17,
        ),
      );
      const standard = convolver(STANDARD_CONVOLVER),
        upstream = convolver(upstreamConvolver);
      standard.setCoefArray(groups);
      upstream.setCoefArray(groups);
      const samples = signal(1024);
      close(
        standard.convolveExpanding(samples, 100, ratio),
        upstream.convolveExpanding(samples, 100, ratio),
      );
      close(
        standard.convolveExpandingWithStride(samples, 120, 3, 2),
        upstream.convolveExpandingWithStride(samples, 120, 3, 2),
      );
    });
  }
});
