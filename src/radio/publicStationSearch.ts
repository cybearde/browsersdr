import { PublicCatalogError, PublicStationClient } from "./publicStationClient";
import {
  publicQueryParams,
  type PublicStationPage,
  type PublicStationQuery,
} from "./publicStations";
export interface PublicSearchState {
  status: "idle" | "loading" | "ready" | "error";
  page?: PublicStationPage;
  pageIndex: number;
  previous: boolean;
  next: boolean;
  message?: string;
}
export class PublicStationSearch {
  private snapshot: PublicSearchState = {
    status: "idle",
    pageIndex: 0,
    previous: false,
    next: false,
  };
  private query: PublicStationQuery = {};
  private cursors: Array<string | undefined> = [undefined];
  private generation = 0;
  private catalogRevision?: string;
  private targetIndex = 0;
  private aborter?: AbortController;
  private readonly listeners = new Set<() => void>();
  constructor(readonly client: PublicStationClient) {}
  getQuery = () => ({ ...this.query, cursor: undefined });
  getSnapshot = () => this.snapshot;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  cancel() {
    this.generation++;
    this.aborter?.abort();
    this.aborter = undefined;
  }
  clear() {
    this.cancel();
    this.cursors = [undefined];
    this.publish({
      status: "idle",
      pageIndex: 0,
      previous: false,
      next: false,
    });
  }
  async search(query: PublicStationQuery) {
    publicQueryParams(query);
    this.query = { ...query, cursor: undefined };
    this.cursors = [undefined];
    this.catalogRevision = undefined;
    await this.load(0);
  }
  async next() {
    if (!this.snapshot.next || this.snapshot.status !== "ready") return;
    const index = this.snapshot.pageIndex + 1;
    this.cursors[index] = this.snapshot.page!.next_cursor!;
    await this.load(index);
  }
  async previous() {
    if (this.snapshot.previous && this.snapshot.status === "ready")
      await this.load(this.snapshot.pageIndex - 1);
  }
  retry() {
    return this.load(this.targetIndex);
  }
  private async load(index: number) {
    this.targetIndex = index;
    this.cancel();
    const generation = this.generation,
      aborter = new AbortController();
    this.aborter = aborter;
    const revision = this.catalogRevision;
    this.publish({
      status: "loading",
      pageIndex: index,
      previous: false,
      next: false,
    });
    try {
      const page = await this.client.list(
        { ...this.query, cursor: this.cursors[index] },
        aborter.signal,
      );
      if (generation !== this.generation || aborter.signal.aborted) return;
      if (revision && page.catalog_revision !== revision)
        throw new Error(
          "The public catalog changed. Search again to refresh the results.",
        );
      this.catalogRevision = page.catalog_revision;
      const repeated =
        page.next_cursor !== null &&
        this.cursors.slice(0, index + 1).includes(page.next_cursor);

      this.publish({
        status: "ready",
        page,
        pageIndex: index,
        previous: index > 0,
        next: !!page.next_cursor && !repeated,
        message: repeated
          ? "Repeated cursor received. Narrow the query and search again."
          : undefined,
      });
    } catch (error) {
      if (generation !== this.generation || aborter.signal.aborted) return;
      if (
        (error instanceof PublicCatalogError &&
          [404, 409, 422].includes(error.status)) ||
        (error instanceof Error && error.message.includes("catalog changed"))
      ) {
        this.cursors = [undefined];
        this.catalogRevision = undefined;
        this.targetIndex = 0;
      }
      this.publish({
        status: "error",
        pageIndex: 0,
        previous: false,
        next: false,
        message:
          error instanceof Error
            ? error.message
            : "Public catalog unavailable. Retry later.",
      });
    }
  }
  private publish(value: PublicSearchState) {
    this.snapshot = value;
    this.listeners.forEach((fn) => fn());
  }
}
