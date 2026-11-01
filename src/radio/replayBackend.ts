import type { AirspyChannelFilter } from "./airspyChannel";
import { isAirspyRate } from "./airspySettings";
import { PocsagDigitalReceiver } from "../pocsag/pocsagDigitalReceiver";
import { pocsagConfiguration } from "../pocsag/settings";
import type { DigitalInputSampleRateHz } from "../digital/inputRates";
import { TextDigitalReceiver } from "../textmodem/digitalReceiver";
import { isTextMode, textModemConfiguration } from "../textmodem/settings";
import { ReplayReader } from "./replayReader";
import { STREAMING_RECORDING_MAX_BYTES } from "./recordingSpool";
import { recordingDataByteLength } from "./iqRecording";
import { CHANNEL_RECORDING_FORMAT } from "./channelRecording";
import type { RecordingOptions } from "./channelRecording";
import { AIRSPY_RECORDING_FORMAT } from "./airspyRecording";
import { BLADERF_SC16_RECORDING_FORMAT } from "./bladerfRecording";
import { PcmBatchPlayer } from "./pcmBatchPlayer";
import { createWasmChannel, type WasmChannelFilter } from "./wasmChannel";
import { isWidebandRate } from "./sourceCapabilities";
import { WidebandChannelFilter } from "./widebandChannel";
import { channelSampleRate } from "./sourceCapabilities";
import type { SampleReceiver } from "@jtarrio/signals/radio/sample_receiver.js";
import { ci8SessionDetails, type HackrfRecordingFormat } from "./ci8Recording";
import { validateLiveRateBudget } from "./liveRateBudget";
import { SharedWbfmDemodulator } from "./sharedWbfmDemodulator";
import { AudioPlayer } from "@jtarrio/signals/players/audioplayer.js";
import { audioCaptureTap, audioSourceDescription } from "./audioCaptureTap";
import type { AnalysisPipeline } from "../dsp/analysisPipeline";
import { decodeRecordingSamples, recordingRoutingSampleRate, preferredRecordingStorageMode, recordingSampleFormat, RECORDING_FORMAT, IqRecorder, validateRecordingMetadata, type IqRecording, type RecordingStatus } from "./iqRecording";
import {
  createSignalsMode,
  normalizeModeSettings,
  planChannelTune,
  validateModeSampleRate,
  type ReceiverModeSettings,
  type ReceiverTuneOptions,
} from "./receiverConfig";
import type { ReceiverBackend, ReceiverBackendEvents, ReceiverStartOptions } from "./receiverController";
import type { SourceSessionMetadata } from "./types";
import { AudioFirstRdsReceiver, RdsMultiplexReceiver, type DigitalSampleReceiver } from "../rds/rdsMultiplexReceiver";
import { createDabReplayPlayback } from "./dabReplayPlayback";
import { AdsbReceiver } from "../adsb/adsbReceiver";
import { AisReceiver } from "../ais/aisReceiver";
import { AprsDigitalReceiver } from "../aprs/aprsDigitalReceiver";
import { Rs41DigitalReceiver } from "../rs41/rs41DigitalReceiver";
import { defaultAprsConfiguration } from "../aprs/settings";
import { defaultRs41Configuration } from "../rs41/settings";
import { SrdDigitalReceiver } from "../srd/srdDigitalReceiver";
import { srdConfigurationForRoute } from "../srd/settings";

const REPLAY_CHUNK_SAMPLES = 8192;
const REPLAY_MAX_CATCH_UP_BLOCKS = 32;

export class ReplayBackend implements ReceiverBackend {
  private readonly audioContext: AudioContext;
  private readonly audioResume: Promise<void>;
  private readonly player: PcmBatchPlayer;
  private readonly demodulator: SharedWbfmDemodulator;
  private receiver?: AudioFirstRdsReceiver;
  private channel?: WidebandChannelFilter | WasmChannelFilter | AirspyChannelFilter;
  private ended = false;
  private rawAnalysis?: SampleReceiver;
  private outputEnabled = true;
  private timer?: number;
  private stopped = false;
  private closed = false;
  private closeTask?: Promise<void>;
  private position = 0;
  private playbackEpoch = 0;
  private pendingRead?: Promise<void>;
  private seeking = false;
  private rangeStart = 0;
  private rangeEnd = 0;
  private pausedAt?: number;
  private readonly reader: ReplayReader;
  private startedAtMs = 0;
  private metadata?: SourceSessionMetadata;
  private recorder?: IqRecorder;
  private recordingChannelOnly = false;
  private completedRecording?: IqRecording;
  private nextGap = 0;
  private elapsedGapSamples = 0;
  private priorGapSamples = 0;
  private readonly rds: RdsMultiplexReceiver;
  private dabPlayback?: ReturnType<typeof createDabReplayPlayback>;
  private volume = 0;
  private readonly adsb: AdsbReceiver;
  private readonly ais: AisReceiver;
  private readonly pocsag: PocsagDigitalReceiver;
  private readonly aprs: AprsDigitalReceiver;
  private readonly rs41: Rs41DigitalReceiver;
  private readonly textModem: TextDigitalReceiver;
  private readonly srd: SrdDigitalReceiver;

  constructor(
    private readonly events: ReceiverBackendEvents,
    private readonly analysis: AnalysisPipeline,
    private recording: IqRecording,
    private sessionGeneration: number,
    private readonly compiledChannel: (rate: number) => Promise<WasmChannelFilter> = createWasmChannel,
  ) {
    validateRecordingMetadata(recording.metadata, recordingDataByteLength(recording), STREAMING_RECORDING_MAX_BYTES);
    this.reader = new ReplayReader(recording);
    this.rangeStart = recording.replayRange?.startSample ?? 0;
    this.rangeEnd = recording.replayRange?.endSample ?? recording.metadata.sampleCount;
    if (!Number.isSafeInteger(this.rangeStart) || !Number.isSafeInteger(this.rangeEnd) || this.rangeStart < 0 || this.rangeEnd > recording.metadata.sampleCount || this.rangeStart >= this.rangeEnd) throw new Error("Invalid replay range.");
    this.position = this.rangeStart;
    while ((recording.metadata.knownGaps[this.nextGap]?.afterSample ?? Infinity) < this.position) {
      this.priorGapSamples += recording.metadata.knownGaps[this.nextGap]!.missingSamples ?? 0;
      this.nextGap++;
    }
    this.audioContext = new AudioContext();
    this.audioContext.addEventListener("statechange", this.onAudioStateChange);
    this.audioResume = this.audioContext.resume();
    this.player = new PcmBatchPlayer(new AudioPlayer({ newAudioContext: () => this.audioContext }), () => audioSourceDescription(this.metadata), this.audioContext);
    this.rds = new RdsMultiplexReceiver((state) => this.events.rdsChanged(state));
    this.demodulator = new SharedWbfmDemodulator(
      this.player,
      samples => this.rds.receiveMultiplex(samples),
      state => this.events.squelchChanged?.(state),
    );
    this.adsb = new AdsbReceiver((state) => this.events.adsbChanged?.(state));
    this.ais = new AisReceiver((state) => this.events.aisChanged?.(state));
    this.pocsag = new PocsagDigitalReceiver(({snapshot,diagnostics}) => this.events.pocsagChanged?.(snapshot,diagnostics),error => this.events.runtimeError(error));
    this.aprs = new AprsDigitalReceiver(({ snapshot, diagnostics }) => this.events.aprsChanged?.(snapshot, diagnostics), error => this.events.runtimeError(error));
    this.rs41 = new Rs41DigitalReceiver(({ snapshot, diagnostics }) => this.events.rs41Changed?.(snapshot, diagnostics), error => this.events.runtimeError(error));
    this.textModem = new TextDigitalReceiver(({ snapshot, diagnostics, image }) => this.events.textModemChanged?.(snapshot, diagnostics, image), error => this.events.runtimeError(error));
    this.srd = new SrdDigitalReceiver(
      ({ snapshot, diagnostics }) => this.events.srdChanged?.(snapshot, diagnostics),
      (error) => this.events.runtimeError(error),
    );
  }

  async start(options: ReceiverStartOptions): Promise<Omit<SourceSessionMetadata, "sessionGeneration">> {
    const sourceMetadata = validateRecordingMetadata(this.recording.metadata, recordingDataByteLength(this.recording), STREAMING_RECORDING_MAX_BYTES);
    this.recording = { ...this.recording, metadata: sourceMetadata };
    const mode = normalizeModeSettings({
      mode: sourceMetadata.mode,
      bandwidthHz: sourceMetadata.channelBandwidthHz,
      squelch: sourceMetadata.squelch,
      beatToneHz: sourceMetadata.beatToneHz,
      srd: sourceMetadata.srd, textModem: sourceMetadata.textModem, pocsag: sourceMetadata.pocsag,
    });
    const metadata: SourceSessionMetadata = {
      source: "replay",
      sessionGeneration: this.sessionGeneration,
      requestedSampleRateHz: recordingRoutingSampleRate(sourceMetadata),
      actualSampleRateHz: recordingRoutingSampleRate(sourceMetadata),
      hardwareCenterFrequencyHz: sourceMetadata.centerFrequencyHz,
      selectedChannelFrequencyHz: sourceMetadata.selectedChannelFrequencyHz,
      mode: mode.mode,
      channelBandwidthHz: mode.bandwidthHz,
      squelch: mode.squelch,
      beatToneHz: mode.beatToneHz,
      srd: mode.srd, textModem: mode.textModem, pocsag: mode.pocsag,
      rtlInput: sourceMetadata.rtlInput,
      gainDb: sourceMetadata.gainDb ?? null,
      ...(sourceMetadata.format !== RECORDING_FORMAT && sourceMetadata.format !== CHANNEL_RECORDING_FORMAT && sourceMetadata.provenanceDetails.originalSource === "hackrf" ? { hackrf: ci8SessionDetails(sourceMetadata as HackrfRecordingFormat) } : {}),
      ...(sourceMetadata.format === AIRSPY_RECORDING_FORMAT ? { airspy: structuredClone(sourceMetadata.airspy) } : {}),
      ...(sourceMetadata.format === BLADERF_SC16_RECORDING_FORMAT ? { bladerf: structuredClone(sourceMetadata.hardware) } : {}),
      sampleFormat: "planar-f32-iq-normalized",
    };
    if (sourceMetadata.format !== RECORDING_FORMAT) validateLiveRateBudget(channelSampleRate(metadata.actualSampleRateHz), this.audioContext.sampleRate);
    validateModeSampleRate(mode.mode, channelSampleRate(metadata.actualSampleRateHz));
    const analogMode = ["OFF", "DAB", "ADS-B", "AIS", "SRD", "POCSAG", "APRS", "RS41", "RTTY", "PSK31", "NAVTEX", "ACARS", "WEFAX", "SSTV"].includes(mode.mode) ? undefined : createSignalsMode(mode);
    this.outputEnabled = mode.mode !== "OFF";
    const channel = metadata.actualSampleRateHz === 19_200_000 ? await this.compiledChannel(metadata.actualSampleRateHz) : undefined;
    if (this.stopped) { channel?.dispose(); throw new DOMException("Replay start was stopped", "AbortError"); }
    this.channel = channel;
    this.player.configure(metadata.actualSampleRateHz === 19_200_000);
    this.metadata = metadata;
    this.demodulator.setSampleRate(channelSampleRate(metadata.actualSampleRateHz));
    if (analogMode) this.demodulator.setMode(analogMode);
    this.demodulator.setCwToneFrequency(mode.beatToneHz ?? 600);
    const nativeOffset = metadata.selectedChannelFrequencyHz - metadata.hardwareCenterFrequencyHz;
    this.channel ??= isAirspyRate(metadata.actualSampleRateHz) ? new (await import("./airspyChannel")).AirspyChannelFilter(metadata.actualSampleRateHz) : isWidebandRate(metadata.actualSampleRateHz) ? new WidebandChannelFilter(nativeOffset, metadata.actualSampleRateHz) : undefined;
    this.channel?.reset(nativeOffset);
    const frequencyOffsetHz = this.channel ? 0 : nativeOffset;
    this.prepareSrd(metadata, frequencyOffsetHz);
    this.demodulator.setFrequencyOffset(frequencyOffsetHz + (mode.mode === "CW-TEXT" ? mode.textModem?.tuningOffsetHz ?? 0 : 0));
    this.setVolume(options.volume);
    this.rds.setEnabled(mode.mode === "WBFM");
    this.rds.setFrequencyOffset(frequencyOffsetHz);
    const analysisReceiver = this.analysis.begin(metadata);
    this.rawAnalysis = this.channel || !this.outputEnabled ? analysisReceiver : undefined;
    this.receiver = new AudioFirstRdsReceiver(this.demodulator, this.rds, this.channel ? undefined : analysisReceiver);
    this.receiver.setSampleRate(channelSampleRate(metadata.actualSampleRateHz));
    this.receiver.setDigitalReceiver(this.digitalReceiver(mode.mode), channelSampleRate(metadata.actualSampleRateHz), frequencyOffsetHz, mode.mode === "CW-TEXT");
    await this.dabPlayback?.ensemble.prepare?.();
    if (mode.mode === "POCSAG") await this.pocsag.prepare();
    if (mode.mode === "APRS") await this.aprs.prepare();
    if (mode.mode === "RS41") await this.rs41.prepare();
    if (isTextMode(mode.mode)) await this.textModem.prepare();
    await this.audioResume;
    if (this.stopped) throw new DOMException("Replay start was stopped", "AbortError");
    if (this.audioContext.state !== "running") throw new DOMException(`Audio context remained ${this.audioContext.state}`, "NotAllowedError");
    this.startedAtMs = performance.now();
    // Begin after start has published metadata, including for very short files.
    this.timer = window.setTimeout(() => this.scheduleNext(), 0);
    const { sessionGeneration: _generation, ...result } = metadata;
    return result;
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    if (this.closeTask) return this.closeTask;
    this.finishRecording("source-stop");
    this.stopped = true;
    this.player.reset();
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    if (this.channel && "dispose" in this.channel) this.channel.dispose();
    this.channel = undefined;
    this.analysis.stop(this.sessionGeneration);
    this.srd.dispose();
    this.pocsag.dispose();
    this.aprs.dispose();
    this.rs41.dispose();
    this.textModem.dispose();
    this.dabPlayback?.close();
    this.dabPlayback = undefined;
    const task = (async () => {
      if (this.audioContext.state !== "closed") await this.audioContext.close();
      this.audioContext.removeEventListener("statechange", this.onAudioStateChange);
      this.closed = true;
    })().finally(() => { if (this.closeTask === task) this.closeTask = undefined; });
    this.closeTask = task;
    return task;
  }

  setVolume(volume: number): void {
    this.volume = volume; this.demodulator.setVolume(volume); this.dabPlayback?.output.setVolume(volume);
  }
  selectDabService(key: string): void { this.dabPlayback?.ensemble.selectService?.(key); }

  async tune(channelFrequencyHz: number, sessionGeneration: number, options: ReceiverTuneOptions = {}): Promise<Omit<SourceSessionMetadata, "sessionGeneration">> {
    if (!this.metadata) throw new Error("Replay source is not running");
    const plan = planChannelTune(this.metadata.hardwareCenterFrequencyHz, channelFrequencyHz, this.metadata.actualSampleRateHz, this.metadata.channelBandwidthHz, options);
    if (plan.hardwareRetuneRequired) throw new Error("That channel lies outside the recorded capture span; replay cannot retune hardware.");
    this.finishRecording("metadata-change");
    this.sessionGeneration = sessionGeneration;
    this.player.reset();
    this.channel?.reset(plan.frequencyOffsetHz);
    this.demodulator.setFrequencyOffset((this.channel ? 0 : plan.frequencyOffsetHz) + (this.metadata.mode === "CW-TEXT" ? this.metadata.textModem?.tuningOffsetHz ?? 0 : 0));
    this.rds.setFrequencyOffset(this.channel ? 0 : plan.frequencyOffsetHz);
    this.metadata = { ...this.metadata, sessionGeneration, selectedChannelFrequencyHz: channelFrequencyHz };
    this.prepareSrd(this.metadata, this.channel ? 0 : plan.frequencyOffsetHz);
    if (this.metadata.mode === "POCSAG") await this.pocsag.prepare();
    if (this.metadata.mode === "APRS") await this.aprs.prepare();
    if (this.metadata.mode === "RS41") await this.rs41.prepare();
    if (isTextMode(this.metadata.mode)) await this.textModem.prepare();
    this.receiver?.setDigitalReceiver(this.digitalReceiver(this.metadata.mode), channelSampleRate(this.metadata.actualSampleRateHz), this.channel ? 0 : plan.frequencyOffsetHz, this.metadata.mode === "CW-TEXT");
    this.analysis.retune(this.metadata);
    const { sessionGeneration: _generation, ...result } = this.metadata;
    return result;
  }

  async configureMode(settings: ReceiverModeSettings, sessionGeneration: number): Promise<Omit<SourceSessionMetadata, "sessionGeneration">> {
    if (!this.metadata) throw new Error("Replay source is not running");
    const mode = normalizeModeSettings(settings);
    validateModeSampleRate(mode.mode, channelSampleRate(this.metadata.actualSampleRateHz));
    const plan = planChannelTune(this.metadata.hardwareCenterFrequencyHz, this.metadata.selectedChannelFrequencyHz, this.metadata.actualSampleRateHz, mode.bandwidthHz);
    if (plan.hardwareRetuneRequired) throw new Error("That channel bandwidth lies outside the recorded capture span.");
    const analogMode = ["OFF", "DAB", "ADS-B", "AIS", "SRD", "POCSAG", "APRS", "RS41", "RTTY", "PSK31", "NAVTEX", "ACARS", "WEFAX", "SSTV"].includes(mode.mode) ? undefined : createSignalsMode(mode);
    this.outputEnabled = mode.mode !== "OFF";
    if (analogMode) this.demodulator.setMode(analogMode);
    this.rds.setEnabled(mode.mode === "WBFM");
    this.demodulator.setCwToneFrequency(mode.beatToneHz ?? 600);
    this.metadata = { ...this.metadata, mode: mode.mode, channelBandwidthHz: mode.bandwidthHz, squelch: mode.squelch, beatToneHz: mode.beatToneHz, srd: mode.srd, textModem: mode.textModem, pocsag: mode.pocsag };
    this.prepareSrd(this.metadata, this.channel ? 0 : this.metadata.selectedChannelFrequencyHz - this.metadata.hardwareCenterFrequencyHz);
    if (mode.mode === "DAB") {
      this.digitalReceiver("DAB");
      await this.dabPlayback?.ensemble.prepare?.();
    } else this.dabPlayback?.reset();
    return this.tune(this.metadata.selectedChannelFrequencyHz, sessionGeneration);
  }

  updateAnalogMode(settings: ReceiverModeSettings): Omit<SourceSessionMetadata, "sessionGeneration"> {
    if (!this.metadata) throw new Error("Replay source is not running");
    const mode = normalizeModeSettings(settings);
    if (mode.mode !== this.metadata.mode)
      throw new Error("Live analog settings cannot change receiver mode.");
    this.demodulator.setCwToneFrequency(mode.beatToneHz ?? 600);
    this.demodulator.setMode(createSignalsMode(mode));
    this.metadata = {
      ...this.metadata,
      channelBandwidthHz: mode.bandwidthHz,
      squelch: mode.squelch,
      beatToneHz: mode.beatToneHz,
    };
    const { sessionGeneration: _generation, ...metadata } = this.metadata;
    return metadata;
  }

  setGain(_gainDb: number | null): Promise<number | null> { return Promise.resolve(this.metadata?.gainDb ?? null); }

  startRecording(survey?: import("./fieldSurvey").SurveyCaptureContext, options?: RecordingOptions): RecordingStatus {
    if (!this.metadata || this.stopped) throw new Error("Replay source is not running");
    if (this.seeking) throw new Error("Wait for replay seeking to finish before recording.");
    if (this.recorder || this.completedRecording) throw new Error("Finish or retrieve the existing replay recording first.");
    const original = this.recording.metadata;
    const offset = this.position + this.priorGapSamples + this.elapsedGapSamples;
    const timestamp = new Date(Date.parse(original.captureStartedAt) + offset / original.sampleRateHz * 1000).toISOString();
    const provenance = `${(original.provenance ?? "").slice(0, 3500)} Re-recorded original bytes during replay from dataset sample ${this.position}; acquisition timestamp advanced by known sample-clock time only, excluding unknown gap durations. No new hardware observation.`;
    this.recorder = new IqRecorder({ ...this.metadata, actualSampleRateHz: original.sampleRateHz }, timestamp, undefined, provenance, survey ? { ...survey, site: original.survey?.site } : original.survey, recordingSampleFormat(original), preferredRecordingStorageMode(options?.storageMode), { ...options, receiverLocation: original.receiverLocation });
    this.recordingChannelOnly = Boolean(options?.captureCurrentChannel);
    return this.recorder.status();
  }

  private finishRecording(reason: "user" | "source-stop" | "metadata-change"): void {
    if (!this.recorder) return;
    const result = this.recorder.finish(reason); this.recorder = undefined;
    if (this.recording.importedSigmf && !this.recordingChannelOnly) result.importedSigmf = { ...this.recording.importedSigmf };
    this.recordingChannelOnly = false;
    this.completedRecording = result;
  }
  stopRecording(reason: "user" | "source-stop" | "metadata-change" = "user"): IqRecording | undefined {
    this.finishRecording(reason);
    const result = this.completedRecording; this.completedRecording = undefined;
    return result;
  }

  getRecordingStatus(): RecordingStatus | undefined { return this.recorder?.status(); }

  private digitalReceiver(mode: ReceiverModeSettings["mode"]): DigitalSampleReceiver | undefined {
    if (mode === "DAB") {
      this.dabPlayback ??= createDabReplayPlayback(this.audioContext, this.events, this.volume, undefined, () => audioSourceDescription(this.metadata));
      return this.dabPlayback.receiver;
    }
    if (mode === "ADS-B") return this.adsb;
    if (mode === "AIS") return this.ais;
    if (mode === "SRD") return this.srd;
    if (mode === "POCSAG") return this.pocsag;
    if (mode === "APRS") return this.aprs;
    if (mode === "RS41") return this.rs41;
    if (isTextMode(mode)) return this.textModem;
    return undefined;
  }

  private prepareSrd(metadata: SourceSessionMetadata, offsetHz: number): void {
    const rate = channelSampleRate(metadata.actualSampleRateHz) as DigitalInputSampleRateHz;
    if (metadata.mode === "POCSAG") this.pocsag.configureSession(pocsagConfiguration(metadata.pocsag,rate,metadata.sessionGeneration,offsetHz));
    if (metadata.mode === "APRS") this.aprs.configureSession(defaultAprsConfiguration(rate, metadata.sessionGeneration, offsetHz));
    if (metadata.mode === "RS41") this.rs41.configureSession(defaultRs41Configuration(rate, metadata.sessionGeneration, offsetHz));
    if (isTextMode(metadata.mode)) this.textModem.configureSession(textModemConfiguration(metadata.mode, metadata.textModem, rate, metadata.sessionGeneration, offsetHz));
    if (metadata.mode !== "SRD") return;
    this.srd.configureSession(
      srdConfigurationForRoute(
        metadata.srd!,
        channelSampleRate(metadata.actualSampleRateHz) as DigitalInputSampleRateHz,
        offsetHz,
        metadata.sessionGeneration,
      ),
    );
  }

  setReplayPaused(paused: boolean): void {
    if (paused && this.pausedAt === undefined) { this.pausedAt = performance.now(); this.player.reset(); }
    else if (!paused && this.pausedAt !== undefined) { this.startedAtMs += performance.now() - this.pausedAt; this.pausedAt = undefined; }
  }

  getReplayPosition(): number { return this.position; }

  async seekReplay(sample: number): Promise<void> {
    if (this.stopped || this.ended || this.seeking || this.recorder || !Number.isFinite(sample)) return;
    this.seeking = true;
    ++this.playbackEpoch;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    try {
      await this.pendingRead;
      if (this.stopped || this.recorder) return;
      this.position = Math.max(0, Math.min(this.rangeEnd, Math.round(sample)));
      this.rangeStart = this.position;
      this.nextGap = 0; this.priorGapSamples = 0; this.elapsedGapSamples = 0;
      while ((this.recording.metadata.knownGaps[this.nextGap]?.afterSample ?? Infinity) < this.position) {
        this.priorGapSamples += this.recording.metadata.knownGaps[this.nextGap]!.missingSamples ?? 0;
        this.nextGap++;
      }
      this.player.reset();
      this.demodulator.setSampleRate(channelSampleRate(recordingRoutingSampleRate(this.recording.metadata)));
      this.channel?.reset(this.metadata!.selectedChannelFrequencyHz - this.metadata!.hardwareCenterFrequencyHz);
      this.rds.reset();
      this.receiver?.resetDigitalReceiver();
      this.dabPlayback?.reset();
      this.analysis.markDiscontinuity(0);
      this.startedAtMs = performance.now();
      if (this.pausedAt !== undefined) this.pausedAt = this.startedAtMs;
    } finally {
      this.seeking = false;
      if (!this.stopped) this.timer = window.setTimeout(() => this.scheduleNext(), 0);
    }
  }

  private scheduleNext(): void {
    if (this.stopped || this.seeking) return;
    if (this.pausedAt !== undefined) { this.timer = window.setTimeout(() => this.scheduleNext(), 25); return; }
    if (this.recording.dataBlob) {
      const bytesPerSample = this.recording.metadata.bytesPerComplexSample;
      const epoch = this.playbackEpoch;
      this.pendingRead = this.reader.prepare(this.position * bytesPerSample, Math.min(REPLAY_CHUNK_SAMPLES * REPLAY_MAX_CATCH_UP_BLOCKS, this.rangeEnd - this.position) * bytesPerSample)
        .then(() => { if (!this.stopped && epoch === this.playbackEpoch) this.deliverNext(); })
        .catch(error => { if (!this.stopped && epoch === this.playbackEpoch) this.events.runtimeError(error); });
    } else this.deliverNext();
  }

  private deliverNext(): void {
    if (this.stopped) return;
    if (this.pausedAt !== undefined) { this.timer = window.setTimeout(() => this.scheduleNext(), 25); return; }
    try {
      const began = performance.now();
      let delay = 0;
      // All rates can fall behind clamped/delayed browser timers. Drain only
      // overdue blocks, retaining the same block/time budget and worker credits.
      for (let n = 0; n < REPLAY_MAX_CATCH_UP_BLOCKS && !this.stopped && !this.ended; n++) {
        delay = this.readNext();
        if (delay > 0 || performance.now() - began >= 6) break;
      }
      if (!this.stopped && !this.ended) this.timer = window.setTimeout(() => this.scheduleNext(), Math.max(0, delay));
    } catch (error) { this.events.runtimeError(error); }
  }

  private readNext(): number {
    while (this.recording.metadata.knownGaps[this.nextGap]?.afterSample === this.position) {
      const gap = this.recording.metadata.knownGaps[this.nextGap]!;
      this.player.reset();
      this.demodulator.setSampleRate(channelSampleRate(recordingRoutingSampleRate(this.recording.metadata)));
      this.channel?.reset(this.metadata!.selectedChannelFrequencyHz - this.metadata!.hardwareCenterFrequencyHz);
      this.rds.setSampleRate(channelSampleRate(recordingRoutingSampleRate(this.recording.metadata)));
      if (this.metadata && (this.metadata.mode === "POCSAG" || this.metadata.mode === "APRS" || this.metadata.mode === "RS41" || isTextMode(this.metadata.mode))) {
        const missing = gap.missingSamples === null ? null : gap.missingSamples / (this.metadata.actualSampleRateHz / channelSampleRate(this.metadata.actualSampleRateHz));
        (isTextMode(this.metadata.mode) ? this.textModem : this.metadata.mode === "POCSAG" ? this.pocsag : this.metadata.mode === "APRS" ? this.aprs : this.rs41).reset({ reason: "source-gap", missingInputSamples: missing !== null && Number.isSafeInteger(missing) ? missing : null });
      } else this.receiver?.resetDigitalReceiver();
      this.dabPlayback?.reset();
      this.analysis.markDiscontinuity(gap.missingSamples ?? 0);
      this.recorder?.addGap(gap.missingSamples, `Replayed source gap: ${gap.reason}`);
      this.elapsedGapSamples += gap.missingSamples ?? 0;
      this.nextGap += 1;
    }
    const dueMs = this.startedAtMs + (this.position - this.rangeStart + this.elapsedGapSamples) / this.recording.metadata.sampleRateHz * 1000;
    const delayMs = dueMs - performance.now();
    if (delayMs > 0) {
      return Math.max(1, delayMs);
    }
    if (this.position >= this.rangeEnd) {
      this.player.flush();
      this.player.finishAudio();
      this.ended = true;
      if (this.metadata?.mode === "DAB" && this.dabPlayback) {
        void this.dabPlayback.flush().then(() => { if (!this.stopped) { audioCaptureTap.archive?.finish(this.dabPlayback!.output); this.events.sourceEnded(); } })
          .catch(error => { if (!this.stopped) this.events.runtimeError(error); });
      } else if (this.metadata && (this.metadata.mode === "POCSAG" || this.metadata.mode === "APRS" || this.metadata.mode === "RS41" || isTextMode(this.metadata.mode))) {
        void (isTextMode(this.metadata.mode) ? this.textModem : this.metadata.mode === "POCSAG" ? this.pocsag : this.metadata.mode === "APRS" ? this.aprs : this.rs41).flush()
          .then(() => { if (!this.stopped) this.events.sourceEnded(); })
          .catch(error => { if (!this.stopped) this.events.runtimeError(error); });
      } else this.events.sourceEnded();
      return 0;
    }
    // File replay may wait for a busy decoder: unlike live acquisition, no
    // samples need to be dropped to keep a physical input stream moving.
    const packetQueue = this.metadata?.mode === "POCSAG" ? this.pocsag.diagnostics : this.metadata?.mode === "APRS" ? this.aprs.diagnostics
      : this.metadata?.mode === "RS41" ? this.rs41.diagnostics : this.metadata && isTextMode(this.metadata.mode) ? this.textModem.diagnostics : undefined;
    if (packetQueue && packetQueue.queueCapacityBlocks > 0 && packetQueue.queuedBlocks >= packetQueue.queueCapacityBlocks) return 4;
    const gapPosition = this.recording.metadata.knownGaps[this.nextGap]?.afterSample;
    const end = Math.min(
      this.rangeEnd,
      this.position + REPLAY_CHUNK_SAMPLES,
      gapPosition ?? Number.POSITIVE_INFINITY,
    );
    if (end <= this.position) throw new Error("Replay gap metadata would move playback backward.");
    const bytes = this.reader.view(this.position * this.recording.metadata.bytesPerComplexSample, end * this.recording.metadata.bytesPerComplexSample);
    const decoded = decodeRecordingSamples(bytes, this.recording.metadata);
    if (this.recording.metadata.sampleEncoding === "signed-8-bit") this.recorder?.appendCi8(bytes);
    else if (this.recording.metadata.sampleEncoding === "signed-16-bit-little-endian") this.recorder?.appendCi16(bytes);
    else this.recorder?.appendCu8(bytes);
    if (!this.outputEnabled) {
      this.rawAnalysis?.receiveSamples({ ...decoded, frequency: this.recording.metadata.centerFrequencyHz });
    } else if (this.channel) {
      this.rawAnalysis?.receiveSamples({ ...decoded, frequency: this.recording.metadata.centerFrequencyHz });
      const count = this.channel.process(decoded.I, decoded.Q);
      if (count) this.receiver?.receiveSamples({ I: decoded.I.subarray(0, count), Q: decoded.Q.subarray(0, count), frequency: this.metadata!.selectedChannelFrequencyHz });
    } else this.receiver?.receiveSamples({ ...decoded, frequency: this.recording.metadata.centerFrequencyHz });
    this.position = end;
    const targetMs = this.startedAtMs + (this.position - this.rangeStart + this.elapsedGapSamples) / this.recording.metadata.sampleRateHz * 1000;
    return Math.max(0, targetMs - performance.now());
  }

  private readonly onAudioStateChange = (): void => this.events.audioStateChanged(this.audioContext.state);
}
