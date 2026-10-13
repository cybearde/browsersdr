import { FFT_SIZE } from "../dsp/spectrumMath";
import type { SpectrumFrame } from "../radio/types";
import { HISTORY_ROWS } from "./spectrumShader";
import { WaterfallHistory } from "./waterfallHistory";
import { SPECTRUM_PALETTES, rgbCss, type SpectrumPalette } from "./spectrumPalette";

export const CANVAS_HISTORY_WIDTH = 1024;
export const CANVAS_MAX_DIMENSION = 2048;
const GAP = -10_000;

/** Keep narrow peaks when several FFT bins share one display column. */
export function peakColumns(bins: Float32Array, width: number): Float32Array {
  const result = new Float32Array(width).fill(GAP);
  for (let x = 0; x < width; x++) {
    const start = Math.floor((x * bins.length) / width);
    const end = Math.max(
      start + 1,
      Math.floor(((x + 1) * bins.length) / width),
    );
    for (let bin = start; bin < end; bin++) {
      const value = bins[bin]!;
      if (Number.isFinite(value)) result[x] = Math.max(result[x]!, value);
    }
  }
  return result;
}

/** Same palette and gap color as the WebGPU display. */
export function waterfallColor(
  level: number,
  floor: number,
  range: number,
  palette: SpectrumPalette = SPECTRUM_PALETTES.classic,
): number[] {
  if (level < -1000 || !Number.isFinite(level)) return [43, 48, 48];
  const t = Math.max(0, Math.min(1, (level - floor) / range));
  const [cold, violet, electric, stellar] = palette.waterfall;
  const [a, b, mix] =
    t <= 0.5
      ? ([cold, violet, t * 2] as const)
      : t <= 0.83
        ? ([violet, electric, (t - 0.5) * 3] as const)
        : ([electric, stellar, (t - 0.83) * 5.88] as const);
  return a.map((value, index) =>
    Math.round(255 * (value + (b[index]! - value) * mix)),
  );
}

/** Bounded display-only cache; never consumes raw I/Q or changes analysis. */
export class CanvasSpectrum {
  private readonly history = new WaterfallHistory(HISTORY_ROWS);
  private readonly levels = new Float32Array(
    CANVAS_HISTORY_WIDTH * HISTORY_ROWS,
  ).fill(GAP);
  private readonly bitmap = document.createElement("canvas");
  private readonly bitmapContext: CanvasRenderingContext2D;
  private readonly rowImage: ImageData;
  private palette = SPECTRUM_PALETTES.classic;
  private floor = -105;
  private range = 90;
  private latest?: SpectrumFrame;

  constructor(
    private readonly context: CanvasRenderingContext2D,
    generation: number,
  ) {
    this.history.reset(generation);
    this.bitmap.width = CANVAS_HISTORY_WIDTH;
    this.bitmap.height = HISTORY_ROWS;
    const bitmapContext = this.bitmap.getContext("2d");
    if (!bitmapContext) throw new Error("Canvas2D history is unavailable.");
    this.bitmapContext = bitmapContext;
    this.rowImage = bitmapContext.createImageData(CANVAS_HISTORY_WIDTH, 1);
  }

  accept(frames: readonly SpectrumFrame[]): SpectrumFrame | undefined {
    let accepted: SpectrumFrame | undefined;
    for (const frame of frames) {
      if (frame.bins.length !== FFT_SIZE) continue;
      const rows = this.history.append(frame);
      if (!rows.length) continue;
      for (const row of rows) {
        const offset = row.row * CANVAS_HISTORY_WIDTH;
        if (row.bins)
          this.levels.set(peakColumns(row.bins, CANVAS_HISTORY_WIDTH), offset);
        else this.levels.fill(GAP, offset, offset + CANVAS_HISTORY_WIDTH);
        this.paintRow(row.row);
      }
      // Own a bounded copy: display listeners must not mutate shared analysis frames.
      this.latest = { ...frame, bins: frame.bins.slice() };
      accepted = this.latest;
    }
    return accepted;
  }

  private paintRow(row: number): void {
    for (let x = 0; x < CANVAS_HISTORY_WIDTH; x++) {
      const rgb = waterfallColor(
        this.levels[row * CANVAS_HISTORY_WIDTH + x]!,
        this.floor,
        this.range,
        this.palette,
      );
      this.rowImage.data.set([...rgb, 255], x * 4);
    }
    // Physical row zero is at the bottom, so circular slices draw newest first.
    this.bitmapContext.putImageData(this.rowImage, 0, HISTORY_ROWS - 1 - row);
  }

  render(
    cssWidth: number,
    cssHeight: number,
    ratio: number,
    floor: number,
    range: number,
    palette: SpectrumPalette = SPECTRUM_PALETTES.classic,
    guideHeight = 0,
  ): void {
    const canvas = this.context.canvas;
    const width = Math.min(
      CANVAS_MAX_DIMENSION,
      Math.max(1, Math.round(cssWidth * ratio)),
    );
    const height = Math.min(
      CANVAS_MAX_DIMENSION,
      Math.max(1, Math.round(cssHeight * ratio)),
    );
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (floor !== this.floor || range !== this.range || palette !== this.palette) {
      this.palette = palette;
      this.floor = floor;
      this.range = range;
      for (const row of this.history.newestFirst()) this.paintRow(row);
    }
    const ctx = this.context;
    ctx.fillStyle = palette === SPECTRUM_PALETTES.classic ? "#020511" : rgbCss(palette.background);
    ctx.fillRect(0, 0, width, height);
    const { count, nextWriteRow } = this.history.state;
    if (count) {
      const start = HISTORY_ROWS - nextWriteRow;
      const first = Math.min(count, nextWriteRow);
      const y = height * (0.38 + Math.min(.5, guideHeight / Math.max(1, cssHeight))),
        rowHeight = (height - y) / count;
      ctx.imageSmoothingEnabled = false;
      if (first)
        ctx.drawImage(
          this.bitmap,
          0,
          start,
          CANVAS_HISTORY_WIDTH,
          first,
          0,
          y,
          width,
          first * rowHeight,
        );
      if (count > first)
        ctx.drawImage(
          this.bitmap,
          0,
          0,
          CANVAS_HISTORY_WIDTH,
          count - first,
          0,
          y + first * rowHeight,
          width,
          (count - first) * rowHeight,
        );
    }
    if (!this.latest) return;
    const bins = peakColumns(this.latest.bins, Math.min(width, FFT_SIZE));
    ctx.strokeStyle = palette === SPECTRUM_PALETTES.classic ? "#4adbff" : rgbCss(palette.trace);
    ctx.lineWidth = Math.max(1, ratio);
    ctx.beginPath();
    for (let x = 0; x < bins.length; x++) {
      const normalized = Math.max(0, Math.min(1, (bins[x]! - floor) / range));
      const px = (x / Math.max(1, bins.length - 1)) * width;
      const py = height * (0.375 - normalized * 0.335);
      if (x === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}
