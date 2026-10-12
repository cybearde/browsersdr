import { PacketDecodePanel } from "./ui/PacketDecodePanel";
import { ReceiverLocationPanel, useReceiverLocation } from "./ui/ReceiverLocationPanel";
import { ReceiverWorkspace, ReceiverSourceOptions } from "./ui/ReceiverWorkspace";
import { RemoteReceiver } from "./ui/RemoteReceiver";
import { RemotePresetSharePanel } from "./ui/RemotePresetSharePanel";
import { hasRemoteShare, type RemotePreset } from "./remote/remotePresets";
import { SettingsSharePanel } from "./ui/SettingsSharePanel";
import { hasSettingsShare, SETTINGS_SHARE_SCHEMA, sharedSettingsBookmark, type SharedSettings, type SharedDisplay } from "./radio/settingsShare";
import { FavoritesPanel, useFavorites } from "./ui/FavoritesPanel";
import { useWorkspaceLayout, WorkspaceControls } from "./ui/WorkspaceLayout";
import { bookmarkFromCandidate, validateBookmark, type Bookmark } from "./radio/bookmarks";
import { applyBookmark } from "./radio/bookmarkSelection";
import { SearchOverlay } from "./ui/SearchOverlay";
import { previewDiscovery } from "./radio/discoverySelection";
import { applyReceptionCandidate } from "./radio/atlasStationSelection";
import { ReceiverTuningControl } from "./ui/ReceiverTuningControl";
import { editableFrequencyMHz, formatFrequencyMHz, formatSampleRate } from "./ui/frequencyFormat";
import { ActionButton } from "./ui/ActionButton";
import { flushSync } from "react-dom";
import { CenterSignalControl } from "./ui/CenterSignalControl";
import { operatingSystem, usbAvailability, type OperatingSystem } from "./platform/browserEnvironment";
import { ConnectionReadiness, ReceiverRecovery } from "./ui/ReceiverConnectionHelp";
import { planChannelCapture } from "./radio/channelRecording";
import { BLADERF_SC16_RECORDING_FORMAT } from "./radio/bladerfRecording";
import { DEFAULT_BLADERF_RX_SETTINGS, BLADERF_GAIN_MODES, type BladeRfRxSettings } from "./radio/bladerfSettings";
import { BladeRfControls } from "./ui/BladeRfControls";
import { usePageVisible } from "./ui/usePageVisible";
import { PositionMap } from "./ui/PositionMap";
import { SetupFileRow } from "./ui/SetupFileRow";
import { DabStationControl, FmStationSummary } from "./ui/ChannelProgramme";
import { ReceiverHealth } from "./ui/ReceiverHealth";
import { AppIcon } from "./ui/AppIcon";
import { ReceiverStatus } from "./ui/ReceiverStatus";
import { DabMetadata } from "./ui/DabMetadata";
import { SOURCE_RECORDING_DESCRIPTIONS, isWidebandRate } from "./radio/sourceCapabilities";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  AnalysisPipeline,
  type AnalysisDiagnostics,
} from "./dsp/analysisPipeline";
import {
  WebGpuSpectrum,
  type SpectrumDisplayStatus,
} from "./graphics/WebGpuSpectrum";
import { SpectrumExplorer } from "./ui/SpectrumExplorer";
import {
  ReceiverController,
  type ReceiverSnapshot,
} from "./radio/receiverController";
import { createHackrfBackend } from "./radio/hackrfBackend";
import { createBladeRfBackend } from "./radio/bladerfBackend";
import { createUsrpb205Backend } from "./radio/usrpB205Backend";
import { createUsrpB205WorkerSession } from "./radio/usrpB205WorkerSession";
import {
  createLocalUsrpB205NoOsDriver,
  localUsrpB205NoOsDriverAvailable,
} from "./radio/usrpB205LocalNoOsDriver";
import { HACKRF_USB_FILTER } from "./radio/hackrfProtocol";
import { BLADERF_USB_FILTER } from "./radio/bladerfProtocol";
import { USRP_B205_USB_FILTER } from "./radio/usrpB205Fx3";
import {
  BLADERF_HOSTED_IMAGES,
  importBladeRfImage,
  selectBladeRfImage,
  storedBladeRfImages,
  type BladeRfHostedImage,
} from "./radio/bladerfImages";
import { bladeRfModelLabel } from "./radio/bladerfModels";
import {
  USRP_B205_IMAGE,
  importUsrpB205Image,
  loadStoredUsrpB205Image,
  type VerifiedUsrpB205Image,
} from "./radio/usrpB205Images";
import {
  USRP_B205_FIRMWARE,
  importUsrpB205Firmware,
  loadStoredUsrpB205Firmware,
  type VerifiedUsrpB205Firmware,
} from "./radio/usrpB205Firmware";
import {
  sourceCapabilities,
  validateSourceFrequency,
  DEFAULT_HACKRF_RX_SETTINGS,
  type HackrfRxSettings,
} from "./radio/sourceCapabilities";
import {
  DEFAULT_USRP_B205_RX_SETTINGS,
  type UsrpB205RxSettings,
} from "./radio/usrpB205Capabilities";
import {
  compatibleSourceRate,
  loadSourcePreferences,
  saveSourcePreferences,
  sourceModeUnavailableReason,
  loadSourceSelection,
} from "./radio/sourcePreferences";
import { createRtlSdrBackend } from "./radio/rtlSdrBackend";
import { SyntheticBackend } from "./radio/syntheticBackend";
import { ReplayBackend } from "./radio/replayBackend";
import type { SourceKind } from "./radio/types";
import {
  parseRecording,
  preferredRecordingStorageMode,
  recordingCapacitySeconds,
  recordingRoutingSampleRate,
  RECORDING_MAX_BYTES,
  RECORDING_METADATA_MAX_BYTES,
  type IqRecording,
  type RecordingStatus,
} from "./radio/iqRecording";
import { cleanupAbandonedRecordings, prepareRecordingStorage, STREAMING_RECORDING_MAX_BYTES } from "./radio/recordingSpool";
import {
  formatControlDisabled,
  RecordingExportCoordinator,
  RecordingFormatLatch,
  RECORDING_ARCHIVE_INPUT_MAX_BYTES,
  RETAINED_CAPTURE_MAX_BYTES,
  type RecordingDownloadKind,
  type RecordingExportFormat,
  type PreparedRecordingExport,
  type RecordingRetentionSnapshot,
  type RetainRecordingResult,
} from "./radio/recordingExport";
import { createDeterministicRecordingFixture } from "./testing/recordingFixture";
import { importSigmfRecording } from "./radio/sigmfImport";
import {
  CW_FILTER_BANDWIDTHS_HZ,
  CW_TONE_MAX_HZ,
  CW_TONE_MIN_HZ,
  defaultModeSettings,
  MANUAL_GAIN_MAX_DB,
  modeCapabilities,
  normalizeModeSettings,
  RECEIVER_MODES,
  type ReceiverMode,
  type ReceiverModeSettings,
} from "./radio/receiverConfig";
import type { SurveyCandidateRecord, SurveyProfile } from "./radio/fieldSurvey";
import { DAB_BAND_III_CHANNELS, dabChannelAt } from "./dab/channels";
import { ADSB_FREQUENCY_HZ } from "./adsb/adsbReceiver";
import { AIS_CENTER_FREQUENCY_HZ } from "./ais/aisReceiver";
import { probeDabPlusAudioSupport } from "./dab/dabAudio";
import { browserTestConfig } from "./testing/browserTestBridge";
import { defaultDiagnosticRecorder } from "./diagnostics/diagnosticRecorder";
import { defaultSrdModeSettings, type SrdModeSettings } from "./srd/settings";
import {
  DiagnosticReportCard,
  OPEN_DIAGNOSTIC_REPORT_EVENT,
} from "./ui/DiagnosticReportCard";
import { CompatibilityReportCard } from "./ui/CompatibilityReportCard";
import { AboutPage } from "./ui/AboutPage";
import { CaptureCandidateLatch, readReceptionCandidate, type ReceptionCandidate } from "./radio/receptionEvidence";
import { AtlasRecoveryPanel } from "./ui/AtlasRecoveryPanel";
import { AtlasSavePanel } from "./ui/AtlasSavePanel";
import { AtlasSettingsPanel } from "./ui/AtlasSettingsPanel";
import { getAtlasConnection } from "./radio/atlasConnection";
import type { CompatibilityReportContext } from "./diagnostics/compatibilityTypes";

interface Capability {
  label: string;
  available: boolean | null;
  detail: string;
}

const VOLUME_KEY = "browsersdr.volume";
const DEFAULT_VOLUME = 0.65;
const preferenceStorage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
};
type AppView = "remote" | "receiver" | "explorer" | "settings" | "diagnostics" | "help" | "about";
type ReceiverDockView = "decode" | "capture" | "session";
type CompatibilityDetailView = "modes" | "recording" | "browsers";
type ReplayImportFormat = "browsersdr" | "sigmf";

type CompatibilityStatus =
  "validated" | "available" | "experimental" | "unclear" | "unsupported";

interface CompatibilityCellData {
  status: CompatibilityStatus;
  evidence: string;
}

interface CompatibilityDetailData {
  label: string;
  columns: string[];
  rows: Array<{
    label: string;
    cells: CompatibilityCellData[];
  }>;
  note: string;
}

const COMPATIBILITY_STATUS_LABELS: Record<CompatibilityStatus, string> = {
  validated: "Validated",
  available: "Available",
  experimental: "Experimental",
  unclear: "Unclear",
  unsupported: "Unsupported",
};

const COMPATIBILITY_DETAILS: Record<
  CompatibilityDetailView,
  CompatibilityDetailData
> = {
  modes: {
    label: "Modes",
    columns: [
      "RTL-SDR",
      "HackRF Pro",
      "bladeRF 2.0 Micro (xA4 validated)",
      "USRP B205-mini",
      "Replay",
    ],
    rows: [
      {
        label: "Spectrum only (OFF)",
        cells: [
          { status: "validated", evidence: "Live WebGPU spectrum" },
          { status: "validated", evidence: "4.8 and 9.6 MS/s live paths" },
          { status: "available", evidence: "Initial physical reception only" },
          {
            status: "available",
            evidence: "Mocked RX path; hardware proof pending",
          },
          { status: "validated", evidence: "Capture span only; no retuning" },
        ],
      },
      {
        label: "WBFM audio + RDS",
        cells: [
          { status: "validated", evidence: "Physical FM, audio and RDS" },
          { status: "validated", evidence: "Physical reception and RDS" },
          {
            status: "available",
            evidence: "Decoder implemented; live proof pending",
          },
          {
            status: "available",
            evidence: "Decoder implemented; live proof pending",
          },
          { status: "validated", evidence: "Deterministic replay coverage" },
        ],
      },
      {
        label: "AM, NBFM, USB, LSB + CW",
        cells: [
          {
            status: "available",
            evidence: "DSP covered; live-air matrix pending",
          },
          {
            status: "available",
            evidence: "DSP covered; live-air matrix pending",
          },
          {
            status: "available",
            evidence: "DSP covered; live-air matrix pending",
          },
          {
            status: "available",
            evidence: "DSP covered; live-air matrix pending",
          },
          { status: "validated", evidence: "Deterministic decoder tests" },
        ],
      },
      {
        label: "DAB / DAB+",
        cells: [
          {
            status: "available",
            evidence: "Decoder covered; live ensemble pending",
          },
          {
            status: "available",
            evidence: "Decoder covered; live ensemble pending",
          },
          { status: "available", evidence: "Compatible sample rate required" },
          {
            status: "available",
            evidence: "4.8 MS/s capture; 2.4 MS/s channel",
          },
          { status: "available", evidence: "Compatible sample rate required" },
        ],
      },
      {
        label: "ADS-B, AIS + SRD",
        cells: [
          {
            status: "available",
            evidence: "Decoder fixtures; live RF pending",
          },
          {
            status: "available",
            evidence: "Decoder fixtures; live RF pending",
          },
          {
            status: "available",
            evidence: "Decoder fixtures; live RF pending",
          },
          {
            status: "available",
            evidence: "Decoder fixtures; live RF pending",
          },
          {
            status: "validated",
            evidence: "Deterministic routing and fixtures",
          },
        ],
      },
      {
        label: "Explorer surveys",
        cells: [
          {
            status: "available",
            evidence: "Retune workflow; field survey pending",
          },
          {
            status: "available",
            evidence: "Retune workflow; field survey pending",
          },
          {
            status: "available",
            evidence: "Retune workflow; field survey pending",
          },
          {
            status: "available",
            evidence: "Retune workflow; field survey pending",
          },
          { status: "unsupported", evidence: "A recording cannot retune" },
        ],
      },
      {
        label: "19.2 MS/s wideband",
        cells: [
          { status: "unsupported", evidence: "Profile tops out at 4.8 MS/s" },
          {
            status: "experimental",
            evidence: "Offered with performance warnings",
          },
          {
            status: "experimental",
            evidence: "Offered with performance warnings",
          },
          { status: "experimental", evidence: "9.6 and 19.2 MS/s require hardware validation" },
          {
            status: "available",
            evidence: "Depends on recording rate and browser",
          },
        ],
      },
    ],
    note: "Mode availability also depends on frequency range, sample rate and a signal suitable for the selected decoder.",
  },
  recording: {
    label: "Recording & export",
    columns: [
      "RTL-SDR",
      "HackRF Pro",
      "bladeRF 2.0 Micro (xA4 validated)",
      "USRP B205-mini",
      "Synthetic demo",
    ],
    rows: [
      {
        label: "Native I/Q capture",
        cells: [
          { status: "validated", evidence: "CU8 samples" },
          { status: "validated", evidence: "CI8 samples" },
          {
            status: "available",
            evidence: SOURCE_RECORDING_DESCRIPTIONS.bladerf,
          },
          { status: "validated", evidence: SOURCE_RECORDING_DESCRIPTIONS["usrp-b205"] },
          { status: "available", evidence: "Quantized CU8 samples" },
        ],
      },
      {
        label: "BrowserSDR data + metadata",
        cells: [
          { status: "validated", evidence: "Export and replay covered" },
          { status: "validated", evidence: "Export and replay covered" },
          { status: "unsupported", evidence: "SigMF export only" },
          { status: "unsupported", evidence: "SigMF export only" },
          { status: "available", evidence: "Local export path" },
        ],
      },
      {
        label: "SigMF data + metadata",
        cells: [
          {
            status: "validated",
            evidence: "Schema, export and import covered",
          },
          {
            status: "validated",
            evidence: "Schema, export and import covered",
          },
          { status: "available", evidence: SOURCE_RECORDING_DESCRIPTIONS.bladerf },
          {
            status: "validated",
            evidence: SOURCE_RECORDING_DESCRIPTIONS["usrp-b205"],
          },
          { status: "available", evidence: "Local export path" },
        ],
      },
      {
        label: "ZIP or separate downloads",
        cells: [
          { status: "validated", evidence: "Both delivery paths covered" },
          { status: "validated", evidence: "Both delivery paths covered" },
          { status: "available", evidence: "ZIP up to 32 MiB; separate files above" },
          { status: "available", evidence: "ZIP up to 32 MiB; separate files above" },
          {
            status: "available",
            evidence: "Browser download behavior applies",
          },
        ],
      },
      {
        label: "Explorer JSON / CSV manifest",
        cells: [
          { status: "available", evidence: "Survey metadata only" },
          { status: "available", evidence: "Survey metadata only" },
          { status: "available", evidence: "Survey metadata only" },
          { status: "available", evidence: "Survey metadata identifies USRP" },
          { status: "available", evidence: "Survey metadata only" },
        ],
      },
    ],
    note: "I/Q capture streams to private browser storage when available, with a bounded-memory fallback. A successful download request does not guarantee that the browser or operating system saved the file.",
  },
  browsers: {
    label: "Browsers",
    columns: ["SDR hardware", "Demo + replay", "WebGPU spectrum"],
    rows: [
      {
        label: "Chrome · desktop",
        cells: [
          { status: "validated", evidence: "WebUSB tested" },
          { status: "validated", evidence: "Primary browser test target" },
          { status: "validated", evidence: "Compatible GPU required" },
        ],
      },
      {
        label: "Edge / Chromium · desktop",
        cells: [
          {
            status: "unclear",
            evidence: "APIs plausible; direct evidence pending",
          },
          {
            status: "unclear",
            evidence: "Not in the validated browser matrix",
          },
          { status: "unclear", evidence: "GPU and driver dependent" },
        ],
      },
      {
        label: "Firefox · desktop",
        cells: [
          {
            status: "unsupported",
            evidence: "Required WebUSB path is unavailable",
          },
          { status: "unclear", evidence: "No supported-browser validation" },
          { status: "unclear", evidence: "Environment dependent" },
        ],
      },
      {
        label: "Safari · desktop",
        cells: [
          {
            status: "unsupported",
            evidence: "Required WebUSB path is unavailable",
          },
          { status: "unclear", evidence: "No supported-browser validation" },
          { status: "unclear", evidence: "Environment dependent" },
        ],
      },
      {
        label: "Mobile browsers",
        cells: [
          {
            status: "unsupported",
            evidence: "Hardware workflow is desktop-only",
          },
          {
            status: "unclear",
            evidence: "Layout adapts; runtime is unvalidated",
          },
          {
            status: "unclear",
            evidence: "GPU, memory and thermal limits vary",
          },
        ],
      },
    ],
    note: "Hardware access requires HTTPS or localhost, user-granted device permission and exclusive access. BrowserSDR does not treat API availability alone as validation.",
  },
};

const RTL_USB_FILTERS = [
  { vendorId: 0x0bda, productId: 0x2832 },
  { vendorId: 0x0bda, productId: 0x2838 },
] as const;

export function usbDeviceMatchesSource(
  device: USBDevice,
  source: SourceKind,
): boolean {
  const filters =
    source === "hackrf"
      ? [HACKRF_USB_FILTER]
      : source === "bladerf"
        ? [BLADERF_USB_FILTER]
        : source === "usrp-b205"
          ? [USRP_B205_USB_FILTER]
          : source === "rtl-sdr"
            ? RTL_USB_FILTERS
            : [];
  return filters.some(
    (filter) =>
      device.vendorId === filter.vendorId &&
      device.productId === filter.productId,
  );
}

function isUsrpb205RuntimeDescriptor(device: USBDevice): boolean {
  return (
    device.configurations?.some(
      (configuration) =>
        configuration.configurationValue === 1 &&
        configuration.interfaces.length === 5 &&
        configuration.interfaces.every(
          (item, index) => item.interfaceNumber === index,
        ),
    ) ?? false
  );
}

export function selectAuthorizedUsbDevice(
  devices: readonly USBDevice[],
  source: SourceKind,
): USBDevice | undefined {
  const matches = devices.filter((candidate) =>
    usbDeviceMatchesSource(candidate, source),
  );
  if (source === "usrp-b205") {
    return matches.find(isUsrpb205RuntimeDescriptor) ?? matches[0];
  }
  return matches[0];
}

function selectedSigmfModeSettings(mode: ReceiverMode | "") {
  if (!mode) throw new Error("Choose a replay mode for the SigMF capture.");
  return defaultModeSettings(mode);
}

export function waitForCaptureDelay(
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Candidate capture cancelled", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export async function waitForRecordingCompletion(
  controller: Pick<ReceiverController, "getSnapshot" | "getRecordingStatus">,
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  let elapsed = 0;
  while (elapsed < ms) {
    const slice = Math.min(100, ms - elapsed);
    await waitForCaptureDelay(slice, signal);
    elapsed += slice;
    const lifecycle = controller.getSnapshot().lifecycle;
    const status = controller.getRecordingStatus();
    if (
      !status ||
      status.state === "capacity-reached" ||
      !["running", "tuning"].includes(lifecycle)
    )
      return;
  }
}

interface AppRuntime {
  analysis: AnalysisPipeline;
  controller: ReceiverController;
  replayRef: { current: IqRecording | undefined };
  usrpImageRef?: { current: VerifiedUsrpB205Image | undefined };
  usrpFirmwareRef?: { current: VerifiedUsrpB205Firmware | undefined };
}

interface AppResourceOwnerProps {
  createAnalysis?: () => AnalysisPipeline;
  children: (runtime: AppRuntime) => ReactNode;
}

const SquelchControl = memo(function SquelchControl({
  controller,
  squelch,
  disabled,
  running,
  onChange,
}: {
  controller: ReceiverController;
  squelch: number;
  disabled: boolean;
  running: boolean;
  onChange: (value: number) => void;
}) {
  const meter = useSyncExternalStore(
    controller.subscribeSquelchMeter,
    controller.getSquelchMeterSnapshot,
    controller.getSquelchMeterSnapshot,
  );
  const [autoStatus, setAutoStatus] = useState<
    "idle" | "measuring" | "set" | "unavailable"
  >("idle");
  const autoSamples = useRef<number[]>([]);
  const autoTimer = useRef<number | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (autoStatus !== "measuring") return;
    return controller.subscribeSquelchMeter(() => {
      const sample = controller.getSquelchMeterSnapshot();
      if (sample) autoSamples.current.push(sample.level);
    });
  }, [autoStatus, controller]);
  useEffect(
    () => () => {
      if (autoTimer.current !== undefined)
        window.clearTimeout(autoTimer.current);
    },
    [],
  );

  const autoSet = () => {
    if (autoTimer.current !== undefined) window.clearTimeout(autoTimer.current);
    const current = controller.getSquelchMeterSnapshot();
    autoSamples.current = current ? [current.level] : [];
    setAutoStatus("measuring");
    autoTimer.current = window.setTimeout(() => {
      autoTimer.current = undefined;
      const samples = [...autoSamples.current].sort((a, b) => a - b);
      if (samples.length === 0) {
        setAutoStatus("unavailable");
        return;
      }
      const noise = samples[Math.floor((samples.length - 1) * 0.95)] ?? 0;
      const threshold = Math.min(
        6,
        Math.max(0.1, Math.round((noise + 0.2) * 10) / 10),
      );
      onChangeRef.current(threshold);
      setAutoStatus("set");
    }, 2_000);
  };

  return (
    <div className="squelch-control">
      <div className="squelch-heading">
        <span>
          Squelch <output>{squelch.toFixed(1)}</output>
        </span>
        <span
          className={`squelch-state ${meter?.open ? "is-open" : "is-muted"}`}
        >
          {meter?.open ? "Audio open" : "Muted"}
        </span>
      </div>
      <div className="squelch-meter-control">
        <div
          className="squelch-meter"
          role="meter"
          aria-label="Current channel quality"
          aria-valuemin={0}
          aria-valuemax={6}
          aria-valuenow={meter?.level ?? 0}
        >
          <span
            className="squelch-meter-level"
            style={{
              width: `${Math.min(100, ((meter?.level ?? 0) / 6) * 100)}%`,
            }}
          />
          <span
            className="squelch-meter-peak"
            style={{
              left: `${Math.min(100, ((meter?.peak ?? 0) / 6) * 100)}%`,
            }}
          />
        </div>
        <span
          className="squelch-meter-threshold"
          style={{ left: `${(squelch / 6) * 100}%` }}
        />
        <input
          className="squelch-meter-input"
          type="range"
          aria-label="Squelch"
          min="0"
          max="6"
          step="0.1"
          value={squelch}
          disabled={disabled}
          onChange={(event) => {
            setAutoStatus("idle");
            onChange(event.currentTarget.valueAsNumber);
          }}
        />
      </div>
      <div className="squelch-meter-scale" aria-hidden="true">
        <span>Open</span>
        <span>Strong signals only</span>
      </div>
      <div className="squelch-auto-row">
        <button
          type="button"
          className="secondary"
          disabled={!running || disabled || autoStatus === "measuring"}
          onClick={autoSet}
        >
          {autoStatus === "measuring" ? "Measuring noise…" : "Auto set"}
        </button>
        <small>
          {autoStatus === "measuring"
            ? "Keep the channel quiet for two seconds"
            : autoStatus === "set"
              ? `Set just above the measured noise at ${squelch.toFixed(1)}`
              : autoStatus === "unavailable"
                ? "No channel-quality samples were available"
                : "Sets the threshold just above current noise"}
        </small>
      </div>
    </div>
  );
});

/** Creates effect-owned resources so every StrictMode setup has a matching cleanup. */
export function AppResourceOwner({
  createAnalysis = () => new AnalysisPipeline(),
  children,
}: AppResourceOwnerProps) {
  const [runtime, setRuntime] = useState<AppRuntime>();

  useEffect(() => {
    const analysis = createAnalysis();
    const testConfig = browserTestConfig();
    const replayRef: AppRuntime["replayRef"] = { current: undefined };
    const usrpImageRef: NonNullable<AppRuntime["usrpImageRef"]> = {
      current: testConfig?.usrpB205Dependencies?.image,
    };
    const usrpFirmwareRef: NonNullable<AppRuntime["usrpFirmwareRef"]> = {
      current: testConfig?.usrpB205Dependencies?.firmware,
    };
    const controller = new ReceiverController((events, options, generation) =>
      options.source === "synthetic"
        ? new SyntheticBackend(events, analysis, generation)
        : options.source === "replay"
          ? new ReplayBackend(
              events,
              analysis,
              replayRef.current ??
                (() => {
                  throw new Error(
                    "Load a valid I/Q recording and JSON sidecar before starting replay.",
                  );
                })(),
              generation,
            )
          : options.source === "hackrf"
            ? createHackrfBackend(
                events,
                analysis,
                generation,
                testConfig?.hackrfDependencies,
              )
            : options.source === "bladerf"
              ? createBladeRfBackend(
                  events,
                  analysis,
                  generation,
                  testConfig?.bladerfDependencies,
                )
              : options.source === "usrp-b205"
                ? createUsrpb205Backend(events, analysis, generation, {
                    ...testConfig?.usrpB205Dependencies,
                    image:
                      testConfig?.usrpB205Dependencies?.image ??
                      usrpImageRef.current,
                    firmware:
                      testConfig?.usrpB205Dependencies?.firmware ??
                      usrpFirmwareRef.current,
                    createAd9364Driver:
                      testConfig?.usrpB205Dependencies?.createAd9364Driver ??
                      (localUsrpB205NoOsDriverAvailable()
                        ? createLocalUsrpB205NoOsDriver
                        : undefined),
                    createWorkerSession:
                      testConfig?.usrpB205Dependencies?.createWorkerSession ??
                      (!testConfig && localUsrpB205NoOsDriverAvailable()
                        ? createUsrpB205WorkerSession
                        : undefined),
                  })
                : createRtlSdrBackend(
                    events,
                    analysis,
                    generation,
                    options.channelFrequencyHz,
                    testConfig?.rtlDependencies,
                  ),
    );
    const owned = {
      analysis,
      controller,
      replayRef,
      usrpImageRef,
      usrpFirmwareRef,
    };
    setRuntime(owned);
    return () => {
      void controller.disconnect().finally(() => analysis.dispose());
    };
  }, [createAnalysis]);

  return runtime ? children(runtime) : null;
}

function storageAvailable(): boolean {
  try {
    window.localStorage.getItem("browsersdr.capability-check");
    return true;
  } catch {
    return false;
  }
}

function capabilities(dabPlusAudioAvailable: boolean | null): Capability[] {
  const secure = window.isSecureContext;
  const webUsb = "usb" in navigator;
  const webGpu = "gpu" in navigator;
  const webAssembly = typeof WebAssembly === "object";
  const workers = typeof Worker === "function";
  const webAudio = typeof AudioContext === "function";
  const webCodecs =
    typeof AudioDecoder === "function" &&
    typeof EncodedAudioChunk === "function";
  const webCrypto = typeof globalThis.crypto?.subtle?.digest === "function";
  const localFiles =
    typeof File === "function" &&
    typeof Blob === "function" &&
    typeof URL.createObjectURL === "function";
  const storage = storageAvailable();
  return [
    {
      label: "Secure context",
      available: secure,
      detail: secure ? "available" : "Use localhost or HTTPS",
    },
    {
      label: "WebUSB API",
      available: webUsb,
      detail: webUsb
        ? "RTL-SDR, HackRF, bladeRF and USRP B205-mini access available"
        : "Required for live hardware; use a WebUSB-compatible browser",
    },
    {
      label: "WebGPU API",
      available: webGpu,
      detail: webGpu
        ? "API detected; device check below"
        : "Canvas2D compatibility display will be used",
    },
    {
      label: "WebAssembly DSP",
      available: webAssembly,
      detail: webAssembly
        ? "Spectrum and wideband channel kernels available"
        : "Required for optimized spectrum and high-rate channel processing",
    },
    {
      label: "Module workers",
      available: workers,
      detail: workers
        ? "Spectrum, channel, DAB and recording jobs available"
        : "Required for background signal processing",
    },
    {
      label: "Web Audio API",
      available: webAudio,
      detail: webAudio
        ? "Demodulated PCM output available"
        : "Required for analog and DAB+ audio output",
    },
    {
      label: "DAB+ AAC decoder",
      available: webCodecs ? dabPlusAudioAvailable : false,
      detail: !webCodecs
        ? "WebCodecs AudioDecoder is unavailable"
        : dabPlusAudioAvailable === null
          ? "Checking AAC-LC, HE-AAC and HE-AAC v2 profiles…"
          : dabPlusAudioAvailable
            ? "AAC-LC, HE-AAC and HE-AAC v2 profiles available"
            : "Browser or system media stack does not expose every required DAB+ AAC profile",
    },
    {
      label: "Web Crypto API",
      available: webCrypto,
      detail: webCrypto
        ? "SigMF, bladeRF and USRP image verification available"
        : "Required for recording and FPGA image integrity checks",
    },
    {
      label: "Local file APIs",
      available: localFiles,
      detail: localFiles
        ? "Recording import and export available"
        : "Required to load and download recording pairs",
    },
    {
      label: "Local storage",
      available: storage,
      detail: storage
        ? "Receiver and survey preferences can persist"
        : "Preferences will not survive a reload",
    },
  ];
}

function loadNumber(
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return fallback;
    const value = Number(stored);
    return Number.isFinite(value) && value >= minimum && value <= maximum
      ? value
      : fallback;
  } catch {
    return fallback;
  }
}

function saveNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage can be unavailable in privacy modes; receiver operation is unaffected.
  }
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function downloadDecodedTargets(mode: string, targets: unknown[]): void {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          { mode, exportedAt: new Date().toISOString(), targets },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `browsersdr-${mode.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-targets.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadSrdSnapshot(receiver: ReceiverSnapshot): void {
  if (!receiver.srd || !receiver.session) return;
  const session = receiver.session;
  downloadDecodedTargets("SRD", [
    {
      schema: "browsersdr-srd-export-v1",
      settings: session.srd,
      provenance: {
        source: session.source,
        generation: session.sessionGeneration,
        actualInputSampleRateHz: session.actualSampleRateHz,
        hardwareCenterFrequencyHz: session.hardwareCenterFrequencyHz,
        selectedChannelFrequencyHz: session.selectedChannelFrequencyHz,
        selectedChannelOffsetHz:
          session.selectedChannelFrequencyHz -
          session.hardwareCenterFrequencyHz,
        decoderInputOffsetHz: isWidebandRate(session.actualSampleRateHz)
          ? 0
          : session.selectedChannelFrequencyHz -
            session.hardwareCenterFrequencyHz,
      },
      integrityPolicy: "Only protocol-validated readings are included.",
      units: {
        temperatureC: "degC",
        humidityPercent: "percent",
        moisturePercent: "percent",
        batteryMillivolts: "mV",
      },
      counters: receiver.srd.counters,
      readings: receiver.srd.recentReadings.slice(-32),
      bursts: receiver.srd.bursts.slice(-4),
      worker: receiver.srdWorker,
    },
  ]);
}

function DiagnosticsPanel({
  health,
  active,
  pipeline,
  receiver,
  controller,
}: {
  active: boolean;
  pipeline: AnalysisPipeline;
  receiver: ReceiverSnapshot;
  controller: ReceiverController;
  health: ReactNode;
}) {
  const visible = usePageVisible(active);
  const [diagnostics, setDiagnostics] = useState<AnalysisDiagnostics>(() =>
    pipeline.getDiagnostics(),
  );
  useEffect(() => {
    if (!visible) return;
    const refresh = () => setDiagnostics(pipeline.getDiagnostics());
    refresh();
    const timer = window.setInterval(refresh, 500);
    return () => window.clearInterval(timer);
  }, [pipeline, receiver.sessionGeneration, visible]);
  const channel = visible ? controller.getChannelDiagnostics() : undefined;
  const ingress = visible ? controller.getIngressDiagnostics() : undefined;
  const processing =
    diagnostics.processingTimeAverageMs === null
      ? "unavailable"
      : `${diagnostics.processingTimeAverageMs.toFixed(2)} ms avg · ${(diagnostics.processingTimeMaximumMs ?? 0).toFixed(2)} ms max`;
  const audio =
    diagnostics.source === "synthetic"
      ? "not applicable (demo has no audio)"
      : (receiver.audioState ?? "unavailable until audio starts");
  useEffect(() => {
    const startedAt = performance.now();
    let queuePressureSamples = 0;
    let debtSamples = 0;
    const emitted = new Set<string>();
    const warnOnce = (
      code: string,
      area: "analysis" | "channel" | "usb",
      message: string,
      context: Record<string, number | string | boolean | null>,
    ) => {
      if (emitted.has(code)) return;
      emitted.add(code);
      defaultDiagnosticRecorder.record({
        area,
        code,
        severity: "warning",
        operation: "monitor",
        safeMessage: message,
        context: { ...context, thresholdVersion: 1 },
      });
    };
    const snapshot = () => {
      const current = pipeline.getDiagnostics();
      const currentChannel = controller.getChannelDiagnostics();
      const currentIngress = controller.getIngressDiagnostics();
      defaultDiagnosticRecorder.addSnapshot({
        lifecycle: receiver.lifecycle,
        visibility: document.visibilityState,
        analysis: {
          receivedComplexSamples: current.receivedComplexSamples,
          receivedBytes: current.receivedBytes,
          processedBlocks: current.processedBlocks,
          processingTimeAverageMs: current.processingTimeAverageMs,
          processingTimeMaximumMs: current.processingTimeMaximumMs,
          skippedInputBlocks: current.skippedInputBlocks,
          skippedInputSamples: current.skippedInputSamples,
          skippedSpectrumFrames: current.skippedSpectrumFrames,
          deliveredDisplayFrames: current.deliveredDisplayFrames,
          knownApplicationDiscontinuities:
            current.knownApplicationDiscontinuities,
          analysisBackend: current.analysisBackend,
          backendStartupMs: current.backendStartupMs,
          backendFallbackReason: current.backendFallbackReason,
        },
        ...(currentChannel
          ? {
              channel: {
                queuedBlocks: currentChannel.queuedBlocks,
                capacityBlocks: currentChannel.capacityBlocks,
                peakQueuedBlocks: currentChannel.peakQueuedBlocks,
                recentBlocks: currentChannel.recentBlocks,
                computeAverageMs: currentChannel.computeAverageMs,
                computeMaximumMs: currentChannel.computeMaximumMs,
                computeBudgetPercent: currentChannel.computeBudgetPercent,
                deliveryAverageMs: currentChannel.deliveryAverageMs,
                turnaroundMaximumMs: currentChannel.turnaroundMaximumMs,
              },
            }
          : {}),
        ...(currentIngress
          ? {
              ingress: {
                debtMs: currentIngress.debtMs,
                budgetMs: currentIngress.budgetMs,
                stageCount: Object.keys(currentIngress.stages).length,
                maximumStageRunMs: Math.max(
                  0,
                  ...Object.values(currentIngress.stages).map(
                    (stage) => stage.lifetimeMaxMs,
                  ),
                ),
              },
            }
          : {}),
      });
      const eligible =
        receiver.lifecycle === "running" &&
        document.visibilityState === "visible" &&
        performance.now() - startedAt >= 10_000;
      if (!eligible) {
        queuePressureSamples = 0;
        debtSamples = 0;
        return;
      }
      if (
        currentChannel &&
        currentChannel.capacityBlocks > 0 &&
        currentChannel.queuedBlocks / currentChannel.capacityBlocks >= 0.75
      )
        queuePressureSamples++;
      else queuePressureSamples = 0;
      if (queuePressureSamples >= 5 && currentChannel)
        warnOnce(
          "CHANNEL_QUEUE_PRESSURE",
          "channel",
          "Channel queue remained above 75% capacity.",
          {
            queuedBlocks: currentChannel.queuedBlocks,
            capacityBlocks: currentChannel.capacityBlocks,
          },
        );
      if (
        currentIngress &&
        currentIngress.budgetMs > 0 &&
        currentIngress.debtMs >= currentIngress.budgetMs
      )
        debtSamples++;
      else debtSamples = 0;
      if (debtSamples >= 3 && currentIngress)
        warnOnce(
          "TRANSPORT_DEBT_EXCEEDED",
          "usb",
          "Transport callback debt remained above its declared budget.",
          { debtMs: currentIngress.debtMs, budgetMs: currentIngress.budgetMs },
        );
      if (
        current.receivedComplexSamples > 0 &&
        current.skippedInputSamples / current.receivedComplexSamples > 0.01
      )
        warnOnce(
          "ANALYSIS_SKIP_RATE_HIGH",
          "analysis",
          "More than 1% of received samples were skipped by analysis.",
          {
            skippedInputSamples: current.skippedInputSamples,
            receivedComplexSamples: current.receivedComplexSamples,
          },
        );
      if (current.backendFallbackReason)
        warnOnce(
          "ANALYSIS_BACKEND_FALLBACK",
          "analysis",
          "The preferred analysis backend was unavailable; a fallback is active.",
          {
            backend: current.analysisBackend,
            reason: current.backendFallbackReason,
          },
        );
    };
    snapshot();
    const timer = window.setInterval(snapshot, 2_000);
    return () => window.clearInterval(timer);
  }, [controller, pipeline, receiver.lifecycle, receiver.sessionGeneration]);
  const reportContext = {
    lifecycle: receiver.lifecycle,
    source: receiver.session?.source ?? diagnostics.source,
    mode: receiver.session?.mode ?? null,
    sampleRateHz: receiver.session?.actualSampleRateHz ?? null,
    bandwidthHz: receiver.session?.channelBandwidthHz ?? null,
    gainMode: receiver.session
      ? receiver.session.gainDb === null
        ? "automatic-or-source-managed"
        : "manual"
      : null,
    firmwareVersion:
      receiver.session?.hackrf?.capabilities.identity.firmwareVersion ??
      (receiver.session?.bladerf
        ? `${receiver.session.bladerf.identity.firmware.major}.${receiver.session.bladerf.identity.firmware.minor}`
        : null),
    recordingActive: Boolean(controller.getRecordingStatus()),
    ...(receiver.session
      ? { exactFrequencyHz: receiver.session.selectedChannelFrequencyHz }
      : {}),
  };

  return (
    <section
      className="diagnostics-panel"
      aria-labelledby="diagnostics-heading"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Session health</p>
          <h2 id="diagnostics-heading">Session diagnostics</h2>
        </div>
      </div>
      {health}
      <details className="diagnostics-details">
        <summary>Raw counters &amp; performance</summary>
        <dl className="diagnostics-grid">
          <div>
            <dt>Received bytes</dt>
            <dd>
              {diagnostics.receivedBytes === null
                ? diagnostics.source === "synthetic"
                  ? "not applicable to generated demo"
                  : "unavailable until a source starts"
                : formatCount(diagnostics.receivedBytes)}
            </dd>
          </div>
          <div>
            <dt>Complex samples</dt>
            <dd>{formatCount(diagnostics.receivedComplexSamples)}</dd>
          </div>
          <div>
            <dt>Worker processing</dt>
            <dd>{processing}</dd>
          </div>
          {channel && (
            <>
              <div>
                <dt>Channel queue</dt>
                <dd>
                  {channel.queuedBlocks}/{channel.capacityBlocks} blocks · peak{" "}
                  {channel.peakQueuedBlocks}
                </dd>
              </div>
              <div>
                <dt>Channel processing</dt>
                <dd>
                  {channel.computeAverageMs.toFixed(2)} ms avg ·{" "}
                  {channel.computeMaximumMs.toFixed(2)} ms max ·{" "}
                  {channel.computeBudgetPercent.toFixed(1)}% of sample time ·
                  last {channel.recentBlocks} blocks
                </dd>
              </div>
              <div>
                <dt>Channel delivery</dt>
                <dd>
                  {channel.deliveryAverageMs.toFixed(2)} ms avg ·{" "}
                  {channel.turnaroundMaximumMs.toFixed(2)} ms maximum round trip
                </dd>
              </div>
            </>
          )}
          {ingress && (
            <>
              <div>
                <dt>Transport lag budget</dt>
                <dd>
                  {ingress.debtMs.toFixed(2)} / {ingress.budgetMs.toFixed(2)} ms
                  · estimated callback debt
                </dd>
              </div>
              {Object.entries(ingress.stages).map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>
                    {value.meanMs.toFixed(3)} ms avg · {value.p99Ms.toFixed(3)}{" "}
                    ms p99 · {value.maxMs.toFixed(3)} ms recent max ·{" "}
                    {value.lifetimeMaxMs.toFixed(3)} ms run max · last{" "}
                    {value.count}
                  </dd>
                </div>
              ))}
            </>
          )}
          <div>
            <dt>Analysis backend</dt>
            <dd>
              {diagnostics.analysisBackend ??
                "initializing when a source starts"}
              {diagnostics.backendStartupMs === null
                ? ""
                : ` · ${diagnostics.backendStartupMs.toFixed(2)} ms startup`}
              {diagnostics.backendFallbackReason
                ? ` · ${diagnostics.backendFallbackReason}`
                : ""}
            </dd>
          </div>
          <div>
            <dt>Analysis blocks</dt>
            <dd>{formatCount(diagnostics.processedBlocks)}</dd>
          </div>
          <div>
            <dt>Display frames delivered</dt>
            <dd>{formatCount(diagnostics.deliveredDisplayFrames)}</dd>
          </div>
          <div>
            <dt>Display frames skipped</dt>
            <dd>{formatCount(diagnostics.skippedSpectrumFrames)}</dd>
          </div>
          <div>
            <dt>Input blocks skipped</dt>
            <dd>
              {formatCount(diagnostics.skippedInputBlocks)} ·{" "}
              {formatCount(diagnostics.skippedInputSamples)} samples
            </dd>
          </div>
          <div>
            <dt>Known app discontinuities</dt>
            <dd>{formatCount(diagnostics.knownApplicationDiscontinuities)}</dd>
          </div>
          <div>
            <dt>Audio output state</dt>
            <dd>{audio}</dd>
          </div>
          <div>
            <dt>Audio underruns</dt>
            <dd>unavailable (upstream player exposes no counter)</dd>
          </div>
          <div>
            <dt>Hardware sample loss</dt>
            <dd>unavailable (USB byte streams have no sequence numbers)</dd>
          </div>
        </dl>
      </details>
      <DiagnosticReportCard context={reportContext} />
    </section>
  );
}

/** Decoder telemetry must not rebuild the controls, Explorer and Help on every
 * FIC/PCM update: long main-thread renders starve WebUSB despite fast DSP workers. */
function ReceiverDecodePanel({
  controller,
  source,
  mode,
  volume,
  active,
}: {
  controller: ReceiverController;
  source: SourceKind;
  mode: ReceiverMode;
  volume: number;
  active: boolean;
}) {
  const receiver = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  // A mode switch publishes the selected mode before the new decoder has
  // finished configuring. Avoid pairing that mode with the previous decoder's
  // last status during the tuning window.
  const modeChangePending =
    receiver.lifecycle === "tuning" && receiver.message.startsWith("Applying ");
  return (
    <section
      id="decode-panel"
      role="tabpanel"
      className="control-panel rds-panel decode-panel receiver-dock-panel"
      data-mode={mode}
      aria-labelledby="decode-heading"
      hidden={!active}
    >
      <h2 id="decode-heading" className="visually-hidden">Decoded data</h2>
      <div className="decode-layout">
        <div className="audio-summary">
          <span>
            {modeChangePending
              ? "Mode change"
              : mode === "OFF"
                ? "Demodulation disabled"
                : mode === "DAB"
                  ? "DAB+ audio output"
                  : ["ADS-B", "AIS", "SRD", "APRS", "RS41"].includes(mode)
                    ? "Data acquisition"
                    : "Audio output"}
          </span>
          <strong>
            {modeChangePending
              ? receiver.message
              : mode === "OFF"
                ? "No audio or decoder output"
                : mode === "DAB"
                  ? (receiver.dab?.message ?? "Not active")
                  : mode === "APRS"
                    ? `${receiver.aprs?.stations.length ?? 0} validated station(s)`
                  : mode === "RS41"
                    ? `${receiver.rs41?.sondes.length ?? 0} validated sonde(s)`
                  : mode === "ADS-B"
                    ? (receiver.adsb?.message ?? "Not active")
                    : mode === "AIS"
                      ? (receiver.ais?.message ?? "Not active")
                      : mode === "SRD"
                        ? receiver.srd
                          ? `${receiver.srd.devices.length} validated device(s)`
                          : "Not active"
                        : source === "synthetic"
                          ? "Not available in demo"
                          : (receiver.audioState ?? "Not active")}
          </strong>
          <small>
            {mode === "OFF"
              ? "Raw I/Q continues to feed the spectrum, waterfall, surveys and recordings."
              : mode === "DAB"
                ? `Mode I · browser HE-AAC · ${Math.round(volume * 100)}% volume`
                : mode === "APRS" ? "1200-baud Bell-202 · AX.25 FCS"
                : mode === "RS41" ? "4800 bit/s · unencrypted RS41"
                : mode === "ADS-B"
                  ? "1090ES · CRC-validated Mode S frames"
                  : mode === "AIS"
                    ? "AIS 1 + AIS 2 · dual-channel GMSK"
                    : mode === "SRD"
                      ? "OOK / 2-FSK signal inspection"
                      : source === "synthetic"
                        ? "Use a hardware source or replay to listen."
                        : `${mode} demodulation · ${Math.round(volume * 100)}% volume`}
          </small>
        <span
          className={`status-pill ${!modeChangePending && (mode === "DAB" ? receiver.dab?.state === "synchronized" : mode === "ADS-B" ? receiver.adsb?.validFrames : mode === "AIS" ? receiver.ais?.validFrames : mode === "SRD" ? receiver.srd?.counters.bursts : mode === "APRS" ? receiver.aprs?.counters.validAx25Frames : mode === "RS41" ? receiver.rs41?.counters.uncorrectedFrames || receiver.rs41?.counters.correctedFrames : receiver.rds?.validGroups) ? "status-running" : "status-idle"}`}
        >
          {modeChangePending
            ? "reconfiguring"
            : mode === "OFF"
              ? "spectrum only"
              : mode === "DAB"
                ? (receiver.dab?.state ?? "not started")
                : mode === "ADS-B"
                  ? `${receiver.adsb?.validFrames ?? 0} valid frames`
                  : mode === "APRS" ? `${receiver.aprs?.counters.validAx25Frames ?? 0} FCS-valid packets`
                  : mode === "RS41" ? `${(receiver.rs41?.counters.uncorrectedFrames ?? 0) + (receiver.rs41?.counters.correctedFrames ?? 0)} integrity-valid frames`
                  : mode === "AIS"
                    ? `${receiver.ais?.validFrames ?? 0} valid frames`
                    : mode === "SRD"
                      ? `${receiver.srd?.counters.bursts ?? 0} bursts`
                      : receiver.rds?.validGroups
                        ? `${receiver.rds.validGroups} valid groups`
                        : source === "synthetic"
                          ? "no audio"
                          : `${mode} audio`}
        </span>
        </div>
        {source !== "synthetic" &&
          ["WBFM", "DAB", "ADS-B", "AIS", "SRD", "APRS", "RS41"].includes(mode) && (
            <div className="rds-content">
              <h3>
                {mode === "OFF"
                  ? "Spectrum explorer"
                  : mode === "DAB"
                    ? "Digital Audio Broadcasting"
                    : mode === "ADS-B"
                      ? "Aircraft targets"
                      : mode === "AIS"
                        ? "Vessel targets"
                        : mode === "APRS" ? "APRS stations"
                        : mode === "RS41" ? "RS41 radiosondes"
                        : mode === "SRD"
                          ? "Short-range devices"
                          : "Radio Data System"}
              </h3>
              {mode === "OFF" ? (
                <p className="rds-empty">
                  Spectrum-only mode keeps RF acquisition and analysis active
                  without sending samples to an audio or digital decoder.
                </p>
              ) : mode === "APRS" || mode === "RS41" ? (
                <PacketDecodePanel receiver={receiver} mode={mode} />
              ) : mode === "SRD" ? (
                <>
                  <div className="target-table-wrap">
                    <table className="target-table">
                      <thead>
                        <tr>
                          <th>Device</th>
                          <th>Protocol / integrity</th>
                          <th>Measurements</th>
                          <th>Last sample</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(receiver.srd?.devices ?? [])
                          .slice(0, 32)
                          .map((device) => {
                            const reading = device.reading;
                            return (
                              <tr key={device.key}>
                                <td>
                                  <strong>{reading.deviceId}</strong>
                                  <small>
                                    {device.readings} validated reading(s)
                                  </small>
                                </td>
                                <td>
                                  {reading.protocol}
                                  <small>{reading.integrity}</small>
                                </td>
                                <td>
                                  {reading.protocol === "acurite-592txr"
                                    ? `${reading.temperatureC.toFixed(1)} °C${reading.humidityPercent == null ? "" : ` · ${reading.humidityPercent}% RH`}`
                                    : `${reading.moisturePercent}% moisture · ${reading.batteryMillivolts} mV`}
                                </td>
                                <td>
                                  {device.lastInputSampleIndex.toLocaleString()}
                                </td>
                              </tr>
                            );
                          })}
                        {!receiver.srd?.devices.length && (
                          <tr>
                            <td colSpan={4}>
                              No integrity-validated sensor reading yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <button
                    type="button"
                    className="secondary"
                    disabled={!receiver.srd}
                    onClick={() => downloadSrdSnapshot(receiver)}
                  >
                    Export device data (JSON)
                  </button>
                  <details className="decoder-details">
                    <summary>Decoder details</summary>{" "}
                    <dl className="rds-grid">
                      <div>
                        <dt>Bursts</dt>
                        <dd>{receiver.srd?.counters.bursts ?? 0}</dd>
                      </div>
                      <div>
                        <dt>Validated readings</dt>
                        <dd>{receiver.srd?.counters.validatedReadings ?? 0}</dd>
                      </div>
                      <div>
                        <dt>Unknown / rejected</dt>
                        <dd>
                          {receiver.srd?.counters.rejectedProtocolFrames ?? 0}
                        </dd>
                      </div>
                      <div>
                        <dt>Queue drops</dt>
                        <dd>{receiver.srdWorker?.droppedInputBlocks ?? 0}</dd>
                      </div>
                    </dl>{" "}
                    <div
                      className="srd-trace"
                      aria-label="Bounded SRD pulse inspector"
                    >
                      {(receiver.srd?.trace ?? [])
                        .slice(-512)
                        .map((point, index) => (
                          <i
                            key={`${point.inputSampleIndex}:${index}`}
                            className={point.level ? "high" : "low"}
                            title={`${point.inputSampleIndex}: envelope ${point.envelope.toFixed(3)}, discriminator ${point.discriminatorHz.toFixed(0)} Hz`}
                          />
                        ))}
                    </div>
                    <p className="display-note">
                      {receiver.srd?.activeBurst
                        ? "Burst in progress…"
                        : receiver.srd?.bursts.length
                          ? `${receiver.srd.bursts.length} recent burst(s); truncated bursts are marked below.`
                          : "Waiting for a signal burst. Unknown signals appear in the inspector."}
                    </p>
                    <details>
                      <summary>Recent pulse bursts</summary>
                      <ul className="srd-burst-list">
                        {(receiver.srd?.bursts ?? []).slice(-4).map((burst) => (
                          <li key={burst.id}>
                            Burst {burst.id}: {burst.pulses.length} pulses
                            {burst.truncated
                              ? ` · truncated (${burst.truncationReason ?? "unknown"})`
                              : ""}
                            {burst.timingCandidates[0]
                              ? ` · candidate ${burst.timingCandidates[0].symbolUs.toFixed(0)} µs (${burst.timingCandidates[0].basis})`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </details>
                </>
              ) : mode === "DAB" ? (
                <>
                  <p className="display-note">
                    Ensemble:{" "}
                    <strong>
                      {receiver.dab?.ensemble?.label ||
                        "Waiting for ensemble name…"}
                    </strong>
                  </p>
                  <DabMetadata metadata={receiver.dab?.programmeMetadata} />
                  <details className="decoder-details">
                    <summary>Decoder details</summary>
                    <p className="display-note">
                      Broadcast metadata:{" "}
                      {receiver.dab?.padStatistics?.padUnits ?? 0} PAD units ·{" "}
                      {receiver.dab?.padStatistics?.labelGroups ?? 0} text
                      segments · {receiver.dab?.padStatistics?.motGroups ?? 0}{" "}
                      image segments ·{" "}
                      {receiver.dab?.padStatistics?.motObjects ?? 0} completed
                      images
                      {receiver.dab?.padStatistics?.motBytes
                        ? ` · ${(receiver.dab.padStatistics.motBytes / 1024).toFixed(1)} KB assembling`
                        : ""}
                    </p>
                    <dl className="rds-grid">
                      <div>
                        <dt>Transmission frames</dt>
                        <dd>{receiver.dab?.frameCount ?? 0}</dd>
                      </div>
                      <div>
                        <dt>Null symbols</dt>
                        <dd>{receiver.dab?.nullSymbolCount ?? 0}</dd>
                      </div>
                      <div>
                        <dt>Estimated signal/null</dt>
                        <dd>
                          {receiver.dab?.estimatedSnrDb == null
                            ? "—"
                            : `${receiver.dab.estimatedSnrDb.toFixed(1)} dB`}
                        </dd>
                      </div>
                      <div>
                        <dt>Coarse frequency offset</dt>
                        <dd>
                          {receiver.dab?.coarseFrequencyOffsetHz == null
                            ? "—"
                            : `${receiver.dab.coarseFrequencyOffsetHz.toFixed(0)} Hz`}
                        </dd>
                      </div>
                      <div>
                        <dt>Valid FIC blocks</dt>
                        <dd>
                          {receiver.dab?.ficBlockCount ?? 0} /{" "}
                          {receiver.dab?.ficBlockAttempts ?? 0}
                        </dd>
                      </div>
                      <div>
                        <dt>FIC-bearing frames</dt>
                        <dd>
                          {receiver.dab?.ficFramesWithAny ?? 0} /{" "}
                          {receiver.dab?.ficFrameCount ?? 0} (
                          {receiver.dab?.ficCompleteFrames ?? 0} complete)
                        </dd>
                      </div>
                      <div>
                        <dt>FIBs per frame</dt>
                        <dd>
                          {receiver.dab?.ficSuccessHistogram
                            ?.map((count, valid) =>
                              count > 0 ? `${valid}:${count}` : "",
                            )
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>Valid FIBs by coding group</dt>
                        <dd>
                          {receiver.dab?.ficGroupBlocks?.join(" · ") || "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>Decoder frequency correction</dt>
                        <dd>
                          {receiver.dab?.decoderCoarseCarrierOffsetHz ?? 0} Hz
                          coarse
                          {receiver.dab?.decoderCoarseCarrierLocked
                            ? " (locked)"
                            : ""}
                          ,{" "}
                          {receiver.dab?.decoderFineFrequencyCorrectionHz?.toFixed(
                            1,
                          ) ?? "0.0"}{" "}
                          Hz fine
                        </dd>
                      </div>
                      <div>
                        <dt>Decoder timing start</dt>
                        <dd>
                          {receiver.dab?.decoderTimingStartSamples ?? 0} samples
                        </dd>
                      </div>
                      <div>
                        <dt>Frame interval / missed frames</dt>
                        <dd>
                          {(
                            (receiver.dab?.frameIntervalSamples ?? 0) / 2048
                          ).toFixed(1)}{" "}
                          ms / {receiver.dab?.missedFrames ?? 0}
                        </dd>
                      </div>
                      <div>
                        <dt>OFDM/FEC processing (last / peak)</dt>
                        <dd>
                          {receiver.dab?.processingMs?.toFixed(1) ?? "0"} /{" "}
                          {receiver.dab?.maxProcessingMs?.toFixed(1) ?? "0"} ms
                          per 96 ms frame
                        </dd>
                      </div>
                      <div>
                        <dt>Q convention</dt>
                        <dd>{receiver.dab?.quadraturePolarity ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Selected service</dt>
                        <dd>
                          {receiver.dab?.serviceId == null
                            ? "—"
                            : `0x${receiver.dab.serviceId.toString(16).toUpperCase()}`}
                        </dd>
                      </div>
                      <div>
                        <dt>MSC subchannel</dt>
                        <dd>{receiver.dab?.subchannelId ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>MSC logical frames</dt>
                        <dd>{receiver.dab?.logicalFrameCount ?? 0}</dd>
                      </div>
                      <div>
                        <dt>DAB+ superframes</dt>
                        <dd>{receiver.dab?.superframeCount ?? 0}</dd>
                      </div>
                      <div>
                        <dt>Superframe candidates</dt>
                        <dd>{receiver.dab?.superframeCandidateCount ?? 0}</dd>
                      </div>
                      <div>
                        <dt>RS-rejected candidates</dt>
                        <dd>{receiver.dab?.reedSolomonFailureCount ?? 0}</dd>
                      </div>
                      <div>
                        <dt>RS columns (last / best)</dt>
                        <dd>
                          {receiver.dab?.lastCorrectedRsColumns ?? 0} /{" "}
                          {receiver.dab?.bestCorrectedRsColumns ?? 0}
                        </dd>
                      </div>
                      <div>
                        <dt>Fire-code failures</dt>
                        <dd>{receiver.dab?.fireCodeFailureCount ?? 0}</dd>
                      </div>
                      <div>
                        <dt>Audio format</dt>
                        <dd>
                          {receiver.dab?.audioFormat
                            ? `DAB+ · ${receiver.dab.audioFormat.dacRate ? "48" : "32"} kHz · ${receiver.dab.audioFormat.stereo || receiver.dab.audioFormat.parametricStereo ? "Stereo" : "Mono"}${receiver.dab.audioFormat.sbr ? " · SBR" : ""}${receiver.dab.audioFormat.parametricStereo ? " · PS" : ""}`
                            : "Waiting for audio format…"}
                        </dd>
                      </div>
                      <div>
                        <dt>Browser audio decoder</dt>
                        <dd>
                          {receiver.dab?.audioDecoderMessage ??
                            "Waiting for validated audio"}
                        </dd>
                      </div>
                      <div>
                        <dt>Decoded PCM audio</dt>
                        <dd>
                          {receiver.dab?.decodedAudioSeconds?.toFixed(2) ??
                            "0.00"}{" "}
                          s
                          {receiver.dab?.pcmSampleRateHz
                            ? ` at ${receiver.dab.pcmSampleRateHz.toLocaleString()} Hz`
                            : ""}
                        </dd>
                      </div>
                      <div>
                        <dt>AAC access units</dt>
                        <dd>{receiver.dab?.accessUnitCount ?? 0}</dd>
                      </div>
                    </dl>
                    <p className="display-note">
                      The first available DAB+ station plays automatically. Use
                      the station selector above to change programmes. Legacy
                      MPEG Layer II DAB and encrypted services are not sent to
                      the HE-AAC output path.
                    </p>
                  </details>
                </>
              ) : mode === "ADS-B" ? (
                <>
                  <PositionMap
                    label="ADS-B target positions"
                    points={(receiver.adsb?.targets ?? []).map((target) => ({
                      latitude: target.latitude,
                      longitude: target.longitude,
                      label: target.callsign ?? target.icao,
                    }))}
                  />
                  <div className="target-table-wrap">
                    <table className="target-table">
                      <thead>
                        <tr>
                          <th>Aircraft</th>
                          <th>Altitude</th>
                          <th>Speed / track</th>
                          <th>Position</th>
                          <th>Messages</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(receiver.adsb?.targets ?? [])
                          .slice(0, 50)
                          .map((target) => (
                            <tr key={target.icao}>
                              <td>
                                <strong>{target.callsign ?? "—"}</strong>
                                <small>{target.icao}</small>
                              </td>
                              <td>
                                {target.altitudeFt == null
                                  ? "—"
                                  : `${target.altitudeFt.toLocaleString()} ft`}
                              </td>
                              <td>
                                {target.groundSpeedKt == null
                                  ? "—"
                                  : `${target.groundSpeedKt.toFixed(0)} kt · ${target.trackDegrees?.toFixed(0) ?? "—"}°`}
                              </td>
                              <td>
                                {target.latitude == null
                                  ? "—"
                                  : `${target.latitude.toFixed(4)}, ${target.longitude?.toFixed(4)}`}
                              </td>
                              <td>{target.messages}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!receiver.adsb?.targets.length}
                    onClick={() =>
                      downloadDecodedTargets(
                        "ADS-B",
                        receiver.adsb?.targets ?? [],
                      )
                    }
                  >
                    Export targets JSON
                  </button>
                  <details className="decoder-details">
                    <summary>Decoder details</summary>{" "}
                    <dl className="rds-grid">
                      <div>
                        <dt>Preamble candidates</dt>
                        <dd>{receiver.adsb?.preamblesDetected ?? 0}</dd>
                      </div>
                      <div>
                        <dt>CRC-valid Mode S</dt>
                        <dd>{receiver.adsb?.crcValidFrames ?? 0}</dd>
                      </div>
                      <div>
                        <dt>Supported DF17/DF18</dt>
                        <dd>{receiver.adsb?.validFrames ?? 0}</dd>
                      </div>
                      <div>
                        <dt>CRC-valid unsupported DF</dt>
                        <dd>{receiver.adsb?.unsupportedFrames ?? 0}</dd>
                      </div>
                      <div>
                        <dt>CRC failures</dt>
                        <dd>{receiver.adsb?.crcFailures ?? 0}</dd>
                      </div>
                      <div>
                        <dt>Ambiguous bit decisions</dt>
                        <dd>{receiver.adsb?.ambiguousFrames ?? 0}</dd>
                      </div>
                      <div>
                        <dt>Targets</dt>
                        <dd>{receiver.adsb?.targets.length ?? 0}</dd>
                      </div>
                    </dl>
                    <p className="display-note">
                      CRC-valid counts zero-remainder parity. Address- or
                      interrogator-overlaid Mode S replies cannot be
                      independently validated here.
                    </p>
                  </details>
                </>
              ) : mode === "AIS" ? (
                <>
                  <PositionMap
                    label="AIS vessel positions"
                    points={(receiver.ais?.targets ?? []).map((target) => ({
                      latitude: target.latitude,
                      longitude: target.longitude,
                      label: target.name ?? String(target.mmsi),
                    }))}
                  />
                  <div className="target-table-wrap">
                    <table className="target-table">
                      <thead>
                        <tr>
                          <th>Vessel</th>
                          <th>Channel</th>
                          <th>Speed / course</th>
                          <th>Position</th>
                          <th>Messages</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(receiver.ais?.targets ?? [])
                          .slice(0, 50)
                          .map((target) => (
                            <tr key={target.mmsi}>
                              <td>
                                <strong>{target.name ?? "—"}</strong>
                                <small>{target.callSign ?? target.mmsi}</small>
                              </td>
                              <td>{target.channel}</td>
                              <td>
                                {target.speedKnots == null
                                  ? "—"
                                  : `${target.speedKnots.toFixed(1)} kt · ${target.courseDegrees?.toFixed(1) ?? "—"}°`}
                              </td>
                              <td>
                                {target.latitude == null
                                  ? "—"
                                  : `${target.latitude.toFixed(4)}, ${target.longitude?.toFixed(4)}`}
                              </td>
                              <td>{target.messages}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!receiver.ais?.targets.length}
                    onClick={() =>
                      downloadDecodedTargets("AIS", receiver.ais?.targets ?? [])
                    }
                  >
                    Export targets JSON
                  </button>
                  <details className="decoder-details">
                    <summary>Decoder details</summary>{" "}
                    <dl className="rds-grid">
                      <div>
                        <dt>AIS 1 frames</dt>
                        <dd>{receiver.ais?.channel1Frames ?? 0}</dd>
                      </div>
                      <div>
                        <dt>AIS 2 frames</dt>
                        <dd>{receiver.ais?.channel2Frames ?? 0}</dd>
                      </div>
                      <div>
                        <dt>Rejected</dt>
                        <dd>{receiver.ais?.rejectedFrames ?? 0}</dd>
                      </div>
                      <div>
                        <dt>Vessels</dt>
                        <dd>{receiver.ais?.targets.length ?? 0}</dd>
                      </div>
                    </dl>
                  </details>
                </>
              ) : mode !== "WBFM" ? (
                <p className="rds-empty">
                  RDS decoding is available only in WBFM. Audio remains
                  available for the selected mode.
                </p>
              ) : !receiver.rds?.validGroups ? (
                <p className="rds-empty">
                  No validated station data decoded yet.
                </p>
              ) : (
                <dl className="rds-grid">
                  <div>
                    <dt>PI identifier</dt>
                    <dd>{receiver.rds.pi ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Programme Service</dt>
                    <dd>
                      {receiver.rds.programmeService ??
                        "Waiting for all PS segments…"}
                    </dd>
                  </div>
                  <div className="rds-text">
                    <dt>RadioText</dt>
                    <dd>
                      {receiver.rds.radioText ?? "Waiting for RadioText…"}
                    </dd>
                  </div>
                </dl>
              )}
              {mode === "WBFM" && (
                <details className="decoder-details">
                  <summary>Decoder details</summary>
                  <p className="display-note">
                    Text appears only after CRC and block-offset validation.
                    Retuning, changing station PI, or leaving WBFM clears prior
                    data.
                  </p>
                </details>
              )}
            </div>
          )}
      </div>
    </section>
  );
}

export function ReceiverApp({
  analysis,
  controller,
  replayRef,
  usrpImageRef = { current: undefined },
  usrpFirmwareRef = { current: undefined },
}: AppRuntime) {
  const antennaSite = useReceiverLocation("local");
  const [receiver, setReceiver] = useState<ReceiverSnapshot>(() =>
    controller.getSnapshot(),
  );
  const [appliedSession, setAppliedSession] = useState(
    () => controller.getSnapshot().session,
  );
  const [initialSource] = useState(() =>
    loadSourceSelection(preferenceStorage),
  );
  const [source, setSource] = useState<SourceKind>(initialSource);
  const [helpOs, setHelpOs] = useState<OperatingSystem>(() => operatingSystem());
  const [initialPreferences] = useState(() =>
    loadSourcePreferences(preferenceStorage, initialSource),
  );
  const [receptionCandidate, setReceptionCandidate] = useState<ReceptionCandidate | undefined>(() => (hasSettingsShare(location.hash) || hasRemoteShare(location.hash)) ? undefined : readReceptionCandidate(location.search));
  const [mode, setMode] = useState(receptionCandidate?.mode ?? initialPreferences.modeSettings.mode);
  const [layout, setLayout] = useWorkspaceLayout();
  const favorites = useFavorites();
  const [favoriteDraft, setFavoriteDraft] = useState<Bookmark>();
  const [spectrumDisplay, setSpectrumDisplay] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("browsersdr.spectrum-display.v1") ?? "null") as SharedDisplay | null;
      if (saved && Number.isFinite(saved.floorDb) && saved.floorDb >= -120 && saved.floorDb <= -30 &&
          Number.isFinite(saved.rangeDb) && saved.rangeDb >= 20 && saved.rangeDb <= 120)
        return { floorDb: saved.floorDb, rangeDb: saved.rangeDb };
    } catch { /* Optional display preferences. */ }
    return { floorDb: -105, rangeDb: 90 };
  });
  useEffect(() => {
    try { localStorage.setItem("browsersdr.spectrum-display.v1", JSON.stringify(spectrumDisplay)); }
    catch { /* Optional display preferences. */ }
  }, [spectrumDisplay]);
  const [sourceAdvancedOpen, setSourceAdvancedOpen] = useState(false);
  const [channelAdvancedOpen, setChannelAdvancedOpen] = useState(
    !["OFF", "WBFM", "SRD", "APRS", "RS41"].includes(initialPreferences.modeSettings.mode),
  );
  const [channelTuneIssue, setChannelTuneIssue] = useState<string>();
  const [autoRecenter, setAutoRecenter] = useState(() =>
    loadNumber("browsersdr-auto-recenter", 1, 0, 1) !== 0,
  );
  useEffect(() => { controller.setAutoRecenter(autoRecenter); }, [controller, autoRecenter]);
  const [frequencyMhz, setFrequencyMhz] = useState(
    (receptionCandidate?.frequency_hz ?? initialPreferences.frequencyHz) / 1_000_000,
  );
  const [channelFrequencyDraft, setChannelFrequencyDraft] = useState<string>();
  const [volume, setVolume] = useState(() =>
    loadNumber(VOLUME_KEY, DEFAULT_VOLUME, 0, 1),
  );
  const [bandwidthHz, setBandwidthHz] = useState(
    normalizeModeSettings({ ...initialPreferences.modeSettings, mode: receptionCandidate?.mode ?? initialPreferences.modeSettings.mode, bandwidthHz: receptionCandidate?.bandwidth_hz ?? initialPreferences.modeSettings.bandwidthHz }).bandwidthHz,
  );
  const [squelch, setSquelch] = useState(
    initialPreferences.modeSettings.squelch,
  );
  const [beatToneHz, setBeatToneHz] = useState(
    initialPreferences.modeSettings.beatToneHz ?? 600,
  );
  const [srdSettings, setSrdSettings] = useState<SrdModeSettings>(
    initialPreferences.modeSettings.srd ?? defaultSrdModeSettings(),
  );
  const [gainDb, setGainDb] = useState<number | null>(
    initialPreferences.gainDb ?? null,
  );
  const [hardwareSettings, setHardwareSettings] = useState<HackrfRxSettings>(
    initialPreferences.hardwareSettings ?? { ...DEFAULT_HACKRF_RX_SETTINGS },
  );
  const [bladerfSettings, setBladeRfSettings] = useState<BladeRfRxSettings>(initialPreferences.bladerfSettings ?? { ...DEFAULT_BLADERF_RX_SETTINGS });
  const [usrpSettings, setUsrpSettings] = useState<UsrpB205RxSettings>(
    initialPreferences.usrpSettings ?? { ...DEFAULT_USRP_B205_RX_SETTINGS },
  );
  const [sampleRateHz, setSampleRateHz] = useState(
    initialPreferences.sampleRateHz,
  );
  const caps = sourceCapabilities(source);
  const hardwareOptions =
    source === "hackrf"
      ? { hardwareSettings }
      : source === "usrp-b205"
        ? { usrpSettings }
        : source === "bladerf"
          ? { bladerfSettings }
          : source === "rtl-sdr"
            ? { gainDb }
            : {};
  const currentModeSettings = useMemo(
    () => ({
      mode,
      bandwidthHz,
      squelch,
      beatToneHz,
      ...(mode === "SRD" ? { srd: srdSettings } : {}),
    }),
    [bandwidthHz, beatToneHz, mode, squelch, srdSettings],
  );
  useEffect(() => {
    saveSourcePreferences(preferenceStorage, source, {
      frequencyHz: frequencyMhz * 1_000_000,
      modeSettings: currentModeSettings,
      sampleRateHz,
      ...(source === "hackrf"
        ? { hardwareSettings }
        : source === "rtl-sdr"
          ? { gainDb }
          : source === "usrp-b205"
            ? { usrpSettings }
            : source === "bladerf"
              ? { bladerfSettings }
              : {}),
    });
  }, [
    currentModeSettings,
    source,
    frequencyMhz,
    mode,
    bandwidthHz,
    squelch,
    beatToneHz,
    srdSettings,
    sampleRateHz,
    hardwareSettings,
    gainDb,
    usrpSettings,
    bladerfSettings,
  ]);
  const [loadedReplay, setLoadedReplay] = useState<IqRecording>();
  const [storedFpgaImages, setStoredFpgaImages] = useState<BladeRfHostedImage[]>([]);
  const [fpgaImageMessage, setFpgaImageMessage] = useState(
    "Import an official hosted image. Connect identifies the model and firmware and requires their matching image.",
  );
  const [importingFpgaImage, setImportingFpgaImage] = useState(false);
  const [fpgaImageError, setFpgaImageError] = useState<string>();
  const refreshStoredFpgaImages = useCallback(async () => {
    try {
      setStoredFpgaImages(await storedBladeRfImages());
    } catch (error) {
      setFpgaImageMessage(
        error instanceof Error
          ? error.message
          : "Could not inspect local FPGA image storage.",
      );
    }
  }, []);
  useEffect(() => {
    void refreshStoredFpgaImages();
  }, [refreshStoredFpgaImages]);
  const importFpgaImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setImportingFpgaImage(true);
    setFpgaImageError(undefined);
    setFpgaImageMessage(`Verifying ${file.name}…`);
    try {
      const image = await importBladeRfImage(file);
      await refreshStoredFpgaImages();
      setFpgaImageMessage(
        `Verified and saved official hosted${image.model} v${image.version}. Connect checks whether this exact model and firmware need it.`,
      );
    } catch (error) {
      setFpgaImageError(
        error instanceof Error
          ? error.message
          : "Could not import the FPGA image.",
      );
      setFpgaImageMessage(
        error instanceof Error
          ? error.message
          : "Could not import the FPGA image.",
      );
    } finally {
      setImportingFpgaImage(false);
    }
  };
  const [usrpImageChecked, setUsrpImageChecked] = useState(
    Boolean(usrpImageRef.current),
  );
  const [usrpImageRevision, setUsrpImageRevision] = useState(0);
  const [importingUsrpImage, setImportingUsrpImage] = useState(false);
  const [usrpImageError, setUsrpImageError] = useState<string>();
  const [usrpImageMessage, setUsrpImageMessage] = useState(
    usrpImageRef.current
      ? `Verified ${USRP_B205_IMAGE.memberFilename}.`
      : "Import the pinned official archive or extracted FPGA member before connecting.",
  );
  useEffect(() => {
    if (usrpImageRef.current) {
      setUsrpImageChecked(true);
      return;
    }
    let active = true;
    void loadStoredUsrpB205Image()
      .then((image) => {
        if (!active) return;
        usrpImageRef.current = image;
        setUsrpImageMessage(
          `Verified saved ${image.contract.memberFilename} (${image.memberSha256.slice(0, 12)}…).`,
        );
        setUsrpImageRevision((value) => value + 1);
      })
      .catch((error) => {
        if (active)
          setUsrpImageMessage(
            error instanceof Error
              ? error.message
              : "Could not inspect local USRP FPGA image storage.",
          );
      })
      .finally(() => {
        if (active) setUsrpImageChecked(true);
      });
    return () => {
      active = false;
    };
  }, [usrpImageRef]);
  const importUsrpImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setImportingUsrpImage(true);
    setUsrpImageError(undefined);
    setUsrpImageMessage(`Verifying ${file.name}…`);
    try {
      const image = await importUsrpB205Image(file);
      usrpImageRef.current = image;
      autoConnectAttempted.current = false;
      setUsrpImageRevision((value) => value + 1);
      setUsrpImageMessage(
        `Verified and saved ${image.contract.memberFilename}. The image is loaded into the FPGA only when needed and never written to flash.`,
      );
    } catch (error) {
      setUsrpImageError(
        error instanceof Error
          ? error.message
          : "Could not import the USRP FPGA image.",
      );
      setUsrpImageMessage(
        error instanceof Error
          ? error.message
          : "Could not import the USRP FPGA image.",
      );
    } finally {
      setImportingUsrpImage(false);
      setUsrpImageChecked(true);
    }
  };
  const [usrpFirmwareChecked, setUsrpFirmwareChecked] = useState(
    Boolean(usrpFirmwareRef.current),
  );
  const [importingUsrpFirmware, setImportingUsrpFirmware] = useState(false);
  const [usrpFirmwareError, setUsrpFirmwareError] = useState<string>();
  const [usrpFirmwareMessage, setUsrpFirmwareMessage] = useState(
    usrpFirmwareRef.current
      ? `Verified ${USRP_B205_FIRMWARE.memberFilename}.`
      : "Import the pinned official FX3 firmware archive or extracted .hex before connecting.",
  );
  useEffect(() => {
    if (usrpFirmwareRef.current) {
      setUsrpFirmwareChecked(true);
      return;
    }
    let active = true;
    void loadStoredUsrpB205Firmware()
      .then((firmware) => {
        if (!active) return;
        usrpFirmwareRef.current = firmware;
        setUsrpFirmwareMessage(
          `Verified saved ${firmware.contract.memberFilename} (${firmware.memberSha256.slice(0, 12)}…).`,
        );
      })
      .catch((error) => {
        if (active)
          setUsrpFirmwareMessage(
            error instanceof Error
              ? error.message
              : "Could not inspect local USRP firmware storage.",
          );
      })
      .finally(() => {
        if (active) setUsrpFirmwareChecked(true);
      });
    return () => {
      active = false;
    };
  }, [usrpFirmwareRef]);
  const importUsrpFirmwareFile = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setImportingUsrpFirmware(true);
    setUsrpFirmwareError(undefined);
    setUsrpFirmwareMessage(`Verifying ${file.name}…`);
    try {
      const firmware = await importUsrpB205Firmware(file);
      usrpFirmwareRef.current = firmware;
      autoConnectAttempted.current = false;
      setUsrpFirmwareMessage(
        `Verified and saved ${firmware.contract.memberFilename}. WestBridge recovery writes only volatile FX3 RAM.`,
      );
    } catch (error) {
      setUsrpFirmwareError(
        error instanceof Error
          ? error.message
          : "Could not import the USRP FX3 firmware.",
      );
      setUsrpFirmwareMessage(
        error instanceof Error
          ? error.message
          : "Could not import the USRP FX3 firmware.",
      );
    } finally {
      setImportingUsrpFirmware(false);
      setUsrpFirmwareChecked(true);
    }
  };
  const [replayBinary, setReplayBinary] = useState<File>();
  const [replayMetadata, setReplayMetadata] = useState<File>();
  const [replayImportFormat, setReplayImportFormat] =
    useState<ReplayImportFormat>("browsersdr");
  const [sigmfReplayMode, setSigmfReplayMode] = useState<ReceiverMode | "">("");
  const [sigmfChannelChoice, setSigmfChannelChoice] = useState<
    "center" | "custom"
  >("center");
  const [sigmfChannelMhz, setSigmfChannelMhz] = useState("");
  const [fileMessage, setFileMessage] = useState(
    "Load a .cu8, .ci8 or .ci16 binary and its .json sidecar, or open the example recording.",
  );
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>();
  const [captureCurrentChannel, setCaptureCurrentChannel] = useState(false);
  const [recordingFormat, setRecordingFormat] =
    useState<RecordingExportFormat>(() => { try { const saved=localStorage.getItem("browsersdr-recording-format"); return saved === "sigmf" ? "sigmf" : "browsersdr"; } catch { return "browsersdr"; } });
  useEffect(() => {
    if (source === "usrp-b205" || source === "bladerf" || (source === "replay" && loadedReplay?.metadata.format === BLADERF_SC16_RECORDING_FORMAT)) setRecordingFormat("sigmf");
  }, [source, loadedReplay]);
  const [exportingRecording, setExportingRecording] = useState(false);
  const [exportCoordinator] = useState(() => new RecordingExportCoordinator());
  useEffect(() => {
    void cleanupAbandonedRecordings().catch(() => undefined);
    return () => exportCoordinator.discard();
  }, [exportCoordinator]);
  const [retainedCapture, setRetainedCapture] =
    useState<RecordingRetentionSnapshot>(() => exportCoordinator.getSnapshot());
  const [previousSavedUrl, setPreviousSavedUrl] = useState<string>();
  const [captureDuration, setCaptureDuration] = useState(() => loadNumber("browsersdr-capture-duration", 0, 0, 300));
  useEffect(() => { try { localStorage.setItem("browsersdr-recording-format", recordingFormat); localStorage.setItem("browsersdr-capture-duration", String(captureDuration)); } catch { /* Optional preferences. */ } }, [recordingFormat, captureDuration]);
  const captureTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [atlasPrepared, setAtlasPrepared] = useState<PreparedRecordingExport>();
  const [atlasSaveActive, setAtlasTransferActive] = useState(false);
  const [atlasConnection] = useState(getAtlasConnection);
  const atlasConnectionState = useSyncExternalStore(atlasConnection.subscribe, atlasConnection.getSnapshot);
  const atlasTransferActive = atlasSaveActive || atlasConnectionState.transferActive;
  const [recordingFormatLatch] = useState(() => new RecordingFormatLatch());
  const [captureCandidateLatch] = useState(() => new CaptureCandidateLatch());
  const [stationSelectionBusy, setStationSelectionBusy] = useState(false);
  const stationSelectionPending = useRef(false);
  const selectedSourceRef = useRef(source);
  selectedSourceRef.current = source;
  const capacityStopPending = useRef(false);
  const surveyCaptureActive = useRef(false);
  const autoConnectAttempted = useRef(false);
  const authorizedUsbDevice = useRef<USBDevice | undefined>(undefined);
  const [activeView, setActiveViewState] = useState<AppView>("receiver");
  const [remoteSelected, setRemoteSelected] = useState(false);
  const [remoteStatus, setRemoteStatus] = useState("disconnected");
  const [remotePreset, setRemotePreset] = useState<RemotePreset>();
  const [remoteOpening, setRemoteOpening] = useState(false);
  const [remoteEntryIssue, setRemoteEntryIssue] = useState("");
  const [lastWorkspace, setLastWorkspace] = useState<"receiver" | "explorer">("receiver");
  const setActiveView = useCallback((view: AppView) => {
    setActiveViewState(view === "receiver" && remoteSelected ? "remote" : view);
    if (view === "receiver" || view === "remote") setLastWorkspace("receiver");
    else if (view === "explorer") setLastWorkspace(view);
  }, [remoteSelected]);
  const openAuxiliaryView = (view: AppView) => {
    setActiveView(view);
    requestAnimationFrame(() => document.getElementById("auxiliary-return")?.focus());
  };
  const [compatibilityDetailView, setCompatibilityDetailView] =
    useState<CompatibilityDetailView>("modes");
  const [receiverDockView, setReceiverDockView] =
    useState<ReceiverDockView>("decode");
  const receiverDockLarge = layout.dockLarge;
  const setReceiverDockLarge = (update: (old: boolean) => boolean) => setLayout((old) => ({ ...old, dockLarge: update(old.dockLarge) }));
  const receiverDockExpanded = layout.dockExpanded;
  const setReceiverDockExpanded = (update: boolean | ((old: boolean) => boolean)) => setLayout((old) => ({ ...old, dockExpanded: typeof update === "function" ? update(old.dockExpanded) : update }));
  const [scanActive, setScanActive] = useState(false);
  const [spectrumStatus, setSpectrumStatus] = useState<SpectrumDisplayStatus>({
    kind: "checking",
    hasFrame: false,
    paused: false,
  });
  const [captureView, setCaptureView] = useState<"record" | "open">("record");
  const [recordingMessage, setRecordingMessage] = useState("");
  const [dabPlusAudioAvailable, setDabPlusAudioAvailable] = useState<
    boolean | null
  >(null);
  useEffect(() => {
    let current = true;
    void probeDabPlusAudioSupport()
      .then((available) => {
        if (current) setDabPlusAudioAvailable(available);
      })
      .catch(() => {
        if (current) setDabPlusAudioAvailable(false);
      });
    return () => {
      current = false;
    };
  }, []);
  const detectedCapabilities = capabilities(dabPlusAudioAvailable);
  const busy =
    Boolean(receiver.cleanupRequired) ||
    [
      "requesting-permission",
      "connecting",
      "disconnecting",
      "starting",
      "running",
      "tuning",
      "stopping",
    ].includes(receiver.lifecycle);
  const running = receiver.lifecycle === "running";
  const hardwareConnected =
    caps.persistentConnection &&
    ["connected", "starting", "running", "tuning", "stopping"].includes(
      receiver.lifecycle,
    );
  const transitioning =
    stationSelectionBusy || scanActive ||
    [
      "requesting-permission",
      "connecting",
      "starting",
      "tuning",
      "stopping",
      "disconnecting",
    ].includes(receiver.lifecycle);
  const sourceConfigurationEditable =
    !hardwareConnected || receiver.lifecycle === "connected";
  const frequencyValid = (() => {
    try {
      validateSourceFrequency(
        source,
        frequencyMhz * 1_000_000,
        source === "hackrf" || source === "bladerf" || source === "usrp-b205"
          ? bandwidthHz
          : 0,
      );
      return true;
    } catch {
      return false;
    }
  })();
  const encoding =
    captureCurrentChannel && source !== "usrp-b205" && source !== "bladerf" && !(source === "replay" && loadedReplay?.metadata.bytesPerComplexSample === 4) ? "ci8" : source === "usrp-b205" || source === "bladerf"
      ? "ci16_le"
      : source === "hackrf"
        ? "ci8"
        : source === "replay" && loadedReplay
          ? loadedReplay.metadata.sampleEncoding === "signed-16-bit-little-endian"
            ? "ci16_le"
            : loadedReplay.metadata.sampleEncoding === "signed-8-bit"
              ? "ci8"
              : "cu8"
          : "cu8";
  const recordingSupported = true;
  const nativeRateHz =
    receiver.session?.usrpB205?.nativeSampleRateHz ??
    receiver.session?.bladerf?.acceptedSampleRateHz ??
    receiver.session?.bladerf?.nativeSampleRateHz ??
    receiver.session?.hackrf?.nativeSampleRateHz ??
    receiver.session?.actualSampleRateHz ??
    sampleRateHz;
  const channelCapturePreview = (() => {
    try {
      return { plan: planChannelCapture({
        actualSampleRateHz: nativeRateHz,
        hardwareCenterFrequencyHz: receiver.session?.hardwareCenterFrequencyHz ?? frequencyMhz * 1_000_000,
        selectedChannelFrequencyHz: receiver.session?.selectedChannelFrequencyHz ?? frequencyMhz * 1_000_000,
        channelBandwidthHz: receiver.session?.channelBandwidthHz ?? bandwidthHz,
        mode: receiver.session?.mode ?? mode,
        bladerf: receiver.session?.bladerf,
      }) };
    } catch (error) { return { error: error instanceof Error ? error.message : "Channel capture is unavailable." }; }
  })();
  const captureRateHz = captureCurrentChannel && channelCapturePreview.plan ? channelCapturePreview.plan.outputSampleRateHz : nativeRateHz;
  const captureBytesPerSample = source === "usrp-b205" || source === "bladerf" || (source === "replay" && loadedReplay?.metadata.bytesPerComplexSample === 4) ? 4 : 2;
  const modeUnavailable = (candidate: ReceiverMode) =>
    sourceModeUnavailableReason(
      source,
      candidate,
      sourceConfigurationEditable
        ? sampleRateHz
        : (receiver.session?.actualSampleRateHz ??
            (source === "replay"
              ? (loadedReplay?.metadata.sampleRateHz ?? sampleRateHz)
              : sampleRateHz)),
      (!sourceConfigurationEditable && hardwareConnected) ||
        source === "replay",
    );
  const liveSession =
    appliedSession?.source === source ? appliedSession : undefined;
  const liveMode = liveSession?.mode ?? mode;
  const displayedFrequencyHz = liveSession?.selectedChannelFrequencyHz;
  const frequencyPending =
    Boolean(liveSession) &&
    (!Number.isFinite(frequencyMhz) ||
      Math.round(frequencyMhz * 1_000_000) !==
        Math.round(liveSession!.selectedChannelFrequencyHz));
  const modePending = Boolean(liveSession && liveSession.mode !== mode);
  const bandwidthPending = Boolean(
    liveSession && liveSession.channelBandwidthHz !== bandwidthHz,
  );
  const modeCaps = modeCapabilities(mode);
  const captureSlotBlocked =
    !["empty", "discarded", "download-requested"].includes(
      retainedCapture.status,
    ) || atlasTransferActive;
  const retainedCapturePresent = !["empty", "discarded"].includes(
    retainedCapture.status,
  );
  const preparedCaptureAvailable =
    ["prepared", "download-requested", "retry-available", "storage-failed"].includes(
      retainedCapture.status,
    ) && Boolean(retainedCapture.basename);
  const preparedCaptureNeedsSeparateFiles =
    retainedCapture.retainedBytes > RECORDING_ARCHIVE_INPUT_MAX_BYTES;

  const settlePreparation = useCallback(
    (attempt: Promise<RetainRecordingResult>) => {
      setExportingRecording(true);
      setRecordingMessage("Preparing completed recording…");
      void attempt.then((result) => {
        if (result.status === "prepared") {
          setAtlasPrepared(
            result.prepared.format === "sigmf" ? result.prepared : undefined,
          );
          const format =
            result.prepared.format === "sigmf" ? "SigMF" : "BrowserSDR replay";
          setRecordingMessage(
            `Prepared ${result.prepared.sampleCount.toLocaleString()} samples as ${format}. Choose one ZIP download or request the two compatible files.`,
          );
        } else if (result.status === "failure") {
          setRecordingMessage(
            `${result.error.message} ${exportCoordinator.getSnapshot().status === "storage-failed" ? "Capture storage failed; this recording cannot be exported. Discard it and start a new recording." : "The completed recording is available in this tab; retry preparation."}`,
          );
        } else if (result.status === "blocked") {
          setRecordingMessage(
            "A prepared recording is still retained. Request its download or discard it before completing another capture.",
          );
        }
        setRetainedCapture(exportCoordinator.getSnapshot());
        setExportingRecording(false);
      });
    },
    [exportCoordinator],
  );

  const retainCompletedRecording = useCallback(
    (recording: IqRecording) => {
      if (captureTimer.current) clearTimeout(captureTimer.current);
      captureTimer.current = undefined;
      captureCandidateLatch.complete(recording);
      setAtlasPrepared(undefined);
      const format = recordingFormatLatch.complete(recordingFormat);
      capacityStopPending.current = false;
      setRecordingStatus(undefined);
      settlePreparation(exportCoordinator.retain(recording, format));
    },
    [
      captureCandidateLatch,
      exportCoordinator,
      recordingFormat,
      recordingFormatLatch,
      settlePreparation,
    ],
  );

  useEffect(() => {
    let previous = controller.getSnapshot();
    const unsubscribe = controller.subscribe((next) => {
      if (
        previous.lifecycle === next.lifecycle &&
        previous.message === next.message &&
        previous.sessionGeneration === next.sessionGeneration &&
        previous.session === next.session &&
        previous.audioState === next.audioState &&
        previous.cleanupRequired === next.cleanupRequired
      )
        return;
      previous = next;
      // Controller transition snapshots include requested settings. Keep the
      // last acknowledged session on live displays until the operation succeeds.
      if (next.lifecycle === "running" || next.lifecycle === "connected")
        setAppliedSession(next.session);
      else if (!next.session) setAppliedSession(undefined);
      setReceiver(next);
    });
    return unsubscribe;
  }, [controller]);

  useEffect(() => {
    if (autoConnectAttempted.current || (hasSettingsShare(location.hash) || hasRemoteShare(location.hash))) return;
    if (
      source === "usrp-b205" &&
      (!usrpImageChecked ||
        !usrpImageRef.current ||
        !usrpFirmwareChecked ||
        !usrpFirmwareRef.current)
    )
      return;
    if (!sourceCapabilities(source).requiresUsb || !navigator.usb?.getDevices) {
      autoConnectAttempted.current = true;
      return;
    }
    let active = true;
    void navigator.usb
      .getDevices()
      .then((devices) => {
        if (!active || autoConnectAttempted.current) return;
        autoConnectAttempted.current = true;
        const device = selectAuthorizedUsbDevice(devices, source);
        if (!device) return;
        authorizedUsbDevice.current = device;
        void controller.connectGranted(
          {
            source,
            channelFrequencyHz: frequencyMhz * 1_000_000,
            volume,
            modeSettings: currentModeSettings,
            ...(source === "hackrf"
              ? { hardwareSettings }
              : source === "rtl-sdr"
                ? { gainDb }
                : source === "usrp-b205"
                  ? { usrpSettings }
                  : source === "bladerf"
                    ? { bladerfSettings }
                    : {}),
            sampleRateHz,
          },
          device,
        );
      })
      .catch(() => {
        if (active) autoConnectAttempted.current = true;
      });
    return () => {
      active = false;
    };
  }, [
    currentModeSettings,
    bandwidthHz,
    beatToneHz,
    controller,
    frequencyMhz,
    gainDb,
    hardwareSettings,
    mode,
    sampleRateHz,
    source,
    squelch,
    usrpImageChecked,
    usrpImageRef,
    usrpImageRevision,
    usrpFirmwareChecked,
    usrpFirmwareRef,
    usrpSettings,
    bladerfSettings,
    volume,
  ]);

  useEffect(() => {
    if (!sourceCapabilities(source).requiresUsb || !navigator.usb?.getDevices) {
      authorizedUsbDevice.current = undefined;
      return;
    }
    let active = true;
    void navigator.usb
      .getDevices()
      .then((devices) => {
        if (!active) return;
        authorizedUsbDevice.current = selectAuthorizedUsbDevice(
          devices,
          source,
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [receiver.lifecycle, source]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const status = controller.getRecordingStatus();
      setRecordingStatus(status);
      if (surveyCaptureActive.current) return;
      if (
        status?.state === "capacity-reached" &&
        !capacityStopPending.current
      ) {
        capacityStopPending.current = true;
        const recording = controller.finalizeCapacityRecording();
        controller.takeCompletedRecording();
        if (recording) retainCompletedRecording(recording);
        return;
      }
      const completed = controller.takeCompletedRecording();
      if (completed) retainCompletedRecording(completed);
    }, 250);
    return () => window.clearInterval(timer);
  }, [controller, retainCompletedRecording, source]);

  const start = () => {
    void controller.start({
      source,
      channelFrequencyHz: frequencyMhz * 1_000_000,
      volume,
      modeSettings: currentModeSettings,
      ...hardwareOptions,
      sampleRateHz,
    });
  };

  const startReceptionForScan =
    useCallback(async (): Promise<ReceiverSnapshot> => {
      if (controller.getSnapshot().lifecycle === "connected") {
        await controller.start({
          source,
          channelFrequencyHz: frequencyMhz * 1_000_000,
          volume,
          modeSettings: currentModeSettings,
          ...(source === "hackrf"
            ? { hardwareSettings }
            : source === "rtl-sdr"
              ? { gainDb }
              : source === "usrp-b205"
                ? { usrpSettings }
                : source === "bladerf"
                  ? { bladerfSettings }
                  : {}),
          sampleRateHz,
        });
      }
      return controller.getSnapshot();
    }, [
      currentModeSettings,
      controller,
      frequencyMhz,
      gainDb,
      hardwareSettings,
      sampleRateHz,
      source,
      usrpSettings,
      bladerfSettings,
      volume,
    ]);

  const connectReceiver = () => {
    const options = {
      source,
      channelFrequencyHz: frequencyMhz * 1_000_000,
      volume,
      modeSettings: currentModeSettings,
      ...hardwareOptions,
      sampleRateHz,
    };
    const granted = authorizedUsbDevice.current;
    if (granted && usbDeviceMatchesSource(granted, source))
      void controller.connectGranted(options, granted);
    else void controller.connect(options);
  };

  const switchSource = async (nextSource: SourceKind) => {
    if (receiver.lifecycle !== "idle") await controller.disconnect();
    if (controller.getSnapshot().cleanupRequired) return;
    const completed = controller.takeCompletedRecording();
    if (completed) retainCompletedRecording(completed);
    const next = loadSourcePreferences(preferenceStorage, nextSource);
    setMode(next.modeSettings.mode);
    setBandwidthHz(next.modeSettings.bandwidthHz);
    setSquelch(next.modeSettings.squelch);
    setBeatToneHz(next.modeSettings.beatToneHz ?? 600);
    setSrdSettings(next.modeSettings.srd ?? defaultSrdModeSettings());
    setChannelAdvancedOpen(!["OFF", "WBFM", "SRD", "APRS", "RS41"].includes(next.modeSettings.mode));
    setFrequencyMhz(next.frequencyHz / 1_000_000);
    setSampleRateHz(next.sampleRateHz);
    setGainDb(next.gainDb ?? null);
    setHardwareSettings(
      next.hardwareSettings ?? { ...DEFAULT_HACKRF_RX_SETTINGS },
    );
    setUsrpSettings(next.usrpSettings ?? { ...DEFAULT_USRP_B205_RX_SETTINGS });
    setBladeRfSettings(next.bladerfSettings ?? { ...DEFAULT_BLADERF_RX_SETTINGS });
    setSourceAdvancedOpen(false);
    if (nextSource === "replay") {
      setReceiverDockView("capture");
      setReceiverDockExpanded(true);
      setCaptureView("open");
    }
    autoConnectAttempted.current = false;
    if (nextSource === "replay" && loadedReplay) {
      setMode(loadedReplay.metadata.mode);
      setBandwidthHz(loadedReplay.metadata.channelBandwidthHz);
      setSquelch(loadedReplay.metadata.squelch);
      setBeatToneHz(loadedReplay.metadata.beatToneHz ?? 600);
      setSrdSettings(loadedReplay.metadata.srd ?? defaultSrdModeSettings());
      setChannelAdvancedOpen(
        !["OFF", "WBFM", "SRD", "APRS", "RS41"].includes(loadedReplay.metadata.mode),
      );
      setFrequencyMhz(
        loadedReplay.metadata.selectedChannelFrequencyHz / 1_000_000,
      );
      setSampleRateHz(recordingRoutingSampleRate(loadedReplay.metadata));
    }
    setSource(nextSource);
  };

  const updateVolume = (nextVolume: number) => {
    setVolume(nextVolume);
    saveNumber(VOLUME_KEY, nextVolume);
    controller.setVolume(nextVolume);
  };

  const tune = useCallback(
    (frequencyHz: number) => {
      analysis.cancelSignalCenter();
      if (sourceCapabilities(source).frequency.integerHz)
        frequencyHz = Math.round(frequencyHz);
      const nextMhz = frequencyHz / 1_000_000;
      setChannelTuneIssue(undefined);
      setChannelFrequencyDraft(undefined);
      setFrequencyMhz(nextMhz);
      const previousGeneration = controller.getSnapshot().sessionGeneration;
      void controller.tune(frequencyHz).then(() => {
        const snapshot = controller.getSnapshot();
        const accepted = snapshot.session;
        if (snapshot.lifecycle === "running" && snapshot.sessionGeneration === previousGeneration)
          setChannelTuneIssue(snapshot.message);
        if (
          accepted &&
          snapshot.lifecycle === "running" &&
          snapshot.sessionGeneration !== previousGeneration
        )
          setFrequencyMhz(accepted.selectedChannelFrequencyHz / 1_000_000);
        if (accepted?.bladerf?.rxSettings) setBladeRfSettings({ ...accepted.bladerf.rxSettings });
        const completed = controller.takeCompletedRecording();
        if (completed) retainCompletedRecording(completed);
      });
    },
    [analysis, controller, retainCompletedRecording, source],
  );

  const tuneReceiverCenter = async (frequencyHz: number): Promise<string | undefined> => {
    analysis.cancelSignalCenter();
    const before = controller.getSnapshot().sessionGeneration;
    await controller.tuneCenter(frequencyHz);
    const snapshot = controller.getSnapshot();
    const completed = controller.takeCompletedRecording();
    if (completed) retainCompletedRecording(completed);
    if (snapshot.session?.bladerf?.rxSettings) setBladeRfSettings({ ...snapshot.session.bladerf.rxSettings });
    if (snapshot.lifecycle !== "running" || snapshot.sessionGeneration === before)
      return snapshot.message;
    return undefined;
  };

  const applyModeSettings = (rawSettings: ReceiverModeSettings) => {
    try {
      const settings = normalizeModeSettings(rawSettings);
      setBandwidthHz(settings.bandwidthHz);
      setSquelch(settings.squelch);
      setBeatToneHz(settings.beatToneHz ?? beatToneHz);
      const active = controller.getSnapshot().session;
      if (
        active?.mode === settings.mode &&
        !["OFF", "DAB", "ADS-B", "AIS", "SRD", "APRS", "RS41"].includes(settings.mode)
      ) {
        controller.updateAnalogMode(settings);
        return;
      }
      const hadFrequencyEdit = frequencyPending;
      void controller.configureMode(settings).then(() => {
        const accepted = controller.getSnapshot().session;
        if (accepted && !hadFrequencyEdit)
          setFrequencyMhz(accepted.selectedChannelFrequencyHz / 1_000_000);
        if (accepted?.bladerf?.rxSettings) setBladeRfSettings({ ...accepted.bladerf.rxSettings });
        const completed = controller.takeCompletedRecording();
        if (completed) retainCompletedRecording(completed);
      });
    } catch {
      void controller.configureMode(rawSettings);
    }
  };

  const applySquelch = useCallback(
    (value: number) => {
      setSquelch(value);
      if (running)
        controller.updateAnalogMode({
          ...currentModeSettings,
          squelch: value,
        });
    },
    [controller, currentModeSettings, running],
  );

  const chooseMode = (nextMode: ReceiverMode) => {
    const next = defaultModeSettings(nextMode);
    setMode(nextMode);
    setChannelAdvancedOpen(!["OFF", "WBFM", "SRD", "APRS", "RS41"].includes(nextMode));
    setBandwidthHz(next.bandwidthHz);
    setSquelch(next.squelch);
    setBeatToneHz(next.beatToneHz ?? 600);
    setSrdSettings(next.srd ?? defaultSrdModeSettings());
    if (running) applyModeSettings(next);
    if (sourceConfigurationEditable)
      setSampleRateHz(
        compatibleSourceRate(source, nextMode, sampleRateHz) ?? sampleRateHz,
      );
    if (caps.requiresUsb && sourceConfigurationEditable && nextMode === "ADS-B")
      setFrequencyMhz(ADSB_FREQUENCY_HZ / 1_000_000);
    if (caps.requiresUsb && sourceConfigurationEditable && nextMode === "AIS")
      setFrequencyMhz(AIS_CENTER_FREQUENCY_HZ / 1_000_000);
  };

  const applyGain = (nextGain: number | null) => {
    setGainDb(nextGain);
    void controller.setGain(nextGain).then(() => {
      const completed = controller.takeCompletedRecording();
      if (completed) retainCompletedRecording(completed);
    });
  };

  const applySampleRate = async (nextRate: number) => {
    if (transitioning || exportingRecording || atlasTransferActive || recordingStartPending.current) return;
    if (controller.getSnapshot().lifecycle !== "running") {
      setSampleRateHz(nextRate);
      return;
    }
    analysis.cancelSignalCenter();
    await controller.configureSampleRate(nextRate);
    const accepted = controller.getSnapshot().session;
    if (accepted?.source === source) setSampleRateHz(accepted.requestedSampleRateHz);
    const completed = controller.takeCompletedRecording();
    if (completed) retainCompletedRecording(completed);
    setRecordingStatus(controller.getRecordingStatus());
  };

  const applyBladeRfHardware = async () => {
    await controller.configureBladeRf(bladerfSettings);
    const accepted = controller.getSnapshot().session?.bladerf?.rxSettings;
    if (accepted) setBladeRfSettings({ ...accepted });
    const completed = controller.takeCompletedRecording();
    if (completed) retainCompletedRecording(completed);
  };

  const applyHardware = async () => {
    await controller.configureHardware(hardwareSettings);
    const accepted = controller.getSnapshot().session?.hackrf?.captureSettings;
    if (accepted)
      setHardwareSettings({
        kind: "hackrf",
        rxLnaGainCode: accepted.rxLnaGainCode,
        rxVgaGainDb: accepted.rxVgaGainDb,
        rfAmplifierEnabled: accepted.rfAmplifierEnabled,
        antennaPowerEnabled: false,
      });
    const completed = controller.takeCompletedRecording();
    if (completed) retainCompletedRecording(completed);
  };

  const stopReceiver = async () => {
    await controller.stop();
    const completed = controller.takeCompletedRecording();
    if (completed) retainCompletedRecording(completed);
    setRecordingStatus(undefined);
  };

  const disconnectReceiver = async () => {
    await controller.disconnect();
    const completed = controller.takeCompletedRecording();
    if (completed) retainCompletedRecording(completed);
    setRecordingStatus(undefined);
  };

  const recordingStartPending = useRef(false);
  const remoteBlockedReason = running || scanActive ? "Stop receiving or scanning before opening a remote receiver."
    : transitioning || receiver.cleanupRequired || remoteOpening || stationSelectionBusy ? "Wait for the current receiver operation to finish."
    : recordingStatus || exportingRecording || atlasTransferActive || retainedCapturePresent ? "Finish and discard the retained capture before opening a remote receiver."
    : undefined;
  const openRemoteReceiver = async (preset?: RemotePreset): Promise<boolean> => {
    if (remoteBlockedReason || recordingStartPending.current || controller.getRecordingStatus() ||
      !["empty", "discarded"].includes(exportCoordinator.getSnapshot().status) || atlasConnection.getSnapshot().transferActive) {
      setRemoteEntryIssue(remoteBlockedReason ?? "Finish the current receiver operation first."); return false;
    }
    setRemoteOpening(true); setRemoteEntryIssue(""); autoConnectAttempted.current = true;
    try {
      await controller.disconnect();
      if (controller.getSnapshot().cleanupRequired) throw new Error("Release the local receiver before connecting remotely.");
      setRemotePreset(preset);
      setRemoteSelected(true);
      setActiveView("remote");
      return true;
    } catch (reason) { setRemoteEntryIssue((reason as Error).message); return false; }
    finally { setRemoteOpening(false); }
  };

  const stationUseBlockedReason = remoteSelected ? "Return to the local receiver before applying local station settings or favorites." : stationSelectionBusy ? "Applying station settings…"
    : source === "replay" ? "Choose a live receiver source or the demo to use a station."
    : transitioning || scanActive || receiver.cleanupRequired ? "Wait for the receiver operation or scan to finish."
    : recordingStatus || exportingRecording ? "Stop recording and finish preparation before selecting a station."
    : atlasTransferActive ? "Wait for the Atlas transfer to finish or cancel it before selecting a station."
    : retainedCapturePresent ? "Download and discard the retained capture before selecting another station."
    : undefined;
  const stationUseBlockedRef = useRef(stationUseBlockedReason);
  stationUseBlockedRef.current = stationUseBlockedReason;
  const useAtlasStation = async (candidate: ReceptionCandidate): Promise<string> => {
    if (stationUseBlockedRef.current || recordingStartPending.current || stationSelectionPending.current ||
        controller.getRecordingStatus() || !["empty", "discarded"].includes(exportCoordinator.getSnapshot().status) ||
        atlasConnection.getSnapshot().transferActive || selectedSourceRef.current !== source)
      throw new Error(stationUseBlockedRef.current ?? "Receiver context changed. Finish the current capture or operation and select again.");
    stationSelectionPending.current = true;
    setStationSelectionBusy(true);
    analysis.cancelSignalCenter();
    try {
      const result = await applyReceptionCandidate(controller, candidate, { source, channelFrequencyHz: candidate.frequency_hz,
        modeSettings: currentModeSettings, sampleRateHz, ...hardwareOptions });
      if (selectedSourceRef.current !== source) throw new Error("Receiver source changed. Select the station again.");
      // Selecting a reference never initiates the app's authorized-device reconnect path.
      autoConnectAttempted.current = true;
      setMode(result.settings.mode);
      setBandwidthHz(result.settings.bandwidthHz);
      setSquelch(result.settings.squelch);
      setFrequencyMhz(result.frequencyHz / 1e6);
      setChannelFrequencyDraft(undefined);
      setChannelTuneIssue(undefined);
      setChannelAdvancedOpen(result.settings.mode !== "WBFM");
      setReceptionCandidate(result.candidate);
      return `Receiver candidate selected. Requested bandwidth ${candidate.bandwidth_hz.toLocaleString()} Hz; applied ${result.settings.bandwidthHz.toLocaleString()} Hz. Start remains manual; station identity is unconfirmed.`;
    } finally {
      const completed = controller.takeCompletedRecording();
      if (completed) retainCompletedRecording(completed);
      stationSelectionPending.current = false;
      setStationSelectionBusy(false);
    }
  };
  const recallFavorite = async (bookmark: Bookmark): Promise<string> => {
    if (stationUseBlockedRef.current || recordingStartPending.current || stationSelectionPending.current ||
        controller.getRecordingStatus() || !["empty", "discarded"].includes(exportCoordinator.getSnapshot().status) ||
        atlasConnection.getSnapshot().transferActive || selectedSourceRef.current !== source)
      throw new Error(stationUseBlockedRef.current ?? "Finish the current capture or receiver operation first.");
    stationSelectionPending.current = true;
    setStationSelectionBusy(true);
    analysis.cancelSignalCenter();
    try {
      const { bookmark: accepted, sampleRateHz: nextRate } = await applyBookmark(controller, bookmark, { source, channelFrequencyHz: frequencyMhz * 1e6, modeSettings: currentModeSettings, sampleRateHz, ...hardwareOptions });
      if (selectedSourceRef.current !== source) throw new Error("Source changed. Recall the favorite again.");
      autoConnectAttempted.current = true;
      setMode(accepted.settings.mode);
      setBandwidthHz(accepted.settings.bandwidthHz);
      setSquelch(accepted.settings.squelch);
      setBeatToneHz(accepted.settings.beatToneHz ?? 600);
      setSrdSettings(accepted.settings.srd ?? defaultSrdModeSettings());
      if (!running) setSampleRateHz(nextRate);
      setFrequencyMhz(accepted.frequencyHz / 1e6);
      setChannelFrequencyDraft(undefined);
      setChannelTuneIssue(undefined);
      // A stored catalog reference is not a freshly checked receiver candidate.
      setReceptionCandidate(undefined);
      setChannelAdvancedOpen(!["OFF", "WBFM", "SRD", "APRS", "RS41"].includes(accepted.settings.mode));
      return `Recalled ${accepted.name}. ${running ? "Applied to reception." : "Start remains manual."}${accepted.atlasReference ? " Saved Atlas reference has not been rechecked; station identity is unconfirmed." : ""}`;
    } finally {
      stationSelectionPending.current = false;
      setStationSelectionBusy(false);
    }
  };
  const applySharedSettings = async (shared: SharedSettings) => {
    if (remoteSelected) throw new Error("Return to the local receiver before applying shared settings.");
    if (controller.getSnapshot().lifecycle === "running") throw new Error("Stop reception before applying shared settings.");
    await recallFavorite(sharedSettingsBookmark(shared));
    setSpectrumDisplay({ floorDb: shared.display.floorDb, rangeDb: shared.display.rangeDb });
    setLayout((old) => ({ ...old, compact: shared.display.compact }));
  };
  const saveFavoriteBlockedReason = remoteSelected ? "Remote presets are separate from local Favorites and settings sharing." : transitioning ? "Wait for the receiver operation to finish."
    : !frequencyValid || frequencyPending || channelFrequencyDraft !== undefined ? "Apply or cancel the channel frequency edit before saving."
    : undefined;
  const newFavorite = () => {
    try {
      setFavoriteDraft(validateBookmark({ id: crypto.randomUUID(), name: `${frequencyMhz} MHz ${mode}`, frequencyHz: Math.round(frequencyMhz * 1e6), settings: normalizeModeSettings(currentModeSettings), tags: [], notes: "", sourceHint: source,
        ...(receptionCandidate?.frequency_hz === Math.round(frequencyMhz * 1e6) && receptionCandidate.mode === mode ? { atlasReference: receptionCandidate } : {}) }));
    } catch (error) { setChannelTuneIssue(error instanceof Error ? error.message : "Check channel settings before saving."); }
  };
  const saveAtlasFavorite = (candidate: ReceptionCandidate) => {
    favorites.change((items) => [...items, bookmarkFromCandidate(candidate)]);
  };
  const startRecording = async () => {
    const captureSite = antennaSite.site;
    if (recordingStartPending.current || stationSelectionPending.current) return;
    recordingStartPending.current = true;
    let status: RecordingStatus | undefined;
    try {
      const storageMode = await prepareRecordingStorage();
      status = controller.startRecording(undefined, { captureCurrentChannel, storageMode, receiverLocation: captureSite });
      if (status) captureCandidateLatch.begin(receptionCandidate, controller.getSnapshot().session);
    }
    catch (error) { setRecordingMessage(error instanceof Error ? error.message : "Recording could not start."); return; }
    finally { recordingStartPending.current = false; }
    setRecordingStatus(status);
    if (status) {
      if (captureDuration > 0) captureTimer.current = setTimeout(() => {
        const completed = controller.stopRecording();
        controller.takeCompletedRecording();
        setRecordingStatus(undefined);
        if (completed) retainCompletedRecording(completed);
      }, captureDuration * 1000);
      recordingFormatLatch.begin(recordingFormat);
      const destination = status.storage === "opfs"
        ? "private browser storage"
        : "bounded memory";
      setRecordingMessage(
        recordingFormat === "sigmf"
          ? `Recording ${encoding.toUpperCase()} I/Q to ${destination}. Stop to prepare paired SigMF data and metadata.`
          : `Recording ${encoding.toUpperCase()} I/Q to ${destination}. Stop to prepare the BrowserSDR binary and JSON sidecar.`,
      );
    }
  };

  useEffect(() => () => { if (captureTimer.current) clearTimeout(captureTimer.current); }, []);

  const stopRecording = () => {
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = undefined;
    const recording = controller.stopRecording();
    setRecordingStatus(undefined);
    if (recording) {
      controller.takeCompletedRecording();
      retainCompletedRecording(recording);
    }
  };

  const retryRecordingPreparation = () =>
    settlePreparation(exportCoordinator.retryPreparation());

  const downloadRecordingFilesDirectly = async () => {
    setRecordingMessage(
      "Preparing separate files in this page, without the recording worker…",
    );
    setExportingRecording(true);
    const result = await exportCoordinator.requestDirectFileDownload();
    setExportingRecording(false);
    setRetainedCapture(exportCoordinator.getSnapshot());
    if (result.status === "download-requested") {
      setRecordingMessage(
        `Separate-file downloads requested for ${result.name}. This recovery path does not contact SigIntAtlas. Browser download requests do not confirm that the files were stored.`,
      );
    } else if (result.status === "failure") {
      setRecordingMessage(
        `${result.error.message} The completed recording is available in this tab.`,
      );
    }
  };

  const requestRecordingDownload = async (kind: RecordingDownloadKind) => {
    setRecordingMessage("Preparing recording download…");
    setExportingRecording(true);
    const result = await exportCoordinator.requestDownload(kind);
    setExportingRecording(false);
    setRetainedCapture(exportCoordinator.getSnapshot());
    if (result.status === "download-requested") {
      setRecordingMessage(
        `${kind === "archive" ? "Archive" : "Separate-file"} download requested for ${result.name}. Browser download requests do not confirm that the file was stored; the prepared capture remains available for retry.`,
      );
    } else if (result.status === "failure")
      setRecordingMessage(
        `${result.error.message} The prepared capture remains available.`,
      );
  };

  const discardPreparedRecording = () => {
    exportCoordinator.discard();
    setAtlasPrepared(undefined);
    setRetainedCapture(exportCoordinator.getSnapshot());
    setRecordingMessage("Prepared recording discarded from memory.");
  };

  const captureSurveyCandidates = useCallback(
    async (
      candidates: SurveyCandidateRecord[],
      profile: SurveyProfile,
      sessionId: string,
      signal: AbortSignal,
    ): Promise<{ captured: number[]; cancelled: boolean }> => {
      const snapshot = controller.getSnapshot();
      if (snapshot.lifecycle !== "running" || !snapshot.session)
        throw new Error(
          "Keep reception running while capturing survey candidates.",
        );
      const captured: number[] = [];
      const originalFrequencyHz = snapshot.session.selectedChannelFrequencyHz;
      let cancelled = false;
      surveyCaptureActive.current = true;
      setExportingRecording(true);
      controller.setVolume(0);
      try {
        for (const candidate of candidates) {
          if (signal.aborted)
            throw new DOMException("Candidate capture cancelled", "AbortError");
          if (exportCoordinator.blocksNewCapture)
            throw new Error(
              "Request or discard the retained recording before capturing another candidate.",
            );
          const band = profile.bands.find(
            (entry) => entry.id === candidate.bandId,
          );
          const captureFrequencyHz = sourceCapabilities(snapshot.session.source)
            .frequency.integerHz
            ? Math.round(candidate.frequencyHz)
            : candidate.frequencyHz;
          const captureTune = await controller.scanTune(captureFrequencyHz);
          if (!captureTune)
            throw new Error(
              `Could not tune ${captureFrequencyHz} Hz for capture.`,
            );
          if (signal.aborted)
            throw new DOMException("Candidate capture cancelled", "AbortError");
          const tuned = controller.getSnapshot();
          if (tuned.lifecycle !== "running" || !tuned.session)
            throw new Error(
              `Could not tune ${candidate.frequencyHz} Hz for capture.`,
            );
          await waitForCaptureDelay(250, signal);
          const maximumSeconds = Math.max(
            1,
            recordingCapacitySeconds(tuned.session.actualSampleRateHz) - 0.5,
          );
          const requestedSeconds = band?.captureSeconds ?? 10;
          const captureSeconds = Math.min(requestedSeconds, maximumSeconds);
          recordingFormatLatch.begin("sigmf");
          const storageMode = await prepareRecordingStorage();
          const status = controller.startRecording({
            sessionId,
            profileName: profile.name,
            site: profile.site,
            bandName: candidate.bandName,
            detector: candidate.detector,
            signal: candidate.annotation,
          }, { storageMode });
          if (status) captureCandidateLatch.begin(undefined, tuned.session);
          if (!status) {
            recordingFormatLatch.complete("sigmf");
            throw new Error(
              `Could not start the ${candidate.frequencyHz} Hz recording.`,
            );
          }
          setRecordingStatus(status);
          setFileMessage(
            `Survey capture ${captured.length + 1}/${candidates.length}: ${candidate.frequencyHz.toLocaleString()} Hz for ${captureSeconds.toFixed(1)} s…`,
          );
          await waitForRecordingCompletion(
            controller,
            captureSeconds * 1_000,
            signal,
          );
          const stopped = controller.stopRecording();
          const recording = stopped ?? controller.takeCompletedRecording();
          if (stopped) controller.takeCompletedRecording();
          setRecordingStatus(undefined);
          if (!recording)
            throw new Error(
              `The ${candidate.frequencyHz} Hz recording did not complete.`,
            );
          const result = await exportCoordinator.retain(
            recording,
            recordingFormatLatch.complete("sigmf"),
          );
          if (result.status === "failure") throw result.error;
          if (result.status !== "prepared")
            throw new Error(
              "A previous completed recording still owns the export slot.",
            );
          const request = await exportCoordinator.requestDownload(
            "archive",
            undefined,
            undefined,
            signal,
          );
          if (request.status === "failure") throw request.error;
          setRetainedCapture(exportCoordinator.getSnapshot());
          if (recording.metadata.stopReason === "source-stop")
            throw new Error(
              `The source stopped during the ${candidate.frequencyHz} Hz capture; its partial SigMF archive was requested and retained.`,
            );
          captured.push(candidate.frequencyHz);
          setFileMessage(
            `Survey SigMF archive download requested for ${result.prepared.basename} (${captured.length}/${candidates.length}); storage is not confirmed.`,
          );
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          cancelled = true;
        else throw error;
      } finally {
        if (controller.getRecordingStatus()) {
          const stopped = controller.stopRecording();
          const partial = stopped ?? controller.takeCompletedRecording();
          if (stopped) controller.takeCompletedRecording();
          if (partial) {
            const retained = await exportCoordinator.retain(
              partial,
              recordingFormatLatch.complete("sigmf"),
            );
            if (retained.status === "prepared")
              await exportCoordinator.requestDownload("archive");
          }
        }
        surveyCaptureActive.current = false;
        setRecordingStatus(undefined);
        setRetainedCapture(exportCoordinator.getSnapshot());
        if (["running", "tuning"].includes(controller.getSnapshot().lifecycle))
          await controller.tune(originalFrequencyHz);
        controller.setVolume(volume);
        setExportingRecording(false);
      }
      return { captured, cancelled };
    },
    [captureCandidateLatch, controller, exportCoordinator, recordingFormatLatch, volume],
  );

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextView: AppView | undefined;
    const views: AppView[] = remoteSelected ? ["receiver"] : ["receiver", "explorer"];
    const currentIndex = event.currentTarget.id === "explorer-tab" ? 1 : 0;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const direction = event.key === "ArrowRight" ? 1 : -1;
      nextView =
        views[(currentIndex + direction + views.length) % views.length];
    } else if (event.key === "Home") {
      nextView = "receiver";
    } else if (event.key === "End") {
      nextView = remoteSelected ? "receiver" : "explorer";
    }
    if (!nextView) return;
    event.preventDefault();
    setActiveView(nextView);
    window.requestAnimationFrame(() =>
      document.getElementById(`${nextView}-tab`)?.focus(),
    );
  };

  const handleCompatibilityTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
  ) => {
    const views: CompatibilityDetailView[] = ["modes", "recording", "browsers"];
    const currentIndex = views.indexOf(compatibilityDetailView);
    let nextView: CompatibilityDetailView | undefined;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const direction = event.key === "ArrowRight" ? 1 : -1;
      nextView =
        views[(currentIndex + direction + views.length) % views.length];
    } else if (event.key === "Home") {
      nextView = views[0];
    } else if (event.key === "End") {
      nextView = views[views.length - 1];
    }
    if (!nextView) return;
    event.preventDefault();
    setCompatibilityDetailView(nextView);
    window.requestAnimationFrame(() =>
      document.getElementById(`compatibility-${nextView}-tab`)?.focus(),
    );
  };

  const activateReplay = async (recording: IqRecording, message: string) => {
    await controller.disconnect();
    if (controller.getSnapshot().cleanupRequired) {
      setFileMessage("Retry disconnect before loading replay.");
      return;
    }
    replayRef.current = recording;
    setLoadedReplay(recording);
    setFrequencyMhz(recording.metadata.selectedChannelFrequencyHz / 1_000_000);
    setMode(recording.metadata.mode);
    setChannelAdvancedOpen(!["OFF", "WBFM", "SRD", "APRS", "RS41"].includes(recording.metadata.mode));
    setBandwidthHz(recording.metadata.channelBandwidthHz);
    setSquelch(recording.metadata.squelch);
    setBeatToneHz(recording.metadata.beatToneHz ?? 600);
    setSampleRateHz(recordingRoutingSampleRate(recording.metadata));
    setSource("replay");
    setFileMessage(message);
  };

  const loadReplayFiles = async () => {
    if (!replayBinary || !replayMetadata) return;
    try {
      if (replayBinary.size > RECORDING_MAX_BYTES)
        throw new Error("Replay file exceeds the 32 MiB limit.");
      if (replayMetadata.size > RECORDING_METADATA_MAX_BYTES)
        throw new Error("Recording metadata exceeds the 1 MiB limit.");
      if (replayImportFormat === "sigmf")
        selectedSigmfModeSettings(sigmfReplayMode);
      const metadataText = await replayMetadata.text();
      const binary = await replayBinary.arrayBuffer();
      let recording: IqRecording;
      if (replayImportFormat === "sigmf") {
        recording = await importSigmfRecording(metadataText, binary, {
          modeSettings: selectedSigmfModeSettings(sigmfReplayMode),
          ...(sigmfChannelChoice === "custom"
            ? {
                selectedChannelFrequencyHz: Number(sigmfChannelMhz) * 1_000_000,
              }
            : {}),
          dataFilename: replayBinary.name,
          metadataFilename: replayMetadata.name,
        });
      } else {
        recording = parseRecording(metadataText, binary);
      }
      await activateReplay(
        recording,
        replayImportFormat === "sigmf"
          ? `Loaded SigMF replay: ${recording.metadata.sampleCount.toLocaleString()} samples (${recording.metadata.durationSeconds.toFixed(3)} s).`
          : `Loaded ${recording.metadata.sampleCount.toLocaleString()} samples (${recording.metadata.durationSeconds.toFixed(3)} s).`,
      );
    } catch (error) {
      setLoadedReplay(undefined);
      replayRef.current = undefined;
      setFileMessage(
        error instanceof Error ? error.message : "Could not load recording.",
      );
    }
  };

  const activeSession = receiver.session;
  const activeHackrfSettings = activeSession?.hackrf?.captureSettings;
  const compatibilityReportContext: CompatibilityReportContext = {
    lifecycle: receiver.lifecycle,
    source: activeSession?.source ?? source,
    deviceProfile: caps.label,
    mode: activeSession?.mode ?? mode,
    sampleRateHz: activeSession?.actualSampleRateHz ?? sampleRateHz,
    nativeSampleRateHz:
      activeSession?.usrpB205?.nativeSampleRateHz ??
      activeSession?.hackrf?.nativeSampleRateHz ??
      activeSession?.bladerf?.nativeSampleRateHz ??
      activeSession?.actualSampleRateHz ??
      null,
    bandwidthHz: activeSession?.channelBandwidthHz ?? bandwidthHz,
    squelch: activeSession?.squelch ?? squelch,
    gainMode:
      activeSession?.source === "hackrf" || source === "hackrf"
        ? "staged"
        : activeSession?.source === "usrp-b205" || source === "usrp-b205"
          ? "slow-attack-agc"
          : activeSession?.source === "bladerf" || source === "bladerf"
            ? (activeSession?.bladerf?.gainMode ?? "slow-attack-agc")
            : activeSession?.source === "rtl-sdr" || source === "rtl-sdr"
              ? (activeSession?.gainDb ?? gainDb) === null
                ? "automatic"
                : "manual"
              : "not-applicable",
    gainDb:
      activeSession?.source === "rtl-sdr" || source === "rtl-sdr"
        ? (activeSession?.gainDb ?? gainDb)
        : null,
    lnaGainCode:
      activeHackrfSettings?.rxLnaGainCode ??
      (source === "hackrf" ? hardwareSettings.rxLnaGainCode : null),
    vgaGainDb:
      activeHackrfSettings?.rxVgaGainDb ??
      (source === "hackrf" ? hardwareSettings.rxVgaGainDb : null),
    rfAmplifierEnabled:
      activeHackrfSettings?.rfAmplifierEnabled ??
      (source === "hackrf" ? hardwareSettings.rfAmplifierEnabled : null),
    antennaPowerEnabled:
      activeHackrfSettings?.antennaPowerEnabled ??
      (source === "hackrf" ? hardwareSettings.antennaPowerEnabled : null),
    firmwareVersion:
      activeSession?.hackrf?.capabilities.identity.firmwareVersion ??
      (activeSession?.usrpB205
        ? `${activeSession.usrpB205.capabilities.firmware.major}.${activeSession.usrpB205.capabilities.firmware.minor}`
        : null) ??
      (activeSession?.bladerf
        ? `${activeSession.bladerf.identity.firmware.major}.${activeSession.bladerf.identity.firmware.minor}`
        : null),
    usbApiVersion:
      activeSession?.hackrf?.capabilities.identity.usbApiVersion ?? null,
    protocolProfile:
      activeSession?.hackrf?.capabilities.protocolProfile ??
      activeSession?.usrpB205?.capabilities.protocolProfile ??
      activeSession?.bladerf?.protocolProfile ??
      null,
    recordingActive: Boolean(recordingStatus),
    audioState: receiver.audioState ?? null,
    ...(Number.isFinite(
      activeSession?.selectedChannelFrequencyHz ?? frequencyMhz * 1_000_000,
    )
      ? {
          exactFrequencyHz:
            activeSession?.selectedChannelFrequencyHz ??
            frequencyMhz * 1_000_000,
        }
      : {}),
  };

  return (
    <main
      className={`app-shell${(activeView === "receiver" || activeView === "remote") ? " receiver-workspace" : ""}${layout.compact ? " density-compact" : ""}${layout.sourceCollapsed ? " source-collapsed" : ""}${layout.channelCollapsed ? " channel-collapsed" : ""}`}
    >
      <div className="app-topbar">
        <header className="app-header">
          <div className="brand-lockup">
            <img
              className="brand-logo"
              src={`${import.meta.env.BASE_URL}brand/logo-observatory-dish-v3-theme-aligned.png`}
              alt=""
              width="1254"
              height="1254"
            />
            <div className="brand-copy">
              <div className="brand-heading">
                <h1 className="brand-name">BrowserSDR</h1>
                <p className="brand-tagline">Listen closer.</p>
              </div>
              <p className="subtitle">
                A local software-defined radio workspace, built for the browser.
              </p>
            </div>
          </div>
        </header>

        <nav className="view-tabs" aria-label="Application views">
          <div role="tablist" aria-label="BrowserSDR views">
            <button
              type="button"
              role="tab"
              id="receiver-tab"
              aria-selected={activeView === "receiver" || activeView === "remote"}
              aria-controls={activeView === "remote" ? "remote-view" : "receiver-view"}
              tabIndex={lastWorkspace === "receiver" ? 0 : -1}
              onClick={() => setActiveView("receiver")}
              onKeyDown={handleTabKeyDown}
            >
              <span className="icon-label"><AppIcon name="radio" />Receiver</span>
              <small>Tune, listen & record</small>
            </button>
            <button
              type="button"
              role="tab"
              id="explorer-tab"
              disabled={remoteSelected}
              title={remoteSelected ? "Select a local I/Q source to use Explorer." : undefined}
              aria-selected={activeView === "explorer"}
              aria-controls="explorer-view"
              tabIndex={lastWorkspace === "explorer" ? 0 : -1}
              onClick={() => setActiveView("explorer")}
              onKeyDown={handleTabKeyDown}
            >
              <span className="icon-label"><AppIcon name="search" />Explorer</span>
              <small>Scan & investigate</small>
            </button>
          </div>
          <p>
            {activeView === "receiver" || activeView === "remote"
              ? "Live radio workspace"
              : activeView === "explorer"
                ? "Wideband spectrum survey"
                : activeView === "settings"
                  ? "Integration settings"
                : activeView === "diagnostics"
                  ? "Session health and browser support"
                  : activeView === "help"
                    ? "Answers, setup and compatibility"
                    : "Licences, privacy and provenance"}
          </p>
        </nav>
        <WorkspaceControls layout={layout} onChange={setLayout} activeView={activeView}
          onSettings={() => openAuxiliaryView("settings")}
          onHelp={() => openAuxiliaryView("help")}
          onAbout={() => openAuxiliaryView("about")}
        />
        {remoteSelected ? <div className="receiver-status remote-header-status" role="status">Remote · {remoteStatus}</div> : <ReceiverStatus
          receiver={receiver}
          spectrum={spectrumStatus}
          recording={recordingStatus}
          preparing={exportingRecording}
          retained={retainedCapture}
          recordingSupported={recordingSupported}
          onReceiver={() => openAuxiliaryView("diagnostics")}
          onSpectrum={() => openAuxiliaryView("diagnostics")}
          onRecording={() => {
            setActiveView("receiver");
            setReceiverDockExpanded(true);
            setReceiverDockView("capture");
            setCaptureView("record");
            requestAnimationFrame(() => document.getElementById("recording-heading")?.scrollIntoView({ block: "center" }));
          }}
          onReport={() => {
            window.dispatchEvent(new Event(OPEN_DIAGNOSTIC_REPORT_EVENT));
            setActiveView("diagnostics");
          }}
        >
          {receiver.issue && (
            <ReceiverRecovery
              key={`${receiver.sessionGeneration}-${receiver.issue.code}`}
              issue={receiver.issue}
              cleanupRequired={Boolean(receiver.cleanupRequired)}
              activeConnection={hardwareConnected}
              os={helpOs}
              onOsChange={setHelpOs}
              onRelease={() => void disconnectReceiver()}
              onRetry={() => {
                if (receiver.issue?.code === "audio-blocked" || !caps.persistentConnection) start();
                else connectReceiver();
              }}
              onReviewSettings={() => {
                setActiveView("receiver");
                setLayout((old) => ({ ...old, sourceCollapsed: false }));
                requestAnimationFrame(() => {
                document.querySelector<HTMLSelectElement>('[aria-label="Signal source"]')?.focus();
                document.querySelector(".acquire-stage")?.scrollIntoView({ block: "nearest" });
                });
              }}
              disabled={transitioning || scanActive}
            />
          )}
        </ReceiverStatus>}
      </div>

      {activeView !== "receiver" && activeView !== "remote" && activeView !== "explorer" && (
        <div className="auxiliary-view-header">
          <button id="auxiliary-return" type="button" className="secondary" onClick={() => {
            setActiveView(lastWorkspace);
            requestAnimationFrame(() => document.getElementById(`${lastWorkspace}-tab`)?.focus());
          }}>Back to {lastWorkspace === "receiver" ? "Receiver" : "Explorer"}</button>
          <span>{activeView === "settings" ? "Integration settings" : activeView === "help" ? "Help & setup" : activeView === "about" ? "About BrowserSDR" : "Diagnostics"}</span>
        </div>
      )}

      <ReceiverWorkspace id="receiver-view" hidden={activeView !== "receiver"}>
        <section
          className="control-panel signal-chain-panel"
          aria-labelledby="receiver-heading"
        >
          <h2 id="receiver-heading" className="visually-hidden">
            Receive and demodulate
          </h2>

          <div className="signal-map" aria-label="Receiver signal flow">
            <span>Acquire</span>
            <i aria-hidden="true">→</i>
            <span>Tune & demodulate</span>
            <i aria-hidden="true">→</i>
            <span>Listen & decode</span>
            <small>Analysis and capture tap the I/Q stream in parallel.</small>
          </div>

          <div className="signal-stage-grid">
            <section
              className="signal-stage acquire-stage"
              aria-labelledby="acquire-heading"
            >
              <div className="stage-heading">
                <span aria-hidden="true">01</span>
                <div>
                  <p>Acquire</p>
                  <h3 id="acquire-heading" className="icon-label"><AppIcon name="radio" />Signal source</h3>
                </div>
                <button type="button" className="stage-collapse secondary" aria-label={layout.sourceCollapsed ? "Expand source panel" : "Collapse source panel"} aria-expanded={!layout.sourceCollapsed} aria-controls="source-stage-body" onClick={() => setLayout((old) => ({ ...old, sourceCollapsed: !old.sourceCollapsed }))}>{layout.sourceCollapsed ? "+" : "−"}</button>
              </div>
              <div id="source-stage-body" className="stage-body" hidden={layout.sourceCollapsed}>
              <div className="stage-controls acquire-controls">
                <label>
                  Source
                  <select
                    value={source}
                    disabled={
                      transitioning || Boolean(receiver.cleanupRequired)
                    }
                    onChange={(event) =>
                      event.currentTarget.value === "remote" ? void openRemoteReceiver() : void switchSource(event.currentTarget.value as SourceKind)
                    }
                    aria-label="Signal source"
                  >
                    <ReceiverSourceOptions remoteDisabled={Boolean(remoteBlockedReason)} />
                  </select>
                </label>
                {(remoteBlockedReason || remoteEntryIssue) && <p className="remote-entry-hint">{remoteEntryIssue || remoteBlockedReason}</p>}
                {(source === "usrp-b205" || source === "bladerf") && (
                  <div className="setup-checklist" aria-label="Setup files">
                    <p className="setup-caption">
                      Setup files · saved in this browser
                    </p>
                    {source === "usrp-b205" ? (
                      <>
                        <SetupFileRow
                          name="Firmware"
                          verified={Boolean(usrpFirmwareRef.current)}
                          checking={!usrpFirmwareChecked}
                          importing={importingUsrpFirmware}
                          disabled={
                            transitioning ||
                            hardwareConnected ||
                            Boolean(receiver.cleanupRequired)
                          }
                          accept=".zip,.hex,application/zip,text/plain,application/octet-stream"
                          error={usrpFirmwareError}
                          onChange={(event) =>
                            void importUsrpFirmwareFile(event)
                          }
                        />
                        <SetupFileRow
                          name="FPGA image"
                          verified={Boolean(usrpImageRef.current)}
                          checking={!usrpImageChecked}
                          importing={importingUsrpImage}
                          disabled={
                            transitioning ||
                            hardwareConnected ||
                            Boolean(receiver.cleanupRequired)
                          }
                          accept=".zip,.bin,application/zip,application/octet-stream"
                          error={usrpImageError}
                          onChange={(event) => void importUsrpImage(event)}
                        />
                      </>
                    ) : (
                      <SetupFileRow
                        name="FPGA image"
                        verified={storedFpgaImages.length > 0}
                        importing={importingFpgaImage}
                        disabled={
                          transitioning ||
                          hardwareConnected ||
                          Boolean(receiver.cleanupRequired)
                        }
                        accept=".rbf,application/octet-stream"
                        error={fpgaImageError}
                        onChange={(event) => void importFpgaImage(event)}
                      />
                    )}
                    <details className="setup-downloads">
                      <summary>Get official files</summary>
                      {source === "usrp-b205" ? (
                        <div>
                          <p>Download each archive, then import it above.</p>
                          <a
                            href={USRP_B205_FIRMWARE.archiveUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Firmware from Ettus
                          </a>
                          <a
                            href={USRP_B205_IMAGE.archiveUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            FPGA image from Ettus
                          </a>
                        </div>
                      ) : (
                        <div>
                          <p>
                            Download the image matching your device firmware,
                            then import the .rbf above.
                          </p>
                          {BLADERF_HOSTED_IMAGES.map((image) => (
                            <a
                              key={`${image.model}-${image.version}`}
                              href={image.upstreamUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              hosted{image.model} v{image.version} · firmware{" "}
                              {image.version === "0.15.3" ? "2.4" : "2.5+"}
                            </a>
                          ))}
                        </div>
                      )}
                    </details>
                  </div>
                )}
                {caps.requiresUsb &&
                  !hardwareConnected &&
                  !transitioning &&
                  !receiver.cleanupRequired && (
                    <ConnectionReadiness
                      source={source}
                      availability={usbAvailability()}
                      os={helpOs}
                      onOsChange={setHelpOs}
                    />
                  )}
                {caps.persistentConnection ? (
                  <div className="connection-stack">
                    <div className={`acquire-connection-control ${hardwareConnected ? "is-connected" : ""}`}>
                      <span
                        className={`acquire-connection-status ${hardwareConnected ? "is-connected" : ""}`}
                        role="status"
                      >
                        {hardwareConnected
                          ? running
                            ? "Receiving"
                            : "Connected"
                          : receiver.lifecycle === "requesting-permission"
                            ? "Choose your device in the USB dialog"
                            : receiver.lifecycle === "connecting"
                              ? "Preparing device"
                              : receiver.lifecycle === "disconnecting"
                                ? "Disconnecting…"
                                : receiver.cleanupRequired
                                  ? "Disconnect to release the device"
                                  : receiver.issue?.code === "selection-cancelled"
                                    ? "Not connected"
                                    : receiver.lifecycle === "error"
                                      ? "Needs attention"
                                      : "Not connected"}
                      </span>
                      {hardwareConnected ||
                      receiver.cleanupRequired ||
                      receiver.lifecycle === "disconnecting" ? (
                        <button
                          type="button"
                          className="acquire-disconnect secondary"
                          onClick={() => void disconnectReceiver()}
                          disabled={
                            scanActive || receiver.lifecycle === "disconnecting"
                          }
                        >
                          {receiver.lifecycle === "disconnecting"
                            ? "Disconnecting…"
                            : "Disconnect"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={`acquire-connect ${receiver.lifecycle === "connecting" ? "is-connecting" : ""}`}
                          aria-busy={
                            receiver.lifecycle === "connecting" ||
                            receiver.lifecycle === "requesting-permission"
                          }
                          onClick={connectReceiver}
                          disabled={
                            importingUsrpImage ||
                            importingUsrpFirmware ||
                            importingFpgaImage ||
                            (source === "usrp-b205" &&
                              (!usrpImageChecked ||
                                !usrpImageRef.current ||
                                !usrpFirmwareChecked ||
                                !usrpFirmwareRef.current)) ||
                            (receiver.lifecycle !== "idle" &&
                              receiver.lifecycle !== "error")
                          }
                        >
                          <AppIcon name="plug" />
                          <span>
                            {receiver.lifecycle === "requesting-permission"
                              ? "Choose USB device…"
                              : receiver.lifecycle === "connecting"
                                ? source === "usrp-b205"
                                  ? "Connecting & initializing…"
                                  : "Connecting…"
                                : receiver.lifecycle === "error" && receiver.issue?.code !== "selection-cancelled"
                                  ? "Retry connection"
                                  : "Connect"}
                          </span>
                        </button>
                      )}
                    </div>
                    {receiver.issue && receiver.issue.code !== "selection-cancelled" && (
                      <button
                        type="button"
                        className="acquire-recovery-link secondary"
                        onClick={() => {
                          const statusMenu = document.querySelector<HTMLDetailsElement>(".receiver-status-menu");
                          if (statusMenu) statusMenu.open = true;
                          const details = document.querySelector<HTMLDetailsElement>(".receiver-recovery .connection-help-details");
                          if (details) {
                            details.open = true;
                            details.querySelector<HTMLElement>("summary")?.focus();
                            details.scrollIntoView({ block: "nearest" });
                          }
                        }}
                      >
                        <AppIcon name="help" />Recovery help
                      </button>
                    )}
                    {(receiver.lifecycle === "connecting" ||
                      receiver.lifecycle === "requesting-permission") && (
                      <button
                        type="button"
                        className="acquire-disconnect secondary"
                        onClick={() => void disconnectReceiver()}
                      >
                        <AppIcon name="unplug" />Cancel connection
                      </button>
                    )}
                    {source === "usrp-b205" &&
                    receiver.lifecycle === "connecting" ? (
                      <p className="acquire-hint">
                        This can take several seconds after reconnecting.
                      </p>
                    ) : source === "usrp-b205" &&
                      (!usrpImageRef.current || !usrpFirmwareRef.current) ? (
                      <p className="acquire-hint">
                        Import both files to enable Connect.
                      </p>
                    ) : source === "bladerf" && !storedFpgaImages.length ? (
                      <p className="acquire-hint">
                        Connect checks whether an FPGA image is needed.
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="acquire-receive"
                      onClick={
                        running || receiver.lifecycle === "tuning"
                          ? () => void stopReceiver()
                          : start
                      }
                      disabled={
                        scanActive ||
                        !["connected", "running", "tuning"].includes(
                          receiver.lifecycle,
                        )
                      }
                    >
                      <AppIcon name={running || receiver.lifecycle === "tuning" ? "stop" : "play"} />
                      {receiver.lifecycle === "starting"
                        ? "Starting…"
                        : receiver.lifecycle === "stopping"
                          ? "Stopping…"
                          : running || receiver.lifecycle === "tuning"
                            ? "Stop receiving"
                            : "Start receiving"}
                    </button>
                  </div>
                ) : (
                  <div className="transport" aria-label="Receiver transport">
                    <button
                      type="button"
                      onClick={start}
                      disabled={busy || (source === "replay" && !loadedReplay)}
                    >
                      <AppIcon name="play" />{source === "synthetic" ? "Start demo" : "Start replay"}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void stopReceiver()}
                      disabled={
                        scanActive || !busy || receiver.lifecycle === "stopping"
                      }
                    >
                      <AppIcon name="stop" />Stop
                    </button>
                  </div>
                )}
                <ReceiverLocationPanel key={`antenna:${source}`} value={antennaSite} />
                {source === "replay" && <small>Replay uses the original acquisition site; the current site applies to future live recordings.</small>}
                {caps.requiresUsb && (
                  <details
                    className="advanced-settings"
                    key={source}
                    open={sourceAdvancedOpen}
                    onToggle={(event) =>
                      setSourceAdvancedOpen(event.currentTarget.open)
                    }
                  >
                    <summary>
                      <span className="icon-label"><AppIcon name="settings" />Device details &amp; settings</span>
                      <small>
                        {(sampleRateHz / 1_000_000).toFixed(3)} MS/s ·{" "}
                        {caps.gain.kind === "rtl-auto-manual"
                          ? gainDb === null
                            ? "automatic gain"
                            : `${gainDb.toFixed(1)} dB gain`
                          : caps.gain.kind === "hackrf-stages"
                            ? `LNA ${hardwareSettings.rxLnaGainCode} · VGA ${hardwareSettings.rxVgaGainDb} dB`
                            : source === "bladerf"
                              ? `${receiver.session?.bladerf?.rxInput ?? bladerfSettings.rxInput} · ${BLADERF_GAIN_MODES[receiver.session?.bladerf?.gainMode ?? bladerfSettings.gainMode].label}`
                              : "slow-attack AGC"}
                      </small>
                    </summary>
                    <div className="advanced-settings-body">
                      {caps.requiresUsb && caps.rates.kind === "choices" && (
                        <label>
                          Sample rate
                          <select
                            aria-label="Sample rate"
                            value={sampleRateHz}
                            disabled={transitioning || (running && source !== "rtl-sdr") || exportingRecording || atlasTransferActive}
                            onChange={(event) =>
                              void applySampleRate(Number(event.currentTarget.value))
                            }
                          >
                            {caps.rates.valuesHz.map((rate) => (
                              <option
                                key={rate}
                                value={rate}
                                disabled={
                                  compatibleSourceRate(source, running ? (receiver.session?.mode ?? mode) : mode, rate) !==
                                  rate
                                }
                              >
                                {(rate / 1_000_000).toFixed(3)} MS/s
                                {caps.rates.kind === "choices" &&
                                caps.rates.experimentalHz?.includes(rate)
                                  ? " (experimental)"
                                  : ""}
                              </option>
                            ))}
                          </select>
                          {hardwareConnected &&
                            receiver.session?.requestedSampleRateHz !==
                              sampleRateHz && (
                              <small className="pending-change">
                                Change pending · applies when reception starts
                              </small>
                            )}
                          <small>
                            {source === "hackrf"
                              ? "4.8, 9.6 and experimental 19.2 MS/s widen the spectrum and native recording; the selected channel is filtered to 2.4 MS/s. Stop reception to change rate without disconnecting."
                              : source === "bladerf"
                                ? "All supported bladeRF 2.0 Micro variants use native SC16 Q11 at 2.4, 4.8, 9.6 or experimental 19.2 MS/s. Stop reception to change rate without disconnecting; wideband SC16 is filtered to a 2.4 MS/s channel."
                                : source === "usrp-b205"
                                  ? "Stop reception to change rate. The new rate is applied when reception starts; the USRP is reinitialized automatically. Demodulation uses a 2.4 MS/s selected-channel path."
                                  : "Change rate while receiving; reception resumes automatically after a brief gap. An active recording finishes before switching. 2.4 MS/s captures full DAB bandwidth and resolves ADS-B pulses."}
                          </small>
                        </label>
                      )}
                      {caps.gain.kind === "rtl-auto-manual" && (
                        <div className="gain-control">
                          <label>
                            RF gain
                            <select
                              value={gainDb === null ? "auto" : "manual"}
                              disabled={transitioning}
                              onChange={(event) =>
                                applyGain(
                                  event.currentTarget.value === "auto"
                                    ? null
                                    : 25,
                                )
                              }
                            >
                              <option value="auto">Automatic</option>
                              <option value="manual">Manual</option>
                            </select>
                          </label>
                          {gainDb !== null && (
                            <label>
                              <span>
                                Requested manual gain{" "}
                                <output>{gainDb.toFixed(1)} dB</output>
                              </span>
                              <input
                                type="range"
                                min="0"
                                max={MANUAL_GAIN_MAX_DB}
                                step="0.1"
                                value={gainDb}
                                disabled={transitioning}
                                onChange={(event) =>
                                  setGainDb(event.currentTarget.valueAsNumber)
                                }
                                onPointerUp={() => applyGain(gainDb)}
                                onKeyUp={() => applyGain(gainDb)}
                              />
                            </label>
                          )}
                        </div>
                      )}
                      {caps.gain.kind === "hackrf-stages" && (
                        <div className="gain-control hackrf-gain-control">
                          <label>
                            RX LNA state
                            <select
                              value={hardwareSettings.rxLnaGainCode}
                              disabled={transitioning}
                              onChange={(event) =>
                                setHardwareSettings({
                                  ...hardwareSettings,
                                  rxLnaGainCode: Number(
                                    event.currentTarget.value,
                                  ) as HackrfRxSettings["rxLnaGainCode"],
                                })
                              }
                            >
                              {caps.gain.lnaCodes.map((code) => (
                                <option key={code} value={code}>
                                  {code === 0
                                    ? "Low (−33 dB relative)"
                                    : code === 16
                                      ? "Middle (−16 dB relative)"
                                      : "High (maximum)"}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            RX VGA gain (dB)
                            <input
                              type="number"
                              min={caps.gain.vgaMinimumDb}
                              max={caps.gain.vgaMaximumDb}
                              step={caps.gain.vgaStepDb}
                              value={hardwareSettings.rxVgaGainDb}
                              disabled={transitioning}
                              onChange={(event) =>
                                setHardwareSettings({
                                  ...hardwareSettings,
                                  rxVgaGainDb:
                                    event.currentTarget.valueAsNumber,
                                })
                              }
                            />
                          </label>
                          <label className="checkbox-control hackrf-amplifier-control">
                            <span>RF amplifier</span>
                            <input
                              type="checkbox"
                              aria-label="RF amplifier"
                              checked={hardwareSettings.rfAmplifierEnabled}
                              disabled={transitioning}
                              onChange={(event) =>
                                setHardwareSettings({
                                  ...hardwareSettings,
                                  rfAmplifierEnabled:
                                    event.currentTarget.checked,
                                })
                              }
                            />
                            <span className="checkbox-state" aria-hidden="true">
                              {hardwareSettings.rfAmplifierEnabled
                                ? "On"
                                : "Off"}
                            </span>
                          </label>
                          <button
                            type="button"
                            disabled={!hardwareConnected || transitioning}
                            onClick={() => void applyHardware()}
                          >
                            Apply RX settings
                          </button>
                          <small>
                            Stage values are requested settings, not calibrated
                            total gain. Antenna power stays off.
                          </small>
                          {mode === "DAB" && (
                            <small>
                              For DAB, start with the RF amplifier off. If
                              stations appear but audio breaks up, extra RF gain
                              can worsen decoding even without visible I/Q
                              clipping.
                            </small>
                          )}
                        </div>
                      )}
                      {source === "usrp-b205" && (
                        <div className="device-setup-details">
                          <p>
                            RX2 antenna · internal clock/time · slow-attack AGC
                            · automatic bandwidth · no calibrated gain.
                          </p>
                          <p>
                            UHD 4.9.0.0 · FX3 8.x · FPGA 7.x · USB 3 required.
                            TX and persistent device-storage writes are
                            disabled.
                          </p>
                          <p>
                            After power loss, Connect reloads firmware and FPGA
                            into device memory as needed. Saved browser copies
                            are reused.
                          </p>
                          {!usrpFirmwareRef.current && (
                            <p>{usrpFirmwareMessage}</p>
                          )}
                          {!usrpImageRef.current && (
                            <p>{usrpImageMessage}</p>
                          )}
                        </div>
                      )}
                      {source === "bladerf" && <BladeRfControls
                        settings={bladerfSettings} onChange={setBladeRfSettings}
                        onApply={() => void applyBladeRfHardware()}
                        connected={hardwareConnected} busy={transitioning}
                        frequencyHz={receiver.session?.hardwareCenterFrequencyHz ?? frequencyMhz * 1_000_000}
                        accepted={receiver.session?.bladerf}
                      />}
                      {source === "bladerf" && (
                        <div className="device-setup-details">
                          <p>
                            Firmware 2.4 requires hosted model image v0.15.3;
                            firmware 2.5 or newer requires v0.16.0. Connect
                            detects the exact model and firmware. Missing or
                            mismatched images stop connection before FPGA
                            programming.
                          </p>
                          {receiver.session?.bladerf && (() => {
                            const details = receiver.session.bladerf;
                            const identity = details.identity;
                            const requiredImage = selectBladeRfImage(identity.model, identity.firmware);
                            return (
                              <p role="status" aria-label="Detected bladeRF model and image">
                                Detected {bladeRfModelLabel(identity.model)} · firmware {identity.firmware.major}.{identity.firmware.minor} · required hosted{requiredImage.model} v{requiredImage.version}.{" "}
                                {identity.variantValidation === "experimental"
                                  ? "This xA5/xA9 receive profile is experimental and awaits owner hardware validation. "
                                  : "Existing xA4 receive profile. "}
                                {identity.volatileImage
                                  ? `Verified volatile image: hosted${identity.volatileImage.model} v${identity.volatileImage.version} (SHA-256 ${identity.volatileImage.sha256.slice(0, 12)}…).`
                                  : `Preconfigured FPGA v${identity.fpga.major}.${identity.fpga.minor}.${identity.fpga.patch}; exact image provenance is unknown.`}
                              </p>
                            );
                          })()}
                          <p>
                            Receive only · no flash writes. Device configuration
                            disappears after power loss; saved browser copies
                            are reused.
                          </p>
                          <p>
                            {storedFpgaImages.length
                              ? `Saved: ${storedFpgaImages.map((image) => `hosted${image.model} v${image.version}`).join(", ")}.`
                              : "No saved image."}{" "}
                            {fpgaImageMessage}
                          </p>
                          <p>
                            xA5 and xA9 are experimental pending owner hardware validation. The larger FPGA does not increase supported reception rates.
                          </p>
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </div>
              </div>
            </section>

            <section
              className="signal-stage demodulate-stage"
              aria-labelledby="demodulate-heading"
            >
              <div className="stage-heading">
                <span aria-hidden="true">03</span>
                <div>
                  <p>Tune & demodulate</p>
                  <h3 id="demodulate-heading" className="icon-label"><AppIcon name="sliders" />Channel settings</h3>
                </div>
                <button type="button" className="stage-collapse secondary" aria-label={layout.channelCollapsed ? "Expand channel panel" : "Collapse channel panel"} aria-expanded={!layout.channelCollapsed} aria-controls="channel-stage-body" onClick={() => setLayout((old) => ({ ...old, channelCollapsed: !old.channelCollapsed }))}>{layout.channelCollapsed ? "+" : "−"}</button>
              </div>
              <div id="channel-stage-body" className="stage-body" hidden={layout.channelCollapsed}>
              <div className="stage-controls primary-channel-controls">
                <label>
                  Mode
                  <select
                    value={mode}
                    disabled={transitioning}
                    onChange={(event) =>
                      chooseMode(event.currentTarget.value as ReceiverMode)
                    }
                  >
                    {RECEIVER_MODES.map((candidate) => (
                      <option
                        key={candidate}
                        value={candidate}
                        disabled={Boolean(modeUnavailable(candidate))}
                        title={modeUnavailable(candidate)}
                      >
                        {candidate === "OFF"
                          ? "Spectrum only · no demodulation"
                          : candidate === "DAB"
                            ? "DAB / DAB+"
                            : candidate}
                        {modeUnavailable(candidate)
                          ? ` — ${modeUnavailable(candidate)}`
                          : ""}
                      </option>
                    ))}
                  </select>
                  {modePending ? (
                    <small className="pending-change">
                      Change pending ·{" "}
                      {running || receiver.lifecycle === "tuning"
                        ? "applying…"
                        : "applies when reception starts"}
                    </small>
                  ) : (
                    running && <small>Applies immediately</small>
                  )}
                </label>
                {mode === "DAB" && (
                  <label>
                    Band III channel
                    <select
                      value={
                        dabChannelAt(frequencyMhz * 1_000_000)?.label ??
                        "custom"
                      }
                      disabled={transitioning}
                      onChange={(event) => {
                        const channel = DAB_BAND_III_CHANNELS.find(
                          (candidate) =>
                            candidate.label === event.currentTarget.value,
                        );
                        if (!channel) return;
                        setFrequencyMhz(channel.frequencyHz / 1_000_000);
                        if (running) tune(channel.frequencyHz);
                      }}
                    >
                      {!dabChannelAt(frequencyMhz * 1_000_000) && (
                        <option value="custom">Custom frequency</option>
                      )}
                      {DAB_BAND_III_CHANNELS.map((channel) => (
                        <option key={channel.label} value={channel.label}>
                          {channel.label} ·{" "}
                          {(channel.frequencyHz / 1_000_000).toFixed(3)} MHz
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {mode === "DAB" && (
                  <DabStationControl controller={controller} />
                )}
                <label>
                  Channel frequency
                  <span className="unit-input">
                    <input
                      type="number"
                      min={Math.max(1, caps.frequency.minimumHz) / 1_000_000}
                      max={caps.frequency.maximumHz / 1_000_000}
                      step="0.000001"
                      value={
                        channelFrequencyDraft !== undefined &&
                        Math.round(Number(channelFrequencyDraft) * 1_000_000) === Math.round(frequencyMhz * 1_000_000)
                          ? channelFrequencyDraft
                          : formatFrequencyMHz(frequencyMhz * 1_000_000)
                      }
                      title={`${(frequencyMhz * 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 3 })} Hz`}
                      disabled={transitioning}
                      onFocus={(event) => {
                        flushSync(() => setChannelFrequencyDraft(editableFrequencyMHz(frequencyMhz * 1_000_000)));
                        event.currentTarget.select();
                      }}
                      onBlur={() => setChannelFrequencyDraft(undefined)}
                      onChange={(event) => {
                        setChannelTuneIssue(undefined);
                        setChannelFrequencyDraft(event.currentTarget.value);
                        setFrequencyMhz(event.currentTarget.valueAsNumber);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape" && liveSession) {
                          setChannelTuneIssue(undefined);
                          setChannelFrequencyDraft(undefined);
                          setFrequencyMhz(liveSession.selectedChannelFrequencyHz / 1_000_000);
                        }
                        if (event.key === "Enter" && running && frequencyValid)
                          tune(frequencyMhz * 1_000_000);
                      }}
                      aria-label="Channel frequency"
                      aria-describedby="frequency-help frequency-state"
                    />
                    <span>MHz</span>
                  </span>
                  <small id="frequency-help">
                    {source === "synthetic"
                      ? "Demo channel frequency in MHz"
                      : caps.frequency.limitsDiscoveredAtTune
                        ? "Checked by the connected tuner"
                        : `${caps.label}: ${caps.frequency.minimumHz / 1_000_000}–${caps.frequency.maximumHz / 1_000_000} MHz`}{" "}
                  </small>
                  <small
                    id="frequency-state"
                    className={frequencyPending ? "pending-change" : ""}
                    role="status"
                  >
                    {channelTuneIssue ?? (!frequencyValid
                      ? "Enter a frequency within the supported range"
                      : frequencyPending
                        ? receiver.lifecycle === "tuning"
                          ? "Applying frequency…"
                          : running
                            ? "Change pending · press Tune or Enter"
                            : "Change pending · applies when reception starts"
                        : liveSession
                          ? "✓ Tuned"
                          : "Applies when reception starts")}
                  </small>
                </label>
                <div className="channel-tune-actions">
                <ActionButton
                  type="button"
                  className="secondary tune-button"
                  icon="crosshair"
                  disabled={
                    !running ||
                    !frequencyValid ||
                    transitioning ||
                    !frequencyPending
                  }
                  disabledReason={!running ? "Start reception before tuning a channel." : !frequencyValid ? "Enter a frequency supported by this receiver." : transitioning ? "Wait for the receiver to finish its current operation." : "Edit the channel frequency first."}
                  onClick={() => tune(frequencyMhz * 1_000_000)}
                >
                  Tune
                </ActionButton>
                {["AM", "NBFM", "WBFM"].includes(mode) && <CenterSignalControl
                  controller={controller}
                  analysis={analysis}
                  disabled={!running || transitioning || scanActive || Boolean(recordingStatus) || frequencyPending || !frequencyValid || source === "synthetic"}
                  disabledReason={source === "synthetic" ? "Fine-tuning is available for received signals, not the demo." : !running ? "Start AM or FM reception to fine-tune a signal." : frequencyPending || !frequencyValid ? "Apply or cancel the channel frequency edit first." : recordingStatus ? "Stop recording before fine-tuning." : scanActive ? "Finish or pause the spectrum scan first." : "Wait for the receiver to finish its current operation."}
                  contextKey={`${source}:${mode}:${bandwidthHz}:${frequencyMhz}`}
                  onAccepted={(frequencyHz) => {
                    setChannelFrequencyDraft(undefined);
                    setFrequencyMhz(frequencyHz / 1_000_000);
                  }}
                />}
                </div>
                <SearchOverlay favorites={favorites.items} frequencyHz={displayedFrequencyHz ?? frequencyMhz * 1e6} mode={mode}
                  contextKey={`${source}:${remoteSelected}:${receiver.sessionGeneration}:${mode}:${sampleRateHz}:${frequencyMhz}`}
                  blockedReason={stationUseBlockedReason} onRecall={recallFavorite} onUseStation={useAtlasStation} onFavorite={saveAtlasFavorite}
                  onPreview={(bookmark) => previewDiscovery(controller, bookmark, { source, channelFrequencyHz: frequencyMhz * 1e6, modeSettings: currentModeSettings, sampleRateHz, ...hardwareOptions })} />
                <FavoritesPanel items={favorites.items} storageMessage={favorites.message} draft={favoriteDraft}
                  onNew={newFavorite} onEdit={(item) => setFavoriteDraft(structuredClone(item))} onCancel={() => setFavoriteDraft(undefined)}
                  onChange={favorites.change} onRecall={recallFavorite} blockedReason={stationUseBlockedReason?.replaceAll("station", "favorite")} saveBlockedReason={saveFavoriteBlockedReason} />
                {mode === "WBFM" && (
                  <FmStationSummary controller={controller} />
                )}
                {source !== "synthetic" &&
                  !["OFF", "ADS-B", "AIS", "SRD", "APRS", "RS41"].includes(mode) && (
                    <>
                      <label>
                        <span className="icon-label"><AppIcon name={volume === 0 ? "mute" : "volume"} />Volume <output>{Math.round(volume * 100)}%</output></span>
                        <input
                          className="volume-slider"
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={volume}
                          onChange={(event) =>
                            updateVolume(event.currentTarget.valueAsNumber)
                          }
                        />
                        <small>
                          {mode === "DAB" ? "DAB+ audio" : `${mode} audio`} ·
                          Applies immediately
                        </small>
                      </label>
                    </>
                  )}
                {mode === "APRS" && <p className="support-copy">1200-baud VHF APRS · receive only. IARU Region 1 suggestion: 144.800 MHz; tuning remains yours.</p>}
                {mode === "RS41" && <p className="support-copy">Unencrypted RS41 · select the sonde frequency. Calibrated PTU and encrypted SGM are unsupported.</p>}
                {mode === "SRD" && (
                  <div className="mode-primary-controls" aria-label="SRD reception settings">
                      <label>
                        Modulation
                        <select
                          value={srdSettings.modulation}
                          disabled={transitioning}
                          onChange={(event) => {
                            const modulation = event.currentTarget.value as
                              "ook" | "2fsk";
                            const next: SrdModeSettings = {
                              ...srdSettings,
                              modulation,
                              protocol: "none",
                            };
                            setSrdSettings(next);
                            if (running)
                              applyModeSettings({
                                ...currentModeSettings,
                                srd: next,
                              });
                          }}
                        >
                          <option value="ook">OOK / ASK envelope</option>
                          <option value="2fsk">Binary FSK discriminator</option>
                        </select>
                      </label>
                      <label>
                        Decoder
                        <select
                          value={srdSettings.protocol}
                          disabled={transitioning}
                          onChange={(event) => {
                            const next = {
                              ...srdSettings,
                              protocol: event.currentTarget
                                .value as SrdModeSettings["protocol"],
                            };
                            setSrdSettings(next);
                            if (running)
                              applyModeSettings({
                                ...currentModeSettings,
                                srd: next,
                              });
                          }}
                        >
                          <option value="none">Inspector only</option>
                          {srdSettings.modulation === "ook" && (
                            <option value="acurite-592txr">
                              Acurite 592TXR
                            </option>
                          )}
                          {srdSettings.modulation === "2fsk" && (
                            <option value="fineoffset-wh51">
                              Fine Offset WH51
                            </option>
                          )}
                        </select>
                        <small>
                          Unknown bursts stay inspectable and never become
                          guessed readings.
                        </small>
                      </label>
                  </div>
                )}
              </div>
              <details
                className="advanced-settings channel-advanced-settings"
                key={mode}
                open={channelAdvancedOpen}
                onToggle={(event) => {
                  // Ignore a queued toggle from the previous mode's detached details node.
                  if (event.currentTarget.isConnected) setChannelAdvancedOpen(event.currentTarget.open);
                }}
              >
                <summary>
                  <span>Advanced channel settings</span>
                  <small>
                    {mode === "OFF"
                      ? "Spectrum only · no audio"
                      : `${bandwidthHz.toLocaleString()} Hz`}
                    {mode === "OFF"
                      ? ""
                      : mode === "CW"
                        ? ` · ${beatToneHz.toLocaleString()} Hz tone`
                        : modeCaps.squelchSettable
                          ? ` · squelch ${squelch.toFixed(1)}`
                          : " · fixed profile"}
                  </small>
                </summary>
                <div
                  className="stage-controls demodulation-controls"
                  aria-label="Channel demodulation settings"
                >
                  {mode === "OFF" ? (
                    <p className="display-note">
                      No channel filter, audio demodulator, or digital decoder
                      is active. RF acquisition and spectrum analysis continue.
                    </p>
                  ) : mode === "CW" ? (
                    <label>
                      Receive filter bandwidth
                      <select
                        value={bandwidthHz}
                        disabled={transitioning}
                        onChange={(event) => {
                          const value = Number(event.currentTarget.value);
                          setBandwidthHz(value);
                          if (running)
                            applyModeSettings({
                              ...currentModeSettings,
                              bandwidthHz: value,
                            });
                        }}
                      >
                        {CW_FILTER_BANDWIDTHS_HZ.map((bandwidth) => (
                          <option key={bandwidth} value={bandwidth}>
                            {bandwidth.toLocaleString()} Hz
                          </option>
                        ))}
                      </select>
                      <small>Centered on the selected RF carrier</small>
                    </label>
                  ) : modeCaps.bandwidthSettable ? (
                    <label>
                      Channel bandwidth
                      <span className="unit-input">
                        <input
                          type="number"
                          min={modeCaps.minimumBandwidthHz}
                          max={modeCaps.maximumBandwidthHz}
                          step="10"
                          value={bandwidthHz}
                          disabled={transitioning}
                          onChange={(event) => {
                            const value = event.currentTarget.valueAsNumber;
                            setBandwidthHz(value);
                            if (
                              running &&
                              Number.isFinite(value) &&
                              value >= modeCaps.minimumBandwidthHz &&
                              value <= modeCaps.maximumBandwidthHz
                            )
                              applyModeSettings({
                                ...currentModeSettings,
                                bandwidthHz: value,
                              });
                          }}
                        />
                        <span>Hz</span>
                      </span>
                      <small>
                        {modeCaps.minimumBandwidthHz.toLocaleString()}–
                        {modeCaps.maximumBandwidthHz.toLocaleString()} Hz
                      </small>
                      <small
                        className={bandwidthPending ? "pending-change" : ""}
                      >
                        {bandwidthPending
                          ? running
                            ? "Change pending"
                            : "Change pending · applies when reception starts"
                          : running
                            ? "Applies immediately"
                            : "Applies when reception starts"}
                      </small>
                    </label>
                  ) : (
                    <div className="readout">
                      <span>Channel bandwidth</span>
                      <strong>{bandwidthHz.toLocaleString()} Hz fixed</strong>
                    </div>
                  )}
                  {mode === "SRD" && (
                    <>
                      <label>
                        Threshold
                        <select
                          value={srdSettings.threshold.mode}
                          disabled={transitioning}
                          onChange={(event) => {
                            const next = {
                              ...srdSettings,
                              threshold: {
                                ...srdSettings.threshold,
                                mode: event.currentTarget.value as
                                  "adaptive" | "manual",
                              },
                            };
                            setSrdSettings(next);
                            if (running)
                              applyModeSettings({
                                ...currentModeSettings,
                                srd: next,
                              });
                          }}
                        >
                          <option value="adaptive">Adaptive</option>
                          <option value="manual">Manual</option>
                        </select>
                      </label>
                    </>
                  )}
                  {modeCaps.squelchSettable && (
                    <SquelchControl
                      controller={controller}
                      squelch={squelch}
                      disabled={transitioning}
                      running={running}
                      onChange={applySquelch}
                    />
                  )}
                  {mode === "CW" && (
                    <label>
                      Beat tone{" "}
                      <output>{beatToneHz.toLocaleString()} Hz</output>
                      <input
                        type="range"
                        aria-label="CW beat tone"
                        min={CW_TONE_MIN_HZ}
                        max={CW_TONE_MAX_HZ}
                        step="10"
                        value={beatToneHz}
                        disabled={transitioning}
                        onChange={(event) => {
                          const value = event.currentTarget.valueAsNumber;
                          setBeatToneHz(value);
                          if (running)
                            applyModeSettings({
                              ...currentModeSettings,
                              beatToneHz: value,
                            });
                        }}
                      />
                      <small>
                        Changes audible pitch without changing the selected RF
                        frequency
                      </small>
                    </label>
                  )}
                </div>
              </details>
              </div>
            </section>
          </div>


        </section>

        <WebGpuSpectrum
          active={activeView === "receiver"}
          pipeline={analysis}
          displaySettings={spectrumDisplay}
          onDisplaySettingsChange={setSpectrumDisplay}
          session={liveSession}
          onTune={running && !transitioning && !scanActive ? tune : undefined}
          tuningControls={<ReceiverTuningControl
            session={liveSession}
            configuredFrequencyHz={frequencyMhz * 1_000_000}
            disabled={!running || transitioning || scanActive}
            channelPending={frequencyPending}
            autoRecenter={autoRecenter}
            onAutoRecenter={(enabled) => {
              controller.setAutoRecenter(enabled);
              setAutoRecenter(enabled);
              saveNumber("browsersdr-auto-recenter", enabled ? 1 : 0);
            }}
            onTuneCenter={tuneReceiverCenter}
          />}
          onStatusChange={setSpectrumStatus}
          onOpenAcquire={() => {
            setActiveView("receiver");
            setLayout((old) => ({ ...old, sourceCollapsed: false }));
            document
              .getElementById("acquire-heading")
              ?.scrollIntoView({ block: "start" });
          }}
          onOpenDiagnostics={() => openAuxiliaryView("diagnostics")}
        />

        <section
          className={`receiver-dock ${receiverDockExpanded ? "is-expanded" : "is-collapsed"}${receiverDockLarge && receiverDockExpanded ? " is-large" : ""}`}
          aria-label="Receiver tools"
        >
          <div className="receiver-dock-bar">
            <div
              className="receiver-dock-tabs"
              role="tablist"
              aria-label="Receiver tool panels"
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const views = ["decode", "capture", "session"] as const;
                const current = views.indexOf(receiverDockView);
                const next = event.key === "Home" ? 0 : event.key === "End" ? views.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + views.length) % views.length;
                const button = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
                setReceiverDockView(views[next]!);
                setReceiverDockExpanded(true);
                button?.focus();
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={receiverDockView === "decode"}
                tabIndex={receiverDockView === "decode" ? 0 : -1}
                aria-controls="decode-panel"
                onClick={() => {
                  setReceiverDockView("decode");
                  setReceiverDockExpanded(true);
                }}
              >
                <AppIcon name="headphones" />Audio & decode
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={receiverDockView === "capture"}
                tabIndex={receiverDockView === "capture" ? 0 : -1}
                aria-controls="capture-panel"
                onClick={() => {
                  setReceiverDockView("capture");
                  setReceiverDockExpanded(true);
                }}
              >
                <AppIcon name="record" />Capture & replay
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={receiverDockView === "session"}
                tabIndex={receiverDockView === "session" ? 0 : -1}
                aria-controls="session-panel"
                onClick={() => {
                  setReceiverDockView("session");
                  setReceiverDockExpanded(true);
                }}
              >
                <AppIcon name="file" />Session
              </button>
            </div>
            <div className="dock-actions">
              {receiverDockExpanded && <button type="button" className="secondary dock-size-toggle"
                aria-pressed={receiverDockLarge} onClick={() => setReceiverDockLarge((large) => !large)}>
                <AppIcon name={receiverDockLarge ? "collapse" : "expand"} />{receiverDockLarge ? "Less space" : "More space"}
              </button>}
            <button
              type="button"
              className="secondary dock-toggle"
              aria-expanded={receiverDockExpanded}
              onClick={() => setReceiverDockExpanded((expanded) => !expanded)}
            >
              <AppIcon name={receiverDockExpanded ? "collapse" : "expand"} />{receiverDockExpanded ? "Collapse" : "Expand"}
            </button>
            </div>
          </div>

          <ReceiverDecodePanel
            controller={controller}
            source={source}
            mode={liveMode}
            volume={volume}
            active={receiverDockExpanded && receiverDockView === "decode"}
          />

          <section
            id="capture-panel"
            role="tabpanel"
            className="control-panel capture-panel receiver-dock-panel"
            aria-labelledby="recording-heading"
            hidden={!receiverDockExpanded || receiverDockView !== "capture"}
          >
            <h2 id="recording-heading" className="visually-hidden">I/Q recordings</h2>
            <div className="capture-topline">
            <div
              className="workspace-subtabs"
              role="tablist"
              aria-label="Recording workspace"
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "record"
                    : event.key === "End"
                      ? "open"
                      : captureView === "record"
                        ? "open"
                        : "record";
                setCaptureView(next);
                document
                  .getElementById(
                    next === "record" ? "record-tab" : "open-recording-tab",
                  )
                  ?.focus();
              }}
            >
              <button
                type="button"
                role="tab"
                id="record-tab"
                aria-controls="record-panel"
                aria-selected={captureView === "record"}
                tabIndex={captureView === "record" ? 0 : -1}
                onClick={() => setCaptureView("record")}
              >
                <AppIcon name="record" />Record
              </button>
              <button
                type="button"
                role="tab"
                id="open-recording-tab"
                aria-controls="open-recording-panel"
                aria-selected={captureView === "open"}
                tabIndex={captureView === "open" ? 0 : -1}
                onClick={() => setCaptureView("open")}
              >
                <AppIcon name="folder" />Open recording
              </button>
            </div>
              {captureView === "record" && <>
              <div
                className={`recording-state ${preparedCaptureAvailable && !recordingStatus && !exportingRecording ? "is-ready" : ""}`}
                role="status"
              >
                <strong>
                  {exportingRecording
                    ? "Preparing…"
                    : recordingStatus
                      ? "Recording"
                      : preparedCaptureAvailable
                        ? "✓ Recording ready"
                        : retainedCapture.status === "storage-failed"
                          ? "Capture storage failed"
                        : retainedCapture.status === "retry-available"
                          ? "Preparation failed"
                          : !recordingSupported
                            ? "Recording unavailable for this receiver"
                            : running ? "Ready to record" : hardwareConnected ? "Start reception to record" : "Start reception before recording"}
                </strong>
                {(recordingStatus ||
                  retainedCapture.sampleCount !== undefined) && (
                  <span>
                    {(
                      (recordingStatus?.sampleCount ??
                        retainedCapture.sampleCount ??
                        0) /
                      (recordingStatus
                        ? (recordingStatus.sampleRateHz ?? nativeRateHz)
                        : (retainedCapture.sampleRateHz ?? nativeRateHz))
                    ).toFixed(2)}{" "}
                    s ·{" "}
                    {(recordingStatus
                      ? recordingStatus.bytes / (1024 * 1024)
                      : retainedCapture.retainedBytes / (1024 * 1024)
                    ).toFixed(2)}
                    {recordingStatus
                      ? ` / ${recordingStatus.maxBytes / (1024 * 1024)}`
                      : ""}{" "}
                    MiB
                  </span>
                )}
              </div>
                <div className="recording-actions">
                {recordingStatus ? (
                  <button
                    type="button"
                    disabled={exportingRecording}
                    onClick={stopRecording}
                  >
                    <AppIcon name="stop" />Stop recording
                  </button>
                ) : !retainedCapturePresent && (
                  <ActionButton
                    type="button"
                    disabled={
                      !recordingSupported ||
                      !running ||
                      (captureCurrentChannel && !channelCapturePreview.plan) ||
                      scanActive ||
                      exportingRecording ||
                      captureSlotBlocked
                    }
                    disabledReason={!recordingSupported ? "Recording is unavailable for this receive profile." : !running ? "Start reception before recording." : scanActive ? "Finish or pause the spectrum scan first." : exportingRecording ? "Wait for recording preparation to finish." : captureSlotBlocked ? "Download or discard the prepared capture first." : "Choose a channel bandwidth that fits inside the receiver window."}
                    onClick={startRecording}
                    icon="record"
                  >
                    Start I/Q recording
                  </ActionButton>
                )}
                {preparedCaptureAvailable && (
                  <ActionButton
                    type="button"
                    disabled={exportingRecording}
                    disabledReason={"Wait for recording preparation to finish."}
                  icon="download"
                  onClick={() => requestRecordingDownload(preparedCaptureNeedsSeparateFiles ? "separate" : "archive")}
                  >
                    {preparedCaptureNeedsSeparateFiles ? "Download separate files" : "Download ZIP"}
                  </ActionButton>
                )}
                {retainedCapturePresent && (
                  <ActionButton
                    type="button"
                    className="secondary destructive"
                    disabled={
                      exportingRecording ||
                      atlasTransferActive ||
                      Boolean(recordingStatus)
                    }
                    disabledReason={atlasTransferActive ? "Wait for the transfer to finish." : recordingStatus ? "Stop recording before discarding the capture." : "Wait for recording preparation to finish."}
                    icon="trash"
                    onClick={discardPreparedRecording}
                  >
                    Discard prepared capture
                  </ActionButton>
                )}
                {retainedCapture.status === "retry-available" && (
                  <>
                    <button
                      type="button"
                      className="secondary"
                      disabled={exportingRecording}
                      onClick={retryRecordingPreparation}
                    >
                      <AppIcon name="retry" />Retry preparation
                    </button>
                    <button
                      type="button"
                      disabled={exportingRecording}
                      onClick={downloadRecordingFilesDirectly}
                    >
                      <AppIcon name="download" />Download files to disk
                    </button>
                  </>
                )}
                </div>
              </>}
            </div>
            <div
              id="record-panel"
              role="tabpanel"
              aria-labelledby="record-tab"
              hidden={captureView !== "record"}
            >
              <div className="capture-options">
                <label className="recording-format">
                  Export format
                  <select
                    aria-label="Recording export format"
                    value={recordingFormat}
                    disabled={
                      !recordingSupported ||
                      formatControlDisabled(recordingStatus, exportingRecording)
                    }
                    onChange={(event) =>
                      setRecordingFormat(
                        event.currentTarget.value as RecordingExportFormat,
                      )
                    }
                  >
                    {source === "usrp-b205" || source === "bladerf" || (source === "replay" && loadedReplay?.metadata.format === BLADERF_SC16_RECORDING_FORMAT) ? (
                      <option value="sigmf">
                        SigMF ci16_le (.sigmf-data + .sigmf-meta)
                      </option>
                    ) : recordingSupported ? (
                      <>
                        <option value="browsersdr">
                          BrowserSDR replay (.{encoding} + .json)
                        </option>
                        <option value="sigmf">
                          SigMF (.sigmf-data + .sigmf-meta)
                        </option>
                      </>
                    ) : (
                      <option value={recordingFormat}>
                        Unavailable for this receive profile
                      </option>
                    )}
                  </select>
                </label>
              <label className="checkbox-control channel-capture-toggle">
                <input type="checkbox" checked={captureCurrentChannel}
                  disabled={Boolean(recordingStatus) || exportingRecording}
                  onChange={event => setCaptureCurrentChannel(event.currentTarget.checked)} />
                Capture current channel only
              </label>
              <label className="capture-duration">Duration (s; 0 = manual)
                <input aria-label="Timed capture seconds" type="number" min={0} max={300} step={1} value={captureDuration}
                  disabled={!!recordingStatus || exportingRecording || atlasTransferActive}
                  onChange={event => { const value=Number(event.currentTarget.value); if (Number.isFinite(value)) setCaptureDuration(Math.max(0,Math.min(300,value))); }} />
              </label>
              </div>
              {retainedCapture.captureWarning && <p className="display-note" role="status">{retainedCapture.captureWarning}</p>}
              {recordingSupported &&
                !retainedCapturePresent &&
                !recordingStatus && (
                  <p className="display-note capture-capacity">
                    Up to {Math.min(3600, recordingCapacitySeconds(captureRateHz, preferredRecordingStorageMode() === "opfs" ? STREAMING_RECORDING_MAX_BYTES : RECORDING_MAX_BYTES, captureBytesPerSample)).toFixed(1)} s
                    at this sample rate · {preferredRecordingStorageMode() === "opfs" ? "2 GiB private browser storage limit" : "32 MiB memory fallback"}
                    .
                  </p>
                )}
              {captureCurrentChannel && (
                <p className="display-note" aria-live="polite">
                  {channelCapturePreview.plan
                    ? `${channelCapturePreview.plan.bandwidthHz.toLocaleString()} Hz channel · Auto: ${formatSampleRate(channelCapturePreview.plan.outputSampleRateHz)} · ${(captureRateHz * captureBytesPerSample * 60 / 1_000_000).toFixed(2)} MB/min. Captures channel I/Q before audio and squelch. Frequency or bandwidth changes end the recording.${["DAB", "ADS-B", "SRD", "APRS", "RS41"].includes(mode) ? " Auto keeps the sample rate required by the decoder." : ""}`
                    : channelCapturePreview.error}
                </p>
              )}

              {retainedCapture.error && (
                <p className="recording-error" role="alert">
                  {retainedCapture.error} {retainedCapture.status === "storage-failed"
                    ? "Capture storage failed; this recording cannot be exported. Discard it and start a new recording."
                    : "The recording is available in this tab. Download before reloading or closing the page."}
                </p>
              )}
              {preparedCaptureAvailable && retainedCapture.status !== "download-requested" && (
                <p className="display-note capture-retention-warning">Kept in this tab only. Download before reloading or closing.</p>
              )}
              {retainedCapture.status === "download-requested" && (
                <p className="display-note">
                  Download requested. Download before reloading or closing this tab. Starting another recording replaces this
                  prepared capture.
                </p>
              )}
              {preparedCaptureAvailable && !preparedCaptureNeedsSeparateFiles && (
                <details className="recording-more">
                  <summary>More options</summary>
                  <div className="recording-controls">
                    <button
                      type="button"
                      className="secondary"
                      disabled={exportingRecording}
                      onClick={() => requestRecordingDownload("separate")}
                    >
                      Download separate files
                    </button>
                  </div>
                  <small>
                    Discard releases the prepared capture from browser storage. Download before reloading or closing this tab; prepared captures are not restored after reload.
                  </small>
                </details>
              )}
              <details className="recording-details">
                <summary>Recording details</summary>
                <p className="display-note">
                  {encoding.toUpperCase()} I/Q ·{" "}
                  {(RETAINED_CAPTURE_MAX_BYTES / (1024 * 1024 * 1024)).toFixed(0)} GiB
                  retained-capture storage limit. ZIP is limited to 32 MiB;
                  use separate files for larger captures. The format is fixed for each
                  recording. A download request does not confirm that the
                  browser saved the file.
                </p>
              <p className="capture-guidance display-note">Stop when the saved range contains a validated PI and complete PS, or keep a provisional candidate if evidence is insufficient. A timed capture stops after approximately the selected wall time; capacity and source changes can stop it earlier.</p>
                <p className="recording-message">{recordingMessage}</p>
              </details>
              {recordingStatus && <p className="capture-evidence-status" role="status">
                Saved-range RDS: {recordingStatus.receptionEvidence?.at(-1)?.pi ?? "PI not decoded"} · {recordingStatus.receptionEvidence?.at(-1)?.ps ?? "Full PS not decoded"}.
                {recordingStatus.receptionEvidence?.at(-1)?.ps ? " Identity evidence is available; stop when the desired recording duration is covered." : " Continue until sufficient evidence or retain a provisional candidate."}
              </p>}

              {previousSavedUrl && <a href={previousSavedUrl} target="_blank" rel="noreferrer">Previous saved recording</a>}
              {receptionCandidate && <p>Reception candidate: {receptionCandidate.station_name ?? "Catalog station"} · {(receptionCandidate.frequency_hz/1e6).toFixed(3)} MHz. This link proposes settings; Start remains a manual action.{receptionCandidate.bandwidth_hz !== bandwidthHz && <> Requested bandwidth {receptionCandidate.bandwidth_hz.toLocaleString()} Hz; applied {mode} profile {bandwidthHz.toLocaleString()} Hz. Plot and saved bounds use the applied profile.</>}</p>}
              <AtlasRecoveryPanel transferActive={atlasTransferActive} connection={atlasConnection} onOpenSettings={() => openAuxiliaryView("settings")} />
              {atlasPrepared && (
                <AtlasSavePanel
                  connection={atlasConnection}
                  onOpenSettings={() => openAuxiliaryView("settings")}
                  prepared={atlasPrepared}
                  onRecordNext={(url) => { setPreviousSavedUrl(url); discardPreparedRecording(); setRecordingMessage("Saved recording remains in SigIntAtlas. Tune the next station and start a capture."); }}
                  onActiveChange={setAtlasTransferActive}
                />
              )}
            </div>
            <div
              id="open-recording-panel"
              role="tabpanel"
              aria-labelledby="open-recording-tab"
              hidden={captureView !== "open"}
            >
              <div className="replay-inputs">
                <label className="recording-format">
                  Replay pair format
                  <select
                    aria-label="Replay pair format"
                    value={replayImportFormat}
                    disabled={busy}
                    onChange={(event) => {
                      const next = event.currentTarget
                        .value as ReplayImportFormat;
                      setReplayImportFormat(next);
                      setReplayBinary(undefined);
                      setReplayMetadata(undefined);
                      setFileMessage(
                        next === "sigmf"
                          ? "Choose a local .sigmf-data/.sigmf-meta pair and an explicit replay mode. The RF-center channel is selected unless you choose a custom channel."
                          : "Load a .cu8, .ci8 or .ci16 binary and its .json sidecar, or open the example recording.",
                      );
                    }}
                  >
                    <option value="browsersdr">
                      BrowserSDR (.cu8, .ci8 or .ci16 + .json)
                    </option>
                    <option value="sigmf">
                      SigMF (.sigmf-data + .sigmf-meta)
                    </option>
                  </select>
                </label>
                {replayImportFormat === "sigmf" && (
                  <>
                    <label className="recording-format">
                      SigMF replay mode
                      <select
                        aria-label="SigMF replay mode"
                        value={sigmfReplayMode}
                        disabled={busy}
                        onChange={(event) =>
                          setSigmfReplayMode(
                            event.currentTarget.value as ReceiverMode | "",
                          )
                        }
                      >
                        <option value="">Choose mode…</option>
                        {RECEIVER_MODES.map((candidate) => (
                          <option key={candidate} value={candidate}>
                            {candidate}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="recording-format">
                      SigMF replay channel
                      <select
                        aria-label="SigMF replay channel"
                        value={sigmfChannelChoice}
                        disabled={busy}
                        onChange={(event) =>
                          setSigmfChannelChoice(
                            event.currentTarget.value as "center" | "custom",
                          )
                        }
                      >
                        <option value="center">RF center from metadata</option>
                        <option value="custom">Custom frequency</option>
                      </select>
                    </label>
                    {sigmfChannelChoice === "custom" && (
                      <label>
                        Custom replay channel (MHz)
                        <input
                          aria-label="Custom replay channel (MHz)"
                          type="number"
                          min="0.000001"
                          max={Number.MAX_SAFE_INTEGER / 1_000_000}
                          step="0.001"
                          value={sigmfChannelMhz}
                          disabled={busy}
                          onChange={(event) =>
                            setSigmfChannelMhz(event.currentTarget.value)
                          }
                        />
                      </label>
                    )}
                  </>
                )}
                <label className="file-picker">
                  {replayImportFormat === "sigmf"
                    ? "SigMF dataset"
                    : "BrowserSDR I/Q binary"}
                  <span className="file-picker-control">
                    <input
                      className="file-picker-input"
                      type="file"
                      accept={
                        replayImportFormat === "sigmf"
                          ? ".sigmf-data,application/octet-stream"
                          : ".cu8,.ci8,.ci16,application/octet-stream"
                      }
                      onChange={(event) =>
                        setReplayBinary(event.currentTarget.files?.[0])
                      }
                    />
                    <span className="file-picker-button" aria-hidden="true">
                      Choose file
                    </span>
                    <span className="file-picker-name" aria-hidden="true">
                      {replayBinary?.name ?? "No file chosen"}
                    </span>
                  </span>
                </label>
                <label className="file-picker">
                  {replayImportFormat === "sigmf"
                    ? "SigMF metadata"
                    : "BrowserSDR JSON sidecar"}
                  <span className="file-picker-control">
                    <input
                      className="file-picker-input"
                      type="file"
                      accept={
                        replayImportFormat === "sigmf"
                          ? ".sigmf-meta,application/json"
                          : ".json,application/json"
                      }
                      onChange={(event) =>
                        setReplayMetadata(event.currentTarget.files?.[0])
                      }
                    />
                    <span className="file-picker-button" aria-hidden="true">
                      Choose file
                    </span>
                    <span className="file-picker-name" aria-hidden="true">
                      {replayMetadata?.name ?? "No file chosen"}
                    </span>
                  </span>
                </label>
                <ActionButton
                  type="button"
                  className="secondary"
                  disabled={
                    !replayBinary ||
                    !replayMetadata ||
                    busy ||
                    (replayImportFormat === "sigmf" &&
                      (!sigmfReplayMode ||
                        (sigmfChannelChoice === "custom" &&
                          !(Number(sigmfChannelMhz) > 0))))
                  }
                  disabledReason={busy ? "Wait for the receiver to finish its current operation." : !replayBinary || !replayMetadata ? "Choose both the I/Q data file and its metadata file." : !sigmfReplayMode ? "Choose a replay mode for this SigMF recording." : "Enter a valid custom replay frequency."}
                  icon="folder"
                  onClick={() => void loadReplayFiles()}
                >
                  {replayImportFormat === "sigmf"
                    ? "Load SigMF pair"
                    : "Load files"}
                </ActionButton>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void activateReplay(
                      createDeterministicRecordingFixture(),
                      "Loaded example AM recording: +6 kHz carrier, 1 kHz audio tone, 0.048 MS/s.",
                    )
                  }
                >
                  <AppIcon name="folder" />Open example recording
                </button>
              </div>
              <p className="file-message" role="status">
                {fileMessage}
              </p>
            </div>
          </section>

          <section
            id="session-panel"
            role="tabpanel"
            className="control-panel receiver-dock-panel session-panel"
            aria-labelledby="session-heading"
            hidden={!receiverDockExpanded || receiverDockView !== "session"}
          >
            <h2 id="session-heading" className="visually-hidden">Session details</h2>
            <SettingsSharePanel current={{ schema: SETTINGS_SHARE_SCHEMA, frequencyHz: Math.round(frequencyMhz * 1e6), settings: currentModeSettings, display: { ...spectrumDisplay, compact: layout.compact } }}
              blockedReason={saveFavoriteBlockedReason}
              applyBlockedReason={remoteSelected ? "Return to the local receiver before applying shared settings." : running ? "Stop reception before applying shared settings." : stationUseBlockedReason?.replaceAll("station", "shared settings")}
              onApply={applySharedSettings} />
            <dl className="session-grid">
              <div>
                <dt>Receiver</dt>
                <dd>{running ? "Receiving" : hardwareConnected ? "Connected" : receiver.lifecycle === "idle" ? "Not connected" : receiver.lifecycle.replaceAll("-", " ")}</dd>
              </div>
              <div>
                <dt>Channel frequency</dt>
                <dd>
                  {displayedFrequencyHz !== undefined
                    ? `${formatFrequencyMHz(displayedFrequencyHz)} MHz`
                    : "Not connected"}
                </dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{liveMode}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{caps.label}</dd>
              </div>
              <div>
                <dt>Sample rate</dt>
                <dd>{formatSampleRate(receiver.session?.actualSampleRateHz ?? sampleRateHz)}</dd>
              </div>
              <div>
                <dt>Receiver center</dt>
                <dd>{receiver.session ? `${formatFrequencyMHz(receiver.session.hardwareCenterFrequencyHz)} MHz` : "Not connected"}</dd>
              </div>
              <div>
                <dt>Audio</dt>
                <dd>{receiver.audioState ?? "Not active"}</dd>
              </div>
            </dl>
            {(running || hardwareConnected) && receiver.session && (
                <details className="receiver-session-details">
                  <summary>Hardware &amp; signal details</summary>
                  <p>
                    Precise center{" "}
                    {(
                      receiver.session.hardwareCenterFrequencyHz / 1_000_000
                    ).toFixed(6)}{" "}
                    MHz · precise channel{" "}
                    {(
                      receiver.session.selectedChannelFrequencyHz / 1_000_000
                    ).toFixed(6)}{" "}
                    MHz · {receiver.session.mode} ·{" "}
                    {receiver.session.mode === "OFF"
                      ? "spectrum-only route"
                      : `${receiver.session.channelBandwidthHz.toLocaleString()} Hz channel`}{" "}
                    ·{" "}
                    {receiver.session.source === "rtl-sdr"
                      ? receiver.session.gainDb === null
                        ? "automatic gain"
                        : `${receiver.session.gainDb.toFixed(1)} dB requested gain`
                      : receiver.session.hackrf
                        ? `accepted LNA code ${receiver.session.hackrf.captureSettings.rxLnaGainCode}, VGA ${receiver.session.hackrf.captureSettings.rxVgaGainDb} dB, RF amplifier ${receiver.session.hackrf.captureSettings.rfAmplifierEnabled ? "on" : "off"}`
                        : receiver.session.bladerf
                          ? `${receiver.session.bladerf.rxInput ?? "RX1"} · ${BLADERF_GAIN_MODES[receiver.session.bladerf.gainMode].label}${receiver.session.bladerf.gainMode === "manual" ? ` · ${receiver.session.bladerf.acceptedGainDb} dB gain readback` : ""}`
                          : receiver.session.usrpB205
                            ? "slow-attack AGC; no calibrated gain readback"
                            : "no hardware gain control"}{" "}
                    ·{" "}
                    {isWidebandRate(receiver.session.actualSampleRateHz)
                      ? "channel DSP rate"
                      : "effective rate"}{" "}
                    {(
                      receiver.session.usrpB205?.effectiveSampleRateHz ??
                      receiver.session.bladerf?.effectiveSampleRateHz ??
                      receiver.session.hackrf?.effectiveSampleRateHz ??
                      (isWidebandRate(receiver.session.actualSampleRateHz)
                        ? 2_400_000
                        : receiver.session.actualSampleRateHz)
                    ).toLocaleString()}{" "}
                    samples/s
                    {receiver.session.hackrf &&
                      ` · native ${receiver.session.hackrf.nativeSampleRateHz.toLocaleString()} samples/s CI8 · ${receiver.session.hackrf.rateEvidence === "requested-and-acknowledged" ? "nominal rate; USB-acknowledged settings" : "firmware-reported rate/settings"} · firmware ${receiver.session.hackrf.capabilities.identity.firmwareVersion} (hardware validation pending)`}
                    {receiver.session.bladerf &&
                      ` · ${bladeRfModelLabel(receiver.session.bladerf.identity.model)} · nominal native ${receiver.session.bladerf.nativeSampleRateHz.toLocaleString()} samples/s SC16 Q11 · RFIC readback ${receiver.session.bladerf.acceptedSampleRateHz.toLocaleString()} samples/s · firmware ${receiver.session.bladerf.identity.firmware.major}.${receiver.session.bladerf.identity.firmware.minor}, FPGA ${receiver.session.bladerf.identity.fpga.major}.${receiver.session.bladerf.identity.fpga.minor}.${receiver.session.bladerf.identity.fpga.patch}${receiver.session.bladerf.identity.volatileImage ? ` · verified volatile hosted${receiver.session.bladerf.identity.volatileImage.model} v${receiver.session.bladerf.identity.volatileImage.version}` : " · preconfigured FPGA; exact image provenance unknown"} (${receiver.session.bladerf.identity.variantValidation === "experimental" ? "experimental; hardware validation pending" : "hardware validation pending"})`}
                    {receiver.session.usrpB205 &&
                      ` · native ${receiver.session.usrpB205.nativeSampleRateHz.toLocaleString()} samples/s CHDR/VRT SC16 LE · requested ${receiver.session.usrpB205.configuration.requested.requestedCenterFrequencyHz.toLocaleString()} Hz, synthesizer-calculated accepted ${receiver.session.usrpB205.configuration.acceptedCenterFrequencyHz.toLocaleString()} Hz · DDC-calculated ${receiver.session.usrpB205.configuration.acceptedSampleRateHz.toLocaleString()} samples/s · AD9361-read-back bandwidth ${receiver.session.usrpB205.configuration.acceptedBandwidthHz.toLocaleString()} Hz · FX3 ${receiver.session.usrpB205.capabilities.firmware.major}.${receiver.session.usrpB205.capabilities.firmware.minor}, FPGA ${receiver.session.usrpB205.capabilities.fpga.compatibilityMajor}.${receiver.session.usrpB205.capabilities.fpga.compatibilityMinor}, USB 3 · RX2/internal · timestamp ${receiver.session.usrpB205.observations.timestampRateValidation} (hardware validation pending)`}
                  </p>
                </details>
            )}
          </section>
        </section>
      </ReceiverWorkspace>

      {remoteSelected && <RemoteReceiver active={activeView === "remote"} layout={layout} onLayoutChange={setLayout}
        onStatus={setRemoteStatus} initialPreset={remotePreset} onSource={(next) => {
          setRemoteSelected(false);
          setActiveViewState("receiver");
          setLastWorkspace("receiver");
          void switchSource(next);
        }} />}

      <div
        id="settings-view"
        role="region"
        aria-label="Integration settings"
        hidden={activeView !== "settings"}
      >
        {activeView === "settings" && <AtlasSettingsPanel connection={atlasConnection} />}
      </div>

      <div
        id="explorer-view"
        role="tabpanel"
        aria-labelledby="explorer-tab"
        hidden={activeView !== "explorer"}
      >
        <SpectrumExplorer
          pipeline={analysis}
          controller={controller}
          receiver={receiver}
          receiverLocation={antennaSite.site}
          initialFrequencyHz={frequencyMhz * 1_000_000}
          volume={volume}
          recordingBlocked={
            Boolean(recordingStatus) || exportingRecording || captureSlotBlocked
          }
          startReceptionForScan={startReceptionForScan}
          onOpenReceiver={() => {
            setActiveView("receiver");
            requestAnimationFrame(() =>
              document
                .getElementById("acquire-heading")
                ?.scrollIntoView({ block: "start" }),
            );
          }}
          onScanningChange={setScanActive}
          onCaptureCandidates={captureSurveyCandidates}
          onInvestigate={(frequencyHz) => {
            setActiveView("receiver");
            const settings = defaultModeSettings("SRD");
            setMode("SRD");
            setBandwidthHz(settings.bandwidthHz);
            setSquelch(settings.squelch);
            setSrdSettings(settings.srd ?? defaultSrdModeSettings());
            if (receiver.lifecycle === "running")
              void controller
                .configureMode(settings)
                .then(() => tune(frequencyHz));
            else tune(frequencyHz);
          }}
        />
      </div>

      <div
        id="diagnostics-view"
        role="region"
        aria-label="Diagnostics"
        hidden={activeView !== "diagnostics"}
      >
        <DiagnosticsPanel
          health={
            <ReceiverHealth
              receiver={receiver}
              spectrum={spectrumStatus}
              recording={recordingStatus}
              preparing={exportingRecording}
              retained={retainedCapture}
              recordingSupported={recordingSupported}
              onReceiver={() => {
                setActiveView("receiver");
                requestAnimationFrame(() => {
                  const menu = document.querySelector<HTMLDetailsElement>(".receiver-status-menu");
                  if (menu) {
                    menu.open = true;
                    menu.querySelector<HTMLElement>("summary")?.focus();
                    menu.scrollIntoView({ block: "start" });
                  }
                });
              }}
              onRecording={() => {
                setActiveView("receiver");
                setReceiverDockExpanded(true);
                setReceiverDockView("capture");
                setCaptureView("record");
                requestAnimationFrame(() =>
                  document
                    .getElementById("recording-heading")
                    ?.scrollIntoView({ block: "start" }),
                );
              }}
              onSpectrum={() => {
                setActiveView("receiver");
                requestAnimationFrame(() =>
                  document
                    .getElementById("graphics-heading")
                    ?.scrollIntoView({ block: "start" }),
                );
              }}
            />
          }
          active={activeView === "diagnostics"}
          pipeline={analysis}
          receiver={receiver}
          controller={controller}
        />

        <section
          className="capabilities-panel"
          aria-labelledby="capabilities-heading"
        >
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Environment</p>
              <h2 id="capabilities-heading">Browser API availability</h2>
            </div>
          </div>
          <p className="display-note">
            These checks detect browser APIs. They do not establish that a
            receiver, audio output, or GPU display is working; see session
            health above.
          </p>
          <ul className="capability-list">
            {detectedCapabilities.map((capability) => (
              <li key={capability.label}>
                <span
                  className={
                    capability.available === null
                      ? "check pending"
                      : capability.available
                        ? "check available"
                        : "check no"
                  }
                  aria-hidden="true"
                >
                  {capability.available === null
                    ? "…"
                    : capability.available
                      ? "i"
                      : "!"}
                </span>
                <span>
                  <strong>{capability.label}</strong>
                  <small>{capability.detail}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div
        id="help-view"
        role="region"
        aria-label="Help & setup"
        hidden={activeView !== "help"}
      >
        {activeView === "help" && (
          <>
            <section className="help-hero" aria-labelledby="help-heading">
              <div>
                <p className="eyebrow">BrowserSDR field guide</p>
                <h2 id="help-heading">How can we help you receive?</h2>
                <p>
                  Start without hardware, check whether your setup is known to
                  work, or troubleshoot a connection. BrowserSDR processes
                  signals locally in this tab.
                </p>
              </div>
              <div className="help-actions">
                <button
                  type="button"
                  onClick={() => {
                    setActiveView("receiver");
                    void switchSource("synthetic");
                  }}
                >
                  Try the no-hardware demo
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => openAuxiliaryView("diagnostics")}
                >
                  Check this browser
                </button>
              </div>
            </section>

            <div className="help-layout">
              <main className="help-main">
                <section
                  className="help-panel compatibility-panel"
                  aria-labelledby="compatibility-heading"
                >
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">Compatibility</p>
                      <h2 id="compatibility-heading">Tested receiver setups</h2>
                    </div>
                    <div className="matrix-legend">
                      <span>
                        <i className="matrix-dot validated" />
                        Validated
                      </span>
                      <span>
                        <i className="matrix-dot unclear" />
                        Unclear
                      </span>
                    </div>
                  </div>
                  <p className="matrix-intro">
                    Evidence applies only to the listed scope.{" "}
                    <strong>Physical tests</strong> exercise a real receiver and
                    RF signal. <strong>Software tests</strong> use generated
                    data or mocked USB and do not establish physical reception.{" "}
                    <strong>Unclear</strong> means evidence is insufficient. See
                    each row and the detailed compatibility notes.
                  </p>
                  <div className="compatibility-table-wrap compatibility-overview">
                    <table className="compatibility-table">
                      <thead>
                        <tr>
                          <th>Source</th>
                          <th>Status</th>
                          <th>Tested scope</th>
                          <th>Known limits</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <th scope="row">Synthetic demo</th>
                          <td>
                            <span className="compat-status is-available">
                              Software-tested
                            </span>
                          </td>
                          <td>
                            Current desktop Chromium; spectrum and analysis path
                          </td>
                          <td>No RF hardware or audio</td>
                        </tr>
                        <tr>
                          <th scope="row">
                            RTL-SDR
                            <br />
                            <small>R820 / R828 / R860 tuner</small>
                          </th>
                          <td>
                            <span className="compat-status is-validated">
                              Validated
                            </span>
                          </td>
                          <td>
                            Live FM, audio, RDS, WebGPU, recording and replay in
                            Chrome
                          </td>
                          <td>Other tuner families are unclear</td>
                        </tr>
                        <tr>
                          <th scope="row">
                            HackRF Pro
                            <br />
                            <small>firmware v2026.01.1–v2026.01.3</small>
                          </th>
                          <td>
                            <span className="compat-status is-validated">
                              Validated
                            </span>
                          </td>
                          <td>
                            Live reception at 4.8 and 9.6 MS/s, tuning,
                            recording and restart
                          </td>
                          <td>
                            19.2 MS/s remains experimental; HackRF One is not
                            this profile
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">bladeRF 2.0 Micro (xA4 validated)</th>
                          <td>
                            <span className="compat-status is-validated">
                              Validated
                            </span>
                          </td>
                          <td>
                            Connection, volatile FPGA load, RF configuration and
                            initial reception
                          </td>
                          <td>
                            {SOURCE_RECORDING_DESCRIPTIONS.bladerf}. TX is unavailable.
                            Sustained hardware checks remain
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">
                            USRP B205-mini / B205mini-i
                            <br />
                            <small>2500:0022 · FX3 8.x · FPGA 7.x</small>
                          </th>
                          <td>
                            <span className="compat-status is-available">
                              Software-tested
                            </span>
                          </td>
                          <td>
                            Mocked browser lifecycle, volatile firmware/FPGA
                            load, VRT/SC16 receive path and reconnect
                          </td>
                          <td>
                            USB 3 hardware validation remains; RX only.
                            {SOURCE_RECORDING_DESCRIPTIONS["usrp-b205"]}
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">Other SDR hardware</th>
                          <td>
                            <span className="compat-status is-unclear">
                              Unclear
                            </span>
                          </td>
                          <td>No direct evidence</td>
                          <td>BrowserSDR only offers the profiles above</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="matrix-footnote">
                    Hardware reception requires a current desktop Chromium
                    browser with WebUSB, an HTTPS or localhost page, and
                    exclusive access to the device. Chrome is the tested
                    browser; other Chromium browsers remain unclear.
                  </p>
                  <details className="compatibility-details">
                    <summary>
                      <span>View detailed compatibility</span>
                      <small>Modes, recording &amp; export, and browsers</small>
                    </summary>
                    <div className="compatibility-detail-content">
                      <div
                        className="compatibility-status-guide"
                        aria-label="Detailed compatibility status definitions"
                      >
                        <span>
                          <strong className="guide-validated">Validated</strong>
                          Direct automated or physical evidence
                        </span>
                        <span>
                          <strong className="guide-available">Available</strong>
                          Implemented; live evidence is incomplete
                        </span>
                        <span>
                          <strong className="guide-experimental">
                            Experimental
                          </strong>
                          Known stability or performance risk
                        </span>
                        <span>
                          <strong className="guide-unclear">Unclear</strong>
                          Not enough evidence to recommend
                        </span>
                        <span>
                          <strong className="guide-unsupported">
                            Unsupported
                          </strong>
                          Not offered by this implementation
                        </span>
                      </div>
                      <div
                        className="compatibility-detail-tabs"
                        role="tablist"
                        aria-label="Detailed compatibility views"
                      >
                        {(
                          Object.keys(
                            COMPATIBILITY_DETAILS,
                          ) as CompatibilityDetailView[]
                        ).map((view) => (
                          <button
                            type="button"
                            id={`compatibility-${view}-tab`}
                            role="tab"
                            aria-selected={compatibilityDetailView === view}
                            aria-controls={`compatibility-${view}-panel`}
                            tabIndex={compatibilityDetailView === view ? 0 : -1}
                            onClick={() => setCompatibilityDetailView(view)}
                            onKeyDown={handleCompatibilityTabKeyDown}
                            key={view}
                          >
                            {COMPATIBILITY_DETAILS[view].label}
                          </button>
                        ))}
                      </div>
                      {(
                        Object.keys(
                          COMPATIBILITY_DETAILS,
                        ) as CompatibilityDetailView[]
                      ).map((view) => {
                        const detail = COMPATIBILITY_DETAILS[view];
                        return (
                          <div
                            id={`compatibility-${view}-panel`}
                            className="compatibility-detail-panel"
                            role="tabpanel"
                            aria-labelledby={`compatibility-${view}-tab`}
                            hidden={compatibilityDetailView !== view}
                            key={view}
                          >
                            <div className="compatibility-table-wrap">
                              <table className="compatibility-table compatibility-detail-table">
                                <thead>
                                  <tr>
                                    <th>
                                      {view === "modes"
                                        ? "Mode or workflow"
                                        : view === "recording"
                                          ? "Workflow"
                                          : "Environment"}
                                    </th>
                                    {detail.columns.map((column) => (
                                      <th key={column}>{column}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {detail.rows.map((row) => (
                                    <tr key={row.label}>
                                      <th scope="row">{row.label}</th>
                                      {row.cells.map((cell, index) => (
                                        <td key={detail.columns[index]}>
                                          <span
                                            className={`compat-status is-${cell.status}`}
                                          >
                                            {
                                              COMPATIBILITY_STATUS_LABELS[
                                                cell.status
                                              ]
                                            }
                                          </span>
                                          <small className="compat-evidence">
                                            {cell.evidence}
                                          </small>
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <p className="compatibility-detail-note">
                              {detail.note}
                            </p>
                          </div>
                        );
                      })}
                      <p className="compatibility-last-reviewed">
                        Evidence reviewed 26 September 2026 · Statuses describe
                        the paths above, not every device, signal or driver
                        combination.
                      </p>
                    </div>
                  </details>
                  <CompatibilityReportCard
                    context={compatibilityReportContext}
                  />
                </section>

                <section
                  className="help-panel faq-panel"
                  aria-labelledby="faq-heading"
                >
                  <p className="eyebrow">Frequently asked questions</p>
                  <h2 id="faq-heading">The useful answers, up front</h2>
                  <div className="faq-list">
                    <details open>
                      <summary>How do I get started?</summary>
                      <p>
                        For a quick check, choose the synthetic demo and press{" "}
                        <strong>Start demo</strong>. For hardware, connect one
                        supported receiver, choose a sample rate and mode, then
                        use <strong>Connect</strong> followed by{" "}
                        <strong>Start receiving</strong>. The browser will ask
                        you to select the USB device.
                      </p>
                    </details>
                    <details>
                      <summary>Which browser should I use?</summary>
                      <p>
                        Use a current desktop Google Chrome build. Hardware
                        access needs WebUSB, and the spectrum benefits from
                        WebGPU, with a Canvas2D fallback when it is unavailable.
                        Open Diagnostics to see what this browser
                        exposes before troubleshooting the radio.
                      </p>
                    </details>
                    <details>
                      <summary>
                        Why is my device missing from the USB chooser?
                      </summary>
                      <p>
                        Close other SDR tools first—only one application can own
                        the radio. Confirm the device matches a supported
                        profile. On Windows, an RTL-SDR may need WinUSB; on
                        Linux, a DVB kernel driver may already own it. Reconnect
                        the radio after changing driver ownership.
                      </p>
                    </details>
                    <details>
                      <summary>Does BrowserSDR upload my radio data?</summary>
                      <p>
                        Local receiver processing, replay and decoded content
                        stay in the browser. Recordings go to SigIntAtlas only
                        when you choose Save. A remote receiver connection sends
                        connection and tuning requests to that receiver's
                        operator and receives its processed audio and spectrum.
                        BrowserSDR does not send it local recordings or Atlas tokens. The
                        Diagnostics view can send a separately reviewed error
                        report. Automatic error reporting is on by default and
                        can be turned off there. Reports exclude radio data, USB serial
                        numbers, IP addresses and exact tuned frequency by
                        default.
                      </p>
                    </details>
                    <details>
                      <summary>
                        Can BrowserSDR transmit or change device firmware?
                      </summary>
                      <p>
                        All supported hardware paths are receive-only. For an
                        bladeRF 2.0 Micro with an empty FPGA, BrowserSDR can load
                        the exact verified model and firmware image
                        into volatile RAM. For a USRP B205-mini in
                        WestBridge mode, it can also load exact verified
                        official FX3 firmware into RAM before the FPGA image. It
                        never writes flash or EEPROM, changes persistent
                        firmware, or enables TX; both USRP images disappear on
                        power loss.
                      </p>
                    </details>
                    <details>
                      <summary>What can I receive?</summary>
                      <p>
                        Spectrum-only mode keeps acquisition and analysis active
                        without audio or decoder output. Analog WBFM, NBFM, AM,
                        USB, LSB and CW are also available, plus DAB/DAB+, 1090
                        MHz ADS-B, dual-channel AIS and SRD signal inspection
                        where the selected source and sample rate support them.
                        Reception still depends on your antenna, local signals
                        and RF conditions.
                      </p>
                    </details>
                    <details>
                      <summary>What is Explorer for?</summary>
                      <p>
                        Explorer scans a frequency range or reusable
                        field-survey profile with the active receiver. It finds
                        candidates using relative signal power, then lets you
                        investigate or capture them. A detected peak is evidence
                        of activity—not proof of a modulation or transmitter
                        identity.
                      </p>
                    </details>
                    <details>
                      <summary>How do recording and replay work?</summary>
                      <p>
                        Capture streams to private browser storage up to 2 GiB
                        when OPFS is available, with a 32 MiB memory fallback.
                        RTL-SDR uses CU8 and HackRF Pro uses CI8; both can be
                        exported in BrowserSDR or SigMF pairs where supported.
                        USRP B205-mini: {SOURCE_RECORDING_DESCRIPTIONS["usrp-b205"]}.
                        bladeRF: {SOURCE_RECORDING_DESCRIPTIONS.bladerf}.
                        Replay never asks for USB permission.
                      </p>
                    </details>
                  </div>
                </section>
              </main>

              <aside
                className="help-aside"
                aria-label="Setup and troubleshooting"
              >
                <section className="help-panel quick-start-panel">
                  <p className="eyebrow">Three steps</p>
                  <h2>Before connecting</h2>
                  <ol className="quick-start-list">
                    <li>
                      <span>01</span>
                      <div>
                        <strong>Check the matrix</strong>
                        <p>Match the exact device and firmware profile.</p>
                      </div>
                    </li>
                    <li>
                      <span>02</span>
                      <div>
                        <strong>Close SDR software</strong>
                        <p>Release the USB device from other applications.</p>
                      </div>
                    </li>
                    <li>
                      <span>03</span>
                      <div>
                        <strong>Check Diagnostics</strong>
                        <p>Confirm secure context and WebUSB; spectrum also works without WebGPU.</p>
                      </div>
                    </li>
                  </ol>
                </section>

                <section
                  className="help-panel"
                  aria-labelledby="device-help-heading"
                >
                  <p className="eyebrow">Device setup</p>
                  <h2 id="device-help-heading">If it will not connect</h2>
                  <p>
                    Use an RTL2832U device with an R820/R828/R860 tuner. Close
                    other SDR software first. Do not change drivers unless the
                    instructions for your hardware and OS require it.
                  </p>
                  <div
                    className="system-troubleshooting"
                    aria-label="Operating system troubleshooting hints"
                  >
                    <article>
                      <h3>Windows</h3>
                      <p>
                        Close SDR applications, then use Zadig to assign the
                        WinUSB driver to the RTL2832U interface. Reconnect the
                        dongle and restart the browser.
                      </p>
                    </article>
                    <article>
                      <h3>Linux</h3>
                      <p>
                        If the DVB driver owns the device, close TV/SDR software
                        and unload the module temporarily:
                      </p>
                      <code>sudo rmmod dvb_usb_rtl28xxu</code>
                      <small>
                        This can disable DVB use until the module is reloaded or
                        the computer restarts.
                      </small>
                    </article>
                    <article>
                      <h3>macOS</h3>
                      <p>
                        Close other SDR applications, reconnect the dongle, and
                        use a current Chromium-based browser. A separate USB
                        driver is normally unnecessary.
                      </p>
                    </article>
                  </div>
                  <div className="help-links">
                    <a
                      href="https://developer.chrome.com/docs/capabilities/build-for-webusb"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Chrome WebUSB guidance ↗
                    </a>
                    <a
                      href="https://github.com/jtarrio/webrtlsdr#compatible-hardware-and-software"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Supported hardware ↗
                    </a>
                    <a
                      href="https://www.rtl-sdr.com/rtl-sdr-quick-start-guide/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      RTL-SDR setup guide ↗
                    </a>
                  </div>
                </section>
              </aside>
            </div>
          </>
        )}
      </div>

      <div
        id="about-view"
        role="region"
        aria-label="About BrowserSDR"
        hidden={activeView !== "about"}
      >
        {activeView === "about" && <AboutPage />}
      </div>
      <RemotePresetSharePanel blockedReason={remoteBlockedReason} onApply={async (preset) => {
        if (!await openRemoteReceiver(preset)) throw new Error(remoteBlockedReason ?? "The receiver could not be released. Finish the current operation and try again.");
      }} />
    </main>
  );
}

const createDefaultAnalysis = () => new AnalysisPipeline();

export default function App() {
  return (
    <AppResourceOwner createAnalysis={createDefaultAnalysis}>
      {(runtime) => <ReceiverApp {...runtime} />}
    </AppResourceOwner>
  );
}
