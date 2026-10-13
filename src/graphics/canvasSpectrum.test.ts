// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { SPECTRUM_PALETTES } from "./spectrumPalette";
import { CanvasSpectrum, peakColumns, waterfallColor } from "./canvasSpectrum";
import type { SpectrumFrame } from "../radio/types";

afterEach(() => vi.restoreAllMocks());

function frame(sequence: number, generation = 4): SpectrumFrame {
  return {
    sessionGeneration: generation,
    sequence,
    sampleIndex: (sequence + 1) * 16384,
    timestampMs: sequence,
    centerFrequencyHz: 100e6,
    sampleRateHz: 1024000,
    units: "relative-dB",
    bins: new Float32Array(4096).fill(-90),
    droppedFramesBefore: 0,
  };
}

it("preserves single-bin peaks, ignores nonfinite values, and matches palette endpoints", () => {
  const bins = new Float32Array(4096).fill(-100);
  bins[2] = -20;
  bins[3] = NaN;
  expect(peakColumns(bins, 1024)[0]).toBe(-20);
  expect(peakColumns(bins, 1024)[1]).toBe(-100);
  expect(waterfallColor(-10000, -100, 90)).toEqual([43, 48, 48]);
  expect(waterfallColor(-100, -100, 90)).toEqual([3, 6, 23]);
  expect(waterfallColor(-55, -100, 90)).toEqual([46, 20, 148]);
});

it("owns frames, rejects stale/repeated rows, retains clock gaps and wraps newest-first history", () => {
  const uploads: { y: number; data: Uint8ClampedArray }[] = [];
  const bitmapContext = {
    createImageData: () => ({ data: new Uint8ClampedArray(1024 * 4) }),
    putImageData: (image: ImageData, _x: number, y: number) =>
      uploads.push({ y, data: image.data.slice() }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    bitmapContext as unknown as CanvasRenderingContext2D,
  );
  const canvas = document.createElement("canvas");
  const drawImage = vi.fn(),
    fillRect = vi.fn(),
    lineTo = vi.fn();
  const ctx = {
    canvas,
    drawImage,
    fillRect,
    beginPath() {},
    moveTo() {},
    lineTo,
    stroke() {},
  } as unknown as CanvasRenderingContext2D;
  const display = new CanvasSpectrum(ctx, 4);
  const first = frame(0);
  const accepted = display.accept([first])!;
  first.bins.fill(0);
  expect(accepted.bins[0]).toBe(-90);
  expect(display.accept([frame(0), frame(1, 3)])).toBeUndefined();
  display.accept([frame(3)]);
  expect(uploads.map((row) => row.y)).toEqual([239, 238, 237, 236]);
  expect([...uploads[1]!.data.slice(0, 4)]).toEqual([43, 48, 48, 255]);
  display.render(800, 400, 2, -105, 90);
  expect(canvas.width).toBe(1600);
  expect(canvas.height).toBe(800);
  expect(drawImage.mock.calls[0]!.slice(1, 5)).toEqual([0, 236, 1024, 4]);
  drawImage.mockClear();
  display.render(800, 400, 2, -105, 90, undefined, 28);
  expect(drawImage.mock.calls[0]![6]).toBeCloseTo(360);
  expect(drawImage.mock.calls[0]![8]).toBeCloseTo(440);
  expect(drawImage.mock.calls[0]!.slice(1, 5)).toEqual([0, 236, 1024, 4]);
  const originalColor = uploads[0]!.data.slice(0, 4);
  display.render(10000, 10000, 3, -90, 20);
  expect(canvas.width).toBe(2048);
  expect(canvas.height).toBe(2048);
  expect(uploads.at(-1)!.data.slice(0, 4)).not.toEqual(originalColor);
  // Recolor a paused, retained history without accepting new frames or moving rows.
  const rowsBefore = uploads.length;
  drawImage.mockClear();
  display.render(800, 400, 1, -90, 20, SPECTRUM_PALETTES["field-deck"]);
  expect(uploads.length - rowsBefore).toBe(4);
  expect([...uploads[rowsBefore + 1]!.data.slice(0, 4)]).toEqual([43, 48, 48, 255]);
  expect(drawImage.mock.calls[0]!.slice(1, 5)).toEqual([0, 236, 1024, 4]);
  expect(ctx.strokeStyle).toBe("rgb(255 199 138)");
  for (let i = 4; i < 242; i++) display.accept([frame(i)]);
  drawImage.mockClear();
  display.render(800, 400, 1, -90, 20);
  expect(drawImage.mock.calls.map((call) => call.slice(1, 5))).toEqual([
    [0, 238, 1024, 2],
    [0, 0, 1024, 238],
  ]);
});
