import { RadioAppSearch } from "./radioAppSearch";
import {
  searchFrequencies,
  sameAppModeSettings,
  type RadioAppSetup,
} from "./radioAppSetup";
import type { AnalysisPipeline } from "../dsp/analysisPipeline";
import { dabChannelAt } from "../dab/channels";
import { DabStationScan, type ScannedDabService } from "./dabStationScan";
import {
  planRadioApp,
  profileMatches,
  radioApp,
  type RadioAppId,
  type RadioAppPlan,
} from "./radioApps";
import type { ReceiverController } from "./receiverController";
import type { ReceiverMode } from "./receiverConfig";
import {
  validateSourceConfiguration,
  type SourceConfiguration,
} from "./sourceCapabilities";

export type AppConfiguration = SourceConfiguration & {
  modeSettings: NonNullable<SourceConfiguration["modeSettings"]>;
  sampleRateHz: number;
};
export interface RadioAppHost {
  configuration: AppConfiguration;
  volume: number;
  remote: boolean;
  blockedReason?: string;
  validateOperation(): void;
  applyDraft(configuration: AppConfiguration): void;
  openDecoder(reset: boolean): void;
  busyChanged(busy: boolean): void;
  scanChanged(scanning: boolean): void;
  volumeChanged(volume: number): void;
  startReception(): Promise<void>;
  stopReception(): Promise<void>;
  appChanged?(app: RadioAppLink | undefined): void;
}
export interface RadioAppLink {
  id: RadioAppId;
  name: string;
  mode: ReceiverMode;
}
interface Baseline {
  configuration: AppConfiguration;
  volume: number;
  centerFrequencyHz?: number;
  stopped: boolean;
  connectionIdentity?: number;
}
export interface RadioAppState {
  app?: RadioAppId;
  configuration?: AppConfiguration;
  setup?: RadioAppSetup;
  busy: boolean;
  issue: string;
  canRestore: boolean;
  awaitingProgramme: boolean;
  note?: string;
}

/** One shared-controller activity owner. Current host values are read at each
 * boundary; React render snapshots never authorize asynchronous hardware work. */
export class RadioAppSession {
  readonly scanner: DabStationScan;
  readonly searcher: RadioAppSearch;
  private state: RadioAppState = {
    busy: false,
    issue: "",
    canRestore: false,
    awaitingProgramme: false,
  };
  private listeners = new Set<() => void>();
  private baseline?: Baseline;
  private releaseAudio?: () => void;
  private playbackAbort?: AbortController;
  private operation = 0;
  private disposed = false;
  private transportIntent = 0;
  private unsubscribe?: () => void;
  private scanOriginal?: ScannedDabService;
  private restoreCenter?: {
    configuration: AppConfiguration;
    centerHz: number;
    connectionIdentity?: number;
  };
  constructor(
    private controller: ReceiverController,
    analysis: AnalysisPipeline,
    private host: () => RadioAppHost,
  ) {
    this.searcher = new RadioAppSearch(
      controller,
      analysis,
      () => this.guard(true),
      (frequencyHz) => {
        if (!this.state.configuration || this.disposed) return;
        const configuration = {
          ...this.state.configuration,
          channelFrequencyHz: frequencyHz,
        };
        this.host().applyDraft(configuration);
        this.publish({
          configuration,
          setup: this.state.setup
            ? { ...this.state.setup, frequencyHz }
            : undefined,
        });
      },
    );
    this.scanner = new DabStationScan(controller, analysis, () =>
      this.guard(true),
    );
  }
  attach() {
    this.disposed = false;
    this.unsubscribe?.();
    this.unsubscribe = this.controller.subscribe((snapshot) => {
      if (snapshot.lifecycle === "disconnecting")
        this.restoreCenter = undefined;
      const pending = this.restoreCenter;
      if (pending && snapshot.lifecycle === "running") {
        this.restoreCenter = undefined;
        if (profileMatches(snapshot, pending.configuration)) {
          const generation = snapshot.sessionGeneration,
            intent = this.operation;
          queueMicrotask(() => {
            if (this.disposed || intent !== this.operation) return;
            const current = this.controller.getSnapshot();
            if (
              current.lifecycle !== "running" ||
              current.sessionGeneration !== generation
            )
              return;
            if (
              pending.connectionIdentity !== undefined &&
              pending.connectionIdentity !==
                this.controller.getConnectionIdentity()
            ) {
              this.publish({
                issue:
                  "The saved capture center belongs to a previous receiver connection. Review it in Receiver.",
              });
              return;
            }
            void this.controller
              .tune(pending.configuration.channelFrequencyHz, {
                centerFrequencyHz: pending.centerHz,
              })
              .then(() => {
                const accepted = this.controller.getSnapshot();
                if (
                  accepted.lifecycle === "running" &&
                  accepted.session?.hardwareCenterFrequencyHz ===
                    pending.centerHz &&
                  profileMatches(accepted, pending.configuration)
                )
                  this.publish({ note: "Previous receiver setup restored." });
                else
                  this.publish({
                    issue:
                      "The saved capture center was not accepted. Review Capture center in Receiver.",
                  });
              });
          });
        }
      }
      if (
        ["idle", "connected"].includes(snapshot.lifecycle) ||
        (snapshot.lifecycle === "running" &&
          snapshot.session?.mode !== "DAB") ||
        (snapshot.lifecycle === "running" &&
          this.state.awaitingProgramme &&
          !this.state.busy &&
          this.scanner.getSnapshot().status !== "scanning" &&
          this.state.configuration &&
          !profileMatches(snapshot, this.state.configuration))
      ) {
        this.playbackAbort?.abort();
        this.releaseGate();
      }
    });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(update: Partial<RadioAppState>) {
    this.state = { ...this.state, ...update };
    if ("app" in update) {
      const app = update.app ? radioApp(update.app) : undefined;
      this.host().appChanged?.(
        app ? { id: app.id, name: app.name, mode: app.mode } : undefined,
      );
    }
    for (const listener of this.listeners) listener();
  }
  private guard(scanOwner = false) {
    const host = this.host(),
      s = this.controller.getSnapshot();
    host.validateOperation();
    if (host.remote)
      throw new Error(
        "Choose a local I/Q receiver in Receiver. Remote audio/FFT cannot run these apps.",
      );
    if (!scanOwner && host.blockedReason) throw new Error(host.blockedReason);
    if (
      !scanOwner &&
      (this.scanner.getSnapshot().status === "scanning" ||
        this.searcher.getSnapshot().status === "searching")
    )
      throw new Error(
        "Cancel the app search or station scan before changing apps or restoring settings.",
      );
    if (
      s.cleanupRequired ||
      s.hardwareSettingsPending ||
      this.controller.getRecordingStatus()
    )
      throw new Error(
        "Finish recording or receiver recovery before changing app settings.",
      );
    if (!["idle", "connected", "running", "error"].includes(s.lifecycle))
      throw new Error("Wait for the current receiver operation to finish.");
    if (s.session && s.session.source !== host.configuration.source)
      throw new Error("The receiver source changed. Open the app again.");
  }
  plan(id: RadioAppId, block: string, setup?: RadioAppSetup) {
    this.guard();
    return planRadioApp(
      id,
      this.host().configuration,
      this.controller.getSnapshot(),
      block,
      setup,
    );
  }
  private busy(value: boolean) {
    this.publish({ busy: value });
    this.host().busyChanged(value);
  }
  async start(): Promise<void> {
    if (this.state.busy) return;
    const intent = ++this.transportIntent;
    try {
      this.guard();
      const target = this.state.configuration,
        config = this.host().configuration;
      if (
        !target ||
        !this.state.app ||
        target.source !== config.source ||
        !sameAppModeSettings(target.modeSettings, config.modeSettings) ||
        target.channelFrequencyHz !== config.channelFrequencyHz ||
        target.sampleRateHz !== config.sampleRateHz
      )
        throw new Error(
          "Receiver settings changed. Open this app's setup before starting it.",
        );
      if (this.controller.getSnapshot().lifecycle === "running") return;
      this.busy(true);
      this.publish({ issue: "" });
      // Invoke immediately in the click's gesture stack, before awaiting any
      // unrelated work: the backend may need the native USB/audio permission.
      await this.host().startReception();
      if (intent !== this.transportIntent) return;
      const accepted = this.controller.getSnapshot();
      if (accepted.lifecycle !== "running" || !profileMatches(accepted, target))
        throw new Error(
          accepted.message ||
            "Reception did not start. Check the receiver setup.",
        );
    } catch (error) {
      if (intent === this.transportIntent)
        this.publish({
          issue:
            error instanceof Error
              ? error.message
              : "Reception could not start.",
        });
    } finally {
      if (intent === this.transportIntent) this.busy(false);
    }
  }
  async stop(): Promise<void> {
    ++this.operation;
    ++this.transportIntent;
    this.playbackAbort?.abort();
    this.busy(true);
    try {
      // Global Stop must not wait for a stalled tune or a scan dwell.
      const cancelling = Promise.all([
        this.scanner.cancel(false),
        this.searcher.cancel(false),
      ]);
      await this.host().stopReception();
      await cancelling;
      const stopped = this.controller.getSnapshot();
      this.publish({ issue: stopped.cleanupRequired ? stopped.message : "" });
    } catch (error) {
      this.publish({
        issue:
          error instanceof Error ? error.message : "Reception could not stop.",
      });
    } finally {
      this.busy(false);
    }
  }
  private captureBaseline() {
    if (this.baseline) return;
    const host = this.host(),
      s = this.controller.getSnapshot(),
      live = s.lifecycle === "running" ? s.session : undefined;
    this.baseline = {
      configuration: structuredClone({
        ...host.configuration,
        ...(live
          ? {
              channelFrequencyHz: live.selectedChannelFrequencyHz,
              sampleRateHz: live.requestedSampleRateHz,
              modeSettings: {
                mode: live.mode,
                bandwidthHz: live.channelBandwidthHz,
                squelch: live.squelch,
                beatToneHz: live.beatToneHz,
                srd: live.srd,
                textModem: live.textModem,
                pocsag: live.pocsag,
              },
            }
          : {}),
      }),
      volume: host.volume,
      centerFrequencyHz: live?.hardwareCenterFrequencyHz,
      stopped: !live,
      connectionIdentity: this.controller.getConnectionIdentity(),
    };
    this.publish({ canRestore: true });
  }
  cancelNavigation() {
    this.operation++;
  }
  async launch(
    id: RadioAppId,
    block: string,
    setup?: RadioAppSetup,
  ): Promise<boolean> {
    if (this.state.busy)
      throw new Error("An app operation is already running.");
    const plan = this.plan(id, block, setup),
      initial = this.controller.getSnapshot(),
      source = this.host().configuration.source;
    this.searcher.clear();
    const token = ++this.operation;
    const intent = this.transportIntent;
    this.restoreCenter = undefined;
    this.busy(true);
    this.publish({ issue: "", note: undefined });
    try {
      if (plan.action !== "navigate" && plan.action !== "replay")
        this.captureBaseline();
      const reset =
        this.state.app !== id ||
        !this.state.configuration ||
        !profileMatches(initial, this.state.configuration);
      await this.apply(plan, () => {
        if (this.disposed || intent !== this.transportIntent)
          throw new Error("App change cancelled by Stop.");
        this.guard(true);
        if (this.host().configuration.source !== source)
          throw new Error("Receiver source changed. App launch cancelled.");
      });
      this.publish({
        app: id,
        setup: plan.setup,
        configuration: plan.configuration as AppConfiguration,
      });
      if (token !== this.operation) return false;
      this.host().openDecoder(reset);
      return true;
    } catch (error) {
      if (this.disposed || intent !== this.transportIntent) return false;
      this.publish({
        issue: error instanceof Error ? error.message : "App launch failed.",
      });
      throw error;
    } finally {
      if (intent === this.transportIntent) this.busy(false);
    }
  }
  private async apply(plan: RadioAppPlan, guard: () => void) {
    guard();
    if (plan.action === "navigate" || plan.action === "replay") return;
    const target = plan.configuration as AppConfiguration;
    if (plan.action === "stop") {
      await this.controller.stop();
      guard();
      if (
        !["idle", "connected"].includes(this.controller.getSnapshot().lifecycle)
      )
        throw new Error("Could not stop reception. Use Receiver recovery.");
    } else if (plan.action === "live") {
      const s = this.controller.getSnapshot();
      this.controller.validateTune(target.channelFrequencyHz, {
        centerFrequencyHz: target.channelFrequencyHz,
      });
      this.controller.validateTune(
        target.channelFrequencyHz,
        { centerFrequencyHz: target.channelFrequencyHz },
        target.modeSettings,
      );
      await this.controller.tune(target.channelFrequencyHz, {
        centerFrequencyHz: target.channelFrequencyHz,
      });
      guard();
      const tuned = this.controller.getSnapshot();
      if (
        tuned.lifecycle !== "running" ||
        tuned.session?.selectedChannelFrequencyHz !==
          target.channelFrequencyHz ||
        tuned.session.hardwareCenterFrequencyHz !== target.channelFrequencyHz ||
        tuned.session.requestedSampleRateHz !== target.sampleRateHz ||
        (target.channelFrequencyHz !== s.session?.selectedChannelFrequencyHz &&
          tuned.sessionGeneration === s.sessionGeneration)
      )
        throw new Error(
          `The receiver did not accept the channel move. ${tuned.message}`,
        );
      await this.controller.configureMode(target.modeSettings);
      guard();
      if (
        this.controller.getSnapshot().lifecycle !== "running" ||
        !profileMatches(this.controller.getSnapshot(), target)
      )
        throw new Error(
          `The receiver did not accept the app profile. ${this.controller.getSnapshot().message}`,
        );
    }
    guard();
    this.host().applyDraft(target);
  }
  async restore(): Promise<void> {
    if (!this.baseline || this.state.busy) return;
    const intent = this.transportIntent;
    this.busy(true);
    this.publish({ issue: "" });
    try {
      this.guard();
      const base = this.baseline,
        host = this.host();
      if (base.configuration.source !== host.configuration.source)
        throw new Error(
          "The previous source is different. Review its settings manually in Receiver.",
        );
      if (
        base.connectionIdentity !== undefined &&
        base.connectionIdentity !== this.controller.getConnectionIdentity()
      )
        throw new Error(
          "The previous receiver connection is no longer available. Review its settings manually in Receiver.",
        );
      // Keep current explicit hardware power/input choices. Restore only receive
      // frequency/mode/rate; do not re-enable a saved supply after Stop.
      const target: AppConfiguration = {
        ...host.configuration,
        channelFrequencyHz: base.configuration.channelFrequencyHz,
        modeSettings: base.configuration.modeSettings,
        sampleRateHz: base.configuration.sampleRateHz,
      };
      validateSourceConfiguration(target);
      const s = this.controller.getSnapshot();
      if (s.lifecycle === "running") {
        // Stopping is an explicit part of Restore; no implicit acquisition start.
        await this.controller.stop();
        if (this.disposed || intent !== this.transportIntent) return;
        this.guard(true);
        if (
          !["idle", "connected"].includes(
            this.controller.getSnapshot().lifecycle,
          )
        )
          throw new Error("Restore needs receiver recovery first.");
      }
      this.host().applyDraft(target);
      this.host().volumeChanged(base.volume);
      if (
        base.centerFrequencyHz !== undefined &&
        base.centerFrequencyHz !== target.channelFrequencyHz
      )
        this.restoreCenter = {
          configuration: target,
          centerHz: base.centerFrequencyHz,
          connectionIdentity: this.controller.getConnectionIdentity(),
        };
      this.releaseGate();
      this.baseline = undefined;
      this.publish({
        app: undefined,
        configuration: undefined,
        canRestore: false,
        note: this.restoreCenter
          ? "Previous settings restored. Start reception manually to restore the saved capture center."
          : "Previous settings restored. Connect and Start remain manual.",
      });
    } catch (error) {
      if (this.disposed || intent !== this.transportIntent) return;
      this.publish({
        issue: error instanceof Error ? error.message : "Restore failed.",
      });
    } finally {
      if (intent === this.transportIntent) this.busy(false);
    }
  }
  private holdGate() {
    this.releaseAudio ??= this.controller.suppressAudio();
    this.publish({ awaitingProgramme: true });
  }
  private releaseGate() {
    this.releaseAudio?.();
    this.releaseAudio = undefined;
    if (this.state.awaitingProgramme)
      this.publish({ awaitingProgramme: false });
  }
  async search(direction: 1 | -1 = 1) {
    this.guard();
    const app = this.state.app,
      setup = this.state.setup,
      snapshot = this.controller.getSnapshot();
    if (
      (app !== "fm" && app !== "balloons") ||
      !setup ||
      !this.state.configuration ||
      !profileMatches(snapshot, this.state.configuration)
    )
      throw new Error(
        "Open a matching FM or Weather Balloons app before searching.",
      );
    this.captureBaseline();
    this.host().scanChanged(true);
    try {
      await this.searcher.run(
        searchFrequencies(app, setup, direction),
        app === "fm" ? "WBFM" : "RS41",
      );
    } finally {
      this.host().scanChanged(false);
      this.publish({ setup: this.state.setup });
    }
  }
  async scan(blocks?: Parameters<DabStationScan["run"]>[0]) {
    if (this.state.busy)
      throw new Error("Wait for the app operation to finish.");
    this.guard();
    const s = this.controller.getSnapshot(),
      dab = s.dab;
    if (
      s.lifecycle !== "running" ||
      s.session?.mode !== "DAB" ||
      s.session.source === "replay"
    )
      throw new Error("Start receiving in the DAB app before scanning.");
    if (s.secondaryVfo)
      throw new Error("Disable VFO B before scanning across DAB blocks.");
    this.captureBaseline();
    const station = dab?.stations?.find(
      (row) =>
        row.serviceId === dab.serviceId &&
        row.subchannelId === dab.subchannelId,
    );
    this.scanOriginal =
      station && dab?.ensemble
        ? {
            block:
              dabChannelAt(s.session.selectedChannelFrequencyHz)?.label ?? "",
            frequencyHz: s.session.selectedChannelFrequencyHz,
            ensembleId: dab.ensemble.id,
            ensembleLabel: dab.ensemble.label,
            key: station.key,
            serviceId: station.serviceId,
            subchannelId: station.subchannelId,
            label: station.label ?? station.key,
            playable: station.playable,
            dabPlus: station.dabPlus,
          }
        : undefined;
    this.holdGate();
    this.host().scanChanged(true);
    try {
      await this.scanner.run(blocks);
    } finally {
      this.host().scanChanged(false);
    }
  }
  async play(service: ScannedDabService) {
    await this.scanner.cancel();
    if (this.state.busy)
      throw new Error("Wait for the app operation to finish.");
    this.guard();
    this.busy(true);
    this.holdGate();
    this.playbackAbort?.abort();
    const abort = (this.playbackAbort = new AbortController());
    try {
      const s = this.controller.getSnapshot(),
        source = s.session?.source;
      if (
        s.lifecycle !== "running" ||
        s.session?.mode !== "DAB" ||
        source === "replay"
      )
        throw new Error(
          "Start live DAB reception before playing a scanned programme.",
        );
      const old = s.dab;
      if (s.session.selectedChannelFrequencyHz !== service.frequencyHz)
        await this.scanner.tuneBlock(service.frequencyHz);
      this.guard(true);
      const tuned = this.controller.getSnapshot();
      if (
        abort.signal.aborted ||
        tuned.lifecycle !== "running" ||
        !tuned.session ||
        tuned.session.source !== source ||
        tuned.session.selectedChannelFrequencyHz !== service.frequencyHz
      )
        throw new Error("Receiver changed while selecting a programme.");
      const alreadyFresh =
        s.sessionGeneration === tuned.sessionGeneration ? undefined : old;
      await this.scanner.observe(
        tuned.sessionGeneration,
        service.frequencyHz,
        abort.signal,
        alreadyFresh,
        service,
      );
      this.guard(true);
      this.controller.selectDabService(service.key);
      await new Promise<void>((resolve, reject) => {
        let unsubscribe = () => {};
        const done = (error?: Error) => {
          unsubscribe();
          clearTimeout(timer);
          abort.signal.removeEventListener("abort", cancelled);
          if (error) reject(error);
          else resolve();
        };
        const cancelled = () =>
          done(new Error("Programme selection cancelled."));
        const inspect = () => {
          const now = this.controller.getSnapshot(),
            selected = now.dab;
          if (
            now.lifecycle !== "running" ||
            now.sessionGeneration !== tuned.sessionGeneration
          )
            done(new Error("Receiver changed during programme selection."));
          else if (
            selected?.ensemble?.id === service.ensembleId &&
            selected.serviceId === service.serviceId &&
            selected.subchannelId === service.subchannelId
          )
            done();
        };
        unsubscribe = this.controller.subscribe(inspect);
        const timer = setTimeout(
          () =>
            done(
              new Error(
                "Programme selection was not acknowledged. Choose it again after discovery.",
              ),
            ),
          3000,
        );
        abort.signal.addEventListener("abort", cancelled, { once: true });
        inspect();
      });
      const configuration = {
        ...this.host().configuration,
        channelFrequencyHz: service.frequencyHz,
      };
      this.host().applyDraft(configuration);
      this.publish({ configuration, issue: "" });
      this.releaseGate();
    } catch (error) {
      this.publish({
        issue:
          error instanceof Error
            ? error.message
            : "Programme selection failed.",
      });
    } finally {
      this.playbackAbort = undefined;
      this.busy(false);
    }
  }
  async resumeProgramme() {
    if (this.scanOriginal) await this.play(this.scanOriginal);
    else
      this.publish({
        issue:
          "No previous decoded programme was selected. Choose a programme from the results or tune a block.",
      });
  }
  dispose() {
    this.disposed = true;
    this.restoreCenter = undefined;
    this.operation++;
    this.playbackAbort?.abort();
    void this.scanner.cancel(false);
    void this.searcher.cancel(false);
    ++this.transportIntent;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.releaseGate();
  }
  appName() {
    return this.state.app ? radioApp(this.state.app).name : "Radio Apps";
  }
}
