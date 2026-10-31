import type { AnalysisPipeline } from "../dsp/analysisPipeline";
import type {
  ReceiverController,
  ReceiverSnapshot,
} from "./receiverController";

export interface RadioAppSearchState {
  status: "idle" | "searching" | "found" | "complete" | "cancelled" | "error";
  visited: number;
  total: number;
  frequencyHz?: number;
  message: string;
}
const INITIAL: RadioAppSearchState = {
  status: "idle",
  visited: 0,
  total: 0,
  message: "",
};
export function channelEvidence(
  snapshot: ReceiverSnapshot,
  mode: "WBFM" | "RS41",
): string | undefined {
  if (mode === "WBFM")
    return snapshot.rds?.validGroups && snapshot.rds.pi
      ? `Received RDS · ${snapshot.rds.programmeService || snapshot.rds.pi}`
      : snapshot.fmStereoReception === "stereo"
        ? "FM stereo candidate · no validated RDS identity"
        : undefined;
  const frame = snapshot.rs41?.recentFrames.find(
    (f) =>
      f.fecStatus !== "rejected" &&
      f.variant !== "unsupported" &&
      f.provenance?.generation === snapshot.sessionGeneration &&
      f.subblockIntegrity.status &&
      f.sondeId,
  );
  return frame?.sondeId
    ? `Validated RS41 identity · ${frame.sondeId}`
    : undefined;
}
/** Finite explicit searches; one acknowledged shared receiver, no sample fan-out. */
export class RadioAppSearch {
  private state: RadioAppSearchState = INITIAL;
  private listeners = new Set<() => void>();
  private aborter?: AbortController;
  private task?: Promise<void>;
  private restore = true;
  constructor(
    private controller: ReceiverController,
    private analysis: Pick<AnalysisPipeline, "subscribeMeasurements">,
    private guard: () => void,
    private onTuned: (frequencyHz: number) => void,
    private budgets = {
      channelWallMs: 10_000,
      fmSeconds: 2,
      balloonSeconds: 3,
      fmTotalWallMs: 600_000,
      balloonTotalWallMs: 300_000,
    },
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  clear() {
    if (this.task) return;
    this.publish(INITIAL);
  }
  private publish(update: Partial<RadioAppSearchState>) {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }
  async cancel(restore = true) {
    if (!restore) this.restore = false;
    this.aborter?.abort();
    await this.task;
  }
  async run(frequencies: readonly number[], mode: "WBFM" | "RS41") {
    if (this.task) throw new Error("A channel search is already running.");
    this.guard();
    const initial = this.controller.getSnapshot(),
      source = initial.session?.source;
    if (
      initial.lifecycle !== "running" ||
      initial.session?.mode !== mode ||
      source === "replay" ||
      initial.secondaryVfo
    )
      throw new Error(
        "Start matching live reception and disable VFO B before searching.",
      );
    if (
      !frequencies.length ||
      frequencies.length > (mode === "WBFM" ? 206 : 64) ||
      new Set(frequencies).size !== frequencies.length ||
      frequencies.some((f) => !Number.isSafeInteger(f))
    )
      throw new Error("Choose a bounded set of valid search channels.");
    // Validate the whole route before the first hardware command.
    for (const frequency of frequencies)
      this.controller.validateTune(frequency, { centerFrequencyHz: frequency });
    const original = initial.session.selectedChannelFrequencyHz,
      signal = (this.aborter = new AbortController()).signal;
    this.restore = true;
    this.state = { ...INITIAL, status: "searching", total: frequencies.length };
    this.publish({});
    let generation = initial.sessionGeneration;
    const release = this.controller.suppressAudio();
    const current = () => {
      this.guard();
      const snapshot = this.controller.getSnapshot();
      if (
        snapshot.lifecycle !== "running" ||
        snapshot.session?.source !== source ||
        snapshot.session?.mode !== mode ||
        snapshot.sessionGeneration !== generation
      )
        throw new Error("Receiver context changed. Search stopped.");
      return snapshot;
    };
    const tune = async (frequency: number, wallMs: number) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.controller.tune(frequency, { centerFrequencyHz: frequency }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => {
                this.restore = false;
                void this.controller.stop();
                reject(
                  new Error(
                    "Channel tune timed out. Reception stopped; check Receiver recovery.",
                  ),
                );
              },
              Math.max(1, wallMs),
            );
          }),
        ]);
        const snapshot = this.controller.getSnapshot();
        if (
          snapshot.lifecycle !== "running" ||
          snapshot.session?.source !== source ||
          snapshot.session?.mode !== mode ||
          snapshot.session?.selectedChannelFrequencyHz !== frequency
        )
          throw new Error("Receiver did not accept the search channel.");
        generation = snapshot.sessionGeneration;
        if (!signal.aborted) this.onTuned(frequency);
      } finally {
        clearTimeout(timer);
      }
    };
    const started = Date.now(),
      totalWallMs =
        mode === "WBFM"
          ? this.budgets.fmTotalWallMs
          : this.budgets.balloonTotalWallMs;
    const task = (async () => {
      let found = false;
      try {
        for (const frequencyHz of frequencies) {
          if (signal.aborted) break;
          current();
          if (Date.now() - started >= totalWallMs)
            throw new Error("Search reached its total time limit.");
          this.publish({
            frequencyHz,
            message: `Searching ${this.state.visited + 1}/${frequencies.length} · ${frequencyHz / 1e6} MHz`,
          });
          const channelStarted = Date.now();
          const remaining = () =>
            Math.min(
              this.budgets.channelWallMs - (Date.now() - channelStarted),
              totalWallMs - (Date.now() - started),
            );
          await tune(frequencyHz, remaining());
          if (signal.aborted) break;
          const result = await this.observe(
            generation,
            mode,
            signal,
            Math.max(1, remaining()),
          );
          this.publish({ visited: this.state.visited + 1 });
          if (result) {
            found = true;
            this.publish({
              status: "found",
              message: `${result} · ${frequencyHz / 1e6} MHz`,
            });
            break;
          }
        }
        if (!found)
          this.publish({
            status: signal.aborted ? "cancelled" : "complete",
            message: signal.aborted
              ? "Search cancelled."
              : "No supported decoded signal found. Try direct tuning or a different window.",
          });
      } catch (error) {
        this.publish({
          status: signal.aborted ? "cancelled" : "error",
          message: signal.aborted
            ? "Search cancelled."
            : error instanceof Error
              ? error.message
              : "Channel search failed.",
        });
      } finally {
        if (!found && this.restore) {
          try {
            current();
            await tune(original, this.budgets.channelWallMs);
            this.onTuned(original);
          } catch {
            this.publish({
              message: `${this.state.message} Previous channel was not restored.`,
            });
          }
        }
        release();
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
  private observe(
    generation: number,
    mode: "WBFM" | "RS41",
    signal: AbortSignal,
    wallMs: number,
  ): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      let done = false,
        first: number | undefined,
        seconds = 0;
      const cleanups: (() => void)[] = [];
      const finish = (result?: string, error?: unknown) => {
        if (done) return;
        done = true;
        for (const cleanup of cleanups.splice(0)) cleanup();
        if (error) reject(error);
        else resolve(result);
      };
      const inspect = () => {
        if (signal.aborted) {
          finish();
          return;
        }
        try {
          this.guard();
          const snapshot = this.controller.getSnapshot();
          if (
            snapshot.lifecycle !== "running" ||
            snapshot.sessionGeneration !== generation ||
            snapshot.session?.mode !== mode
          )
            throw new Error("Receiver changed during channel observation.");
          const evidence = channelEvidence(snapshot, mode);
          if (evidence) finish(evidence);
          else if (
            seconds >=
            (mode === "WBFM"
              ? this.budgets.fmSeconds
              : this.budgets.balloonSeconds)
          )
            finish();
        } catch (error) {
          finish(undefined, error);
        }
      };
      cleanups.push(this.controller.subscribe(inspect));
      cleanups.push(
        this.analysis.subscribeMeasurements((frame) => {
          if (
            frame.sessionGeneration !== generation ||
            !Number.isFinite(frame.sampleIndex) ||
            !(frame.sampleRateHz > 0)
          )
            return;
          first ??= frame.sampleIndex;
          seconds = Math.max(
            seconds,
            (frame.sampleIndex - first) / frame.sampleRateHz,
          );
          inspect();
        }, true),
      );
      const abort = () => finish();
      signal.addEventListener("abort", abort, { once: true });
      cleanups.push(() => signal.removeEventListener("abort", abort));
      const timeout = setTimeout(
        () =>
          finish(
            undefined,
            new Error("No acquired data before the channel time limit."),
          ),
        wallMs,
      );
      cleanups.push(() => clearTimeout(timeout));
      inspect();
    });
  }
}
