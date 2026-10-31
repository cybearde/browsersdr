import { InstrumentButton } from "./InstrumentButton";
import { matchingRadioApps, type RadioAppId } from "../radio/radioApps";
import {
  readFrequencySourceMode,
  saveFrequencySourceMode,
  type FrequencySourceMode,
  type SavedFrequencyCatalog,
  type FrequencyCatalogUpdate,
} from "../radio/publicFrequencyCatalog";
import { DeferredWorkspace } from "./DeferredWorkspace";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  lazy,
  Suspense,
} from "react";
import { createPortal } from "react-dom";
import { AppIcon } from "./AppIcon";
import { useOverlayDialog } from "./useOverlayDialog";
import { atlasStationUrl } from "../radio/atlasStationNavigation";
import { PublicStationClient } from "../radio/publicStationClient";
import { PublicStationSearch } from "../radio/publicStationSearch";
import { rankPublicStations } from "../radio/publicStationRelevance";
import { PublicTransmissionSearch } from "../radio/publicTransmissionSearch";
import type {
  PublicSource,
  PublicStation,
  PublicStationReferences,
  PublicStationQuery,
  PublicReferenceLocation,
} from "../radio/publicStations";
import {
  discoveryQuery,
  guideBookmark,
  matchingGuides,
  normalizeDiscoveryText,
  parseDiscoveryFrequency,
} from "../radio/discoveryGuides";
import {
  publicReceptionCandidate,
  unchangedPublicReference,
} from "../radio/discoverySelection";
import { bookmarkFromCandidate, type Bookmark } from "../radio/bookmarks";
import type { ReceptionCandidate } from "../radio/receptionEvidence";
import type { ReceiverMode } from "../radio/receiverConfig";
import type { SharedFrequencyGuide } from "../radio/sharedFrequencyGuides";
import "./SearchOverlay.css";
import {
  ANTENNA_GUIDES,
  type AntennaContext,
  type AntennaGuideId,
} from "../radio/antennaGuide";
const AntennaGuide = lazy(() =>
  import("./AntennaGuide").then((module) => ({ default: module.AntennaGuide })),
);
interface Preview {
  bookmark: Bookmark;
  station?: PublicStationReferences;
  referenceId?: string;
  location?: PublicReferenceLocation;
  context: string;
  catalogRevision?: string;
}
function FrequencyRows({
  rows,
  mode,
  choose,
}: {
  rows: SharedFrequencyGuide[];
  mode: ReceiverMode;
  choose: (bookmark: Bookmark) => void;
}) {
  return rows.map((row) => {
    const previewMode = row.recommendedMode ?? mode;
    return (
      <article key={row.id} aria-label={row.name}>
        <h4>{row.name}</h4>
        <p>
          <strong>{row.context}</strong>
          {row.frequencyMeaning === "receiver_dial" && " · USB dial frequency"}
        </p>
        {row.direction && <p>Direction / use: {row.direction}</p>}
        {row.bandwidthHz !== null && (
          <p>
            Signal bandwidth: {(row.bandwidthHz / 1000).toLocaleString()} kHz
            {row.spreadingFactor !== null && <> · SF{row.spreadingFactor}</>}
            {row.codingRate !== null && <> · CR {row.codingRate}</>}
          </p>
        )}
        {row.channelSpacingHz !== null && (
          <p>Channel spacing: {row.channelSpacingHz / 1000} kHz</p>
        )}
        <p>{row.notes}</p>
        <p className="display-note">
          <a href={row.url} target="_blank" rel="noopener noreferrer">
            {row.publisher}
          </a>{" "}
          · Reviewed {row.reviewedOn}
        </p>
        <InstrumentButton
          type="button"
          className="secondary"
          onClick={() =>
            choose(guideBookmark(row.name, previewMode, row.frequencyHz))
          }
        >
          Preview {row.frequencyHz / 1e6} MHz with {previewMode}
        </InstrumentButton>
      </article>
    );
  });
}
function FrequencyPlan({
  name,
  rows,
  mode,
  choose,
}: {
  name: string;
  rows: SharedFrequencyGuide[];
  mode: ReceiverMode;
  choose: (bookmark: Bookmark) => void;
}) {
  const [expanded, setExpanded] = useState(rows.length <= 8);
  return (
    <details
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        {name} · {rows.length} frequency profiles
      </summary>
      {expanded && <FrequencyRows rows={rows} mode={mode} choose={choose} />}
    </details>
  );
}
export interface SearchOverlayProps {
  onRadioApp?: (app: RadioAppId) => void;
  /** Caller supplies all preview-relevant settings so unrelated RF progress need not rerender Search. */
  validationKey?: string;
  antennaContext?: AntennaContext;
  favorites: Bookmark[];
  frequencyHz: number;
  mode: ReceiverMode;
  contextKey: string;
  blockedReason?: string;
  onPreview: (bookmark: Bookmark) => string;
  onRecall: (bookmark: Bookmark) => Promise<string>;
  onUseStation: (candidate: ReceptionCandidate) => Promise<string>;
  onFavorite: (candidate: ReceptionCandidate) => void;
  client?: PublicStationClient;
}
function Sources({ sources }: { sources: PublicSource[] }) {
  return (
    <ul className="discovery-sources">
      {sources.map((source, index) => (
        <li key={index}>
          {source.url ? (
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {source.publisher}
            </a>
          ) : (
            source.publisher
          )}
          {" · "}Published: {source.published_on ?? "unknown"} · Retrieved:{" "}
          {source.retrieved_at ?? "unknown"} · Reviewed:{" "}
          {source.reviewed_at ?? "unknown"}
        </li>
      ))}
    </ul>
  );
}
function StationReferences({
  client,
  station,
  catalogRevision,
  total,
  query,
  choose,
  onFavorite,
  onMessage,
}: {
  client: PublicStationClient;
  station: PublicStation;
  catalogRevision: string;
  total: number;
  query: PublicStationQuery;
  choose: (
    bookmark: Bookmark,
    station?: PublicStationReferences,
    referenceId?: string,
    location?: PublicReferenceLocation,
  ) => void;
  onFavorite: SearchOverlayProps["onFavorite"];
  onMessage: (message: string) => void;
}) {
  const [pager] = useState(
    () =>
      new PublicTransmissionSearch(
        client,
        station,
        catalogRevision,
        total,
        query,
      ),
  );
  const state = useSyncExternalStore(pager.subscribe, pager.getSnapshot);
  useEffect(() => () => pager.cancel(), [pager]);
  return (
    <section aria-label={`References for ${station.name}`}>
      <p>
        {total} matching references · {station.transmission_count} published in
        total.
      </p>
      {state.status === "idle" && (
        <InstrumentButton
          type="button"
          className="secondary"
          onClick={() => void pager.load()}
        >
          Show references for {station.name}
        </InstrumentButton>
      )}
      {state.status === "loading" && (
        <p role="status">Loading published references…</p>
      )}
      {state.message && <p role="alert">{state.message}</p>}
      {state.status === "error" &&
        (state.restart ? (
          <p>Search Atlas again to refresh this station and its references.</p>
        ) : (
          <InstrumentButton
            type="button"
            className="secondary"
            onClick={() => void pager.retry()}
          >
            Retry references
          </InstrumentButton>
        ))}
      {state.status === "ready" && (
        <>
          <p role="status">
            Reference page {state.pageIndex + 1} · {state.page!.items.length} of{" "}
            {state.page!.total} matching references
          </p>
          {!state.page!.total && (
            <p>No published transmission references match these filters.</p>
          )}
          {state.page!.items.map((reference) => {
            const selected = { ...station, transmissions: [reference] };
            const location = pager.getLocation();
            let candidate: ReceptionCandidate | undefined;
            try {
              candidate = publicReceptionCandidate(selected, reference.id);
            } catch {
              /* Unsupported declared mode is readable, never guessed. */
            }
            return (
              <div key={reference.id} className="discovery-reference">
                <p>
                  <strong>
                    {reference.frequency_hz / 1e6} MHz ·{" "}
                    {reference.broadcast_format ?? "Unknown format"}
                  </strong>{" "}
                  ·{" "}
                  {[
                    reference.site?.name,
                    reference.site?.place_name,
                    reference.site?.country,
                  ]
                    .filter(Boolean)
                    .join(", ") || "Site unknown"}
                </p>
                <p className="display-note">
                  Validity: {reference.valid_from ?? "unknown"} to{" "}
                  {reference.valid_to ?? "unknown"}. Source dates and validity
                  do not prove current RF activity.
                </p>
                <Sources sources={reference.sources} />
                <a
                  href={atlasStationUrl(station.id, reference.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open exact Atlas reference
                </a>
                {candidate ? (
                  <div className="discovery-actions">
                    <InstrumentButton
                      type="button"
                      className="secondary"
                      onClick={() =>
                        choose(
                          bookmarkFromCandidate(candidate!),
                          selected,
                          reference.id,
                          location,
                        )
                      }
                    >
                      Preview {reference.frequency_hz / 1e6} MHz
                    </InstrumentButton>
                    <InstrumentButton
                      type="button"
                      className="secondary"
                      onClick={() => {
                        try {
                          onFavorite(candidate!);
                          onMessage(
                            "Station favorite saved locally; public reference is not revalidated by saving.",
                          );
                        } catch (error) {
                          onMessage(
                            error instanceof Error
                              ? error.message
                              : "Could not save favorite.",
                          );
                        }
                      }}
                    >
                      Save station favorite
                    </InstrumentButton>
                  </div>
                ) : (
                  <p>
                    Station handoff unavailable for this declared format. Use a
                    compatible local guide without attaching station identity.
                  </p>
                )}
              </div>
            );
          })}
          <nav
            className="discovery-actions"
            aria-label="Public reference pages"
          >
            <InstrumentButton
              type="button"
              className="secondary"
              disabled={!state.previous}
              onClick={() => void pager.previous()}
            >
              Previous references
            </InstrumentButton>
            <InstrumentButton
              type="button"
              className="secondary"
              disabled={!state.next}
              onClick={() => void pager.next()}
            >
              Next references
            </InstrumentButton>
          </nav>
        </>
      )}
    </section>
  );
}
export function SearchOverlayFeature(props: SearchOverlayProps) {
  const [antenna, setAntenna] = useState<{
    id?: AntennaGuideId;
    frequencyHz: number;
    mode: ReceiverMode;
  }>();
  const antennaReturn = useRef("");
  const [client] = useState(() => props.client ?? new PublicStationClient());
  const [search] = useState(() => new PublicStationSearch(client));
  const state = useSyncExternalStore(search.subscribe, search.getSnapshot);
  const [open, setOpen] = useState(true),
    [query, setQuery] = useState(""),
    [interpretation, setInterpretation] = useState<"auto" | "text">("auto");
  const [minimum, setMinimum] = useState(""),
    [maximum, setMaximum] = useState("");
  const [group, setGroup] = useState("all"),
    [preview, setPreview] = useState<Preview>(),
    [message, setMessage] = useState("");
  const [applying, setApplying] = useState(false);
  const [shared, setShared] =
    useState<typeof import("../radio/sharedFrequencyGuides")>();
  const [frequencyMode, setFrequencyMode] = useState(readFrequencySourceMode);
  const [catalog, setCatalog] = useState<SavedFrequencyCatalog>();
  const [catalogState, setCatalogState] = useState(
    "Loading saved public catalog…",
  );
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [guideLoadAttempt, setGuideLoadAttempt] = useState(0);
  const previewRef = useRef(preview);
  previewRef.current = preview;
  useEffect(() => {
    if (!open) return;
    let active = true;
    let worker: Worker | undefined;
    let current: SavedFrequencyCatalog | undefined;
    let pending:
      | {
          revision: string;
          order: string[];
          profiles: Map<string, SharedFrequencyGuide>;
        }
      | undefined;
    setCatalogLoading(true);
    setCatalog(undefined);
    setCatalogState(
      frequencyMode === "live"
        ? "Loading live Atlas catalog…"
        : "Loading saved public catalog…",
    );
    const unavailable = () => {
      if (!active) return;
      setCatalogLoading(false);
      setCatalogState(
        frequencyMode === "live"
          ? "Live Atlas catalog unavailable. Retry or select Automatic / Saved."
          : "Atlas unavailable · using saved public catalog (may be out of date)",
      );
    };
    void import("../radio/sharedFrequencyGuides")
      .then((module) => {
        if (!active) return;
        setShared(module);
        current = {
          snapshot: module.bundledFrequencySnapshot,
          checkedAt: null,
        };
        if (frequencyMode !== "live") setCatalog(current);
        try {
          worker = new Worker(
            new URL(
              "../workers/publicFrequencyCatalog.worker.ts",
              import.meta.url,
            ),
            { type: "module" },
          );
          worker.onmessage = (event: MessageEvent<FrequencyCatalogUpdate>) => {
            if (!active || !current) return;
            const update = event.data;
            if (update.order)
              pending = {
                revision: update.revision,
                order: update.order,
                profiles: new Map(
                  current.snapshot.profiles.map((profile) => [
                    profile.id,
                    profile,
                  ]),
                ),
              };
            if (update.patch) {
              if (!pending || pending.revision !== update.revision) {
                unavailable();
                return;
              }
              for (const profile of update.patch)
                pending.profiles.set(profile.id, profile);
            }
            if (!update.complete) return;
            let snapshot = current.snapshot;
            if (update.revision !== snapshot.revision) {
              if (
                !pending ||
                pending.revision !== update.revision ||
                pending.order.some((id) => !pending!.profiles.has(id))
              ) {
                unavailable();
                return;
              }
              snapshot = {
                ...snapshot,
                revision: update.revision,
                published_at: update.published_at,
                profiles: pending.order.map((id) => pending!.profiles.get(id)!),
              };
            } else if (snapshot.published_at !== update.published_at)
              snapshot = { ...snapshot, published_at: update.published_at };
            pending = undefined;
            current = { snapshot, checkedAt: update.checkedAt };
            if (update.source === "unavailable") {
              unavailable();
              return;
            }
            if (update.source === "saved" && frequencyMode === "live") return;
            setCatalog(current);
            const selected = previewRef.current;
            if (
              selected?.catalogRevision &&
              selected.catalogRevision !== update.revision
            ) {
              revision.current++;
              aborter.current?.abort();
              setPreview(undefined);
              setApplying(false);
            }
            if (update.source === "live") {
              setCatalogState(
                update.saved
                  ? "Live Atlas public catalog"
                  : "Live Atlas public catalog · saving unavailable; previous saved copy retained",
              );
              setCatalogLoading(false);
            } else {
              setCatalogState(
                frequencyMode === "saved"
                  ? "Saved public catalog · offline copy"
                  : "Saved public catalog · checking Atlas…",
              );
              if (frequencyMode === "saved") setCatalogLoading(false);
            }
          };
          worker.onerror = unavailable;
          worker.postMessage({ mode: frequencyMode });
        } catch {
          unavailable();
        }
      })
      .catch(() => {
        if (active) {
          setCatalogLoading(false);
          setCatalogState(
            "Public frequency catalog could not load. Retry to load the saved copy.",
          );
        }
      });
    return () => {
      active = false;
      worker?.terminate();
    };
  }, [open, frequencyMode, guideLoadAttempt]);
  const trigger = useRef<HTMLButtonElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    aborter = useRef<AbortController | undefined>(undefined);
  const revision = useRef(0),
    latestContext = useRef(props.contextKey);
  latestContext.current = props.contextKey;
  const id = useId();
  useOverlayDialog(open, dialog, trigger, 'input[type="search"]');
  useEffect(
    () => () => {
      search.cancel();
      aborter.current?.abort();
    },
    [search],
  );
  const invalidate = () => {
    revision.current++;
    aborter.current?.abort();
    setApplying(false);
    setPreview(undefined);
    setMessage("");
  };
  const edit = () => {
    invalidate();
    search.clear();
  };
  const close = () => {
    invalidate();
    search.clear();
    setOpen(false);
  };
  const parsed =
    interpretation === "auto" ? parseDiscoveryFrequency(query) : { notice: "" };
  const guides = matchingGuides(query);
  const catalogProfiles = catalog?.snapshot.profiles;
  const sharedFrequencies = useMemo(
    () =>
      catalogProfiles
        ? (shared?.matchingSharedFrequencies(
            query,
            interpretation,
            catalogProfiles,
          ) ?? [])
        : [],
    [catalogProfiles, shared, query, interpretation],
  );
  const frequencyFamilies = useMemo<readonly (readonly [string, string])[]>(
    () => [
      ...(shared?.SHARED_FREQUENCY_FAMILIES ?? []),
      ...[...new Set(catalogProfiles?.map((profile) => profile.family) ?? [])]
        .filter(
          (family) =>
            !shared?.SHARED_FREQUENCY_FAMILIES.some(
              ([known]) => known === family,
            ),
        )
        .map((family) => [family, family] as const),
    ],
    [catalogProfiles, shared],
  );
  const localQuery = normalizeDiscoveryText(query);
  const favorites = props.favorites.filter((item) =>
    normalizeDiscoveryText(
      `${item.name} ${item.tags.join(" ")} ${item.notes} ${item.frequencyHz / 1e6} ${item.settings.mode}`,
    ).includes(localQuery),
  );
  let previewText = "",
    previewError = "";
  if (preview) {
    try {
      if (preview.context !== props.contextKey)
        throw new Error("Receiver context changed. Preview this result again.");
      if (props.blockedReason) throw new Error(props.blockedReason);
      previewText = props.onPreview(preview.bookmark);
    } catch (error) {
      previewError =
        error instanceof Error
          ? error.message
          : "Receiver configuration unavailable.";
    }
  }
  function choose(
    bookmark: Bookmark,
    station?: PublicStationReferences,
    referenceId?: string,
    location?: PublicReferenceLocation,
    catalogRevision?: string,
  ) {
    invalidate();
    setPreview({
      bookmark,
      station,
      referenceId,
      location,
      context: props.contextKey,
      catalogRevision,
    });
    // Preview remains in the scroll body, with an explicit focus target on narrow screens.
    requestAnimationFrame(() =>
      dialog.current?.querySelector<HTMLElement>(".discovery-preview")?.focus(),
    );
  }
  async function apply() {
    if (!preview || applying || previewError) return;
    const selected = preview,
      owner = new AbortController(),
      version = ++revision.current;
    aborter.current = owner;
    setApplying(true);
    setMessage("");
    try {
      let candidate: ReceptionCandidate | undefined;
      if (selected.station && selected.referenceId) {
        const current = await client.reference(
          selected.station.id,
          selected.referenceId,
          owner.signal,
          selected.location,
        );
        owner.signal.throwIfAborted();
        unchangedPublicReference(
          selected.station,
          current,
          selected.referenceId,
        );
        candidate = publicReceptionCandidate(current, selected.referenceId);
      }
      if (
        version !== revision.current ||
        selected.context !== latestContext.current
      )
        throw new Error("Receiver or selection changed. Preview again.");
      const result = candidate
        ? await props.onUseStation(candidate)
        : await props.onRecall(selected.bookmark);
      if (!owner.signal.aborted && version === revision.current) {
        setPreview(undefined);
        setMessage(result);
      }
    } catch (error) {
      if (!owner.signal.aborted && version === revision.current)
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not apply receiver settings.",
        );
    } finally {
      if (version === revision.current) setApplying(false);
    }
  }
  const submit = () => {
    invalidate();
    try {
      void search.search(
        discoveryQuery(query, interpretation, minimum, maximum),
      );
    } catch (error) {
      search.clear();
      setMessage(
        error instanceof Error ? error.message : "Check search filters.",
      );
    }
  };
  return (
    <>
      <InstrumentButton
        ref={trigger}
        type="button"
        className="secondary discovery-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(true)}
      >
        <AppIcon name="search" /> Search
      </InstrumentButton>
      {createPortal(
        <dialog
          ref={dialog}
          id={id}
          className="favorites-panel discovery-panel overlay-motion"
          aria-label="Search stations & signals"
          aria-describedby={`${id}-help`}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const b = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < b.left ||
              event.clientX > b.right ||
              event.clientY < b.top ||
              event.clientY > b.bottom
            )
              close();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            const elements = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]',
              ),
            ).filter((e) => e.getClientRects().length > 0);
            const first = elements[0],
              last = elements.at(-1),
              active = document.activeElement;
            if (event.shiftKey && active === first && last) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && active === last && first) {
              event.preventDefault();
              first.focus();
            }
          }}
        >
          <DeferredWorkspace active={open} freezeWhenInactive>
            {() => (
              <>
                <header className="favorites-heading">
                  <div>
                    <h2 id={`${id}-title`}>
                      {antenna ? "Antenna guide" : "Search stations & signals"}
                    </h2>
                    <p>
                      {antenna
                        ? "Reception setups & starting dimensions"
                        : "Local guides, approved Atlas references and your favorites"}
                    </p>
                  </div>
                  <InstrumentButton
                    type="button"
                    className="secondary"
                    aria-label="Close Search"
                    onClick={close}
                  >
                    <AppIcon name="close" />
                  </InstrumentButton>
                </header>
                <div className="favorites-body discovery-body">
                  {antenna ? (
                    <>
                      <InstrumentButton
                        type="button"
                        ref={(node) => {
                          node?.focus();
                        }}
                        className="secondary"
                        onClick={() => {
                          setAntenna(undefined);
                          requestAnimationFrame(() =>
                            Array.from(
                              dialog.current?.querySelectorAll<HTMLButtonElement>(
                                "button",
                              ) ?? [],
                            )
                              .find(
                                (button) =>
                                  button.textContent === antennaReturn.current,
                              )
                              ?.focus(),
                          );
                        }}
                      >
                        ← Back to Search
                      </InstrumentButton>
                      <Suspense
                        fallback={<p role="status">Opening antenna guide…</p>}
                      >
                        <AntennaGuide
                          initialGuideId={antenna.id}
                          context={{
                            ...(props.antennaContext ?? {
                              kind: "local",
                              sourceLabel: "Receiver",
                            }),
                            frequencyHz: antenna.frequencyHz,
                            mode: antenna.mode,
                          }}
                        />
                      </Suspense>
                    </>
                  ) : (
                    <>
                      <p id={`${id}-help`} className="display-note">
                        Free public catalog search, no account needed. Browsing
                        keeps reception unchanged. Results are references, not
                        verified reception.
                      </p>
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          submit();
                        }}
                      >
                        <label>
                          Search text, frequency or DAB block
                          <input
                            type="search"
                            maxLength={200}
                            value={query}
                            placeholder="meshcore, meshtastic europe, zigbee, energy…"
                            onChange={(event) => {
                              edit();
                              setQuery(event.currentTarget.value);
                            }}
                          />
                        </label>
                        <div className="discovery-fields">
                          <label>
                            Interpretation
                            <select
                              value={interpretation}
                              onChange={(event) => {
                                edit();
                                setInterpretation(
                                  event.currentTarget.value as "auto" | "text",
                                );
                              }}
                            >
                              <option value="auto">
                                Auto · bare numbers are MHz
                              </option>
                              <option value="text">
                                Text · keep numbers as names
                              </option>
                            </select>
                          </label>
                          <label>
                            Show
                            <select
                              value={group}
                              onChange={(event) =>
                                setGroup(event.currentTarget.value)
                              }
                            >
                              <option value="all">All sources</option>
                              <option value="guides">Local guides & Radio Apps</option>
                              <option value="frequencies">
                                Shared RF frequencies
                              </option>
                              <option value="atlas">Atlas stations</option>
                              <option value="favorites">My favorites</option>
                            </select>
                          </label>
                        </div>
                        <details>
                          <summary>Optional Atlas frequency window</summary>
                          <div className="discovery-fields">
                            <label>
                              Minimum frequency (MHz)
                              <input
                                inputMode="decimal"
                                value={minimum}
                                onChange={(event) => {
                                  edit();
                                  setMinimum(event.currentTarget.value);
                                }}
                              />
                            </label>
                            <label>
                              Maximum frequency (MHz)
                              <input
                                inputMode="decimal"
                                value={maximum}
                                onChange={(event) => {
                                  edit();
                                  setMaximum(event.currentTarget.value);
                                }}
                              />
                            </label>
                          </div>
                          <p className="display-note">
                            Paired bounds: minimum included, maximum excluded.
                            Applies to published nominal references.
                          </p>
                        </details>
                        {parsed.notice && (
                          <p className="display-note">{parsed.notice}</p>
                        )}
                        {parsed.error && <p role="alert">{parsed.error}</p>}
                        <div className="discovery-actions">
                          <InstrumentButton
                            type="submit"
                            disabled={state.status === "loading"}
                          >
                            Search Atlas
                          </InstrumentButton>
                          <InstrumentButton
                            type="button"
                            className="secondary"
                            onClick={() => {
                              edit();
                              setQuery("");
                              setMinimum("");
                              setMaximum("");
                            }}
                          >
                            Clear search
                          </InstrumentButton>
                        </div>
                      </form>
                      {props.blockedReason && (
                        <p className="display-note">
                          {props.blockedReason} Browsing remains available.
                        </p>
                      )}
                      {message && <p role="status">{message}</p>}
                      {preview && (
                        <section
                          className="discovery-preview"
                          aria-label="Receiver preview"
                          tabIndex={-1}
                        >
                          <h3>Receiver preview · {preview.bookmark.name}</h3>
                          <p>{previewText || previewError}</p>
                          {preview.bookmark.atlasReference && (
                            <p className="display-note">
                              Catalog-requested bandwidth:{" "}
                              {preview.bookmark.atlasReference.bandwidth_hz.toLocaleString()}{" "}
                              Hz. The receiver preview shows the supported
                              applied profile.
                            </p>
                          )}
                          {preview.station && (
                            <>
                              <p>
                                Public station ID: {preview.station.id} ·
                                reference: {preview.referenceId} · publication
                                version {preview.station.publication_version}.
                                Candidate only; identity unconfirmed.
                              </p>
                              <Sources sources={preview.station.sources} />
                              <Sources
                                sources={
                                  preview.station.transmissions.find(
                                    (t) => t.id === preview.referenceId,
                                  )!.sources
                                }
                              />
                            </>
                          )}
                          {preview.bookmark.settings.mode === "DAB" && (
                            <p>
                              After manually starting reception, select a
                              decoded service in the DAB programme control. No
                              programme is selected by search.
                            </p>
                          )}
                          <div className="discovery-actions">
                            <InstrumentButton
                              type="button"
                              disabled={!!previewError || applying}
                              onClick={() => void apply()}
                            >
                              {applying
                                ? "Checking and applying…"
                                : "Apply to receiver"}
                            </InstrumentButton>
                            <InstrumentButton
                              type="button"
                              className="secondary"
                              onClick={invalidate}
                            >
                              Cancel preview
                            </InstrumentButton>
                          </div>
                        </section>
                      )}
                      {(group === "all" || group === "frequencies") && (
                        <section aria-label="Shared RF frequencies">
                          <h3>Shared RF frequencies</h3>
                          <p className="display-note">
                            Public carriers, regional channel plans and USB dial
                            conventions, available without an account. Expand a
                            plan to browse its channels. Frequency alone does
                            not identify traffic. Preview uses the listed audio
                            mode or your current mode; a frequency guide does
                            not add a protocol decoder. Check receiver range and
                            capture bandwidth before recording.
                          </p>
                          <label>
                            Frequency catalog
                            <select
                              value={frequencyMode}
                              onChange={(event) => {
                                invalidate();
                                const mode = event.currentTarget
                                  .value as FrequencySourceMode;
                                saveFrequencySourceMode(mode);
                                setFrequencyMode(mode);
                              }}
                            >
                              <option value="automatic">
                                Automatic · live with saved fallback
                              </option>
                              <option value="live">Live · Atlas only</option>
                              <option value="saved">
                                Saved · offline copy
                              </option>
                            </select>
                          </label>
                          <p role="status">{catalogState}</p>
                          {catalog && (
                            <p className="display-note">
                              Revision {catalog.snapshot.revision.slice(0, 12)}{" "}
                              · published{" "}
                              {new Date(
                                catalog.snapshot.published_at,
                              ).toLocaleString()}
                              .
                              {catalog.checkedAt
                                ? ` Last live check ${new Date(catalog.checkedAt).toLocaleString()}.`
                                : " Bundled public snapshot; not yet checked live."}{" "}
                              Saved mode can include profiles since changed or
                              withdrawn. Station results always require a live
                              lookup.
                            </p>
                          )}
                          <InstrumentButton
                            type="button"
                            disabled={catalogLoading}
                            onClick={() => {
                              invalidate();
                              setGuideLoadAttempt((value) => value + 1);
                            }}
                          >
                            Refresh frequency catalog
                          </InstrumentButton>
                          {!catalogLoading &&
                            catalog &&
                            !sharedFrequencies.length && (
                              <p>
                                No matching shared frequency. Try meshtastic
                                Europe, LoRaWAN US, Bluetooth advertising, GPS
                                L1, PMR446, NOAA weather or FT8 20m.
                              </p>
                            )}
                          {frequencyFamilies.map(([family, label]) => {
                            const rows = sharedFrequencies.filter(
                              (row) => row.family === family,
                            );
                            return (
                              rows.length > 0 && (
                                <details key={family} open={!!query.trim()}>
                                  <summary>
                                    {label} · {rows.length} frequency profiles
                                  </summary>
                                  {[
                                    ...new Set(rows.map((row) => row.plan)),
                                  ].map((plan) => {
                                    const planRows = rows.filter(
                                      (row) => row.plan === plan,
                                    );
                                    return plan === null ? (
                                      <FrequencyRows
                                        key="presets"
                                        rows={planRows}
                                        mode={props.mode}
                                        choose={(bookmark) =>
                                          choose(
                                            bookmark,
                                            undefined,
                                            undefined,
                                            undefined,
                                            catalog?.snapshot.revision,
                                          )
                                        }
                                      />
                                    ) : (
                                      <FrequencyPlan
                                        key={`${plan}:${query}:${interpretation}`}
                                        name={plan}
                                        rows={planRows}
                                        mode={props.mode}
                                        choose={(bookmark) =>
                                          choose(
                                            bookmark,
                                            undefined,
                                            undefined,
                                            undefined,
                                            catalog?.snapshot.revision,
                                          )
                                        }
                                      />
                                    );
                                  })}
                                </details>
                              )
                            );
                          })}
                        </section>
                      )}
                      {props.onRadioApp && (group === "all" || group === "guides") && matchingRadioApps(query).length > 0 && <section aria-label="Radio Apps"><h3>Radio Apps</h3>{matchingRadioApps(query).map(app => <article key={app.id}><h4>{app.name}</h4><p>{app.description}</p><InstrumentButton type="button" className="secondary" onClick={() => { close(); props.onRadioApp?.(app.id); }}>Open {app.name}</InstrumentButton></article>)}</section>}
                      {(group === "all" || group === "guides") && (
                        <section aria-label="Modes & frequency guides">
                          <h3>Modes & frequency guides</h3>
                          {parsed.frequencyHz !== undefined && (
                            <article>
                              <h4>
                                {parsed.block
                                  ? `DAB block ${parsed.block}`
                                  : `${parsed.frequencyHz / 1e6} MHz`}
                              </h4>
                              <p>{parsed.notice}</p>
                              <InstrumentButton
                                type="button"
                                className="secondary"
                                onClick={() =>
                                  choose(
                                    guideBookmark(
                                      parsed.block
                                        ? `DAB ${parsed.block}`
                                        : `${parsed.frequencyHz! / 1e6} MHz`,
                                      parsed.block ? "DAB" : props.mode,
                                      parsed.frequencyHz!,
                                    ),
                                  )
                                }
                              >
                                Preview{" "}
                                {parsed.block
                                  ? "DAB block"
                                  : `frequency with ${props.mode}`}
                              </InstrumentButton>
                            </article>
                          )}
                          {!guides.length &&
                            parsed.frequencyHz === undefined && (
                              <p>
                                No local guide matches. Try a mode name,
                                frequency or DAB block.
                              </p>
                            )}
                          {guides.map((guide) => (
                            <article key={guide.id}>
                              <h4>{guide.name}</h4>
                              <p>{guide.context}</p>
                              <p>{guide.status}</p>
                              {ANTENNA_GUIDES.some(
                                (item) =>
                                  item.mode === guide.mode &&
                                  guide.mode !== undefined,
                              ) && (
                                <InstrumentButton
                                  type="button"
                                  className="secondary"
                                  onClick={(event) => {
                                    antennaReturn.current =
                                      event.currentTarget.textContent ?? "";
                                    setAntenna({
                                      id: ANTENNA_GUIDES.find(
                                        (item) => item.mode === guide.mode,
                                      )?.id,
                                      frequencyHz:
                                        guide.frequencyHz ?? props.frequencyHz,
                                      mode: guide.mode!,
                                    });
                                    requestAnimationFrame(() =>
                                      dialog.current
                                        ?.querySelector<HTMLElement>(
                                          ".antenna-guide button",
                                        )
                                        ?.focus(),
                                    );
                                  }}
                                >
                                  Antenna setup for {guide.name}
                                </InstrumentButton>
                              )}
                              <p className="display-note">
                                {guide.match} ·{" "}
                                <a
                                  href={guide.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {guide.publisher}
                                </a>{" "}
                                · {guide.sourceDate}
                              </p>
                              {guide.mode &&
                                guide.id !== "dab" &&
                                guide.id !== "atis" && (
                                  <InstrumentButton
                                    type="button"
                                    className="secondary"
                                    onClick={() =>
                                      choose(
                                        guideBookmark(
                                          guide.name,
                                          guide.mode!,
                                          guide.frequencyHz ??
                                            props.frequencyHz,
                                        ),
                                      )
                                    }
                                  >
                                    Preview {guide.name}
                                  </InstrumentButton>
                                )}
                            </article>
                          ))}
                        </section>
                      )}
                      {(group === "all" || group === "atlas") && (
                        <section aria-label="Atlas stations">
                          <h3>Atlas stations</h3>
                          <p className="display-note">
                            Published references only, pages of up to 50. Name,
                            alias and call-sign matches come first within each
                            returned page; continuation follows catalog order.
                            No global relevance ranking or complete worldwide
                            inventory. Text matching is literal; Atlas preserves
                            accents and approved aliases. A DAB format does not
                            establish programme membership.
                          </p>
                          {state.status === "idle" && (
                            <p>
                              Choose Search Atlas to query the public catalog.
                            </p>
                          )}
                          {state.status === "loading" && (
                            <p role="status">Searching public Atlas catalog…</p>
                          )}
                          {state.message && (
                            <p
                              role={
                                state.status === "error" ? "alert" : "status"
                              }
                            >
                              {state.message}
                            </p>
                          )}
                          {state.status === "error" && (
                            <InstrumentButton
                              type="button"
                              className="secondary"
                              onClick={() => {
                                invalidate();
                                void search.retry();
                              }}
                            >
                              Retry station page
                            </InstrumentButton>
                          )}
                          {state.status === "ready" && (
                            <>
                              <p role="status">
                                {state.page!.items.length
                                  ? `Page ${state.pageIndex + 1} · ${state.page!.items.length} published stations`
                                  : "No matching published stations. This does not establish absence of an RF signal."}
                              </p>
                              {rankPublicStations(
                                state.page!.items,
                                search.getQuery().q,
                              ).map(({ station, match, relevance }) => (
                                <article
                                  key={station.id}
                                  aria-label={station.name}
                                  className="discovery-station"
                                >
                                  <h4>{station.name}</h4>
                                  {search.getQuery().q && (
                                    <p className="display-note">
                                      {relevance.label}. Check the published
                                      service and local frequency before
                                      choosing it.
                                    </p>
                                  )}
                                  <p>
                                    {[
                                      station.country,
                                      station.service,
                                      station.network,
                                      station.call_sign,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ") ||
                                      "Region / service unknown"}
                                  </p>
                                  {station.aliases.length > 0 && (
                                    <p>
                                      Approved aliases:{" "}
                                      {station.aliases.join(", ")}
                                    </p>
                                  )}
                                  <p className="display-note">
                                    Matched{" "}
                                    {match.station_fields.length
                                      ? match.station_fields.join(", ")
                                      : "published reference / browse"}
                                    . Only references matching this page's
                                    filters are listed.
                                  </p>
                                  <Sources sources={station.sources} />
                                  <StationReferences
                                    key={`${state.page!.catalog_revision}:${station.id}:${station.publication_version}:${search.getRequestId()}`}
                                    client={client}
                                    station={station}
                                    catalogRevision={
                                      state.page!.catalog_revision
                                    }
                                    total={match.matching_transmission_count}
                                    query={search.getQuery()}
                                    choose={choose}
                                    onFavorite={props.onFavorite}
                                    onMessage={setMessage}
                                  />
                                </article>
                              ))}
                              <nav
                                className="discovery-actions"
                                aria-label="Public station pages"
                              >
                                <InstrumentButton
                                  type="button"
                                  className="secondary"
                                  disabled={!state.previous}
                                  onClick={() => {
                                    invalidate();
                                    void search.previous();
                                  }}
                                >
                                  Previous stations
                                </InstrumentButton>
                                <InstrumentButton
                                  type="button"
                                  className="secondary"
                                  disabled={!state.next}
                                  onClick={() => {
                                    invalidate();
                                    void search.next();
                                  }}
                                >
                                  Next stations
                                </InstrumentButton>
                              </nav>
                            </>
                          )}
                        </section>
                      )}
                      {(group === "all" || group === "favorites") && (
                        <section aria-label="My favorites">
                          <h3>My favorites</h3>
                          <p className="display-note">
                            Stored in this browser. Recall does not verify a
                            stored station identity.
                          </p>
                          {!favorites.length && (
                            <p>No matching local favorites.</p>
                          )}
                          {favorites.map((item) => (
                            <article key={item.id}>
                              <h4>{item.name}</h4>
                              <p>
                                {item.frequencyHz / 1e6} MHz ·{" "}
                                {item.settings.mode}
                              </p>
                              <InstrumentButton
                                type="button"
                                className="secondary"
                                onClick={() => choose(item)}
                              >
                                Preview favorite {item.name}
                              </InstrumentButton>
                            </article>
                          ))}
                        </section>
                      )}
                    </>
                  )}
                </div>
                <footer className="favorites-footer">
                  <span className="display-note">
                    Query and filters are retained when closed.
                  </span>
                  <InstrumentButton type="button" className="secondary" onClick={close}>
                    Close Search
                  </InstrumentButton>
                </footer>
              </>
            )}
          </DeferredWorkspace>
        </dialog>,
        document.body,
      )}
    </>
  );
}
