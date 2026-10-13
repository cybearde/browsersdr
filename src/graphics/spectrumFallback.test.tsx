// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { WebGpuSpectrum } from "./WebGpuSpectrum";
import type { AnalysisPipeline } from "../dsp/analysisPipeline";
import type { SpectrumFrame } from "../radio/types";
import { hackrfRecordingFixture } from "../testing/hackrfRecordingFixture";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it.each([
  "missing",
  "null adapter",
  "adapter rejects",
  "device rejects",
  "context",
  "shader",
  "lost",
  "render error",
  "render throws",
  "experimental",
])(
  "recovers from %s with an independent Canvas2D display and cleans up",
  async (failure) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    if (failure === "experimental")
      window.history.replaceState(null, "", "?analysis=gpu&fft=16384");
    const callbacks = new Map<number, FrameRequestCallback>();
    let next = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.set(++next, callback);
      return next;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
    const flush = () => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(0));
    };
    const fillRect = vi.fn(),
      putImageData = vi.fn(),
      destroy = vi.fn(),
      unconfigure = vi.fn();
    const contexts = new Map<HTMLCanvasElement, string>();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      function (this: HTMLCanvasElement, kind: string) {
        if (contexts.has(this) && contexts.get(this) !== kind) return null;
        contexts.set(this, kind);
        if (kind === "webgpu")
          return failure === "context"
            ? null
            : ({
                configure() {},
                unconfigure,
                getCurrentTexture: () => ({ createView() {} }),
              } as unknown as RenderingContext);
        return {
          canvas: this,
          fillRect,
          putImageData,
          createImageData: () => ({ data: new Uint8ClampedArray(1024 * 4) }),
          drawImage() {},
          beginPath() {},
          moveTo() {},
          lineTo() {},
          stroke() {},
        } as unknown as RenderingContext;
      },
    );
    let lose!: (info: { reason: string }) => void;
    let renderError!: (event: { error: Error }) => void;
    const device = {
      limits: { maxTextureDimension2D: 8192 },
      queue: { submit() {}, writeBuffer() {} },
      lost: new Promise((resolve) => {
        lose = resolve;
      }),
      destroy,
      addEventListener: (_type: string, listener: typeof renderError) => {
        renderError = listener;
      },
      removeEventListener() {},
      createShaderModule: () => ({
        getCompilationInfo: async () => ({
          messages:
            failure === "shader"
              ? [{ type: "error", message: "bad shader" }]
              : [],
        }),
      }),
      createBindGroupLayout() {},
      createPipelineLayout() {},
      createRenderPipeline: () => ({}),
      createBindGroup: () => ({}),
      createBuffer: () => ({ destroy() {} }),
      createCommandEncoder: () => ({
        beginRenderPass: () => {
          if (failure === "render throws") throw new Error("render threw");
          return {
            setBindGroup() {},
            setPipeline() {},
            draw() {},
            end() {},
          };
        },
        finish() {},
      }),
    };
    vi.stubGlobal(
      "navigator",
      failure === "missing" || failure === "experimental"
        ? {}
        : {
            gpu: {
              requestAdapter: async () => {
                if (failure === "adapter rejects")
                  throw new Error("adapter failed");
                if (failure === "null adapter") return null;
                return {
                  requestDevice: async () => {
                    if (failure === "device rejects")
                      throw new Error("device failed");
                    return device;
                  },
                };
              },
              getPreferredCanvasFormat: () => "bgra8unorm",
            },
          },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "clientWidth", "get").mockReturnValue(
      960,
    );
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "clientHeight",
      "get",
    ).mockReturnValue(560);
    let listener!: (
      frame: SpectrumFrame,
      frames: readonly SpectrumFrame[],
    ) => void;
    const unsubscriptions: ReturnType<typeof vi.fn>[] = [];
    const pipeline = {
      subscribe: (callback: typeof listener) => {
        listener = callback;
        const unsubscribe = vi.fn();
        unsubscriptions.push(unsubscribe);
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
    const status = vi.fn();
    await act(async () =>
      root.render(
        <WebGpuSpectrum
          pipeline={pipeline}
          session={session}
          onStatusChange={status}
        />,
      ),
    );
    const gpuCanvas = host.querySelector("canvas");
    if (failure === "lost") await act(async () => lose({ reason: "unknown" }));
    if (failure === "render error")
      await act(async () => renderError({ error: new Error("render failed") }));
    expect(host.querySelector("canvas")!.getAttribute("aria-label")).toContain(
      "Canvas2D",
    );
    if (failure === "lost" || failure === "render error")
      expect(host.querySelector("canvas")).not.toBe(gpuCanvas);
    // Fallback initialization includes a deferred module import. Wait for its
    // actual ready status before feeding frames, with the same assertion.
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(status).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: "ready", hasFrame: false }),
      );
    });
    const frame = (sequence: number, generation = 0): SpectrumFrame => ({
      sessionGeneration: generation,
      sequence,
      timestampMs: 0,
      sampleIndex: (sequence + 1) * 16384,
      sampleRateHz: 4800000,
      centerFrequencyHz: 118800000,
      units: "relative-dB",
      bins: new Float32Array(4096).fill(-90),
      droppedFramesBefore: 0,
    });
    const send = async (f: SpectrumFrame) => act(async () => listener(f, [f]));
    await send(frame(0));
    flush();
    expect(status).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "ready", hasFrame: true }),
    );
    await send(frame(1)); // Pause while the final display redraw is queued.
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".display-pause")!.click(),
    );
    expect(callbacks.size).toBe(0);
    const frozenDraws = fillRect.mock.calls.length;
    flush();
    expect(fillRect.mock.calls.length).toBe(frozenDraws);

    putImageData.mockClear();
    await send(frame(1));
    expect(putImageData).not.toHaveBeenCalled();
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".display-pause")!.click(),
    );
    await act(async () =>
      root.render(
        <WebGpuSpectrum
          pipeline={pipeline}
          session={session}
          active={false}
          onStatusChange={status}
        />,
      ),
    );
    flush();
    fillRect.mockClear();
    await send(frame(2));
    flush();
    expect(fillRect).not.toHaveBeenCalled();
    expect(putImageData).toHaveBeenCalled();
    await act(async () =>
      root.render(
        <WebGpuSpectrum
          pipeline={pipeline}
          session={session}
          onStatusChange={status}
        />,
      ),
    );
    flush();
    expect(fillRect).toHaveBeenCalled();
    putImageData.mockClear();
    await send(frame(99, 2));
    expect(putImageData).not.toHaveBeenCalled();
    await send(frame(3));
    await act(async () => root.unmount());
    expect(callbacks.size).toBe(0);
    expect(
      unsubscriptions.every(
        (unsubscribe) => unsubscribe.mock.calls.length === 1,
      ),
    ).toBe(true);
    if (["shader", "render error"].includes(failure))
      expect(destroy).toHaveBeenCalledOnce();
    window.history.replaceState(null, "", "/");
  },
);
