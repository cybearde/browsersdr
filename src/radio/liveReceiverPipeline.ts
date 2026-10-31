import type { SecondaryVfo, SecondaryVfoSettings } from "./secondaryVfo";
import { PocsagDigitalReceiver } from "../pocsag/pocsagDigitalReceiver";
import { pocsagConfiguration } from "../pocsag/settings";
import type { DigitalInputSampleRateHz } from "../digital/inputRates";
import { TextDigitalReceiver } from "../textmodem/digitalReceiver";
import { isTextMode, textModemConfiguration } from "../textmodem/settings";
import type { IngressTimings } from "./ingressTimings";
import { SharedWbfmDemodulator } from "./sharedWbfmDemodulator";
import { PcmBatchPlayer } from "./pcmBatchPlayer";
import { isWidebandRate } from "./sourceCapabilities";
import {
  WidebandChannelWorker,
  type ChannelWorkerPort,
} from "./widebandChannel";
import { channelSampleRate } from "./sourceCapabilities";
import { validateLiveRateBudget } from "./liveRateBudget";
import type { Demodulator } from "@jtarrio/signals/demod/demodulator.js";
import { AudioPlayer } from "@jtarrio/signals/players/audioplayer.js";
import { audioSourceDescription } from "./audioCaptureTap";
import type { SampleReceiver } from "@jtarrio/signals/radio/sample_receiver.js";
import type { SampleBlock } from "@jtarrio/signals/radio/sample_block.js";
import {
  AudioFirstRdsReceiver,
  RdsMultiplexReceiver,
} from "../rds/rdsMultiplexReceiver";
import { DabReceiver, type DabEnsembleDecoder } from "../dab/dabReceiver";
import {
  DabAudioPlayer,
  DabPcmPlayer,
  WebCodecsDabAudioDecoder,
} from "../dab/dabAudio";
import { DabPlusProgrammeDecoder } from "../dab/dabPlusSuperframe";
import { DabEnsembleWorkerDecoder } from "../dab/dabEnsembleWorker";
import { AdsbReceiver } from "../adsb/adsbReceiver";
import { AisReceiver } from "../ais/aisReceiver";
import { AprsDigitalReceiver } from "../aprs/aprsDigitalReceiver";
import { Rs41DigitalReceiver } from "../rs41/rs41DigitalReceiver";
import { defaultAprsConfiguration } from "../aprs/settings";
import { defaultRs41Configuration } from "../rs41/settings";
import { SrdDigitalReceiver } from "../srd/srdDigitalReceiver";
import { srdConfigurationForRoute } from "../srd/settings";
import {
  createSignalsMode,
  validateModeSampleRate,
  type ReceiverModeSettings,
} from "./receiverConfig";
import type { SourceSessionMetadata } from "./types";
import type { ReceiverBackendEvents } from "./receiverController";
import type { AnalysisPipeline } from "../dsp/analysisPipeline";

export type LiveDemodulator = Pick<
  Demodulator,
  | "setMode"
  | "setVolume"
  | "setFrequencyOffset"
  | "setSampleRate"
  | "receiveSamples"
  | "expectFrequencyAndSetOffset"
> & { setCwToneFrequency?(frequencyHz: number): void; };
export interface LiveReceiverDependencies {
  createChannelWorker?: () => ChannelWorkerPort;
  createAudioContext?: () => AudioContext;
  createDemodulator?: (context: AudioContext) => LiveDemodulator;
  /** Permissively licensed OFDM/FIC/MSC stage. Its selected DAB+ service sends
   * each decoded 24 ms logical frame to the supplied programme endpoint. */
  createDabEnsembleDecoder?: (
    programme: DabPlusProgrammeDecoder,
  ) => DabEnsembleDecoder;
}

/** Shared DSP/audio owner only. Hardware acquisition and native recording stay in
 * the backends. All samples must arrive synchronously through the raw fan-out. */
export class LiveReceiverPipeline implements SampleReceiver {
  readonly audioContext: AudioContext;
  readonly demodulator: LiveDemodulator;
  private readonly player: PcmBatchPlayer;
  private readonly rds: RdsMultiplexReceiver;
  private dabResources?: ReturnType<LiveReceiverPipeline["createDabResources"]>;
  private selectedDabServiceKey?: string;
  private selectedDabFrequencyHz?: number;
  private requestedDabServiceKey?: string;
  private secondary?: SecondaryVfo;
  private secondaryEpoch = 0;
  private volume = 0;
  private readonly adsb: AdsbReceiver;
  private readonly ais: AisReceiver;
  private pocsag?: PocsagDigitalReceiver;
  private aprs?: AprsDigitalReceiver;
  private rs41?: Rs41DigitalReceiver;
  private textModem?: TextDigitalReceiver;
  private srd?: SrdDigitalReceiver;
  private readonly receiver: AudioFirstRdsReceiver;
  private generation?: number;
  private rawAnalysis?: SampleReceiver;
  private channel?: WidebandChannelWorker;
  private selectedFrequency = 0;
  private enabled = false;
  private outputEnabled = true;
  private centerFrequencyHz = 0;
  private metadata?: SourceSessionMetadata;
  private closeTask?: Promise<void>;
  private closed = false;
  private closing = false;

  constructor(
    private readonly events: ReceiverBackendEvents,
    private readonly analysis?: AnalysisPipeline,
    private readonly dependencies: LiveReceiverDependencies = {},
    private readonly timings?: IngressTimings,
  ) {
    this.audioContext =
      dependencies.createAudioContext?.() ?? new AudioContext();
    this.audioContext.addEventListener("statechange", this.audioChanged);
    this.player = new PcmBatchPlayer(
      new AudioPlayer({ newAudioContext: () => this.audioContext }),
      () => audioSourceDescription(this.metadata),
      this.audioContext,
      () => this.secondary?.settings?.recordAudio !== true,
    );
    this.rds = new RdsMultiplexReceiver((value) => events.rdsChanged(value));
    this.demodulator =
      dependencies.createDemodulator?.(this.audioContext) ??
      new SharedWbfmDemodulator(
        this.player,
        (samples) => this.rds.receiveMultiplex(samples),
        (state) => this.events.squelchChanged?.(state),
        (stereo) => this.events.fmStereoReceptionChanged?.(stereo),
      );
    this.adsb = new AdsbReceiver((value) => events.adsbChanged?.(value));
    this.ais = new AisReceiver((value) => events.aisChanged?.(value));
    this.receiver = new AudioFirstRdsReceiver(this.demodulator, this.rds);
  }
  recordingContext(metadata: SourceSessionMetadata, target: "A"|"B"): SourceSessionMetadata {
    if (target === "A") return metadata;
    const selected=this.secondary?.settings;
    if (!this.enabled || !selected) throw new Error("Enable VFO B before selecting it for I/Q recording.");
    return {...metadata,selectedChannelFrequencyHz:selected.frequencyHz,mode:selected.mode,channelBandwidthHz:selected.bandwidthHz,squelch:selected.squelch,beatToneHz:selected.mode === "CW" ? 600 : undefined,srd:undefined,textModem:undefined,pocsag:undefined};
  }
  async configureSecondaryVfo(settings?: SecondaryVfoSettings): Promise<void> {
    const epoch = ++this.secondaryEpoch;
    if (!settings) { this.secondary?.stop(); return; }
    if (!this.enabled || !this.metadata) throw new Error("Start reception before enabling VFO B.");
    const { SecondaryVfo } = await import("./secondaryVfo");
    if (epoch !== this.secondaryEpoch || !this.enabled || this.closing) return;
    this.secondary ??= new SecondaryVfo(this.audioContext, (value, message) => this.events.secondaryVfoChanged?.(value,message), this.dependencies.createChannelWorker);
    await this.secondary.configure(settings,this.metadata);
  }
  private ensureDabResources() {
    return this.dabResources ??= this.createDabResources();
  }

  private createDabResources() {
    const output = new DabAudioPlayer(this.audioContext, () => audioSourceDescription(this.metadata));
    output.setVolume(this.volume);
    const pcm = new DabPcmPlayer(output);
    let active = true;
    const programme = new DabPlusProgrammeDecoder(
      new WebCodecsDabAudioDecoder(
        (left, right, rate) => {
          if (!active) return;
          pcm.play(left, right, rate);
          receiver.recordPcm(left.length, rate);
        },
        (status) => {
          if (!active) return;
          receiver.updateAudioStatus(status);
          if (status.state === "error") this.events.runtimeError(new Error(status.message));
        },
      ),
      (stats) => { if (active) receiver.updateProgrammeStats(stats); },
      // AAC support is independent of OFDM/FIC discovery. Keep receiving labels
      // and services when the browser cannot decode this programme's audio.
      (error) => { if (active && !(error instanceof DOMException && error.name === "NotSupportedError")) this.events.runtimeError(error instanceof Error ? error : new Error(String(error))); },
      (metadata) => { if (active) receiver.updateProgrammeMetadata(metadata); },
    );
    const ensemble = this.dependencies.createDabEnsembleDecoder?.(programme) ??
      (typeof Worker === "undefined" ? undefined : new DabEnsembleWorkerDecoder(
        programme,
        (status) => { if (active) receiver.updateDecoderStatus(status); },
        (error) => { if (active) this.events.runtimeError(error); },
        undefined,
        () => {
          if (!active) return;
          pcm.reset(); output.reset(); this.player.reset(); receiver.resetProgramme();
        },
      ));
    const receiver = new DabReceiver((value) => {
      if (!active) return;
      const selectedKey = this.selectedDabServiceKey;
      const activeServiceKey =
        value.serviceId === undefined || value.subchannelId === undefined
          ? undefined
          : `${value.serviceId}:${value.subchannelId}`;
      if (
        selectedKey &&
        selectedKey !== activeServiceKey &&
        this.requestedDabServiceKey !== selectedKey &&
        value.stations?.some(
          (station) => station.key === selectedKey && station.playable,
        )
      ) {
        this.requestedDabServiceKey = selectedKey;
        ensemble?.selectService?.(selectedKey);
      } else if (!selectedKey && activeServiceKey) {
        // The DAB decoder may choose its primary service without an explicit
        // UI selection. Remember that active choice across source reconfigure.
        this.selectedDabServiceKey = activeServiceKey;
        this.selectedDabFrequencyHz =
          this.metadata?.selectedChannelFrequencyHz ??
          this.selectedFrequency;
        this.requestedDabServiceKey = activeServiceKey;
      }
      this.events.dabChanged?.(value);
    }, ensemble);
    return {
      receiver, ensemble, output,
      reset: () => { programme.reset(); pcm.reset(); output.reset(); },
      close: () => {
        active = false;
        receiver.close(); programme.close(); pcm.reset(); output.dispose();
      },
    };
  }

  private releaseDabResources(): void {
    this.dabResources?.close();
    this.dabResources = undefined;
    this.requestedDabServiceKey = undefined;
  }

  get channelDiagnostics() {
    return this.channel?.diagnostics;
  }
  async resume(): Promise<void> {
    await this.audioContext.resume();
    // Resuming an already-running context emits no statechange event.
    this.audioChanged();
  }
  requireRunning(): void {
    if (this.audioContext.state !== "running")
      throw new DOMException(
        `Audio context remained ${this.audioContext.state}`,
        "NotAllowedError",
      );
  }
  setVolume(volume: number): void {
    this.demodulator.setVolume(volume);
    this.volume = volume;
    this.dabResources?.output.setVolume(volume);
  }
  /** Signals 0.10.1 uses exact rational interpolation and allocates one phase
   * filter per output/gcd(input, output). Fractional readbacks can make that
   * allocation enormous. Reject before any consumer sees the rate; never round
   * acquisition timing to make a filter fit. RTL keeps its legacy rate policy. */
  validateRateBudget(sampleRate: number): void {
    validateLiveRateBudget(sampleRate, this.audioContext.sampleRate);
  }
  setSampleRate(sampleRate: number): void {
    this.receiver.setSampleRate(channelSampleRate(sampleRate));
  }
  receiveSamples(block: SampleBlock): void {
    if (!this.enabled || block.frequency !== this.centerFrequencyHz) return;
    this.rawAnalysis?.receiveSamples(block);
    if (!this.outputEnabled) return;
    this.secondary?.receive(block);
    if (this.channel) this.channel.receive(block, this.selectedFrequency);
    else this.receiver.receiveSamples(block);
  }
  receiveCi8(bytes: Uint8Array, frequency: number): boolean {
    if (!this.enabled || frequency !== this.centerFrequencyHz) return true;
    if (!this.outputEnabled) {
      this.analysis?.receiveCi8(bytes, frequency, this.generation!, this.timings);
      return true;
    }
    if (!this.channel) return false;
    this.secondary?.native(bytes, frequency, "ci8");
    this.analysis?.receiveCi8(bytes, frequency, this.generation!, this.timings);
    this.channel.receiveCi8(bytes, this.selectedFrequency);
    return true;
  }
  receiveSc16(bytes: Uint8Array, frequency: number): boolean {
    if (!this.enabled || frequency !== this.centerFrequencyHz) return true;
    if (!this.outputEnabled) {
      this.analysis?.receiveSc16(
        bytes,
        frequency,
        this.generation!,
        this.timings,
      );
      return true;
    }
    if (!this.channel) return false;
    this.secondary?.native(bytes, frequency, "sc16");
    this.analysis?.receiveSc16(
      bytes,
      frequency,
      this.generation!,
      this.timings,
    );
    this.channel.receiveSc16(bytes, this.selectedFrequency);
    return true;
  }
  receiveUsrpSc16(bytes: Uint8Array, frequency: number): boolean {
    if (!this.enabled || frequency !== this.centerFrequencyHz) return true;
    if (!this.outputEnabled) {
      this.analysis?.receiveUsrpSc16(bytes, frequency, this.generation!, this.timings);
      return true;
    }
    if (!this.channel) return false;
    this.secondary?.native(bytes, frequency, "usrp-sc16");
    this.analysis?.receiveUsrpSc16(bytes, frequency, this.generation!, this.timings);
    this.channel.receiveUsrpSc16(bytes, this.selectedFrequency);
    return true;
  }
  async prepare(metadata: SourceSessionMetadata): Promise<void> {
    this.requireOpen();
    if (metadata.mode === "POCSAG" || metadata.mode === "APRS" || metadata.mode === "RS41" || isTextMode(metadata.mode)) this.enabled = false;
    this.preparePackets(metadata);
    if (metadata.mode === "POCSAG") await this.pocsag!.prepare();
    if (metadata.mode === "APRS") await this.aprs!.prepare();
    if (metadata.mode === "RS41") await this.rs41!.prepare();
    if (isTextMode(metadata.mode)) await this.textModem!.prepare();
    this.requireOpen();
    const dabReady =
      metadata.mode === "DAB"
        ? (this.ensureDabResources().ensemble?.prepare?.() ?? Promise.resolve())
        : Promise.resolve();
    if (metadata.mode === "OFF" || !isWidebandRate(metadata.actualSampleRateHz)) {
      await dabReady;
      return;
    }
    this.requireOpen();
    this.channel ??= new WidebandChannelWorker(
      (block) => {
        if (this.enabled) this.receiver.receiveSamples(block);
      },
      (error) => this.events.runtimeError(error),
      this.dependencies.createChannelWorker,
      this.timings,
    );
    await Promise.all([
      this.channel.configure(
        metadata.sessionGeneration,
        metadata.selectedChannelFrequencyHz -
          metadata.hardwareCenterFrequencyHz,
        metadata.actualSampleRateHz,
        metadata.source === "hackrf"
          ? "ci8"
          : metadata.source === "bladerf"
            ? "sc16"
            : metadata.source === "usrp-b205"
              ? "usrp-sc16"
            : false,
      ),
      dabReady,
    ]);
    this.requireOpen();
  }

  begin(metadata: SourceSessionMetadata, volume: number): void {
    this.requireOpen();
    validateModeSampleRate(
      metadata.mode,
      channelSampleRate(metadata.actualSampleRateHz),
    );
    this.route(metadata);
    this.centerFrequencyHz = metadata.hardwareCenterFrequencyHz;
    this.metadata = structuredClone(metadata);
    this.secondary?.retune(metadata);
    this.selectedFrequency = metadata.selectedChannelFrequencyHz;
    this.generation = metadata.sessionGeneration;
    this.rawAnalysis = this.analysis?.begin(metadata);
    this.setSampleRate(metadata.actualSampleRateHz);
    this.setVolume(volume);
    this.enabled = true;
  }
  /** Keep the analysis tap but reset decoder/filter histories for a new route. */
  retune(metadata: SourceSessionMetadata): void {
    this.requireOpen();
    validateModeSampleRate(
      metadata.mode,
      channelSampleRate(metadata.actualSampleRateHz),
    );
    this.route(metadata);
    this.centerFrequencyHz = metadata.hardwareCenterFrequencyHz;
    this.metadata = structuredClone(metadata);
    this.secondary?.retune(metadata);
    this.selectedFrequency = metadata.selectedChannelFrequencyHz;
    if (this.generation === undefined)
      this.rawAnalysis = this.analysis?.begin(metadata);
    else this.analysis?.retune(metadata);
    this.generation = metadata.sessionGeneration;
    this.setSampleRate(metadata.actualSampleRateHz);
    this.enabled = true;
  }
  /** Reset stateful consumers at a proven source boundary without inventing a
   * loss count or replacing the active acquisition generation. */
  markDiscontinuity(missingSamples: number | null): void {
    if (this.metadata) this.secondary?.retune(this.metadata);
    if (!this.enabled || !this.metadata) return;
    this.analysis?.markDiscontinuity(missingSamples ?? 0);
    this.player.reset();
    this.rds.reset();
    if (this.metadata.mode === "POCSAG" || this.metadata.mode === "APRS" || this.metadata.mode === "RS41" || isTextMode(this.metadata.mode)) {
      const missing = missingSamples === null ? null : missingSamples / (this.metadata.actualSampleRateHz / channelSampleRate(this.metadata.actualSampleRateHz));
      (isTextMode(this.metadata.mode) ? this.textModem : this.metadata.mode === "POCSAG" ? this.pocsag : this.metadata.mode === "APRS" ? this.aprs : this.rs41)?.reset({ reason: "source-gap", missingInputSamples: missing !== null && Number.isSafeInteger(missing) ? missing : null });
    } else this.receiver.resetDigitalReceiver();
    this.dabResources?.reset();
    if (!["OFF", "DAB", "ADS-B", "AIS", "SRD", "POCSAG", "APRS", "RS41", "RTTY", "PSK31", "NAVTEX", "ACARS", "WEFAX", "SSTV"].includes(this.metadata.mode)) {
      this.demodulator.setMode(createSignalsMode({
        mode: this.metadata.mode,
        bandwidthHz: this.metadata.channelBandwidthHz,
        squelch: this.metadata.squelch,
        beatToneHz: this.metadata.beatToneHz,
      }));
    }
  }
  selectDabService(key: string): void {
    this.selectedDabServiceKey = key;
    this.selectedDabFrequencyHz = this.metadata?.selectedChannelFrequencyHz;
    this.requestedDabServiceKey = key;
    this.dabResources?.ensemble?.selectService?.(key);
  }

  updateAnalogMode(settings: ReceiverModeSettings): void {
    this.requireOpen();
    if (["OFF", "DAB", "ADS-B", "AIS", "SRD", "POCSAG", "APRS", "RS41", "RTTY", "PSK31", "NAVTEX", "ACARS", "WEFAX", "SSTV", "CW-TEXT"].includes(settings.mode))
      throw new Error(`${settings.mode} does not use the analog audio path.`);
    this.demodulator.setCwToneFrequency?.(settings.beatToneHz ?? 600);
    this.demodulator.setMode(createSignalsMode(settings));
  }

  private preparePackets(metadata: SourceSessionMetadata): void {
    const rate = channelSampleRate(metadata.actualSampleRateHz);
    const offset = isWidebandRate(metadata.actualSampleRateHz) ? 0 : metadata.selectedChannelFrequencyHz - metadata.hardwareCenterFrequencyHz;
    if (isTextMode(metadata.mode)) {
      this.textModem ??= new TextDigitalReceiver(({ snapshot, diagnostics, image }) => this.events.textModemChanged?.(snapshot, diagnostics, image), error => this.events.runtimeError(error));
      this.textModem.configureSession(textModemConfiguration(metadata.mode, metadata.textModem, rate, metadata.sessionGeneration, offset));
    }
    if (metadata.mode === "POCSAG") {
      this.pocsag ??= new PocsagDigitalReceiver(({snapshot, diagnostics}) => this.events.pocsagChanged?.(snapshot, diagnostics), error => this.events.runtimeError(error));
      this.pocsag.configureSession(pocsagConfiguration(metadata.pocsag,rate,metadata.sessionGeneration,offset));
    }
    if (metadata.mode === "APRS") {
      this.aprs ??= new AprsDigitalReceiver(({ snapshot, diagnostics }) => this.events.aprsChanged?.(snapshot, diagnostics), error => this.events.runtimeError(error));
      this.aprs.configureSession(defaultAprsConfiguration(rate as DigitalInputSampleRateHz, metadata.sessionGeneration, offset));
    }
    if (metadata.mode === "RS41") {
      this.rs41 ??= new Rs41DigitalReceiver(({ snapshot, diagnostics }) => this.events.rs41Changed?.(snapshot, diagnostics), error => this.events.runtimeError(error));
      this.rs41.configureSession(defaultRs41Configuration(rate as DigitalInputSampleRateHz, metadata.sessionGeneration, offset));
    }
  }

  private route(metadata: SourceSessionMetadata): void {
    if (!["AM","NBFM","USB","LSB","CW","WBFM"].includes(metadata.mode)) this.secondary?.stop("VFO B stopped because VFO A left analog audio mode.");
    if (
      metadata.mode !== "DAB" ||
      (this.selectedDabFrequencyHz !== undefined &&
        this.selectedDabFrequencyHz !== metadata.selectedChannelFrequencyHz)
    ) {
      this.selectedDabServiceKey = undefined;
      this.selectedDabFrequencyHz = undefined;
      this.requestedDabServiceKey = undefined;
    }
    if (metadata.mode === "DAB") this.ensureDabResources().reset();
    const wideband = isWidebandRate(metadata.actualSampleRateHz);
    const rate = channelSampleRate(metadata.actualSampleRateHz);
    const offset = wideband
      ? 0
      : metadata.selectedChannelFrequencyHz -
        metadata.hardwareCenterFrequencyHz;
    if (metadata.mode === "SRD") {
      this.srd ??= new SrdDigitalReceiver(
        ({ snapshot, diagnostics }) =>
          this.events.srdChanged?.(snapshot, diagnostics),
        (error) => this.events.runtimeError(error),
      );
      this.srd.configureSession(
        srdConfigurationForRoute(
          metadata.srd!,
          rate as DigitalInputSampleRateHz,
          offset,
          metadata.sessionGeneration,
        ),
      );
    }
    this.preparePackets(metadata);
    const digital =
      metadata.mode === "DAB"
        ? this.ensureDabResources().receiver
        : metadata.mode === "ADS-B"
          ? this.adsb
          : metadata.mode === "AIS"
          ? this.ais
          : metadata.mode === "SRD"
            ? this.srd
          : metadata.mode === "POCSAG" ? this.pocsag
          : metadata.mode === "APRS" ? this.aprs
          : isTextMode(metadata.mode) ? this.textModem
          : metadata.mode === "RS41" ? this.rs41
          : undefined;
    this.outputEnabled = metadata.mode !== "OFF";
    if (wideband && this.outputEnabled) {
      if (!this.channel)
        throw new Error(
          "Prepare the wideband channel worker before starting reception.",
        );
      void this.channel.configure(
        metadata.sessionGeneration,
        metadata.selectedChannelFrequencyHz -
          metadata.hardwareCenterFrequencyHz,
        metadata.actualSampleRateHz,
        metadata.source === "hackrf"
          ? "ci8"
          : metadata.source === "bladerf"
            ? "sc16"
            : metadata.source === "usrp-b205"
              ? "usrp-sc16"
            : false,
      );
    }
    // Configure first: rate rejection cannot replace the active decoder route.
    this.receiver.setDigitalReceiver(digital, rate, offset, metadata.mode === "CW-TEXT");
    if (metadata.mode !== "DAB") this.releaseDabResources();
    if (digital !== this.adsb) this.adsb.reset();
    if (digital !== this.ais) this.ais.reset();
    if (digital !== this.pocsag) this.pocsag?.reset();
    if (digital !== this.aprs) this.aprs?.reset();
    if (digital !== this.rs41) this.rs41?.reset();
    if (digital !== this.textModem) this.textModem?.reset();
    if (digital !== this.srd) this.srd?.reset({ reason: "reconfigure", missingInputSamples: null });
    if ((!digital || metadata.mode === "CW-TEXT") && this.outputEnabled)
      this.demodulator.setCwToneFrequency?.(metadata.beatToneHz ?? 600);
    if ((!digital || metadata.mode === "CW-TEXT") && this.outputEnabled)
      this.demodulator.setMode(
        createSignalsMode({
          mode: metadata.mode,
          bandwidthHz: metadata.channelBandwidthHz,
          squelch: metadata.squelch,
          beatToneHz: metadata.beatToneHz,
        }),
      );
    this.player.configure(metadata.actualSampleRateHz === 19_200_000);
    this.demodulator.setFrequencyOffset(offset + (metadata.mode === "CW-TEXT" ? metadata.textModem?.tuningOffsetHz ?? 0 : 0));
    this.rds.setEnabled(metadata.mode === "WBFM");
    this.rds.setFrequencyOffset(offset);
  }
  /** Synchronous invalidation precedes every hardware await/close. */
  reset(): void {
    ++this.secondaryEpoch;
    this.secondary?.close(); this.secondary = undefined;
    this.enabled = false;
    this.outputEnabled = false;
    this.player.reset();
    if (this.dabResources) {
      this.receiver.setDigitalReceiver(undefined, 2_400_000, 0);
      this.releaseDabResources();
    }
    this.rawAnalysis = undefined;
    this.channel?.close();
    this.channel = undefined;
    if (this.generation !== undefined) this.analysis?.stop(this.generation);
    this.generation = undefined;
    this.metadata = undefined;
    this.rds.reset();
    this.adsb.reset();
    this.ais.reset();
    this.srd?.reset();
    this.pocsag?.reset();
    this.aprs?.reset();
    this.rs41?.reset();
    this.textModem?.reset();
  }
  async suspend(): Promise<void> {
    if (this.audioContext.state === "running")
      await this.audioContext.suspend();
  }
  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.closeTask) return this.closeTask;
    this.closing = true;
    this.reset();
    const task = (async () => {
      this.srd?.dispose();
      this.pocsag?.dispose();
      this.aprs?.dispose();
      this.rs41?.dispose();
      this.textModem?.dispose();
      if (this.audioContext.state !== "closed") await this.audioContext.close();
      this.audioContext.removeEventListener("statechange", this.audioChanged);
      this.closed = true;
    })().finally(() => {
      if (this.closeTask === task) this.closeTask = undefined;
    });
    this.closeTask = task;
    return task;
  }
  private requireOpen(): void {
    if (this.closing)
      throw new DOMException("Live receiver was disconnected", "AbortError");
  }
  private readonly audioChanged = (): void =>
    this.events.audioStateChanged(this.audioContext.state);
}
