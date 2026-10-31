import { validateAirspySettings, type AirspySettings } from "./airspySettings";
import type { SecondaryVfoSettings } from "./secondaryVfo";
import { rtlDeviceFrequency } from "./rtlInput";
import type { PocsagSnapshot } from "../pocsag/types";
import type { FmStereoReception } from "./fmStereoReception";
import { isTextMode } from "../textmodem/settings";
import type { TextModemSnapshot } from "../textmodem/types";
import { captureOrigin } from "./receptionEvidence";
import { classifyReceiverIssue, type ReceiverIssue } from "./receiverRecovery";
import type { RecordingOptions } from "./channelRecording";
import { validateBladeRfRxSettings, type BladeRfRxSettings } from "./bladerfSettings";
import type { IngressDiagnostics } from "./ingressTimings";
import type { ChannelDiagnostics } from "./widebandChannel";
import type {
  AdsbSnapshot,
  AisSnapshot,
  DabSnapshot,
  RdsSnapshot,
  ReceiverLifecycle,
  SourceKind,
  SourceSessionMetadata,
  SquelchMeterState,
} from "./types";
import type { AprsSnapshot } from "../aprs/types";
import type { Rs41Snapshot } from "../rs41/types";
import type { SrdSnapshot } from "../srd/types";
import type { DigitalWorkerAdapterDiagnostics } from "../digital";
import {
  normalizeGain,
  defaultModeSettings,
  normalizeModeSettings,
  planChannelTune,
  type ReceiverTuneOptions,
  type ReceiverModeSettings,
} from "./receiverConfig";
import type { IqRecording, RecordingStatus } from "./iqRecording";
import type { SurveyCaptureContext } from "./fieldSurvey";
import { defaultDiagnosticRecorder } from "../diagnostics/diagnosticRecorder";
import {
  sourceCapabilities,
  validateSourceConfiguration,
  validateSourceRoute,
  validateSourceFrequency,
  validateHackrfRxSettings,
  isWidebandRate,
  type HackrfRxSettings,
} from "./sourceCapabilities";
import type { UsrpB205RxSettings } from "./usrpB205Capabilities";

export const FM_MIN_HZ = 87_500_000;
export const FM_MAX_HZ = 108_000_000;
export const RTL_SAMPLE_RATE_HZ = 1_024_000;
export { RTL_SAMPLE_RATES_HZ as RTL_SAMPLE_RATE_OPTIONS_HZ } from "./rtlSampleRate";

export interface ReceiverStartOptions {
  airspySettings?: AirspySettings;
  rtlInput?: import("./rtlInput").RtlInputSettings;
  source?: SourceKind;
  channelFrequencyHz: number;
  volume: number;
  modeSettings?: ReceiverModeSettings;
  gainDb?: number | null;
  sampleRateHz?: number;
  hardwareSettings?: HackrfRxSettings;
  usrpSettings?: UsrpB205RxSettings;
  bladerfSettings?: BladeRfRxSettings;
}

export interface ReceiverBackendEvents {
  captureSamplesRequested?(): boolean;
  captureSamples?(bytes: Uint8Array, session: SourceSessionMetadata, gap?: {missingSamples:number|null;reason:string}): void;
  secondaryVfoChanged?(settings: SecondaryVfoSettings | undefined, message?: string): void;
  permissionGranted(): void;
  statusChanged?(message: string): void;
  runtimeError(error: unknown): void;
  audioStateChanged(state: AudioContextState): void;
  sourceEnded(): void;
  rdsChanged(state: RdsSnapshot): void;
  dabChanged?(state: DabSnapshot): void;
  adsbChanged?(state: AdsbSnapshot): void;
  aisChanged?(state: AisSnapshot): void;
  textModemChanged?(state: TextModemSnapshot, diagnostics: DigitalWorkerAdapterDiagnostics, image?: import("../textmodem/imageTypes").ReceivedImage): void;
  pocsagChanged?(state: PocsagSnapshot, diagnostics: DigitalWorkerAdapterDiagnostics): void;
  aprsChanged?(state: AprsSnapshot, diagnostics: DigitalWorkerAdapterDiagnostics): void;
  rs41Changed?(state: Rs41Snapshot, diagnostics: DigitalWorkerAdapterDiagnostics): void;
  srdChanged?(
    state: SrdSnapshot,
    diagnostics: DigitalWorkerAdapterDiagnostics,
  ): void;
  squelchChanged?(state: SquelchMeterState): void;
  fmStereoReceptionChanged?(reception: FmStereoReception | undefined): void;
}

export interface ReceiverBackend {
  configureSecondaryVfo?(settings?: SecondaryVfoSettings): Promise<void>;
  getIngressDiagnostics?(): IngressDiagnostics | undefined;
  getChannelDiagnostics?(): ChannelDiagnostics | undefined;
  /** Optional persistent hardware connection used by RTL-SDR. */
  connect?(
    options: ReceiverStartOptions,
  ): Promise<Omit<SourceSessionMetadata, "sessionGeneration">>;
  /** Connect an already-authorized WebUSB device without opening the chooser. */
  connectGranted?(
    options: ReceiverStartOptions,
    device: USBDevice,
  ): Promise<Omit<SourceSessionMetadata, "sessionGeneration">>;
  start(
    options: ReceiverStartOptions,
    sessionGeneration?: number,
  ): Promise<Omit<SourceSessionMetadata, "sessionGeneration">>;
  stop(): Promise<void>;
  /** Final teardown for a persistent backend. */
  disconnect?(): Promise<void>;
  selectDabService?(key: string): void;
  setVolume(volume: number): void;
  tune(
    channelFrequencyHz: number,
    sessionGeneration: number,
    options?: ReceiverTuneOptions,
  ): Promise<Omit<SourceSessionMetadata, "sessionGeneration">>;
  /** Explicit acquisition-center retune used by bounded spectrum scans. */
  scanTune?(
    centerFrequencyHz: number,
    sessionGeneration: number,
  ): Promise<Omit<SourceSessionMetadata, "sessionGeneration">>;
  configureMode(
    settings: ReceiverModeSettings,
    sessionGeneration: number,
  ): Promise<Omit<SourceSessionMetadata, "sessionGeneration">>;
  /** Update the active analog demodulator without retuning or replacing the
   * acquisition generation. Only same-mode bandwidth/squelch/tone changes are
   * accepted by the controller. */
  updateAnalogMode?(
    settings: ReceiverModeSettings,
  ): Omit<SourceSessionMetadata, "sessionGeneration">;
  setGain(gainDb: number | null): Promise<number | null>;
  /** Change the acquisition rate at a clean sample boundary, retaining USB
   * and audio ownership. The old recording must be finished before invocation. */
  configureSampleRate?(
    sampleRateHz: number,
    sessionGeneration: number,
    options?: ReceiverTuneOptions,
  ): Promise<Omit<SourceSessionMetadata, "sessionGeneration">>;
  /** Finish the old capture before invocation. Live gains preserve sample/decoder
   * generations and return accepted metadata without stopping acquisition.
   * Rejection closes the session; no partial accepted configuration is published. */
  configureHardware?(
    settings: HackrfRxSettings,
    sessionGeneration: number,
  ): Promise<Omit<SourceSessionMetadata, "sessionGeneration">>;
  configureAirspy?(settings: AirspySettings, sessionGeneration: number): Promise<Omit<SourceSessionMetadata, "sessionGeneration">>;
  configureBladeRf?(settings: BladeRfRxSettings, sessionGeneration: number): Promise<Omit<SourceSessionMetadata, "sessionGeneration">>;
  startRecording?(survey?: SurveyCaptureContext, options?: RecordingOptions): RecordingStatus;
  stopRecording?(
    reason?: "user" | "source-stop" | "metadata-change",
  ): IqRecording | undefined;
  getRecordingStatus?(): RecordingStatus | undefined;
  setReplayPaused?(paused: boolean): void;
  getReplayPosition?(): number;
}

export type ReceiverBackendFactory = (
  events: ReceiverBackendEvents,
  options: ReceiverStartOptions,
  sessionGeneration: number,
) => ReceiverBackend;

export interface ReceiverSnapshot {
  /** Explicit center exploration cleared an incompatible listening channel. */
  channelSelectionWarning?: string;
  secondaryVfo?: SecondaryVfoSettings;
  secondaryVfoMessage?: string;
  /** Stabilized recent WBFM reception; undefined while acquiring or outside WBFM. */
  fmStereoReception?: FmStereoReception;
  lifecycle: ReceiverLifecycle;
  message: string;
  sessionGeneration: number;
  session?: SourceSessionMetadata;
  audioState?: AudioContextState;
  rds?: RdsSnapshot;
  dab?: DabSnapshot;
  adsb?: AdsbSnapshot;
  ais?: AisSnapshot;
  textModem?: TextModemSnapshot;
  textModemWorker?: DigitalWorkerAdapterDiagnostics;
  modemImage?: import("../textmodem/imageTypes").ReceivedImage;
  pocsag?: PocsagSnapshot;
  pocsagWorker?: DigitalWorkerAdapterDiagnostics;
  aprs?: AprsSnapshot;
  aprsWorker?: DigitalWorkerAdapterDiagnostics;
  rs41?: Rs41Snapshot;
  rs41Worker?: DigitalWorkerAdapterDiagnostics;
  srd?: SrdSnapshot;
  srdWorker?: DigitalWorkerAdapterDiagnostics;
  /** A failed close retains ownership; only Stop/retry is safe until it closes. */
  cleanupRequired?: boolean;
  hardwareSettingsPending?: boolean;
  issue?: ReceiverIssue;
}

type Listener = (snapshot: ReceiverSnapshot) => void;
type SquelchMeterListener = () => void;

const INITIAL_SNAPSHOT: ReceiverSnapshot = {
  lifecycle: "idle",
  message: "Receiver not started",
  sessionGeneration: 0,
};

export class ReceiverController {
  setReplayPaused(paused: boolean): void {
    if (this.snapshot.lifecycle !== "running" || this.snapshot.session?.source !== "replay") return;
    this.backend?.setReplayPaused?.(paused);
  }
  getReplayPosition(): number | undefined { return this.backend?.getReplayPosition?.(); }

  private snapshot: ReceiverSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<Listener>();
  private squelchMeter: SquelchMeterState | undefined;
  private readonly squelchMeterListeners = new Set<SquelchMeterListener>();
  private backend?: ReceiverBackend;
  private connectionIdentity = 0;
  /** Opaque session-local identity; never a serial number or persisted setting. */
  getConnectionIdentity = (): number | undefined => this.backend ? this.connectionIdentity : undefined;
  private startTask?: Promise<void>;
  private sampleRateTask?: Promise<Omit<SourceSessionMetadata, "sessionGeneration">>;
  private generation = 0;
  private source: SourceKind = "rtl-sdr";
  private autoRecenter = true;
  private completedRecording?: IqRecording;
  private requestedVolume = 0.7;
  private readonly audioSuppressions = new Set<symbol>();
  private readonly cleanupTasks = new Map<ReceiverBackend, Promise<void>>();

  constructor(private readonly createBackend: ReceiverBackendFactory) {}

  private readonly captureListeners = new Set<(bytes: Uint8Array, session: SourceSessionMetadata, gap?: {missingSamples:number|null;reason:string}) => void>();
  subscribeCaptureSamples(listener: (bytes: Uint8Array, session: SourceSessionMetadata, gap?: {missingSamples:number|null;reason:string}) => void): () => void {
    if (this.captureListeners.size) throw new Error("An event capture subscriber already owns the raw capture tap.");
    this.captureListeners.add(listener);
    return () => { this.captureListeners.delete(listener); };
  }
  private lastIngress?: IngressDiagnostics;
  getIngressDiagnostics = (): IngressDiagnostics | undefined =>
    this.backend?.getIngressDiagnostics?.() ?? this.lastIngress;
  getChannelDiagnostics = (): ChannelDiagnostics | undefined =>
    this.backend?.getChannelDiagnostics?.();

  getSnapshot = (): ReceiverSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSquelchMeterSnapshot = (): SquelchMeterState | undefined =>
    this.squelchMeter;

  subscribeSquelchMeter = (listener: SquelchMeterListener): (() => void) => {
    this.squelchMeterListeners.add(listener);
    return () => this.squelchMeterListeners.delete(listener);
  };

  start(options: ReceiverStartOptions): Promise<void> {
    const restartingConnectedBackend =
      this.snapshot.lifecycle === "connected" && Boolean(this.backend?.connect);
    if (
      !restartingConnectedBackend &&
      this.snapshot.lifecycle !== "idle" &&
      this.snapshot.lifecycle !== "error"
    ) {
      return this.startTask ?? Promise.resolve();
    }
    if (this.backend && !restartingConnectedBackend) return Promise.resolve();

    this.requestedVolume = clampVolume(options.volume);
    options = { ...options, volume: this.audioSuppressions.size ? 0 : this.requestedVolume };

    const generation = ++this.generation;
    this.source = options.source ?? "rtl-sdr";
    try {
      validateOptions(options);
    } catch (error) {
      this.publishFailure(generation, error);
      return Promise.resolve();
    }
    const source = options.source ?? "rtl-sdr";
    this.publish({
      lifecycle: sourceCapabilities(source).requiresUsb
        ? "requesting-permission"
        : "starting",
      message:
        source === "synthetic"
          ? "Starting the synthetic RF spectrum demo…"
          : source === "replay"
            ? "Starting paced I/Q replay and audio…"
            : `Choose ${options.source === "rtl-sdr" ? "an" : "a"} ${sourceCapabilities(source).label} device in the browser prompt…`,
      sessionGeneration: generation,
      session: this.snapshot.session,
      audioState: this.snapshot.audioState,
    });

    let backend = this.backend;
    if (!backend) {
      try {
        backend = this.createAndAttachBackend(options, generation);
      } catch (error) {
        this.publishFailure(generation, error);
        return Promise.resolve();
      }
    } else {
      this.publish({
        ...this.snapshot,
        lifecycle: "starting",
        message: `Starting ${options.modeSettings?.mode ?? "WBFM"} reception…`,
        sessionGeneration: generation,
      });
    }
    const task = this.runStart(backend, options, generation);
    this.startTask = task;
    void task.finally(() => {
      if (this.startTask === task) this.startTask = undefined;
    });
    return task;
  }

  async connect(options: ReceiverStartOptions): Promise<void> {
    await this.connectDevice(options);
  }

  async connectGranted(
    options: ReceiverStartOptions,
    device: USBDevice,
  ): Promise<void> {
    await this.connectDevice(options, device);
  }

  private async connectDevice(
    options: ReceiverStartOptions,
    grantedDevice?: USBDevice,
  ): Promise<void> {
    if (
      this.snapshot.lifecycle !== "idle" &&
      this.snapshot.lifecycle !== "error"
    )
      return;
    if (this.backend) return;
    this.requestedVolume = clampVolume(options.volume);
    options = { ...options, volume: this.audioSuppressions.size ? 0 : this.requestedVolume };
    const generation = ++this.generation;
    this.source = options.source ?? "rtl-sdr";
    try {
      validateOptions(options);
    } catch (error) {
      this.publishFailure(generation, error);
      return;
    }
    let backend: ReceiverBackend;
    try {
      backend = this.createAndAttachBackend(options, generation);
    } catch (error) {
      this.publishFailure(generation, error);
      return;
    }
    if (!backend.connect) {
      await this.runStart(backend, options, generation);
      return;
    }
    this.publish({
      lifecycle: grantedDevice ? "connecting" : "requesting-permission",
      message: grantedDevice
        ? `Reconnecting the authorized ${sourceCapabilities(options.source ?? "rtl-sdr").label} device…`
        : `Choose ${(options.source ?? "rtl-sdr") === "rtl-sdr" ? "an" : "a"} ${sourceCapabilities(options.source ?? "rtl-sdr").label} device in the browser prompt…`,
      sessionGeneration: generation,
    });
    try {
      if (grantedDevice && !backend.connectGranted)
        throw new Error(
          "This receiver cannot reconnect an authorized USB device.",
        );
      const metadata = grantedDevice
        ? await backend.connectGranted!(options, grantedDevice)
        : await backend.connect(options);
      if (generation !== this.generation || this.backend !== backend) return;
      this.publishConnected(
        metadata,
        generation,
        `${sourceCapabilities(metadata.source).label} connected. Start reception when ready.`,
      );
    } catch (error) {
      try {
        await this.cleanupBackend(backend);
      } catch {
        /* Retain ownership for cleanup retry. */
      }
      if (generation === this.generation)
        this.publishFailure(generation, error);
    }
  }

  async stop(): Promise<void> {
    if (this.snapshot.lifecycle === "idle") return;
    if (this.snapshot.lifecycle === "connected") return;
    if (this.snapshot.lifecycle === "stopping") {
      await this.cleanupTasks.get(this.backend!);
      return;
    }

    const generation = ++this.generation;
    const backend = this.backend;
    const pendingRate = this.sampleRateTask;
    this.captureCompletedRecording(backend?.stopRecording?.("source-stop"));
    const persistent = Boolean(backend?.disconnect);
    const preserveConnection =
      persistent && ["running", "tuning"].includes(this.snapshot.lifecycle);
    this.publish({
      lifecycle: "stopping",
      message: preserveConnection
        ? "Stopping sample transfers; keeping the device connected…"
        : "Stopping sample transfers and closing the source…",
      sessionGeneration: generation,
      session: this.snapshot.session,
      audioState: this.snapshot.audioState,
    });

    try {
      let stoppedMetadata = this.snapshot.session;
      if (preserveConnection && backend) {
        await backend.stop();
        if (pendingRate) stoppedMetadata = { ...await pendingRate, sessionGeneration: generation };
        if (stoppedMetadata?.airspy) stoppedMetadata = { ...stoppedMetadata, airspy: { ...stoppedMetadata.airspy, settings: { ...stoppedMetadata.airspy.settings, biasTee: false } } };
      }
      else await this.cleanupBackend(backend);
      if (generation === this.generation) {
        if (preserveConnection && stoppedMetadata)
          this.publishConnected(
            stoppedMetadata,
            generation,
            `Reception stopped. ${sourceCapabilities(stoppedMetadata.source).label} remains connected.`,
          );
        else
          this.publish({
            lifecycle: "idle",
            message: "Receiver stopped.",
            sessionGeneration: generation,
          });
      }
    } catch (error) {
      this.publishFailure(generation, error);
    }
  }

  async disconnect(): Promise<void> {
    const backend = this.backend;
    if (!backend) {
      if (this.snapshot.lifecycle !== "idle")
        this.publish({
          lifecycle: "idle",
          message: "Receiver disconnected.",
          sessionGeneration: ++this.generation,
        });
      return;
    }
    const generation = ++this.generation;
    this.captureCompletedRecording(backend.stopRecording?.("source-stop"));
    this.publish({
      ...this.snapshot,
      lifecycle: "disconnecting",
      message: "Releasing the signal source…",
      sessionGeneration: generation,
    });
    try {
      await this.cleanupBackend(backend);
      if (generation === this.generation)
        this.publish({
          lifecycle: "idle",
          message: "Receiver disconnected.",
          sessionGeneration: generation,
        });
    } catch (error) {
      if (generation === this.generation)
        this.publishFailure(generation, error);
    }
  }

  selectDabService(key: string): void {
    if (
      this.snapshot.lifecycle !== "running" ||
      !this.snapshot.dab?.stations?.some(
        (station) => station.key === key && station.playable,
      )
    )
      return;
    this.backend?.selectDabService?.(key);
  }

  setVolume(volume: number): void {
    const safeVolume = clampVolume(volume);
    this.requestedVolume = safeVolume;
    this.backend?.setVolume(this.audioSuppressions.size ? 0 : safeVolume);
  }

  /** Scoped temporary silence without overwriting the user's volume/mute.
   * Multiple owners cannot release one another's gate. Start also respects it. */
  suppressAudio(): () => void {
    const owner = Symbol("receiver-audio-suppression");
    this.audioSuppressions.add(owner);
    this.backend?.setVolume(0);
    return () => {
      if (!this.audioSuppressions.delete(owner)) return;
      this.backend?.setVolume(this.audioSuppressions.size ? 0 : this.requestedVolume);
    };
  }

  startRecording(survey?: SurveyCaptureContext, options?: RecordingOptions): RecordingStatus | undefined {
    if (
      this.snapshot.lifecycle !== "running" || this.snapshot.hardwareSettingsPending ||
      !this.backend ||
      this.completedRecording
    )
      return undefined;
    return this.backend.startRecording?.(survey, options);
  }

  stopRecording(): IqRecording | undefined {
    const recording = this.backend?.stopRecording?.("user");
    this.captureCompletedRecording(recording);
    return recording;
  }

  getRecordingStatus(): RecordingStatus | undefined {
    return this.backend?.getRecordingStatus?.();
  }

  finalizeCapacityRecording(): IqRecording | undefined {
    if (this.backend?.getRecordingStatus?.()?.state !== "capacity-reached")
      return undefined;
    const recording = this.backend.stopRecording?.("user");
    this.captureCompletedRecording(recording);
    return recording;
  }

  takeCompletedRecording(): IqRecording | undefined {
    const recording = this.completedRecording;
    this.completedRecording = undefined;
    return recording;
  }

  setAutoRecenter(enabled: boolean): void {
    this.autoRecenter = enabled;
  }

  async tuneCenter(centerFrequencyHz: number, channelFrequencyHz = this.snapshot.session?.selectedChannelFrequencyHz): Promise<void> {
    const session = this.snapshot.session;
    const backend = this.backend;
    if (this.snapshot.lifecycle !== "running" || this.snapshot.hardwareSettingsPending || !session || !backend || channelFrequencyHz === undefined) return;
    // Hardware limits still apply, independently of whether the old channel fits.
    // Reject before changing a mode, ending a recording, or touching the source.
    try {
      if (session.source === "replay") throw new Error("The capture center is fixed during replay. Select a channel within the recorded RF window.");
      if (session.source === "rtl-sdr" && session.rtlInput) rtlDeviceFrequency(centerFrequencyHz, session.rtlInput);
      validateSourceFrequency(session.source, centerFrequencyHz,
        ["airspy", "hackrf", "bladerf", "usrp-b205"].includes(session.source) ? session.actualSampleRateHz : 0,
        session.hackrf?.capabilities.identity);
    } catch (error) {
      this.publishCommandFailure(error);
      return;
    }
    try {
      this.validateTune(channelFrequencyHz, { centerFrequencyHz });
    } catch {
      // A manual capture move takes priority over listening. Use the existing
      // OFF route, so neither an aliased channel nor a decoder can keep playing.
      // One generation owns both steps; Stop/source replacement cancels step two.
      this.captureCompletedRecording(backend.stopRecording?.("metadata-change"));
      const generation = ++this.generation;
      this.publish({
        lifecycle: "tuning", message: "Clearing the channel and moving the receiver window…",
        sessionGeneration: generation, session, audioState: this.snapshot.audioState,
      });
      try {
        await backend.configureMode(defaultModeSettings("OFF"), generation);
        if (generation !== this.generation || this.backend !== backend) return;
        const metadata = await backend.tune(centerFrequencyHz, generation, { centerFrequencyHz });
        if (generation !== this.generation || this.backend !== backend) return;
        this.publishRunning(metadata, generation);
        this.publish({ ...this.snapshot, channelSelectionWarning:
          `Channel ${(channelFrequencyHz / 1e6).toFixed(6)} MHz cannot play in this receiver window. Switched to Spectrum only; select a channel and mode to listen again.` });
      } catch (error) {
        if (generation === this.generation && this.backend === backend) await this.failBackend(backend, error);
      }
      return;
    }
    await this.tune(channelFrequencyHz, { centerFrequencyHz });
  }

  /** Check a proposed channel/mode together without changing the active session. */
  validateTune(channelFrequencyHz: number, options: ReceiverTuneOptions = {}, settings?: ReceiverModeSettings): ReceiverTuneOptions {
    const session = this.snapshot.session;
    if (this.snapshot.lifecycle !== "running" || !session)
      throw new Error("Wait for active reception before checking a channel move.");
    const modeSettings = settings ?? {
      mode: session.mode, bandwidthHz: session.channelBandwidthHz,
      squelch: session.squelch, beatToneHz: session.beatToneHz, srd: session.srd, textModem: session.textModem, pocsag: session.pocsag,
    };
    const tuneOptions = { autoRecenter: this.autoRecenter, ...options };
    validateSourceRoute(session.source, modeSettings, session.actualSampleRateHz, channelFrequencyHz, session.hackrf?.capabilities.identity);
    const requiresCenter = ["airspy", "hackrf", "bladerf", "usrp-b205"].includes(session.source)
      && !isWidebandRate(session.actualSampleRateHz) && ["DAB", "ADS-B"].includes(modeSettings.mode);
    if (requiresCenter && tuneOptions.centerFrequencyHz === undefined && tuneOptions.autoRecenter)
      tuneOptions.centerFrequencyHz = channelFrequencyHz;
    const plan = planChannelTune(session.hardwareCenterFrequencyHz, channelFrequencyHz,
      session.actualSampleRateHz, modeSettings.bandwidthHz, tuneOptions);
    if (session.source === "replay" && plan.hardwareRetuneRequired)
      throw new Error("The capture center is fixed during replay. Select a channel within the recorded RF window.");
    if (requiresCenter && plan.hardwareCenterFrequencyHz !== channelFrequencyHz)
      throw new Error(`${modeSettings.mode} requires the receiver center to match the channel at this sample rate.`);
    if (plan.hardwareRetuneRequired)
      validateSourceFrequency(session.source, plan.hardwareCenterFrequencyHz,
        ["airspy", "hackrf", "bladerf", "usrp-b205"].includes(session.source) ? session.actualSampleRateHz : 0, session.hackrf?.capabilities.identity);
    return tuneOptions;
  }

  async tune(channelFrequencyHz: number, options: ReceiverTuneOptions = {}): Promise<void> {
    if (
      this.snapshot.lifecycle !== "running" || this.snapshot.hardwareSettingsPending ||
      !this.snapshot.session ||
      !this.backend
    )
      return;
    let tuneOptions: ReceiverTuneOptions;
    try {
      tuneOptions = this.validateTune(channelFrequencyHz, options);
    } catch (error) {
      this.publish({
        ...this.snapshot,
        message:
          error instanceof Error
            ? error.message
            : "Enter a valid channel frequency.",
      });
      return;
    }
    this.captureCompletedRecording(
      this.backend.stopRecording?.("metadata-change"),
    );
    const generation = ++this.generation;
    const backend = this.backend;
    this.publish({
      textModem: undefined, textModemWorker: undefined, modemImage: undefined,
      pocsag: undefined, pocsagWorker: undefined, aprs: undefined, aprsWorker: undefined, rs41: undefined, rs41Worker: undefined,
      lifecycle: "tuning",
      message: options.centerFrequencyHz !== undefined
        ? `Moving receiver center to ${(options.centerFrequencyHz / 1_000_000).toFixed(6)} MHz…`
        : `Retuning channel to ${(channelFrequencyHz / 1_000_000).toFixed(6)} MHz…`,
      sessionGeneration: generation,
      session: {
        ...this.snapshot.session,
        sessionGeneration: generation,
        selectedChannelFrequencyHz: channelFrequencyHz,
      },
      audioState: this.snapshot.audioState,
    });
    try {
      const metadata = await backend.tune(channelFrequencyHz, generation, tuneOptions);
      if (generation !== this.generation || this.backend !== backend) return;
      this.publishRunning(metadata, generation);
    } catch (error) {
      if (generation === this.generation && this.backend === backend)
        await this.failBackend(backend, error);
    }
  }

  async configureSampleRate(sampleRateHz: number): Promise<void> {
    const backend = this.backend;
    const session = this.snapshot.session;
    if (this.snapshot.lifecycle !== "running" || !backend?.configureSampleRate ||
        !session || !["rtl-sdr", "hackrf", "airspy"].includes(session.source) || this.snapshot.hardwareSettingsPending) return;
    if (sampleRateHz === session.requestedSampleRateHz) return;
    const tuneOptions = { autoRecenter: this.autoRecenter };
    try {
      validateSourceConfiguration({
        source: session.source,
        channelFrequencyHz: session.selectedChannelFrequencyHz,
        sampleRateHz,
        modeSettings: {
          mode: session.mode, bandwidthHz: session.channelBandwidthHz,
          squelch: session.squelch, beatToneHz: session.beatToneHz,
          srd: session.srd, textModem: session.textModem, pocsag: session.pocsag,
        },
        ...(session.source === "rtl-sdr" ? { gainDb: session.gainDb } : {}),
        airspySettings: session.airspy?.settings,
        hardwareSettings: session.hackrf?.captureSettings,
        hackrfIdentity: session.hackrf?.capabilities.identity,
      });
      const plan = planChannelTune(session.hardwareCenterFrequencyHz, session.selectedChannelFrequencyHz,
        sampleRateHz, session.channelBandwidthHz, tuneOptions);
      const mustCenter = session.source === "hackrf" && !isWidebandRate(sampleRateHz) && ["DAB", "ADS-B"].includes(session.mode);
      if (mustCenter && plan.hardwareCenterFrequencyHz !== session.selectedChannelFrequencyHz && !this.autoRecenter)
        throw new Error(`${session.mode} requires the receiver center to match the channel at this sample rate. Enable Follow channel.`);
      if (session.source === "hackrf") validateSourceFrequency("hackrf", mustCenter ? session.selectedChannelFrequencyHz : plan.hardwareCenterFrequencyHz, sampleRateHz, session.hackrf?.capabilities.identity);
    } catch (error) {
      this.publishCommandFailure(error);
      return;
    }
    this.captureCompletedRecording(backend.stopRecording?.("metadata-change"));
    const generation = ++this.generation;
    this.publish({
      textModem: undefined, textModemWorker: undefined, modemImage: undefined,
      pocsag: undefined, pocsagWorker: undefined, aprs: undefined, aprsWorker: undefined, rs41: undefined, rs41Worker: undefined,
      lifecycle: "tuning",
      message: `Switching ${sourceCapabilities(session.source).label} to ${(sampleRateHz / 1_000_000).toFixed(3)} MS/s…`,
      sessionGeneration: generation,
      session: { ...session, sessionGeneration: generation },
      audioState: this.snapshot.audioState,
    });
    const task = backend.configureSampleRate(sampleRateHz, generation, tuneOptions);
    this.sampleRateTask = task;
    try {
      const metadata = await task;
      if (generation === this.generation && this.backend === backend)
        this.publishRunning(metadata, generation);
    } catch (error) {
      if (generation === this.generation && this.backend === backend)
        await this.failBackend(backend, error);
    } finally {
      if (this.sampleRateTask === task) this.sampleRateTask = undefined;
    }
  }

  async scanTune(
    centerFrequencyHz: number,
  ): Promise<SourceSessionMetadata | undefined> {
    const backend = this.backend;
    const scanTune = backend?.scanTune;
    if (
      this.snapshot.lifecycle !== "running" || this.snapshot.hardwareSettingsPending ||
      !this.snapshot.session ||
      !backend ||
      !scanTune
    )
      return undefined;
    try {
      validateSourceFrequency(
        this.snapshot.session.source,
        centerFrequencyHz,
        this.snapshot.session.source === "airspy" || this.snapshot.session.source === "hackrf" ||
          this.snapshot.session.source === "bladerf" ||
          this.snapshot.session.source === "usrp-b205"
          ? this.snapshot.session.actualSampleRateHz
          : 0,
        this.snapshot.session.hackrf?.capabilities.identity,
      );
    } catch (error) {
      this.publish({
        ...this.snapshot,
        message:
          error instanceof Error
            ? error.message
            : "Enter a valid scan frequency.",
      });
      return undefined;
    }
    this.captureCompletedRecording(backend.stopRecording?.("metadata-change"));
    const generation = ++this.generation;
    this.publish({
      ...this.snapshot,
      textModem: undefined, textModemWorker: undefined, modemImage: undefined,
      pocsag: undefined, pocsagWorker: undefined, aprs: undefined, aprsWorker: undefined, rs41: undefined, rs41Worker: undefined,
      lifecycle: "tuning",
      message: `Scanning ${(centerFrequencyHz / 1_000_000).toFixed(3)} MHz…`,
      sessionGeneration: generation,
      session: {
        ...this.snapshot.session,
        sessionGeneration: generation,
        hardwareCenterFrequencyHz: centerFrequencyHz,
        selectedChannelFrequencyHz: centerFrequencyHz,
      },
      rds: undefined,
    });
    try {
      const metadata = await scanTune.call(
        backend,
        centerFrequencyHz,
        generation,
      );
      if (generation !== this.generation || this.backend !== backend)
        return undefined;
      this.publishRunning(metadata, generation);
      return { ...metadata, sessionGeneration: generation };
    } catch (error) {
      if (generation === this.generation && this.backend === backend)
        await this.failBackend(backend, error);
      return undefined;
    }
  }

  async configureMode(settings: ReceiverModeSettings): Promise<void> {
    if (
      this.snapshot.lifecycle !== "running" || this.snapshot.hardwareSettingsPending ||
      !this.snapshot.session ||
      !this.backend
    )
      return;
    let normalized: ReceiverModeSettings;
    try {
      normalized = normalizeModeSettings(settings);
      validateSourceRoute(
        this.snapshot.session.source,
        normalized,
        this.snapshot.session.actualSampleRateHz,
        this.snapshot.session.selectedChannelFrequencyHz,
        this.snapshot.session.hackrf?.capabilities.identity,
      );
    } catch (error) {
      this.publish({
        ...this.snapshot,
        message:
          error instanceof Error
            ? error.message
            : "Invalid receiver mode settings.",
      });
      return;
    }
    this.captureCompletedRecording(
      this.backend.stopRecording?.("metadata-change"),
    );
    const generation = ++this.generation;
    const backend = this.backend;
    this.publish({
      ...this.snapshot,
      textModem: undefined, textModemWorker: undefined, modemImage: undefined,
      pocsag: undefined, pocsagWorker: undefined, aprs: undefined, aprsWorker: undefined, rs41: undefined, rs41Worker: undefined,
      lifecycle: "tuning",
      message: `Applying ${normalized.mode} channel settings…`,
      sessionGeneration: generation,
      session: {
        ...this.snapshot.session,
        sessionGeneration: generation,
        mode: normalized.mode,
        channelBandwidthHz: normalized.bandwidthHz,
        squelch: normalized.squelch,
        beatToneHz: normalized.beatToneHz,
        srd: normalized.srd, textModem: normalized.textModem, pocsag: normalized.pocsag,
      },
    });
    try {
      const metadata = await backend.configureMode(normalized, generation);
      if (generation !== this.generation || this.backend !== backend) return;
      this.publishRunning(metadata, generation);
    } catch (error) {
      if (generation === this.generation && this.backend === backend)
        await this.failBackend(backend, error);
    }
  }

  updateAnalogMode(settings: ReceiverModeSettings): void {
    if (
      this.snapshot.lifecycle !== "running" || this.snapshot.hardwareSettingsPending ||
      !this.snapshot.session ||
      !this.backend
    )
      return;
    let normalized: ReceiverModeSettings;
    try {
      normalized = normalizeModeSettings(settings);
      if (normalized.mode !== this.snapshot.session.mode)
        throw new Error("Live analog settings cannot change receiver mode.");
      if (["OFF", "DAB", "ADS-B", "AIS", "SRD", "POCSAG", "APRS", "RS41", "RTTY", "PSK31", "NAVTEX", "ACARS", "WEFAX", "SSTV", "CW-TEXT"].includes(normalized.mode))
        throw new Error(
          `${normalized.mode} does not use the analog audio path.`,
        );
      validateSourceRoute(
        this.snapshot.session.source,
        normalized,
        this.snapshot.session.actualSampleRateHz,
        this.snapshot.session.selectedChannelFrequencyHz,
        this.snapshot.session.hackrf?.capabilities.identity,
      );
      if (!this.backend.updateAnalogMode)
        throw new Error("This source cannot update analog settings live.");
      if (this.backend.getRecordingStatus?.()?.captureCurrentChannel && (normalized.bandwidthHz !== this.snapshot.session.channelBandwidthHz || normalized.beatToneHz !== this.snapshot.session.beatToneHz))
        this.captureCompletedRecording(this.backend.stopRecording?.("metadata-change"));
      const metadata = this.backend.updateAnalogMode(normalized);
      this.publish({
        ...this.snapshot,
        session: {
          ...metadata,
          sessionGeneration: this.snapshot.sessionGeneration,
        },
      });
    } catch (error) {
      this.publish({
        ...this.snapshot,
        message:
          error instanceof Error
            ? error.message
            : "Invalid live analog settings.",
      });
    }
  }

  async configureSecondaryVfo(settings?: SecondaryVfoSettings): Promise<void> {
    if (!this.backend?.configureSecondaryVfo || this.snapshot.lifecycle !== "running") throw new Error("VFO B requires a running local receiver.");
    if (settings && !["AM","NBFM","USB","LSB","CW","WBFM"].includes(this.snapshot.session?.mode ?? "")) throw new Error("Use an analog audio mode on VFO A before enabling VFO B.");
    await this.backend.configureSecondaryVfo(settings);
  }

  async setGain(gainDb: number | null): Promise<void> {
    if (
      !["connected", "running"].includes(this.snapshot.lifecycle) ||
      !this.snapshot.session ||
      !this.backend
    )
      return;
    const backend = this.backend;
    if (this.snapshot.session.source === "hackrf") {
      this.publish({
        ...this.snapshot,
        message: "HackRF uses RX stage settings, not RTL auto/manual gain.",
      });
      return;
    }
    try {
      normalizeGain(gainDb);
    } catch (error) {
      this.publishCommandFailure(error);
      return;
    }
    this.captureCompletedRecording(backend.stopRecording?.("metadata-change"));
    const generation = this.generation;
    try {
      const actual = await backend.setGain(normalizeGain(gainDb));
      if (
        this.backend !== backend ||
        this.generation !== generation ||
        !this.snapshot.session
      )
        return;
      this.publish({
        ...this.snapshot,
        message:
          actual === null
            ? "Automatic RF gain enabled."
            : `Manual RF gain set to ${actual.toFixed(1)} dB.`,
        session: { ...this.snapshot.session, gainDb: actual },
      });
    } catch (error) {
      if (this.backend === backend && this.generation === generation) {
        this.publishCommandFailure(error);
      }
    }
  }

  async configureHardware(settings: HackrfRxSettings): Promise<void> {
    const backend = this.backend;
    const session = this.snapshot.session;
    if (
      !backend ||
      !session ||
      this.snapshot.hardwareSettingsPending ||
      !["connected", "running"].includes(this.snapshot.lifecycle)
    )
      return;
    let validated: HackrfRxSettings;
    try {
      if (session.source !== "hackrf" || !backend.configureHardware)
        throw new Error("This source does not support HackRF RX settings.");
      validated = validateHackrfRxSettings(settings, session.hackrf?.capabilities.identity.kind);
    } catch (error) {
      this.publishCommandFailure(error);
      return;
    }
    const wasRunning = this.snapshot.lifecycle === "running";
    const old = session.hackrf?.captureSettings;
    if (old && old.rxLnaGainCode === validated.rxLnaGainCode && old.rxVgaGainDb === validated.rxVgaGainDb && old.rfAmplifierEnabled === validated.rfAmplifierEnabled && old.antennaPowerEnabled === validated.antennaPowerEnabled) return;
    this.captureCompletedRecording(backend.stopRecording?.("metadata-change"));
    const generation = wasRunning ? this.generation : ++this.generation;
    this.publish({
      ...this.snapshot,
      hardwareSettingsPending: true,
      lifecycle: wasRunning ? "running" : "tuning",
      sessionGeneration: generation,
      message: "Applying HackRF RX settings…",
    });
    try {
      const metadata = await backend.configureHardware!(validated, generation);
      if (this.backend !== backend || this.generation !== generation) return;
      if (wasRunning) this.publish({ ...this.snapshot, hardwareSettingsPending: false, session: { ...metadata, sessionGeneration: generation }, message: "HackRF RX settings applied live." });
      else
        this.publishConnected(
          metadata,
          generation,
          "HackRF RX settings accepted.",
        );
    } catch (error) {
      if (this.backend === backend && this.generation === generation)
        await this.failBackend(backend, error);
    }
  }

  async configureAirspy(settings: AirspySettings): Promise<void> {
    const backend = this.backend;
    const session = this.snapshot.session;
    if (
      !backend ||
      !session ||
      !["connected", "running"].includes(this.snapshot.lifecycle)
    )
      return;
    let validated: AirspySettings;
    try {
      if (session.source !== "airspy" || !backend.configureAirspy)
        throw new Error("This source does not support Airspy RX settings.");
      validated = validateAirspySettings(settings);
      validateSourceConfiguration({ source: "airspy", channelFrequencyHz: session.selectedChannelFrequencyHz, sampleRateHz: session.requestedSampleRateHz, modeSettings: { mode: session.mode, bandwidthHz: session.channelBandwidthHz, squelch: session.squelch, beatToneHz: session.beatToneHz, srd: session.srd, textModem: session.textModem, pocsag: session.pocsag }, airspySettings: validated });
      planChannelTune(session.hardwareCenterFrequencyHz, session.selectedChannelFrequencyHz, session.requestedSampleRateHz / validated.decimation, session.channelBandwidthHz, { autoRecenter: false });
    } catch (error) {
      this.publishCommandFailure(error);
      return;
    }
    const wasRunning = this.snapshot.lifecycle === "running";
    this.captureCompletedRecording(backend.stopRecording?.("metadata-change"));
    const generation = ++this.generation;
    this.publish({
      ...this.snapshot,
      textModem: undefined, textModemWorker: undefined, modemImage: undefined,
      pocsag: undefined, pocsagWorker: undefined, aprs: undefined, aprsWorker: undefined, rs41: undefined, rs41Worker: undefined,
      lifecycle: "tuning",
      sessionGeneration: generation,
      message: "Applying Airspy RX settings…",
    });
    try {
      const metadata = await backend.configureAirspy!(validated, generation);
      if (this.backend !== backend || this.generation !== generation) return;
      if (wasRunning) this.publishRunning(metadata, generation);
      else
        this.publishConnected(
          metadata,
          generation,
          "Airspy RX settings accepted.",
        );
    } catch (error) {
      if (this.backend === backend && this.generation === generation)
        await this.failBackend(backend, error);
    }
  }

  async configureBladeRf(settings: BladeRfRxSettings): Promise<void> {
    const backend = this.backend;
    const session = this.snapshot.session;
    if (
      !backend ||
      !session ||
      !["connected", "running"].includes(this.snapshot.lifecycle)
    )
      return;
    let validated: BladeRfRxSettings;
    try {
      if (session.source !== "bladerf" || !backend.configureBladeRf)
        throw new Error("This source does not support bladeRF RX settings.");
      validated = validateBladeRfRxSettings(settings, session.hardwareCenterFrequencyHz);
    } catch (error) {
      this.publishCommandFailure(error);
      return;
    }
    const wasRunning = this.snapshot.lifecycle === "running";
    this.captureCompletedRecording(backend.stopRecording?.("metadata-change"));
    const generation = ++this.generation;
    this.publish({
      ...this.snapshot,
      textModem: undefined, textModemWorker: undefined, modemImage: undefined,
      pocsag: undefined, pocsagWorker: undefined, aprs: undefined, aprsWorker: undefined, rs41: undefined, rs41Worker: undefined,
      lifecycle: "tuning",
      sessionGeneration: generation,
      message: "Applying bladeRF RX settings…",
    });
    try {
      const metadata = await backend.configureBladeRf!(validated, generation);
      if (this.backend !== backend || this.generation !== generation) return;
      if (wasRunning) this.publishRunning(metadata, generation);
      else
        this.publishConnected(
          metadata,
          generation,
          "bladeRF RX settings accepted.",
        );
    } catch (error) {
      if (this.backend === backend && this.generation === generation)
        await this.failBackend(backend, error);
    }
  }

  private async runStart(
    backend: ReceiverBackend,
    options: ReceiverStartOptions,
    generation: number,
  ): Promise<void> {
    try {
      const metadata = await backend.start(
        { ...options, volume: clampVolume(options.volume) },
        generation,
      );
      if (
        !this.isCurrent(generation, "starting") &&
        !this.isCurrent(generation, "requesting-permission") &&
        !this.isCurrent(generation, "connecting")
      ) {
        await this.cleanupBackend(backend);
        return;
      }
      this.publishRunning(metadata, generation);
    } catch (error) {
      try {
        await this.cleanupBackend(backend);
      } catch {
        /* Keep ownership for Stop to retry. */
      }
      if (generation === this.generation)
        this.publishFailure(generation, error);
    }
  }

  private async handleRuntimeError(
    backend: ReceiverBackend,
    error: unknown,
  ): Promise<void> {
    if (
      this.backend !== backend ||
      (this.snapshot.lifecycle !== "running" &&
        this.snapshot.lifecycle !== "tuning")
    )
      return;
    await this.failBackend(backend, error);
  }

  private async failBackend(
    backend: ReceiverBackend,
    error: unknown,
  ): Promise<void> {
    // Invalidate in-flight reconfiguration and prevent Start until close settles.
    const failedOperation = this.snapshot.lifecycle;
    const generation = ++this.generation;
    this.captureCompletedRecording(backend.stopRecording?.("source-stop"));
    this.publish({
      lifecycle: "stopping",
      message: "Closing the receiver after a failed command…",
      sessionGeneration: generation,
    });
    try {
      await this.cleanupBackend(backend);
    } catch {
      /* Stop remains available to retry. */
    }
    if (generation === this.generation) this.publishFailure(generation, error, failedOperation);
  }

  private async handleSourceEnded(backend: ReceiverBackend): Promise<void> {
    if (
      this.backend !== backend ||
      !["starting", "running", "tuning"].includes(this.snapshot.lifecycle)
    )
      return;
    // Keep the completed capture metadata attached while the backend closes. The
    // spectrum view keys its GPU resources to this session generation, so
    // retaining it preserves the final rendered spectrum and waterfall at EOF.
    const completedSnapshot = this.snapshot;
    const generation = ++this.generation;
    this.captureCompletedRecording(backend.stopRecording?.("source-stop"));
    this.publish({
      ...completedSnapshot,
      lifecycle: "stopping",
      message: "Closing the completed replay…",
      sessionGeneration: generation,
    });
    try {
      await this.cleanupBackend(backend);
    } catch (error) {
      if (generation === this.generation)
        this.publishFailure(generation, error);
      return;
    }
    if (generation === this.generation) {
      this.publish({
        ...completedSnapshot,
        lifecycle: "idle",
        message: "Replay reached end of file. Final spectrum retained.",
        sessionGeneration: generation,
      });
    }
  }

  private captureCompletedRecording(recording: IqRecording | undefined): void {
    if (recording && !this.completedRecording) {
      recording.metadata.reception = {
        ...recording.metadata.reception,
        source_kind: captureOrigin(recording.metadata.source),
        decoded_evidence: recording.metadata.reception?.decoded_evidence ?? [],
      };
      this.completedRecording = recording;
    }
  }

  private publishRunning(
    metadata: Omit<SourceSessionMetadata, "sessionGeneration">,
    generation: number,
  ): void {
    this.publish({
      lifecycle: "running",
      message:
        metadata.mode === "OFF"
          ? `Spectrum-only acquisition at ${(metadata.selectedChannelFrequencyHz / 1_000_000).toFixed(3)} MHz — no demodulator or decoder output`
          : metadata.source === "synthetic"
            ? `Synthetic RF demo running in ${metadata.mode} — no hardware or audio`
            : metadata.source === "replay"
              ? `Replaying ${metadata.mode} capture at ${(metadata.selectedChannelFrequencyHz / 1_000_000).toFixed(3)} MHz`
              : `Receiving ${metadata.mode} at ${(metadata.selectedChannelFrequencyHz / 1_000_000).toFixed(3)} MHz`,
      sessionGeneration: generation,
      session: { ...metadata, sessionGeneration: generation },
      audioState: this.snapshot.audioState,
      rds:
        metadata.mode === "WBFM"
          ? ((this.snapshot.sessionGeneration === generation
              ? this.snapshot.rds
              : undefined) ?? {
              pi: null,
              programmeService: null,
              radioText: null,
              validGroups: 0,
            })
          : undefined,
      dab: metadata.mode === "DAB" ? this.snapshot.dab : undefined,
      adsb: metadata.mode === "ADS-B" ? this.snapshot.adsb : undefined,
      ais: metadata.mode === "AIS" ? this.snapshot.ais : undefined,
      textModem: isTextMode(metadata.mode) && this.snapshot.textModemWorker?.generation === generation ? this.snapshot.textModem : undefined,
      modemImage: isTextMode(metadata.mode) && this.snapshot.textModemWorker?.generation === generation ? this.snapshot.modemImage : undefined,
      textModemWorker: isTextMode(metadata.mode) && this.snapshot.textModemWorker?.generation === generation ? this.snapshot.textModemWorker : undefined,
      pocsag: metadata.mode === "POCSAG" && this.snapshot.pocsagWorker?.generation === generation ? this.snapshot.pocsag : undefined,
      pocsagWorker: metadata.mode === "POCSAG" && this.snapshot.pocsagWorker?.generation === generation ? this.snapshot.pocsagWorker : undefined,
      aprs: metadata.mode === "APRS" && this.snapshot.aprsWorker?.generation === generation ? this.snapshot.aprs : undefined,
      aprsWorker: metadata.mode === "APRS" && this.snapshot.aprsWorker?.generation === generation ? this.snapshot.aprsWorker : undefined,
      rs41: metadata.mode === "RS41" && this.snapshot.rs41Worker?.generation === generation ? this.snapshot.rs41 : undefined,
      rs41Worker: metadata.mode === "RS41" && this.snapshot.rs41Worker?.generation === generation ? this.snapshot.rs41Worker : undefined,
      srd: metadata.mode === "SRD" && this.snapshot.srdWorker?.generation === generation ? this.snapshot.srd : undefined,
      srdWorker: metadata.mode === "SRD" && this.snapshot.srdWorker?.generation === generation ? this.snapshot.srdWorker : undefined,
    });
  }

  private publishConnected(
    metadata:
      Omit<SourceSessionMetadata, "sessionGeneration"> | SourceSessionMetadata,
    generation: number,
    message: string,
  ): void {
    this.publish({
      lifecycle: "connected",
      message,
      sessionGeneration: generation,
      session: { ...metadata, sessionGeneration: generation },
      audioState: "suspended",
    });
  }

  private createAndAttachBackend(
    options: ReceiverStartOptions,
    generation: number,
  ): ReceiverBackend {
    // Callbacks may run during construction, so this binding must exist before createBackend executes.
    let backend: ReceiverBackend | undefined = undefined;
    backend = this.createBackend(
      {
        captureSamplesRequested: () => this.captureListeners.size > 0,
        captureSamples: (bytes,session,gap) => {
          if (this.backend !== backend || this.snapshot.lifecycle !== "running" || session.sessionGeneration !== this.snapshot.sessionGeneration) return;
          for (const listener of this.captureListeners) {
            try { listener(bytes,session,gap); } catch { this.captureListeners.delete(listener); }
          }
        },
        secondaryVfoChanged: (secondaryVfo,secondaryVfoMessage) => {
          if (this.backend === backend) this.publish({...this.snapshot,secondaryVfo,secondaryVfoMessage});
        },
        permissionGranted: () => {
          if (this.isCurrent(generation, "requesting-permission"))
            this.publish({
              ...this.snapshot,
              lifecycle: "connecting",
              message: `Opening and configuring the ${sourceCapabilities(options.source ?? "rtl-sdr").label}…`,
            });
        },
        statusChanged: (message) => {
          if (
            this.backend === backend &&
            ["requesting-permission", "connecting"].includes(
              this.snapshot.lifecycle,
            )
          ) {
            this.publish({
              ...this.snapshot,
              lifecycle: "connecting",
              message,
            });
          }
        },
        runtimeError: (error) => {
          if (backend) void this.handleRuntimeError(backend, error);
        },
        audioStateChanged: (audioState) => {
          if (
            this.backend !== backend ||
            ["stopping", "disconnecting"].includes(this.snapshot.lifecycle)
          )
            return;
          this.publish({ ...this.snapshot, audioState });
        },
        sourceEnded: () => {
          if (backend) void this.handleSourceEnded(backend);
        },
        rdsChanged: (rds) => {
          if (
            this.backend !== backend ||
            ["stopping", "disconnecting"].includes(this.snapshot.lifecycle)
          )
            return;
          this.publish({ ...this.snapshot, rds });
        },
        fmStereoReceptionChanged: (fmStereoReception) => {
          if (this.backend !== backend || this.snapshot.lifecycle !== "running" || this.snapshot.session?.mode !== "WBFM" || this.snapshot.fmStereoReception === fmStereoReception) return;
          this.publish({ ...this.snapshot, fmStereoReception });
        },
        dabChanged: (dab) => {
          if (
            this.backend !== backend ||
            ["stopping", "disconnecting"].includes(this.snapshot.lifecycle)
          )
            return;
          this.publish({ ...this.snapshot, dab });
        },
        adsbChanged: (adsb) => {
          if (
            this.backend !== backend ||
            ["stopping", "disconnecting"].includes(this.snapshot.lifecycle)
          )
            return;
          this.publish({ ...this.snapshot, adsb });
        },
        aisChanged: (ais) => {
          if (
            this.backend !== backend ||
            ["stopping", "disconnecting"].includes(this.snapshot.lifecycle)
          )
            return;
          this.publish({ ...this.snapshot, ais });
        },
        textModemChanged: (textModem, textModemWorker, modemImage) => {
          if (this.backend !== backend || this.snapshot.session?.mode !== textModem.mode || textModemWorker.generation !== this.snapshot.sessionGeneration || ["stopping", "disconnecting"].includes(this.snapshot.lifecycle)) return;
          this.publish({ ...this.snapshot, textModem, textModemWorker, modemImage });
        },
        pocsagChanged: (pocsag, pocsagWorker) => {
          if (this.backend !== backend || this.snapshot.session?.mode !== "POCSAG" || pocsagWorker.generation !== this.snapshot.sessionGeneration || ["stopping", "disconnecting"].includes(this.snapshot.lifecycle)) return;
          this.publish({ ...this.snapshot, pocsag, pocsagWorker });
        },
        aprsChanged: (aprs, aprsWorker) => {
          if (this.backend !== backend || this.snapshot.session?.mode !== "APRS" || aprsWorker.generation !== this.snapshot.sessionGeneration || ["stopping", "disconnecting"].includes(this.snapshot.lifecycle)) return;
          this.publish({ ...this.snapshot, aprs, aprsWorker });
        },
        rs41Changed: (rs41, rs41Worker) => {
          if (this.backend !== backend || this.snapshot.session?.mode !== "RS41" || rs41Worker.generation !== this.snapshot.sessionGeneration || ["stopping", "disconnecting"].includes(this.snapshot.lifecycle)) return;
          this.publish({ ...this.snapshot, rs41, rs41Worker });
        },
        srdChanged: (srd, srdWorker) => {
          if (
            this.backend !== backend ||
            this.snapshot.session?.mode !== "SRD" ||
            srdWorker.generation !== this.snapshot.sessionGeneration ||
            ["stopping", "disconnecting"].includes(this.snapshot.lifecycle)
          )
            return;
          this.publish({ ...this.snapshot, srd, srdWorker });
        },
        squelchChanged: (squelchMeter) => {
          if (
            this.backend !== backend ||
            ["stopping", "disconnecting"].includes(this.snapshot.lifecycle)
          )
            return;
          this.publishSquelchMeter(squelchMeter);
        },
      },
      options,
      generation,
    );
    this.backend = backend;
    this.connectionIdentity++;
    this.lastIngress = undefined;
    return backend;
  }

  private cleanupBackend(backend?: ReceiverBackend): Promise<void> {
    if (!backend) return Promise.resolve();
    const existing = this.cleanupTasks.get(backend);
    if (existing) return existing;
    const task = Promise.resolve()
      .then(() => {
        if (this.backend === backend)
          this.lastIngress = backend.getIngressDiagnostics?.();
        return backend.disconnect?.() ?? backend.stop();
      })
      .then(() => {
        if (this.backend === backend) this.backend = undefined;
      })
      .finally(() => {
        this.cleanupTasks.delete(backend);
      });
    this.cleanupTasks.set(backend, task);
    return task;
  }

  private publishCommandFailure(error: unknown): void {
    const issue = classifyReceiverIssue(error, this.source, this.snapshot.lifecycle);
    this.publish({ ...this.snapshot, message: issue.summary, issue });
  }

  private publishFailure(
    generation: number,
    error: unknown,
    operation = this.snapshot.lifecycle,
  ): void {
    const issue = classifyReceiverIssue(error, this.source, operation);
    const expected = issue.code === "selection-cancelled";
    const setup = [
      "browser-unsupported", "device-unsupported", "usb-permission",
      "usb-busy", "firmware", "settings",
    ].includes(issue.code);
    if (!expected)
      defaultDiagnosticRecorder.record({
        area: isUsbIssue(issue) ? "usb" : "receiver",
        code: setup ? "RECEIVER_SETUP_FAILURE" : "RECEIVER_TERMINAL_FAILURE",
        severity: setup ? "warning" : "error",
        operation,
        error,
        autoSubmitEligible: !setup,
        context: { generation, issueCode: issue.code, source: issue.source },
      });
    this.publish({
      lifecycle: "error",
      message: issue.summary,
      issue,
      sessionGeneration: generation,
      audioState: this.snapshot.audioState,
      cleanupRequired: Boolean(this.backend),
    });
  }

  private isCurrent(generation: number, lifecycle: ReceiverLifecycle): boolean {
    return (
      generation === this.generation && this.snapshot.lifecycle === lifecycle
    );
  }

  private publish(snapshot: ReceiverSnapshot): void {
    const previous = this.snapshot;
    if (snapshot.lifecycle !== "running" || snapshot.session?.mode !== "WBFM" || snapshot.sessionGeneration !== previous.sessionGeneration)
      snapshot = { ...snapshot, fmStereoReception: undefined };
    // Spreading a snapshot for telemetry must retain a failure; a new status must clear it.
    if (
      snapshot.issue === previous.issue &&
      (snapshot.message !== previous.message || snapshot.lifecycle !== previous.lifecycle)
    )
      snapshot = { ...snapshot, issue: undefined };
    this.snapshot = snapshot;
    if (
      this.squelchMeter &&
      (snapshot.sessionGeneration !== previous.sessionGeneration ||
        snapshot.lifecycle !== "running" ||
        !snapshot.session ||
        !["NBFM", "AM", "USB", "LSB"].includes(snapshot.session.mode))
    )
      this.publishSquelchMeter(undefined);
    for (const listener of this.listeners) listener(snapshot);
  }

  private publishSquelchMeter(state: SquelchMeterState | undefined): void {
    if (
      this.squelchMeter?.level === state?.level &&
      this.squelchMeter?.peak === state?.peak &&
      this.squelchMeter?.open === state?.open
    )
      return;
    this.squelchMeter = state;
    for (const listener of this.squelchMeterListeners) listener();
  }
}

export function clampVolume(volume: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0));
}

export function validateOptions(options: ReceiverStartOptions): void {
  validateSourceConfiguration(options);
}

export function describeReceiverError(error: unknown): string {
  return classifyReceiverIssue(error).summary;
}

function isUsbIssue(issue: ReceiverIssue): boolean {
  return [
    "browser-unsupported", "device-unsupported", "usb-permission", "usb-busy",
    "usb-transfer", "power-cycle", "firmware",
  ].includes(issue.code);
}
