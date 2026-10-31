import { DAB_BAND_III_CHANNELS, type DabChannel } from "../dab/channels";
import type { DabStation } from "../dab/dabChannelCoding";
import type { DabSnapshot } from "../dab/dabReceiver";
import type { AnalysisPipeline } from "../dsp/analysisPipeline";
import type { ReceiverController } from "./receiverController";

export interface ScannedDabService {
  block: string;
  frequencyHz: number;
  ensembleId: number;
  ensembleLabel: string;
  key: string;
  serviceId: number;
  subchannelId: number;
  label: string;
  playable: boolean;
  dabPlus: boolean;
  bitrateKbps?: number;
}
export interface DabScanState {
  status: "idle" | "scanning" | "complete" | "cancelled" | "error";
  block?: string;
  visited: number;
  total: number;
  services: readonly ScannedDabService[];
  message: string;
  overflow: boolean;
}
export const DAB_SCAN_INITIAL: DabScanState = {
  status: "idle",
  visited: 0,
  total: 0,
  services: [],
  message: "",
  overflow: false,
};
export interface DabScanBudgets {
  minimumSeconds: number;
  maximumSeconds: number;
  stableSeconds: number;
  blockWallMs: number;
  totalWallMs: number;
}
const DEFAULT_BUDGETS: DabScanBudgets = {
  minimumSeconds: 2,
  maximumSeconds: 6,
  stableSeconds: 1,
  blockWallMs: 15_000,
  totalWallMs: 600_000,
};
const abortError = () =>
  new DOMException("Station scan cancelled", "AbortError");

/** Only decoded FIC/service records enter the bounded list. No RF samples or
 * artwork are copied. Clock measurements are subscribed only during a dwell. */
export class DabStationScan {
  private state: DabScanState = DAB_SCAN_INITIAL;
  private listeners = new Set<() => void>();
  private aborter?: AbortController;
  private task?: Promise<void>;
  private allowRestore = true;
  constructor(
    private controller: ReceiverController,
    private analysis: Pick<AnalysisPipeline, "subscribeMeasurements">,
    private guard: () => void,
    private budgets = DEFAULT_BUDGETS,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(update: Partial<DabScanState>) {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }
  async cancel(restore = true): Promise<void> {
    if (!restore) this.allowRestore = false;
    this.aborter?.abort();
    await this.task;
  }
  async tuneBlock(
    frequencyHz: number,
    wallMs = this.budgets.blockWallMs,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.controller.tune(frequencyHz, { centerFrequencyHz: frequencyHz }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              this.allowRestore = false;
              // Invalidate the in-flight command generation before any late ack.
              // Recovery keeps its normal ownership/cleanup-required semantics.
              void this.controller.stop();
              reject(
                new Error(
                  "DAB tuning timed out. Reception was stopped; review Receiver recovery.",
                ),
              );
            },
            Math.max(1, wallMs),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async run(
    blocks: readonly DabChannel[] = DAB_BAND_III_CHANNELS,
  ): Promise<void> {
    if (this.task) throw new Error("A station scan is already running.");
    this.guard();
    const initial = this.controller.getSnapshot();
    if (
      initial.lifecycle !== "running" ||
      initial.session?.mode !== "DAB" ||
      initial.session.source === "replay"
    )
      throw new Error("Start live DAB reception before scanning.");
    const unique = [...new Map(blocks.map((b) => [b.frequencyHz, b])).values()];
    if (
      !unique.length ||
      unique.length > 38 ||
      unique.some(
        (b) =>
          !DAB_BAND_III_CHANNELS.some(
            (c) => c.label === b.label && c.frequencyHz === b.frequencyHz,
          ),
      )
    )
      throw new Error("Choose between 1 and 38 supported DAB blocks.");
    this.aborter = new AbortController();
    this.allowRestore = true;
    const signal = this.aborter.signal,
      source = initial.session.source,
      started = Date.now();
    const originalFrequency = initial.session.selectedChannelFrequencyHz;
    this.state = {
      ...DAB_SCAN_INITIAL,
      status: "scanning",
      total: unique.length,
    };
    this.publish({
      message: "Scanning decoded ensembles. Audio is suppressed.",
    });
    const task = (async () => {
      let expectedGeneration = initial.sessionGeneration;
      try {
        for (const block of unique) {
          if (signal.aborted) throw abortError();
          this.guard();
          const before = this.controller.getSnapshot();
          if (
            before.lifecycle !== "running" ||
            before.session?.source !== source ||
            before.sessionGeneration !== expectedGeneration
          )
            throw new Error("Receiver context changed. Scan stopped.");
          if (Date.now() - started > this.budgets.totalWallMs)
            throw new Error(
              "Station scan reached its total time limit. Partial results retained.",
            );
          this.publish({
            block: block.label,
            message: `Block ${this.state.visited + 1} of ${unique.length} · ${block.label}`,
          });
          const oldDab = before.dab;
          const blockStarted = Date.now();
          const remaining = () =>
            Math.min(
              this.budgets.blockWallMs - (Date.now() - blockStarted),
              this.budgets.totalWallMs - (Date.now() - started),
            );
          await this.tuneBlock(block.frequencyHz, remaining());
          const tuned = this.controller.getSnapshot();
          expectedGeneration = tuned.sessionGeneration;
          if (signal.aborted) throw abortError();
          if (
            tuned.lifecycle !== "running" ||
            tuned.session?.source !== source ||
            tuned.session.mode !== "DAB" ||
            tuned.session.selectedChannelFrequencyHz !== block.frequencyHz ||
            tuned.session.hardwareCenterFrequencyHz !== block.frequencyHz
          )
            throw new Error(
              tuned.message || "The receiver did not accept this scan block.",
            );
          const dab = await this.observe(
            expectedGeneration,
            block.frequencyHz,
            signal,
            oldDab,
            undefined,
            Math.max(1, remaining()),
          );
          if (dab?.ensemble && (dab.ficBlockCount ?? 0) > 0)
            this.add(block, dab);
          this.publish({ visited: this.state.visited + 1 });
        }
        this.publish({
          status: "complete",
          message:
            "Scan finished. Results are observations during this scan; service lists may be incomplete. Choose a station to listen.",
        });
      } catch (error) {
        this.publish({
          status: signal.aborted ? "cancelled" : "error",
          message: signal.aborted
            ? "Scan stopped. Partial results retained. Choose a station or resume your previous programme."
            : error instanceof Error
              ? error.message
              : "Station scan failed.",
        });
      } finally {
        // Stop/source changes invalidate ownership. Never restore after those.
        const current = this.controller.getSnapshot();
        if (
          this.allowRestore &&
          current.lifecycle === "running" &&
          !current.cleanupRequired &&
          current.session?.source === source &&
          current.session.mode === "DAB" &&
          current.sessionGeneration === expectedGeneration
        ) {
          try {
            this.guard();
            await this.tuneBlock(originalFrequency);
            const restored = this.controller.getSnapshot();
            if (
              restored.lifecycle !== "running" ||
              restored.session?.selectedChannelFrequencyHz !== originalFrequency
            )
              this.publish({
                message: `${this.state.message} Previous block could not be restored.`,
              });
          } catch {
            this.publish({
              message: `${this.state.message} Previous block could not be restored.`,
            });
          }
        }
      }
    })();
    this.task = task;
    try {
      await task;
    } finally {
      this.task = undefined;
      this.aborter = undefined;
    }
  }
  private add(block: DabChannel, dab: DabSnapshot) {
    const rows = new Map(
      this.state.services.map((s) => [
        `${s.frequencyHz}:${s.ensembleId}:${s.key}`,
        s,
      ]),
    );
    for (const station of dab.stations ?? []) {
      const id = `${block.frequencyHz}:${dab.ensemble!.id}:${station.key}`;
      if (rows.size >= 256 && !rows.has(id)) {
        this.publish({ overflow: true });
        break;
      }
      const row: ScannedDabService = {
        block: block.label,
        frequencyHz: block.frequencyHz,
        ensembleId: dab.ensemble!.id,
        ensembleLabel: (
          dab.ensemble!.label || `Ensemble 0x${dab.ensemble!.id.toString(16)}`
        ).slice(0, 128),
        key: station.key.slice(0, 40),
        serviceId: station.serviceId,
        subchannelId: station.subchannelId,
        label: (
          station.label || `Service 0x${station.serviceId.toString(16)}`
        ).slice(0, 128),
        playable: station.playable,
        dabPlus: station.dabPlus,
        bitrateKbps: station.bitrateKbps,
      };
      rows.set(id, row);
      if (
        new TextEncoder().encode(JSON.stringify([...rows.values()])).length >
        128 * 1024
      ) {
        rows.delete(id);
        this.publish({ overflow: true });
        break;
      }
    }
    this.publish({ services: [...rows.values()] });
  }
  /** Stable means the ID/service signature has not changed for one acquired
   * second, with valid FIC and >=2 acquired seconds. Never a completeness claim. */
  observe(
    generation: number,
    frequencyHz: number,
    signal: AbortSignal,
    oldDab?: DabSnapshot,
    wanted?: ScannedDabService,
    wallMs = this.budgets.blockWallMs,
  ): Promise<DabSnapshot | undefined> {
    return new Promise((resolve, reject) => {
      let firstIndex: number | undefined,
        seconds = 0,
        signature = "",
        stableAt = 0,
        dab: DabSnapshot | undefined,
        done = false;
      const cleanups: (() => void)[] = [];
      const finish = (error?: unknown) => {
        if (done) return;
        done = true;
        for (const cleanup of cleanups.splice(0)) cleanup();
        if (error) reject(error);
        else resolve(dab);
      };
      const inspect = () => {
        if (done) return;
        if (signal.aborted) {
          finish(abortError());
          return;
        }
        try {
          this.guard();
        } catch (error) {
          finish(error);
          return;
        }
        const current = this.controller.getSnapshot();
        if (
          current.lifecycle !== "running" ||
          current.sessionGeneration !== generation ||
          current.session?.mode !== "DAB" ||
          current.session.selectedChannelFrequencyHz !== frequencyHz
        ) {
          finish(new Error("Receiver changed while reading a DAB block."));
          return;
        }
        if (
          current.dab &&
          current.dab !== oldDab &&
          (current.dab.ficBlockCount ?? 0) > 0
        )
          dab = current.dab;
        if (
          wanted &&
          dab?.ensemble?.id === wanted.ensembleId &&
          dab.stations?.some((s) => this.matchesService(s, wanted))
        ) {
          finish();
          return;
        }
        const next = dab?.ensemble
          ? JSON.stringify([
              dab.ensemble.id,
              (dab.stations ?? []).map((s) => [s.key, s.label, s.playable]),
            ])
          : "";
        if (next !== signature) {
          signature = next;
          stableAt = seconds;
        }
        if (
          !wanted &&
          seconds >= this.budgets.minimumSeconds &&
          (dab?.stations?.length ?? 0) > 0 &&
          seconds - stableAt >= this.budgets.stableSeconds
        )
          finish();
        else if (seconds >= this.budgets.maximumSeconds)
          finish(
            wanted
              ? new Error(
                  "The selected programme was not found in fresh ensemble data. Rescan or choose another station.",
                )
              : undefined,
          );
      };
      cleanups.push(this.controller.subscribe(inspect));
      cleanups.push(
        this.analysis.subscribeMeasurements((frame) => {
          if (frame.sessionGeneration !== generation) return;
          firstIndex ??= frame.sampleIndex;
          seconds = Math.max(
            seconds,
            (frame.sampleIndex - firstIndex) / frame.sampleRateHz,
          );
          inspect();
        }, true),
      );
      const abort = () => finish(abortError());
      signal.addEventListener("abort", abort, { once: true });
      cleanups.push(() => signal.removeEventListener("abort", abort));
      const timeout = setTimeout(
        () =>
          finish(
            new Error(
              "Timed out waiting for acquired DAB data. Check reception; partial results retained.",
            ),
          ),
        wallMs,
      );
      cleanups.push(() => clearTimeout(timeout));
      inspect();
    });
  }
  private matchesService(station: DabStation, wanted: ScannedDabService) {
    return (
      station.key === wanted.key &&
      station.serviceId === wanted.serviceId &&
      station.subchannelId === wanted.subchannelId &&
      station.playable
    );
  }
}
