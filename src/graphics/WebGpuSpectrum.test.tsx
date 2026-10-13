// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setTheme } from "../ui/themes";
import { WebGpuSpectrum } from "./WebGpuSpectrum";
import type { AnalysisPipeline } from "../dsp/analysisPipeline";
import { hackrfRecordingFixture } from "../testing/hackrfRecordingFixture";
import type { SpectrumFrame } from "../radio/types";

afterEach(() => {
  setTheme("classic");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("retains hidden rows without drawing, throttles status, and caches canvas layout", async () => {
  // Settle the deferred guide before measuring steady-state renderer redraws.
  await import("./BandGuideFeature");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resize!: ResizeObserverCallback;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const submit = vi.fn(),
    writeBuffer = vi.fn();
  const pass = { setBindGroup() {}, setPipeline() {}, draw() {}, end() {} };
  const device = {
    limits: { maxTextureDimension2D: 8192 },
    queue: { submit, writeBuffer },
    lost: new Promise(() => {}),
    addEventListener() {},
    removeEventListener() {},
    destroy() {},
    createShaderModule: () => ({
      getCompilationInfo: async () => ({ messages: [] }),
    }),
    createBindGroupLayout() {},
    createPipelineLayout() {},
    createRenderPipeline: () => ({}),
    createBindGroup: () => ({}),
    createBuffer: (descriptor: { label: string }) => ({
      label: descriptor.label,
      destroy() {},
    }),
    createCommandEncoder: () => ({ beginRenderPass: () => pass, finish() {} }),
  };
  vi.stubGlobal("navigator", {
    gpu: {
      requestAdapter: async () => ({ requestDevice: async () => device }),
      getPreferredCanvasFormat: () => "bgra8unorm",
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    configure() {},
    unconfigure() {},
    getCurrentTexture: () => ({ createView() {} }),
  } as unknown as RenderingContext);
  const width = vi
    .spyOn(HTMLCanvasElement.prototype, "clientWidth", "get")
    .mockReturnValue(960);
  const height = vi
    .spyOn(HTMLCanvasElement.prototype, "clientHeight", "get")
    .mockReturnValue(560);
  let listener!: (
    latest: SpectrumFrame,
    frames: readonly SpectrumFrame[],
  ) => void;
  const unsubscribe = vi.fn();
  const pipeline = {
    subscribe: (callback: typeof listener) => {
      listener = callback;
      return unsubscribe;
    },
  } as unknown as AnalysisPipeline;
  const session = {
    ...(await hackrfRecordingFixture()).session,
    sessionGeneration: 0,
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  await act(async () =>
    root.render(
      <WebGpuSpectrum pipeline={pipeline} session={session} active />,
    ),
  );
  expect(host.querySelector(".diagnostic-message")).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>(".spectrum-info-button")!.click());
  const frame = (sequence: number): SpectrumFrame => ({
    sessionGeneration: 0,
    sequence,
    timestampMs: now,
    sampleIndex: (sequence + 1) * 192512,
    hopSamples: 192512,
    sampleRateHz: 4800000,
    centerFrequencyHz: 118800000,
    units: "relative-dB",
    bins: new Float32Array(4096),
    droppedFramesBefore: 0,
  });
  const send = async (sequence: number) => {
    const f = frame(sequence);
    await act(async () => listener(f, [f]));
  };
  await send(0);
  const status = host.querySelector(".diagnostic-message")!.textContent;
  now += 40;
  await send(1);
  expect(host.querySelector(".diagnostic-message")!.textContent).toBe(status);
  now += 250;
  await send(2);
  expect(host.querySelector(".diagnostic-message")!.textContent).not.toBe(
    status,
  );
  expect(width).toHaveBeenCalledOnce();
  expect(height).toHaveBeenCalledOnce();
  const uniforms = writeBuffer.mock.calls.filter(
    (call) => call[0]?.label === "display controls",
  );
  expect(new Set(uniforms.map((call) => call[2])).size).toBe(1);
  const canvasNode = host.querySelector("canvas");
  writeBuffer.mockClear();
  await act(async () => setTheme("field-deck"));
  expect(host.querySelector("canvas")).toBe(canvasNode);
  expect(unsubscribe).not.toHaveBeenCalled();
  expect(writeBuffer.mock.calls.filter((call) => call[0]?.label === "circular waterfall power history")).toHaveLength(0);
  const themedUniform = writeBuffer.mock.calls.find((call) => call[0]?.label === "display controls")!;
  const themedData = new Float32Array(themedUniform[2]);
  expect(themedData.length).toBe(32);
  expect([...themedData.slice(24, 27)]).toEqual([1, expect.closeTo(.78), expect.closeTo(.54)]);
  await act(async () => setTheme("classic"));
  await act(async () =>
    root.render(
      <WebGpuSpectrum pipeline={pipeline} session={session} active={false} />,
    ),
  );
  submit.mockClear();
  writeBuffer.mockClear();
  const hiddenStatus = host.querySelector(".diagnostic-message")!.textContent;
  now += 1000;
  await send(3);
  await send(4);
  expect(submit).not.toHaveBeenCalled();
  expect(host.querySelector(".diagnostic-message")!.textContent).toBe(
    hiddenStatus,
  );
  expect(
    writeBuffer.mock.calls.filter(
      (call) => call[0]?.label === "circular waterfall power history",
    ),
  ).toHaveLength(2);
  await act(async () =>
    root.render(
      <WebGpuSpectrum pipeline={pipeline} session={session} active />,
    ),
  );
  expect(submit).toHaveBeenCalledOnce();
  expect(unsubscribe).not.toHaveBeenCalled();
  const canvas = host.querySelector("canvas")!;
  await act(async () =>
    resize(
      [
        {
          target: canvas,
          contentRect: { width: 800, height: 400 },
        } as unknown as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    ),
  );
  expect(canvas.width).toBe(800);
  expect(canvas.height).toBe(400);
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  submit.mockClear();
  await send(5);
  expect(submit).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(submit).toHaveBeenCalled();
  const current = frame(6);
  current.bins.fill(-90);
  current.bins[2000] = -40;
  await act(async () => listener(current, [current]));
  const pause = host.querySelector<HTMLButtonElement>(".display-pause")!;
  const autoScale = Array.from(
    host.querySelectorAll(".spectrum-actions button"),
  ).find(
    (button) => button.textContent?.trim() === "Auto scale",
  ) as HTMLButtonElement;
  expect(autoScale.disabled).toBe(false);
  await act(async () => pause.click());
  expect(pause.textContent).toContain("Resume display");
  await send(7); // Incoming data must not alter scaling of the frozen display.
  await act(async () => autoScale.click());
  expect(
    Array.from(host.querySelectorAll(".display-controls output")).map(
      (output) => output.textContent,
    ),
  ).toEqual(["-98 dB", "64 dB"]);
  expect(pause.getAttribute("aria-pressed")).toBe("true");
  await act(async () => pause.click());
  expect(pause.textContent).toContain("Pause display");
  await act(async () => root.unmount());
  expect(unsubscribe).toHaveBeenCalledOnce();
});
