import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { AppIcon } from "./AppIcon";
import { useOverlayDialog } from "./useOverlayDialog";
import { PublicStationClient } from "../radio/publicStationClient";
import { PublicStationSearch } from "../radio/publicStationSearch";
import type { PublicSource, PublicStation } from "../radio/publicStations";
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
import "./SearchOverlay.css";
interface Preview {
  bookmark: Bookmark;
  station?: PublicStation;
  referenceId?: string;
  context: string;
}
export interface SearchOverlayProps {
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
export function SearchOverlay(props: SearchOverlayProps) {
  const [client] = useState(() => props.client ?? new PublicStationClient());
  const [search] = useState(() => new PublicStationSearch(client));
  const state = useSyncExternalStore(search.subscribe, search.getSnapshot);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [interpretation, setInterpretation] = useState<"auto" | "text">("auto");
  const [minimum, setMinimum] = useState(""),
    [maximum, setMaximum] = useState("");
  const [group, setGroup] = useState("all"),
    [preview, setPreview] = useState<Preview>(),
    [message, setMessage] = useState("");
  const [applying, setApplying] = useState(false);
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
    station?: PublicStation,
    referenceId?: string,
  ) {
    invalidate();
    setPreview({ bookmark, station, referenceId, context: props.contextKey });
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
        const current = await client.detail(selected.station.id, owner.signal);
        owner.signal.throwIfAborted();
        unchangedPublicReference(
          selected.station,
          current.station,
          selected.referenceId,
        );
        candidate = publicReceptionCandidate(
          current.station,
          selected.referenceId,
        );
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
      <button
        ref={trigger}
        type="button"
        className="secondary discovery-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(true)}
      >
        <AppIcon name="search" /> Search
      </button>
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
                'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
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
          <header className="favorites-heading">
            <div>
              <h2 id={`${id}-title`}>Search stations & signals</h2>
              <p>Local guides, approved Atlas references and your favorites</p>
            </div>
            <button
              type="button"
              className="secondary"
              aria-label="Close Search"
              onClick={close}
            >
              <AppIcon name="close" />
            </button>
          </header>
          <div className="favorites-body discovery-body">
            <p id={`${id}-help`} className="display-note">
              Free public catalog search, no account needed. Browsing keeps
              reception unchanged. Results are references, not verified
              reception.
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
                  placeholder="ads, energy, 103,4 MHz, 11C…"
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
                    <option value="auto">Auto · bare numbers are MHz</option>
                    <option value="text">Text · keep numbers as names</option>
                  </select>
                </label>
                <label>
                  Show
                  <select
                    value={group}
                    onChange={(event) => setGroup(event.currentTarget.value)}
                  >
                    <option value="all">All sources</option>
                    <option value="guides">Local guides</option>
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
                  Paired bounds: minimum included, maximum excluded. Applies to
                  published nominal references.
                </p>
              </details>
              {parsed.notice && <p className="display-note">{parsed.notice}</p>}
              {parsed.error && <p role="alert">{parsed.error}</p>}
              <div className="discovery-actions">
                <button type="submit" disabled={state.status === "loading"}>
                  Search Atlas
                </button>
                <button
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
                </button>
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
                    Hz. The receiver preview shows the supported applied
                    profile.
                  </p>
                )}
                {preview.station && (
                  <>
                    <p>
                      Public station ID: {preview.station.id} · reference:{" "}
                      {preview.referenceId} · publication version{" "}
                      {preview.station.publication_version}. Candidate only;
                      identity unconfirmed.
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
                    After manually starting reception, select a decoded service
                    in the DAB programme control. No programme is selected by
                    search.
                  </p>
                )}
                <div className="discovery-actions">
                  <button
                    type="button"
                    disabled={!!previewError || applying}
                    onClick={() => void apply()}
                  >
                    {applying ? "Checking and applying…" : "Apply to receiver"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={invalidate}
                  >
                    Cancel preview
                  </button>
                </div>
              </section>
            )}
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
                    <button
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
                    </button>
                  </article>
                )}
                {!guides.length && parsed.frequencyHz === undefined && (
                  <p>
                    No local guide matches. Try a mode name, frequency or DAB
                    block.
                  </p>
                )}
                {guides.map((guide) => (
                  <article key={guide.id}>
                    <h4>{guide.name}</h4>
                    <p>{guide.context}</p>
                    <p>{guide.status}</p>
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
                    {guide.mode && guide.id !== "dab" && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          choose(
                            guideBookmark(
                              guide.name,
                              guide.mode!,
                              guide.frequencyHz ?? props.frequencyHz,
                            ),
                          )
                        }
                      >
                        Preview {guide.name}
                      </button>
                    )}
                  </article>
                ))}
              </section>
            )}
            {(group === "all" || group === "atlas") && (
              <section aria-label="Atlas stations">
                <h3>Atlas stations</h3>
                <p className="display-note">
                  Published references only, alphabetical pages of up to 50, at
                  most 20 pages. No global relevance ranking or complete
                  worldwide inventory. Text matching is literal; Atlas preserves
                  accents and approved aliases. A DAB format does not establish
                  programme membership.
                </p>
                {state.status === "idle" && (
                  <p>Choose Search Atlas to query the public catalog.</p>
                )}
                {state.status === "loading" && (
                  <p role="status">Searching public Atlas catalog…</p>
                )}
                {state.message && (
                  <p role={state.status === "error" ? "alert" : "status"}>
                    {state.message}
                  </p>
                )}
                {state.status === "ready" && (
                  <>
                    <p role="status">
                      {state.page!.items.length
                        ? `Page ${state.pageIndex + 1} · ${state.page!.items.length} published stations`
                        : "No matching published stations. This does not establish absence of an RF signal."}
                    </p>
                    {state.page!.items.map(({ station, match }) => (
                      <article
                        key={station.id}
                        aria-label={station.name}
                        className="discovery-station"
                      >
                        <h4>{station.name}</h4>
                        <p>
                          {[
                            station.country,
                            station.service,
                            station.network,
                            station.call_sign,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Region / service unknown"}
                        </p>
                        {station.aliases.length > 0 && (
                          <p>Approved aliases: {station.aliases.join(", ")}</p>
                        )}
                        <p className="display-note">
                          Matched{" "}
                          {match.station_fields.length
                            ? match.station_fields.join(", ")
                            : "published reference / browse"}
                          . Only references matching this page's filters are
                          listed.
                        </p>
                        <Sources sources={station.sources} />
                        {!station.transmissions.length && (
                          <p>No published transmission references.</p>
                        )}
                        {station.transmissions.map((reference) => {
                          let candidate: ReceptionCandidate | undefined;
                          try {
                            candidate = publicReceptionCandidate(
                              station,
                              reference.id,
                            );
                          } catch {
                            /* Unsupported declared mode is readable, never guessed. */
                          }
                          return (
                            <div
                              key={reference.id}
                              className="discovery-reference"
                            >
                              <p>
                                <strong>
                                  {reference.frequency_hz / 1e6} MHz ·{" "}
                                  {reference.broadcast_format ??
                                    "Unknown format"}
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
                                {reference.valid_to ?? "unknown"}. Source dates
                                and validity do not prove current RF activity.
                              </p>
                              <Sources sources={reference.sources} />
                              {candidate ? (
                                <div className="discovery-actions">
                                  <button
                                    type="button"
                                    className="secondary"
                                    onClick={() =>
                                      choose(
                                        bookmarkFromCandidate(candidate!),
                                        station,
                                        reference.id,
                                      )
                                    }
                                  >
                                    Preview {reference.frequency_hz / 1e6} MHz
                                  </button>
                                  <button
                                    type="button"
                                    className="secondary"
                                    onClick={() => {
                                      try {
                                        props.onFavorite(candidate!);
                                        setMessage(
                                          "Station favorite saved locally; public reference is not revalidated by saving.",
                                        );
                                      } catch (error) {
                                        setMessage(
                                          error instanceof Error
                                            ? error.message
                                            : "Could not save favorite.",
                                        );
                                      }
                                    }}
                                  >
                                    Save station favorite
                                  </button>
                                </div>
                              ) : (
                                <p>
                                  Station handoff unavailable for this declared
                                  format. Use a compatible local guide without
                                  attaching station identity.
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </article>
                    ))}
                    <nav
                      className="discovery-actions"
                      aria-label="Public station pages"
                    >
                      <button
                        type="button"
                        className="secondary"
                        disabled={!state.previous}
                        onClick={() => {
                          invalidate();
                          void search.previous();
                        }}
                      >
                        Previous stations
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={!state.next}
                        onClick={() => {
                          invalidate();
                          void search.next();
                        }}
                      >
                        Next stations
                      </button>
                    </nav>
                  </>
                )}
              </section>
            )}
            {(group === "all" || group === "favorites") && (
              <section aria-label="My favorites">
                <h3>My favorites</h3>
                <p className="display-note">
                  Stored in this browser. Recall does not verify a stored
                  station identity.
                </p>
                {!favorites.length && <p>No matching local favorites.</p>}
                {favorites.map((item) => (
                  <article key={item.id}>
                    <h4>{item.name}</h4>
                    <p>
                      {item.frequencyHz / 1e6} MHz · {item.settings.mode}
                    </p>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => choose(item)}
                    >
                      Preview favorite {item.name}
                    </button>
                  </article>
                ))}
              </section>
            )}
          </div>
          <footer className="favorites-footer">
            <span className="display-note">
              Query and filters are retained when closed.
            </span>
            <button type="button" className="secondary" onClick={close}>
              Close Search
            </button>
          </footer>
        </dialog>,
        document.body,
      )}
    </>
  );
}
