import { PublicCatalogError, PublicStationClient } from "./publicStationClient";
import {
  malformedPublicResponse,
  type PublicStation,
  type PublicStationQuery,
  type PublicTransmissionPage,
} from "./publicStations";
export interface PublicTransmissionState {
  status: "idle" | "loading" | "ready" | "error";
  page?: PublicTransmissionPage;
  pageIndex: number;
  previous: boolean;
  next: boolean;
  message?: string;
  restart: boolean;
}
/** One station/filter/generation owns all cursor positions. Only the visible page is rendered. */
export class PublicTransmissionSearch {
  private snapshot: PublicTransmissionState = {
    status: "idle",
    pageIndex: 0,
    previous: false,
    next: false,
    restart: false,
  };
  private cursors: Array<string | undefined> = [undefined];
  private pages = new Map<number, { ids: string[]; offset: number }>();
  private generation = 0;
  private aborter?: AbortController;
  private readonly listeners = new Set<() => void>();
  constructor(
    private readonly client: PublicStationClient,
    private readonly station: PublicStation,
    private readonly catalogRevision: string,
    private readonly total: number,
    private readonly query: PublicStationQuery,
  ) {}
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
  }
  async load(index = 0) {
    if (this.snapshot.restart) return;
    this.cancel();
    const generation = this.generation,
      aborter = new AbortController();
    this.aborter = aborter;
    this.publish({
      status: "loading",
      pageIndex: index,
      previous: false,
      next: false,
      restart: false,
    });
    try {
      const page = await this.client.transmissions(
        this.station.id,
        { ...this.query, cursor: this.cursors[index] },
        aborter.signal,
      );
      if (generation !== this.generation || aborter.signal.aborted) return;
      if (
        page.catalog_revision !== this.catalogRevision ||
        page.publication_version !== this.station.publication_version ||
        page.total !== this.total
      )
        throw new PublicCatalogError(409, "catalog_changed");
      const previous = this.pages.get(index - 1);
      const offset =
        index === 0
          ? 0
          : previous
            ? previous.offset + previous.ids.length
            : malformedPublicResponse();
      const ids = page.items.map((row) => row.id);
      const otherIds = new Set(
        [...this.pages.entries()]
          .filter(([n]) => n !== index)
          .flatMap(([, row]) => row.ids),
      );
      if (
        ids.some((id) => otherIds.has(id)) ||
        offset + ids.length > page.total ||
        (page.next_cursor === null && offset + ids.length !== page.total) ||
        (page.next_cursor !== null && offset + ids.length >= page.total) ||
        (page.next_cursor !== null &&
          this.cursors.slice(0, index + 1).includes(page.next_cursor))
      )
        malformedPublicResponse();
      this.pages.set(index, { ids, offset });
      if (page.next_cursor) this.cursors[index + 1] = page.next_cursor;
      this.publish({
        status: "ready",
        page,
        pageIndex: index,
        previous: index > 0,
        next: page.next_cursor !== null,
        restart: false,
      });
    } catch (error) {
      if (generation !== this.generation || aborter.signal.aborted) return;
      const restart =
        error instanceof PublicCatalogError &&
        [404, 409, 422].includes(error.status);
      if (restart) {
        this.cursors = [undefined];
        this.pages.clear();
      }
      this.publish({
        status: "error",
        pageIndex: index,
        previous: false,
        next: false,
        restart,
        message:
          error instanceof Error
            ? error.message
            : "Public references unavailable. Retry later.",
      });
    }
  }
  retry() {
    return this.load(this.snapshot.pageIndex);
  }
  next() {
    if (this.snapshot.status === "ready" && this.snapshot.next)
      return this.load(this.snapshot.pageIndex + 1);
  }
  previous() {
    if (this.snapshot.status === "ready" && this.snapshot.previous)
      return this.load(this.snapshot.pageIndex - 1);
  }
  private publish(value: PublicTransmissionState) {
    this.snapshot = value;
    this.listeners.forEach((fn) => fn());
  }
}
