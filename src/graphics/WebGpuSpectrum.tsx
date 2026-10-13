import { ActionButton } from "../ui/ActionButton";
import type { CanvasSpectrum } from "./canvasSpectrum";
import { SPECTRUM_PALETTES } from "./spectrumPalette";
import { useTheme } from "../ui/themes";
import { SpectrumInfo } from "./SpectrumInfo";
import { spectrumDisplayScale } from "./spectrumDisplayScale";
import { usePageVisible } from "../ui/usePageVisible";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { AnalysisPipeline } from "../dsp/analysisPipeline";
import { frequencyForPixel, spectrumEdges } from "../dsp/frequencyScale";
import { FFT_SIZE } from "../dsp/spectrumMath";
import type { SourceSessionMetadata, SpectrumFrame } from "../radio/types";
import { GpuSpectrum, gpuFftSize } from "../dsp/gpuSpectrum";
import { GpuAnalysisTap } from "../dsp/gpuAnalysisTap";
import { WaterfallHistory } from "./waterfallHistory";
import { HISTORY_ROWS, spectrumShader } from "./spectrumShader";
import { defaultDiagnosticRecorder } from "../diagnostics/diagnosticRecorder";
import { channelPassbands, formatPassbandWidth } from "./channelPassband";
import { formatFrequencyMHz } from "../ui/frequencyFormat";
import { lazy, Suspense, type CSSProperties } from "react";
const BandGuideFeature = lazy(() => import("./BandGuideFeature").then(module => ({default:module.BandGuideFeature})));

export interface SpectrumDisplayStatus {
  kind: "checking" | "ready" | "unsupported" | "error";
  hasFrame: boolean;
  paused: boolean;
  stalled?: boolean;
  renderer?: "webgpu" | "canvas2d";
}

type GpuState = {
  kind: "checking" | "ready" | "unsupported" | "error";
  message: string;
};

const GPU_VERTEX_STAGE = 0x1;
const GPU_FRAGMENT_STAGE = 0x2;
const GPU_BUFFER_COPY_DST = 0x8;
const GPU_BUFFER_UNIFORM = 0x40;
const GPU_BUFFER_STORAGE = 0x80;
const GAP_LEVEL_DB = -10_000;

function formatFrequency(frequencyHz: number): string {
  return `${formatFrequencyMHz(frequencyHz)} MHz`;
}

function frequencyPercent(
  frequencyHz: number,
  centerFrequencyHz: number,
  sampleRateHz: number,
): number {
  return (0.5 + (frequencyHz - centerFrequencyHz) / sampleRateHz) * 100;
}

export function WebGpuSpectrum({
  pipeline,
  session,
  onTune,
  onStatusChange,
  onOpenAcquire,
  onOpenDiagnostics,
  active = true,
  tuningControls,
  displaySettings,
  onDisplaySettingsChange,
}: {
  displaySettings?: { floorDb: number; rangeDb: number };
  onDisplaySettingsChange?: (settings: { floorDb: number; rangeDb: number }) => void;
  active?: boolean;
  tuningControls?: ReactNode;
  onStatusChange?: (status: SpectrumDisplayStatus) => void;
  onOpenAcquire?: () => void;
  onOpenDiagnostics?: () => void;
  pipeline: AnalysisPipeline;
  session?: SourceSessionMetadata;
  onTune?: (frequencyHz: number) => void;
}) {
  const theme = useTheme();
  const paletteRef = useRef(SPECTRUM_PALETTES[theme]);
  paletteRef.current = SPECTRUM_PALETTES[theme];
  const visible = usePageVisible(active);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const requestedFftSize = gpuFftSize();
  const [fftSize, setFftSize] = useState<number>(requestedFftSize ?? FFT_SIZE);
  const [fftMessage, setFftMessage] = useState(
    requestedFftSize
      ? "Experimental GPU FFT initializing; WASM remains active."
      : "",
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const renderRef = useRef<() => void>(() => undefined);
  const [guideGap, setGuideGap] = useState(0);
  const [guideCoordinates, setGuideCoordinates] = useState<{center:number;rate:number;generation:number}>();
  const guideCoordinatesRef = useRef(guideCoordinates);
  const [displayWidth, setDisplayWidth] = useState(0);
  const rememberGuideCoordinates = (frame: SpectrumFrame) => {
    const old = guideCoordinatesRef.current;
    if (old?.center === frame.centerFrequencyHz && old.rate === frame.sampleRateHz && old.generation === frame.sessionGeneration) return;
    const next = {center:frame.centerFrequencyHz,rate:frame.sampleRateHz,generation:frame.sessionGeneration};
    guideCoordinatesRef.current = next;
    setGuideCoordinates(next);
  };
  useEffect(() => {
    if (visible) renderRef.current();
  }, [visible]);
  useEffect(() => { renderRef.current(); }, [theme]);
  const pausedRef = useRef(false);
  const floorRef = useRef(-105);
  const rangeRef = useRef(90);
  const [paused, setPaused] = useState(false);
  const [floorDb, setFloorDb] = useState(-105);
  const [rangeDb, setRangeDb] = useState(90);
  useEffect(() => {
    if (!displaySettings) return;
    floorRef.current = displaySettings.floorDb;
    rangeRef.current = displaySettings.rangeDb;
    setFloorDb(displaySettings.floorDb);
    setRangeDb(displaySettings.rangeDb);
    renderRef.current();
  }, [displaySettings]);
  const [renderer, setRenderer] = useState<"webgpu" | "canvas2d">("webgpu");
  const [fallbackReason, setFallbackReason] = useState("");
  const [gpuAttempt, setGpuAttempt] = useState(0);
  const latestBinsRef = useRef<Float32Array | undefined>(undefined);
  const lastFrameAt = useRef(0);
  const [stalled, setStalled] = useState(false);
  const [displayedGeneration, setDisplayedGeneration] = useState<number>();
  const hasFrame = Boolean(
    session && displayedGeneration === session.sessionGeneration,
  );
  const [state, setState] = useState<GpuState>({
    kind: "checking",
    message: "Requesting a GPU adapter and device…",
  });
  const validGuideCoordinates = hasFrame && guideCoordinates?.generation === session?.sessionGeneration ? guideCoordinates : undefined;
  const guideGapRef = useRef(guideGap);
  guideGapRef.current = guideGap;
  useEffect(() => { renderRef.current(); }, [guideGap]);
  useEffect(() => {
    onStatusChange?.({ kind: state.kind, hasFrame, paused, stalled, renderer });
  }, [state.kind, hasFrame, paused, stalled, renderer, onStatusChange]);
  useEffect(() => {
    const timer = setInterval(() => setStalled(Boolean(session && hasFrame && !paused && performance.now() - lastFrameAt.current > 3_000)), 1_000);
    return () => clearInterval(timer);
  }, [session, hasFrame, paused]);
  const autoScale = () => {
    const bins = latestBinsRef.current;
    const scale = bins && spectrumDisplayScale(bins);
    if (!scale) return;
    floorRef.current = scale.floorDb;
    rangeRef.current = scale.rangeDb;
    setFloorDb(scale.floorDb);
    setRangeDb(scale.rangeDb);
    onDisplaySettingsChange?.(scale);
    renderRef.current();
  };
  const retryGraphics = () => {
    setState({ kind: "checking", message: "Recreating the spectrum display…" });
    setDisplayedGeneration(undefined);
    setFftSize(renderer === "canvas2d" ? FFT_SIZE : requestedFftSize ?? FFT_SIZE);
    setGpuAttempt((attempt) => attempt + 1);
  };
  const labels = useMemo(
    () =>
      session
        ? spectrumEdges(
            session.hardwareCenterFrequencyHz,
            session.actualSampleRateHz,
          ).map(formatFrequency)
        : undefined,
    [session],
  );
  const markerPositionPercent = session
    ? Math.max(
        0,
        Math.min(
          100,
          (0.5 +
            (session.selectedChannelFrequencyHz -
              session.hardwareCenterFrequencyHz) /
              session.actualSampleRateHz) *
            100,
        ),
      )
    : 50;
  const passbandDisplay = useMemo(() => {
    if (!session) return undefined;
    const bands = channelPassbands(session)
      .map((band) => ({
        ...band,
        left: Math.max(
          0,
          Math.min(
            100,
            frequencyPercent(
              band.startFrequencyHz,
              session.hardwareCenterFrequencyHz,
              session.actualSampleRateHz,
            ),
          ),
        ),
        right: Math.max(
          0,
          Math.min(
            100,
            frequencyPercent(
              band.endFrequencyHz,
              session.hardwareCenterFrequencyHz,
              session.actualSampleRateHz,
            ),
          ),
        ),
      }))
      .filter((band) => band.right > band.left)
      .sort((left, right) => left.left - right.left);
    if (!bands.length) return undefined;
    const dimmed: { left: number; right: number }[] = [];
    let cursor = 0;
    for (const band of bands) {
      if (band.left > cursor) dimmed.push({ left: cursor, right: band.left });
      cursor = Math.max(cursor, band.right);
    }
    if (cursor < 100) dimmed.push({ left: cursor, right: 100 });
    const summary =
      session.mode === "AIS"
        ? `AIS 1 / AIS 2 · ${formatPassbandWidth(bands[0]!.endFrequencyHz - bands[0]!.startFrequencyHz)} each`
        : `${session.mode} · ${formatPassbandWidth(bands[0]!.endFrequencyHz - bands[0]!.startFrequencyHz)}${session.mode === "USB" ? " upper sideband" : session.mode === "LSB" ? " lower sideband" : ""}`;
    return { bands, dimmed, summary };
  }, [session]);

  useEffect(() => {
    let disposed = false;
    const size = fftSize;
    let canvasDisplay: CanvasSpectrum | undefined;
    let animationFrame: number | undefined;
    let fft: GpuSpectrum | undefined;
    let gpuTap: GpuAnalysisTap | undefined;
    let detachGpuTap: (() => void) | undefined;
    let gpuFrames = 0;
    let totalLatency = 0;
    let maxLatency = 0;
    let device: GPUDevice | undefined;
    let context: GPUCanvasContext | null = null;
    let spectrumBuffer: GPUBuffer | undefined;
    let historyBuffer: GPUBuffer | undefined;
    let displayBuffer: GPUBuffer | undefined;
    let waterfallPipeline: GPURenderPipeline | undefined;
    let spectrumPipeline: GPURenderPipeline | undefined;
    let markerPipeline: GPURenderPipeline | undefined;
    let bindGroup: GPUBindGroup | undefined;
    let latestFrame: SpectrumFrame | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let gpuFailed = false;
    const renderWhenVisible = () => {
      if (document.visibilityState === "visible") renderRef.current();
    };
    const history = new WaterfallHistory(HISTORY_ROWS, size);
    history.reset(sessionRef.current?.sessionGeneration ?? 0);
    const gapRow = new Float32Array(size).fill(GAP_LEVEL_DB);
    const data = new ArrayBuffer(128);
    const colors = new Float32Array(data, 32);
    const view = new DataView(data);
    let cssWidth = 0;
    let cssHeight = 0;
    let statusAt = -Infinity;
    const shouldUpdateStatus = () => {
      const now = performance.now();
      if (!visibleRef.current || now - statusAt < 250) return false;
      statusAt = now;
      return true;
    };

    const writeDisplay = () => {
      if (!device || !displayBuffer) return;
      const currentSession = sessionRef.current;
      const selected =
        currentSession?.selectedChannelFrequencyHz ??
        latestFrame?.centerFrequencyHz ??
        0;
      const center =
        latestFrame?.centerFrequencyHz ??
        currentSession?.hardwareCenterFrequencyHz ??
        selected;
      const rate =
        latestFrame?.sampleRateHz ?? currentSession?.actualSampleRateHz ?? 1;
      view.setFloat32(
        0,
        Math.max(-1, Math.min(1, (2 * (selected - center)) / rate)),
        true,
      );
      view.setFloat32(4, floorRef.current, true);
      view.setFloat32(8, rangeRef.current, true);
      view.setFloat32(12, cssHeight > 0 ? Math.min(.5, guideGapRef.current / cssHeight) : 0, true);
      view.setUint32(16, history.state.nextWriteRow, true);
      view.setUint32(20, history.state.count, true);
      colors.set(paletteRef.current.uniforms);
      device.queue.writeBuffer(displayBuffer, 0, data);
    };
    const render = () => {
      if (disposed || !visibleRef.current) return;
      if (canvasDisplay) {
        const drawCanvas = () => {
          if (disposed || !visibleRef.current) return;
          try {
            canvasDisplay?.render(
              cssWidth, cssHeight, Math.max(1, window.devicePixelRatio || 1),
              floorRef.current, rangeRef.current, paletteRef.current,
              guideGapRef.current,
            );
          } catch (error) {
            setState({ kind: "error", message: `Canvas2D rendering failed: ${error instanceof Error ? error.message : String(error)}` });
          }
        };
        // Commit the final accepted frame before Pause returns. A pending RAF
        // must not change the frozen plot later or disagree with Auto scale.
        if (pausedRef.current) {
          if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
          animationFrame = undefined;
          drawCanvas();
        } else if (animationFrame === undefined) {
          animationFrame = requestAnimationFrame(() => {
            animationFrame = undefined;
            drawCanvas();
          });
        }
        return;
      }
      const canvas = canvasRef.current;
      if (
        !visibleRef.current ||
        !canvas ||
        !device ||
        !context ||
        !waterfallPipeline ||
        !spectrumPipeline ||
        !markerPipeline ||
        !bindGroup
      )
        return;
      try {
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const width = Math.min(
        Math.max(1, Math.round(cssWidth * ratio)),
        device.limits.maxTextureDimension2D,
      );
      const height = Math.min(
        Math.max(1, Math.round(cssHeight * ratio)),
        device.limits.maxTextureDimension2D,
      );
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      writeDisplay();
      const encoder = device.createCommandEncoder({
        label: "RF spectrum and waterfall commands",
      });
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: paletteRef.current.background[0], g: paletteRef.current.background[1], b: paletteRef.current.background[2], a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setBindGroup(0, bindGroup);
      pass.setPipeline(waterfallPipeline);
      pass.draw(3);
      if (latestFrame) {
        pass.setPipeline(spectrumPipeline);
        pass.draw(size);
        pass.setPipeline(markerPipeline);
        pass.draw(2);
      }
      pass.end();
      device.queue.submit([encoder.finish()]);
      } catch (error) {
        defaultDiagnosticRecorder.record({ area: "graphics", code: "WEBGPU_RENDER_FAILURE", severity: "warning", operation: "render", error });
        fallbackToCanvas(`WebGPU rendering failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    renderRef.current = render;

    const unsubscribe = pipeline.subscribe((frame, frames) => {
      if (disposed || frame.sessionGeneration !== (sessionRef.current?.sessionGeneration ?? 0)) return;
      if (canvasDisplay) {
        if (pausedRef.current) return;
        const accepted = canvasDisplay.accept(frames);
        if (!accepted) return;
        latestBinsRef.current = accepted.bins;
        lastFrameAt.current = performance.now();
        setDisplayedGeneration(accepted.sessionGeneration);
        rememberGuideCoordinates(accepted);
        render();
        if (shouldUpdateStatus()) setState({ kind: "ready", message: `Canvas2D live · ${(accepted.sampleIndex / accepted.sampleRateHz).toFixed(2)} s on source sample clock · ${fallbackReason}` });
        return;
      }
      if (!pausedRef.current) latestBinsRef.current = frame.bins;
      if (
        fft ||
        gpuFailed ||
        !device ||
        !spectrumBuffer ||
        !historyBuffer ||
        frame.bins.length !== size ||
        pausedRef.current
      )
        return;
      latestFrame = frame;
      rememberGuideCoordinates(frame);
      lastFrameAt.current = performance.now();
      setDisplayedGeneration(frame.sessionGeneration);
      device.queue.writeBuffer(spectrumBuffer, 0, frame.bins);
      for (const retainedFrame of frames) {
        for (const row of history.append(retainedFrame)) {
          device.queue.writeBuffer(
            historyBuffer,
            row.row * size * Float32Array.BYTES_PER_ELEMENT,
            row.bins ?? gapRow,
          );
        }
      }
      render();
      if (shouldUpdateStatus())
        setState({
          kind: "ready",
          message:
            frame.droppedFramesBefore > 0
              ? `WebGPU live · ${frame.droppedFramesBefore} display frame(s) skipped and marked in history`
              : `WebGPU live · ${(frame.sampleIndex / frame.sampleRateHz).toFixed(2)} s on source sample clock`,
        });
    });

    async function initialize() {
      const initializationStarted = performance.now();
      const canvas = canvasRef.current;
      if (renderer === "canvas2d") {
        try {
          const { CanvasSpectrum } = await import("./canvasSpectrum");
          if (disposed) return;
          if (!canvas) throw new Error("Spectrum canvas is unavailable.");
          const canvasContext = canvas.getContext("2d", { alpha: false });
          if (!canvasContext) throw new Error("This browser could not create a Canvas2D context.");
          canvasDisplay = new CanvasSpectrum(canvasContext, sessionRef.current?.sessionGeneration ?? 0);
          cssWidth = canvas.clientWidth;
          setDisplayWidth(cssWidth);
          cssHeight = canvas.clientHeight;
          resizeObserver = new ResizeObserver((entries) => {
            const entry = entries.find((item) => item.target === canvas);
            if (entry) {
              cssWidth = entry.contentRect.width;
              setDisplayWidth(cssWidth);
              cssHeight = entry.contentRect.height;
            }
            render();
          });
          resizeObserver.observe(canvas);
          render();
          setState({ kind: "ready", message: `Canvas2D ready · waiting for RF I/Q spectrum frames · ${fallbackReason}` });
        } catch (error) {
          setState({ kind: "error", message: `Canvas2D display unavailable: ${error instanceof Error ? error.message : String(error)}` });
        }
        return;
      }
      if (!canvas || !("gpu" in navigator) || !navigator.gpu) {
        fallbackToCanvas("WebGPU is unavailable.");
        return;
      }
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (disposed) return;
        if (!adapter) {
          fallbackToCanvas("No compatible GPU adapter was found.");
          return;
        }
        device = await adapter.requestDevice();
        if (disposed) {
          device.destroy();
          return;
        }
        const requestedDevice = device;
        void requestedDevice.lost.then((info) => {
          if (disposed || device !== requestedDevice) return;
          releaseGpuResources(false);
          defaultDiagnosticRecorder.record({
            area: "graphics",
            code: "WEBGPU_DEVICE_LOST",
            severity: "error",
            operation: "render",
            safeMessage: info.reason || "unknown",
            autoSubmitEligible: true,
          });
          fallbackToCanvas(`The GPU device was lost (${info.reason || "unknown"}).`);
        });
        device.addEventListener("uncapturederror", onUncapturedError);
        context = canvas.getContext("webgpu") as GPUCanvasContext | null;
        if (!context)
          throw new Error(
            "This browser could not create a WebGPU canvas context.",
          );
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: "opaque" });
        const module = device.createShaderModule({
          code: spectrumShader(size),
          label: "RF spectrum and waterfall shader",
        });
        const compilation = await module.getCompilationInfo();
        if (disposed || gpuFailed || !device) return;
        const shaderErrors = compilation.messages.filter(
          (message) => message.type === "error",
        );
        if (shaderErrors.length)
          throw new Error(
            shaderErrors.map((message) => message.message).join("; "),
          );
        const layout = device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPU_VERTEX_STAGE,
              buffer: { type: "read-only-storage" },
            },
            {
              binding: 1,
              visibility: GPU_FRAGMENT_STAGE,
              buffer: { type: "read-only-storage" },
            },
            {
              binding: 2,
              visibility: GPU_VERTEX_STAGE | GPU_FRAGMENT_STAGE,
              buffer: { type: "uniform" },
            },
          ],
        });
        const pipelineLayout = device.createPipelineLayout({
          bindGroupLayouts: [layout],
        });
        waterfallPipeline = device.createRenderPipeline({
          label: "waterfall pipeline",
          layout: pipelineLayout,
          vertex: { module, entryPoint: "fullscreenVertex" },
          fragment: {
            module,
            entryPoint: "waterfallFragment",
            targets: [{ format }],
          },
        });
        spectrumPipeline = device.createRenderPipeline({
          label: "RF spectrum pipeline",
          layout: pipelineLayout,
          vertex: { module, entryPoint: "spectrumVertex" },
          fragment: {
            module,
            entryPoint: "spectrumFragment",
            targets: [{ format }],
          },
          primitive: { topology: "line-strip" },
        });
        markerPipeline = device.createRenderPipeline({
          label: "selected frequency marker pipeline",
          layout: pipelineLayout,
          vertex: { module, entryPoint: "markerVertex" },
          fragment: {
            module,
            entryPoint: "markerFragment",
            targets: [{ format }],
          },
          primitive: { topology: "line-list" },
        });
        spectrumBuffer = device.createBuffer({
          label: "spectrum levels",
          size: size * 4,
          usage: GPU_BUFFER_STORAGE | GPU_BUFFER_COPY_DST,
        });
        historyBuffer = device.createBuffer({
          label: "circular waterfall power history",
          size: size * HISTORY_ROWS * 4,
          usage: GPU_BUFFER_STORAGE | GPU_BUFFER_COPY_DST,
        });
        displayBuffer = device.createBuffer({
          label: "display controls",
          size: 128,
          usage: GPU_BUFFER_UNIFORM | GPU_BUFFER_COPY_DST,
        });
        device.queue.writeBuffer(
          historyBuffer,
          0,
          new Float32Array(size * HISTORY_ROWS).fill(GAP_LEVEL_DB),
        );
        bindGroup = device.createBindGroup({
          layout,
          entries: [
            { binding: 0, resource: { buffer: spectrumBuffer } },
            { binding: 1, resource: { buffer: historyBuffer } },
            { binding: 2, resource: { buffer: displayBuffer } },
          ],
        });
        if (requestedFftSize && size === requestedFftSize) {
          try {
            fft = await GpuSpectrum.create(device, size);
            if (disposed || gpuFailed) {
              fft.dispose();
              return;
            }
            const startupMs = performance.now() - initializationStarted;
            setFftMessage(
              `Experimental GPU FFT · ${size} bins · ${startupMs.toFixed(2)} ms startup · wall-clock timing (no GPU timestamps)`,
            );
            gpuTap = new GpuAnalysisTap(
              size,
              sessionRef.current?.sessionGeneration ?? 0,
              async (input, frame) => {
                if (
                  pausedRef.current ||
                  disposed ||
                  gpuFailed ||
                  !device ||
                  !fft ||
                  !spectrumBuffer ||
                  !historyBuffer
                )
                  return;
                const started = performance.now();
                const currentDevice = device;
                const encoder = device.createCommandEncoder({
                  label: "FFT upload-compute-history",
                });
                fft.encode(input, encoder);
                latestFrame = frame;
                rememberGuideCoordinates(frame);
                lastFrameAt.current = performance.now();
      setDisplayedGeneration(frame.sessionGeneration);
                encoder.copyBufferToBuffer(
                  fft.output,
                  0,
                  spectrumBuffer,
                  0,
                  size * 4,
                );
                for (const row of history.append(frame)) {
                  if (row.kind === "gap")
                    currentDevice.queue.writeBuffer(
                      historyBuffer,
                      row.row * size * 4,
                      gapRow,
                    );
                  else
                    encoder.copyBufferToBuffer(
                      fft.output,
                      0,
                      historyBuffer,
                      row.row * size * 4,
                      size * 4,
                    );
                }
                currentDevice.queue.submit([encoder.finish()]);
                render();
                await currentDevice.queue.onSubmittedWorkDone();
                if (disposed || gpuFailed) return;
                const latency = performance.now() - started;
                gpuFrames++;
                totalLatency += latency;
                maxLatency = Math.max(maxLatency, latency);
                if (shouldUpdateStatus()) {
                  setFftMessage(
                    `Experimental GPU FFT · ${size} bins · ${startupMs.toFixed(2)} ms startup · upload + compute + render completion, wall clock: ${(totalLatency / gpuFrames).toFixed(2)} ms mean / ${maxLatency.toFixed(2)} ms max · ${gpuFrames} frames · WASM reference also active`,
                  );
                  setState({
                    kind: "ready",
                    message: `WebGPU FFT live · ${(frame.sampleIndex / frame.sampleRateHz).toFixed(2)} s source clock · ${frame.droppedFramesBefore} skipped input/gap event(s)`,
                  });
                }
              },
              (error) => disableFft(error),
            );
            detachGpuTap = pipeline.attachGpuTap(
              (block) => gpuTap?.accept(block),
              (block) => gpuTap?.accept(block),
            );
          } catch (error) {
            disableFft(error);
          }
        }
        cssWidth = canvas.clientWidth;
        setDisplayWidth(cssWidth);
        cssHeight = canvas.clientHeight;
        resizeObserver = new ResizeObserver((entries) => {
          const entry = entries.find((item) => item.target === canvas);
          if (entry) {
            cssWidth = entry.contentRect.width;
            setDisplayWidth(cssWidth);
            cssHeight = entry.contentRect.height;
          }
          render();
        });
        resizeObserver.observe(canvas);
        document.addEventListener("visibilitychange", renderWhenVisible);
        render();
        if (gpuFailed || disposed) return;
        setState({
          kind: "ready",
          message: "WebGPU ready · waiting for RF I/Q spectrum frames",
        });
      } catch (error) {
        if (!disposed) {
          releaseGpuResources(true);
          defaultDiagnosticRecorder.record({
            area: "graphics",
            code: "WEBGPU_INITIALIZATION_FAILURE",
            severity: "warning",
            operation: "initialize",
            error,
          });
          fallbackToCanvas(`WebGPU initialization failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    void initialize();
    return () => {
      disposed = true;
      renderRef.current = () => undefined;
      unsubscribe();
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      releaseGpuResources(true);
    };
    function fallbackToCanvas(reason: string): void {
      if (disposed) return;
      releaseGpuResources(true);
      setFallbackReason(reason);
      setRenderer("canvas2d");
      setFftSize(FFT_SIZE);
      latestBinsRef.current = undefined;
      setDisplayedGeneration(undefined);
      setState({ kind: "checking", message: "Preparing Canvas2D spectrum display…" });
      if (requestedFftSize) setFftMessage("Experimental GPU FFT unavailable; using CPU/WASM spectrum frames.");
    }
    function disableFft(error: unknown): void {
      if (disposed || gpuFailed) return;
      gpuTap?.dispose();
      detachGpuTap?.();
      fft?.dispose();
      fft = undefined;
      history.reset(sessionRef.current?.sessionGeneration ?? 0);
      latestFrame = undefined;
      setFftMessage(
        `Experimental GPU FFT disabled: ${error instanceof Error ? error.message : String(error)}. Using CPU/WASM spectrum.`,
      );
      if (size !== FFT_SIZE) setFftSize(FFT_SIZE);
    }
    function onUncapturedError(event: GPUUncapturedErrorEvent): void {
      if (!disposed) {
        releaseGpuResources(true);
        defaultDiagnosticRecorder.record({
          area: "graphics",
          code: "WEBGPU_UNCAPTURED_ERROR",
          severity: "error",
          operation: "render",
          error: event.error,
          autoSubmitEligible: true,
        });
        fallbackToCanvas(`WebGPU rendering error: ${event.error.message}`);
      }
    }
    function releaseGpuResources(destroyDevice: boolean): void {
      gpuFailed = true;
      gpuTap?.dispose();
      detachGpuTap?.();
      fft?.dispose();
      fft = undefined;
      if (requestedFftSize && !disposed)
        setFftMessage(
          "Experimental GPU FFT disabled with graphics; CPU/WASM analysis continues. Retry graphics to recover.",
        );
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      document.removeEventListener("visibilitychange", renderWhenVisible);
      const currentDevice = device;
      currentDevice?.removeEventListener("uncapturederror", onUncapturedError);
      spectrumBuffer?.destroy();
      historyBuffer?.destroy();
      displayBuffer?.destroy();
      context?.unconfigure();
      if (destroyDevice) currentDevice?.destroy();
      spectrumBuffer = undefined;
      historyBuffer = undefined;
      displayBuffer = undefined;
      waterfallPipeline = undefined;
      spectrumPipeline = undefined;
      markerPipeline = undefined;
      bindGroup = undefined;
      context = null;
      device = undefined;
    }
  }, [
    gpuAttempt,
    renderer,
    fallbackReason,
    pipeline,
    requestedFftSize,
    session?.sessionGeneration,
    fftSize,
  ]);

  const tuneFromClick = (event: MouseEvent<HTMLCanvasElement>) => {
    if (!session || !onTune) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const frequency = frequencyForPixel(
      event.clientX - bounds.left,
      bounds.width,
      session.hardwareCenterFrequencyHz,
      session.actualSampleRateHz,
    );
    // Use exactly the keyboard-tuning path: source/backend validates the span.
    onTune(frequency);
  };
  const updatePaused = () => {
    pausedRef.current = !paused;
    setPaused(!paused);
    renderRef.current();
  };

  return (
    <section className="graphics-panel" aria-labelledby="graphics-heading">
      <div className="panel-heading spectrum-heading">
        <div className="stage-heading">
          <span aria-hidden="true">02</span>
          <div>
            <p>Analyze</p>
            <h2 id="graphics-heading">Spectrum & waterfall</h2>
          </div>
        </div>
        <span className={`status-pill status-${state.kind}`}>{state.kind}</span>
      </div>
      <div className="spectrum-display">
        <div
          className="spectrum-toolbar"
          aria-label="Spectrum and receiver controls"
        >
          <div className="spectrum-display-tools">
            <div className="spectrum-actions">
              <ActionButton
                type="button"
                className="secondary display-action"
                icon="sliders"
                title="Fit the current spectrum without changing receiver gain"
                disabled={!hasFrame || state.kind !== "ready"}
                disabledReason={state.kind !== "ready" ? "The spectrum display must be available first. Check diagnostics or retry graphics." : "Start reception and wait for spectrum samples."}
                onClick={autoScale}
              >
                Auto scale
              </ActionButton>
              <ActionButton
                type="button"
                className="secondary display-action display-pause"
                icon={paused ? "play" : "pause"}
                disabledLabel={paused ? "Resume display" : "Pause display"}
                aria-pressed={paused}
                disabled={state.kind !== "ready" || (!hasFrame && !paused)}
                disabledReason={state.kind !== "ready" ? "The spectrum display must be available first. Check diagnostics or retry graphics." : "Start reception and wait for spectrum samples."}
                onClick={updatePaused}
              >
                {paused ? "Resume display" : "Pause display"}
              </ActionButton>
            </div>
          <Suspense fallback={null}><BandGuideFeature canvas={canvasRef} width={displayWidth}
            coordinates={validGuideCoordinates} selectedHz={session?.selectedChannelFrequencyHz ?? 0}
            onHeightChange={setGuideGap} /></Suspense>
          </div>
          {tuningControls}
        </div>
        <div className={`canvas-frame${guideGap > 0 ? " has-band-guide" : ""}`} style={{"--band-guide-height":`${guideGap}px`} as CSSProperties}>
          <canvas
            key={renderer}
            ref={canvasRef}
            width={960}
            height={560}
            aria-label={`${renderer === "canvas2d" ? "Canvas2D" : "WebGPU"} RF spectrum and waterfall plot; click to tune`}
            onClick={tuneFromClick}
          />
          {(state.kind !== "ready" || !hasFrame) && (
            <div className="plot-state" role="status">
              <strong>
                {state.kind === "error" || state.kind === "unsupported"
                  ? "Spectrum display unavailable"
                  : state.kind === "checking"
                    ? "Preparing spectrum display…"
                    : !session
                      ? "Start receiving to see the spectrum"
                      : "Waiting for signal samples…"}
              </strong>
              <p>
                {state.kind === "error" || state.kind === "unsupported"
                  ? state.message
                  : !session
                    ? "Connect a receiver or choose the synthetic demo in Acquire."
                    : "The spectrum will appear when samples reach the display."}
              </p>
              <div>
                {(state.kind === "error" || state.kind === "unsupported") && (
                  <button
                    type="button"
                    className="secondary retry-graphics"
                    onClick={retryGraphics}
                  >
                    Retry graphics
                  </button>
                )}
                {(state.kind === "error" || state.kind === "unsupported") &&
                  onOpenDiagnostics && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={onOpenDiagnostics}
                    >
                      Check diagnostics
                    </button>
                  )}
                {!session && onOpenAcquire && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={onOpenAcquire}
                  >
                    Go to Acquire
                  </button>
                )}
              </div>
            </div>
          )}
          {passbandDisplay && hasFrame && state.kind === "ready" ? (
            <>
              <span className="receiver-center-line" aria-hidden="true" />
              <div className="passband-layer" aria-hidden="true">
                {passbandDisplay.dimmed.map((segment, index) => (
                  <span
                    key={`dim-${index}`}
                    className="passband-dim"
                    style={{
                      left: `${segment.left}%`,
                      width: `${segment.right - segment.left}%`,
                    }}
                  />
                ))}
                {passbandDisplay.bands.map((band) => (
                  <span
                    key={band.label}
                    className="passband-band"
                    style={{
                      left: `${band.left}%`,
                      width: `${band.right - band.left}%`,
                    }}
                  />
                ))}
              </div>
              <span
                className="selected-frequency-line"
                aria-hidden="true"
                style={{ left: `${markerPositionPercent}%` }}
              />
              <span className="passband-legend">
                Channel passband · {passbandDisplay.summary}
              </span>
            </>
          ) : null}
          <span className="plot-label spectrum-label">Spectrum</span>

          <span className="plot-label waterfall-label">
            Waterfall · newest at top
          </span>
          {paused ? (
            <span className="paused-label">
              Display paused · receiver still running
            </span>
          ) : null}
          {labels ? (
            <div className="frequency-rule" aria-hidden="true">
              <span>{labels[0]}</span>
              <span>{labels[1]}</span>
              <span>{labels[2]}</span>
            </div>
          ) : null}
          {session ? (
            <span
              className="marker-label"
              style={{ left: `clamp(80px, ${markerPositionPercent}%, calc(100% - 80px))` }}
            >
              Channel {formatFrequency(session.selectedChannelFrequencyHz)}
            </span>
          ) : null}
          <div className="plot-metadata">
            <span className="display-units">Relative dB · not dBm</span>
            {session && (
              <small className="receiver-offset">
                Channel offset{" "}
                {session.selectedChannelFrequencyHz - session.hardwareCenterFrequencyHz >= 0 ? "+" : ""}
                {((session.selectedChannelFrequencyHz - session.hardwareCenterFrequencyHz) / 1_000).toFixed(3)}{" "}
                kHz
              </small>
            )}
          </div>
          <SpectrumInfo>
            <p className="diagnostic-message">{state.message}</p>
            {fftMessage && <p className="display-note">{fftMessage}</p>}
            {renderer === "canvas2d" && <p className="display-note">Compatibility display · CPU/WASM analysis · peak-preserving 1024-column waterfall.</p>}
            <p className="display-note">
              {fftSize}-point Hann FFT ·{" "}
              {renderer === "webgpu" && requestedFftSize ? "4-frame power average" : "~40 ms power average"}{" "}
              · circular 240-row sample-clock history · relative dB (not dBm) ·
              click plot to retune · background tabs may resume with marked gaps
            </p>
          </SpectrumInfo>
        </div>
      </div>
      <details className="display-settings">
        <summary>Display settings</summary>
        <div className="display-controls">
          <label>
            Display renderer
            <select aria-label="Display renderer" value={renderer} onChange={(event) => {
              const next = event.currentTarget.value as "webgpu" | "canvas2d";
              setRenderer(next);
              setFallbackReason(next === "canvas2d" ? "Compatibility display selected." : "");
              setFftSize(next === "canvas2d" ? FFT_SIZE : requestedFftSize ?? FFT_SIZE);
              setDisplayedGeneration(undefined);
              latestBinsRef.current = undefined;
              setState({ kind: "checking", message: "Preparing spectrum display…" });
              setFftMessage(next === "canvas2d" && requestedFftSize ? "Experimental GPU FFT unavailable; using CPU/WASM spectrum frames." : "");
              setGpuAttempt(attempt => attempt + 1);
            }}>
              <option value="webgpu">WebGPU (automatic fallback)</option>
              <option value="canvas2d">Compatibility (Canvas2D)</option>
            </select>
          </label>
          <label>
            Floor <output>{floorDb} dB</output>
            <input
              type="range"
              aria-label="Spectrum floor"
              min="-120"
              max="-30"
              step="1"
              value={floorDb}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                floorRef.current = value;
                setFloorDb(value);
                onDisplaySettingsChange?.({ floorDb: value, rangeDb });
                renderRef.current();
              }}
            />
          </label>
          <label>
            Range <output>{rangeDb} dB</output>
            <input
              type="range"
              aria-label="Spectrum range"
              min="20"
              max="120"
              step="1"
              value={rangeDb}
              onChange={(event) => {
                const value = event.currentTarget.valueAsNumber;
                rangeRef.current = value;
                setRangeDb(value);
                onDisplaySettingsChange?.({ floorDb, rangeDb: value });
                renderRef.current();
              }}
            />
          </label>
        </div>
        <small>
          Auto scale fits the current spectrum. Display changes do not affect
          receiver gain.
        </small>
      </details>
    </section>
  );
}
