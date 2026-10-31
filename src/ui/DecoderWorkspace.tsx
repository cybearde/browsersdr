import { useRadioAppPageSize } from "./useRadioAppPageSize";
import { InstrumentRange } from "./InstrumentRange";
import { InstrumentButton } from "./InstrumentButton";
import { PocsagPanel } from "./PocsagPanel";
import { isTextMode } from "../textmodem/settings";
import { TextDecodePanel } from "./TextDecodePanel";
import { useVisibleReceiver } from "./useVisibleReceiver";
import { useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ReceiverController,
  ReceiverSnapshot,
} from "../radio/receiverController";
import type { ReceiverMode } from "../radio/receiverConfig";
import type { SourceKind } from "../radio/types";
import type { ReceiverLocation } from "../radio/receiverLocation";
import { DecodedResults } from "./DecodedResults";
import { PositionMap } from "./PositionMap";
import { DabMetadata } from "./DabMetadata";
import { AppIcon } from "./AppIcon";
import {
  DECODER_FORMATS,
  decoderAcceptedCount,
  decoderIdentity,
  decoderJson,
  decoderRecords,
  decoderRetention,
  decoderViewExport,
  type DecoderFormat,
  type DecoderRecord,
} from "./decoderViewModel";

interface ReviewSnapshot {
  identity: string;
  receiver: ReceiverSnapshot;
  results: DecoderRecord[];
  messages: DecoderRecord[];
  accepted: number;
  frozenAt?: string;
}

export interface DecoderWorkspaceProps {
  controller: ReceiverController;
  source: SourceKind;
  mode: ReceiverMode;
  configuredMode: ReceiverMode;
  volume: number;
  frequencyHz: number;
  sampleRateHz: number;
  active: boolean;
  remote: boolean;
  blockedReason?: string;
  unavailableReason: (mode: ReceiverMode) => string | undefined;
  configurationPreview: (mode: ReceiverMode) => string;
  onApply: (mode: ReceiverMode) => void;
  onOpenReceiver: () => void;
  onOpenRecording: () => void;
  onVolumeChange: (volume: number) => void;
  serviceControl?: ReactNode;
  appMode?: ReceiverMode;
  onAppContentTarget?: (target: HTMLDivElement | null) => void;
  receiverLocation?: ReceiverLocation;
}

/** Another view of the existing controller; no acquisition or decoder is started here. */
export function DecoderWorkspace(props: DecoderWorkspaceProps) {
  const { receiver, presenting } = useVisibleReceiver(
    props.controller,
    props.active,
  );
  const [browsedFormat, setBrowsedFormat] = useState<DecoderFormat>();
  const [frozen, setFrozen] = useState<ReviewSnapshot>();
  const [selection, setSelection] = useState<{
    identity: string;
    key: string;
  }>();
  const selectionTrigger = useRef<HTMLElement | SVGElement | null>(null);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const [clearedPaging, setClearedPaging] = useState<{
    identity: string;
    keys: string[];
  }>();
  const [trayCollapsed, setTrayCollapsed] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<{
    format: DecoderFormat;
    value: "results" | "messages" | "map";
  }>();
  const [issue, setIssue] = useState("");
  const [audibleVolume, setAudibleVolume] = useState(props.volume || 0.7);
  const [aprsCategory, setAprsCategory] = useState("stations");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [dabPane, setDabPane] = useState("programmes");
  const [showTracks, setShowTracks] = useState(true);
  const nativeFormat = DECODER_FORMATS.find(
    (f) =>
      f.mode ===
      (receiver.lifecycle === "connected" ? props.configuredMode : props.mode),
  )?.mode;
  const format =
    DECODER_FORMATS.find((f) => f.mode === props.appMode)?.mode ??
    browsedFormat ??
    nativeFormat ??
    "WBFM";
  const satellite = format === "satellite";
  const customAppOutput = props.appMode === "WBFM" || props.appMode === "SRD";
  const reviewMode = satellite ? "OFF" : format;
  const identity = decoderIdentity(
    receiver,
    reviewMode,
    props.remote ? "remote" : props.source,
  );
  const modeChangePending =
    receiver.lifecycle === "tuning" && receiver.message.startsWith("Applying ");
  const applied =
    !props.remote &&
    !modeChangePending &&
    props.mode === reviewMode &&
    (!receiver.session || receiver.session.source === props.source);
  const needsApply =
    props.remote ||
    props.configuredMode !== reviewMode ||
    (receiver.lifecycle === "running" && props.mode !== reviewMode);
  const live = useMemo<ReviewSnapshot>(
    () => ({
      identity,
      // Exports carry acquisition metadata, never audio/artwork buffers or controller internals.
      receiver: {
        lifecycle: receiver.lifecycle,
        message: receiver.message,
        sessionGeneration: receiver.sessionGeneration,
        session: receiver.session,
      },
      results:
        presenting && applied ? decoderRecords(receiver, reviewMode) : [],
      messages:
        presenting && applied ? decoderRecords(receiver, reviewMode, true) : [],
      accepted:
        presenting && applied ? decoderAcceptedCount(receiver, reviewMode) : 0,
    }),
    [identity, receiver, applied, reviewMode, presenting],
  );
  const held = frozen?.identity === identity ? frozen : undefined;
  const display = held ?? live;
  const hasReviewData =
    display.results.length > 0 || display.messages.length > 0;
  const hasMessages =
    isTextMode(reviewMode) ||
    ["POCSAG", "APRS", "RS41", "SRD"].includes(reviewMode);
  const supportsMap = ["ADS-B", "AIS", "APRS", "RS41"].includes(reviewMode);
  const preferredView =
    view?.format === format ? view.value : supportsMap ? "map" : "results";
  const effectiveView =
    (preferredView === "messages" && !hasMessages) ||
    (preferredView === "map" && !supportsMap)
      ? "results"
      : preferredView;
  const records =
    effectiveView === "messages" ? display.messages : display.results;
  const filtered = presenting
    ? records.filter(
        (r) =>
          (props.appMode !== "APRS" ||
            (aprsCategory !== "messages" && aprsCategory !== "weather") ||
            r.category === aprsCategory ||
            (aprsCategory === "weather" && r.hasWeather)) &&
          !(
            reviewMode === "POCSAG" &&
            clearedPaging?.identity === identity &&
            clearedPaging.keys.includes(r.key)
          ) &&
          `${r.label} ${r.summary} ${r.fields.flat().join(" ")}`
            .toLowerCase()
            .includes(filter.toLowerCase()),
      )
    : [];
  const pageSize = useRadioAppPageSize();
  const [pageSelection, setPageSelection] = useState({ key: "", page: 0 });
  const pageKey = `${identity}:${filter}:${effectiveView}:${aprsCategory}`;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page =
    pageSelection.key === pageKey ? Math.min(pageSelection.page, pages - 1) : 0;
  const pageRecords = props.appMode
    ? filtered.slice(page * pageSize, (page + 1) * pageSize)
    : filtered;
  const selected =
    selection?.identity === identity
      ? filtered.find((r) => r.key === selection.key)
      : undefined;
  const positioned = filtered.filter(hasPosition);
  const geographic = effectiveView === "map";
  const traffic = reviewMode === "ADS-B" || reviewMode === "AIS";
  const hasTracks = traffic || reviewMode === "RS41";
  const sourceLabel = props.remote
    ? "Remote audio / FFT"
    : props.source === "synthetic"
      ? "Generated demo"
      : props.source;
  const channelHz =
    receiver.session?.selectedChannelFrequencyHz ?? props.frequencyHz;
  const inputRate = receiver.session?.actualSampleRateHz ?? props.sampleRateHz;
  const unavailable = props.remote
    ? "Remote audio/FFT does not provide the raw I/Q input required by these decoders. Select a local source in Receiver."
    : props.source === "synthetic"
      ? "The generated demo has no received digital data. Choose hardware or a compatible I/Q recording in Receiver."
      : satellite
        ? undefined
        : props.unavailableReason(reviewMode);
  const applyBlocked = props.blockedReason || unavailable;
  const metadata = display.receiver.session;
  const title =
    DECODER_FORMATS.find((f) => f.mode === format)?.title ??
    "Satellite recordings";
  const retention = decoderRetention(reviewMode);
  const empty = modeChangePending
    ? "Applying the decoder configuration. Results will appear when the receiver is ready."
    : needsApply
      ? "This format is a preview. Apply it to the shared receiver before decoding."
      : receiver.lifecycle !== "running"
        ? props.appMode
          ? "Use Start receiving above to connect and start. Receiver settings lets you change the source or antenna setup."
          : "No retained results. Open Receiver to connect and start, or open an I/Q recording."
        : "Receiving, but no results have been accepted yet. Check the signal, frequency and input requirements in Receiver.";

  function freezeDisplay() {
    setIssue("");
    if (held) {
      setFrozen(undefined);
      return;
    }
    // Validate both bounded views before copying. Typed arrays stay typed in the held snapshot.
    try {
      decoderViewExport(
        live.receiver,
        reviewMode,
        [...live.results, ...(hasMessages ? live.messages : [])],
        "retained",
        true,
      );
      setFrozen({
        ...structuredClone(live),
        frozenAt: new Date().toLocaleTimeString(),
      });
    } catch (error) {
      setIssue(
        error instanceof Error ? error.message : "Cannot freeze these results.",
      );
    }
  }
  function selectRecord(key: string, trigger?: HTMLElement | SVGElement) {
    selectionTrigger.current = trigger ?? null;
    setSelection({ identity, key });
  }
  function closeInspector() {
    setSelection(undefined);
    selectionTrigger.current?.focus();
  }
  function exportResults(exportScope: "retained" | "selected") {
    setIssue("");
    try {
      const json = decoderViewExport(
        display.receiver,
        reviewMode,
        exportScope === "selected" && selected ? [selected] : records,
        exportScope,
        Boolean(held),
      );
      const url = URL.createObjectURL(
        new Blob([json], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `browsersdr-${reviewMode.toLowerCase()}-${exportScope}.json`;
      anchor.click();
      if (exportMenu.current) exportMenu.current.open = false;
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setIssue(
        error instanceof Error ? error.message : "Cannot export these results.",
      );
    }
  }

  const stateLabel = held
    ? "Display frozen"
    : modeChangePending
      ? "Applying configuration"
      : applied
        ? receiver.lifecycle === "running"
          ? "Live input"
          : "Retained / idle"
        : !needsApply
          ? "Configured / idle"
          : "Preview";
  const unit = isTextMode(reviewMode)
    ? reviewMode === "WEFAX" || reviewMode === "SSTV"
      ? "images"
      : reviewMode === "RTTY" ||
          reviewMode === "PSK31" ||
          reviewMode === "CW-TEXT"
        ? "text segments"
        : "message blocks"
    : reviewMode === "WBFM"
      ? "groups"
      : reviewMode === "DAB"
        ? "FIC blocks"
        : reviewMode === "SRD"
          ? "readings"
          : "frames";
  const reviewStatus = held
    ? `Frozen at ${held.frozenAt}. Reception continues; ${Math.max(0, live.accepted - held.accepted).toLocaleString()} additional ${reviewMode === "POCSAG" ? "messages with complete framing" : `accepted ${unit}`}.`
    : `${records.length} retained ${geographic ? "targets" : effectiveView === "messages" ? "records" : "results"}${geographic ? ` · ${positioned.length} positioned` : ""} · ${live.accepted.toLocaleString()} ${reviewMode === "POCSAG" ? "messages with complete framing" : `accepted ${unit}`}`;
  const columns = geographic ? geographicColumns(reviewMode) : [];

  const inspector = selected && !satellite && (
    <aside className="decoder-inspector" aria-label="Selected decoded record">
      <div className="decoder-inspector-heading">
        <h2>{selected.label}</h2>
        <InstrumentButton
          type="button"
          className="secondary"
          aria-label="Close record details"
          onClick={closeInspector}
        >
          <AppIcon name="close" />
        </InstrumentButton>
      </div>
      <p>{selected.summary}</p>
      <p className="decoder-integrity">{selected.integrity}</p>
      <dl className="decoder-context">
        {selected.fields.map(([name, val]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{val}</dd>
          </div>
        ))}
        {supportsMap && (
          <div>
            <dt>Map position</dt>
            <dd>{positionText(selected)}</dd>
          </div>
        )}
        <div>
          <dt>{reviewMode === "DAB" ? "Service format" : "Receive clock"}</dt>
          <dd>{selected.clock}</dd>
        </div>
        <div>
          <dt>Acquisition</dt>
          <dd>
            {metadata
              ? `${metadata.source} · generation ${metadata.sessionGeneration}`
              : `generation ${display.receiver.sessionGeneration}`}
          </dd>
        </div>
      </dl>
      <details>
        <summary>Raw published record</summary>
        <pre>{decoderJson(selected.raw)}</pre>
      </details>
    </aside>
  );
  const results = geographic ? (
    <div
      className="decoder-record-list decoder-table-wrap"
      id="decoder-retained-results"
      hidden={trayCollapsed}
      tabIndex={0}
      aria-label="Retained decoded records"
    >
      <table className="decoder-target-table">
        <caption className="visually-hidden">
          {title} · retained decoded records
        </caption>
        <thead>
          <tr>
            <th scope="col">Target</th>
            {columns.map((name) => (
              <th scope="col" key={name}>
                {name}
              </th>
            ))}
            <th scope="col">Position</th>
          </tr>
        </thead>
        <tbody>
          {pageRecords.map((r) => (
            <tr
              key={r.key}
              className={
                selected?.key === r.key ? "decoder-row-selected" : undefined
              }
            >
              <td>
                <InstrumentButton
                  type="button"
                  className="decoder-record"
                  aria-pressed={selected?.key === r.key}
                  onClick={(event) => selectRecord(r.key, event.currentTarget)}
                >
                  <strong>{r.label}</strong>
                </InstrumentButton>
              </td>
              {columns.map((name) => (
                <td key={name}>
                  {r.fields.find(([field]) => field === name)?.[1] ?? "Unknown"}
                </td>
              ))}
              <td>{positionText(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : reviewMode === "POCSAG" ? (
    <div
      className="decoder-record-list decoder-table-wrap"
      aria-label="Retained paging messages"
    >
      <table className="decoder-target-table decoder-paging-table">
        <thead>
          <tr>
            {[
              "Address",
              "Message",
              "Rate / function",
              "Framing / integrity",
              "Input clock",
            ].map((label) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRecords.map((r) => (
            <tr
              key={r.key}
              className={
                selected?.key === r.key ? "decoder-row-selected" : undefined
              }
            >
              <td>
                <InstrumentButton
                  type="button"
                  className="decoder-record"
                  aria-pressed={selected?.key === r.key}
                  onClick={(event) => selectRecord(r.key, event.currentTarget)}
                >
                  <strong>{r.label}</strong>
                </InstrumentButton>
              </td>
              <td>{r.summary}</td>
              <td>
                {r.fields.find(([f]) => f === "Bit rate")?.[1]} /{" "}
                {r.fields.find(([f]) => f === "Function")?.[1]}
              </td>
              <td>{r.integrity}</td>
              <td>{r.clock}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="decoder-record-list" aria-label="Retained decoded records">
      {pageRecords.map((r) => (
        <InstrumentButton
          type="button"
          key={r.key}
          className="decoder-record"
          aria-pressed={selected?.key === r.key}
          onClick={(event) => selectRecord(r.key, event.currentTarget)}
        >
          <strong>{r.label}</strong>
          <span>{r.summary}</span>
          <small>{r.clock}</small>
        </InstrumentButton>
      ))}
    </div>
  );

  return (
    <section
      id="decoder-view"
      role="tabpanel"
      aria-labelledby="decoder-tab"
      hidden={!props.active}
      className="decoder-workbench"
    >
      {presenting && (
        <>
          <div className="decoder-toolbar" hidden={customAppOutput}>
            {props.appMode === "APRS" && (
              <label className="radio-app-aprs-filter">
                <span className="visually-hidden">APRS view</span>
                <select
                  aria-label="APRS view"
                  value={aprsCategory}
                  onChange={(event) => {
                    const category = event.currentTarget.value;
                    setAprsCategory(category);
                    setView({
                      format,
                      value: category === "stations" ? "map" : "messages",
                    });
                    setSelection(undefined);
                  }}
                >
                  <option value="stations">Stations & map</option>
                  <option value="packets">All packets</option>
                  <option value="messages">Messages</option>
                  <option value="weather">Weather</option>
                </select>
              </label>
            )}
            {!props.appMode && (
              <>
                <div className="decoder-format">
                  <label htmlFor="decoder-format" className="visually-hidden">
                    Format
                  </label>
                  <select
                    id="decoder-format"
                    value={format}
                    onChange={(event) => {
                      setBrowsedFormat(
                        event.currentTarget.value as DecoderFormat,
                      );
                      setFrozen(undefined);
                      setSelection(undefined);
                      setFilter("");
                      setIssue("");
                      setView(undefined);
                      setTrayCollapsed(false);
                    }}
                  >
                    {DECODER_FORMATS.map((f) => (
                      <option key={f.mode} value={f.mode}>
                        {f.label}
                      </option>
                    ))}
                    <option value="satellite">
                      Satellite · Recording workflow
                    </option>
                  </select>
                </div>
                <div className="decoder-input-summary">
                  <span>{sourceLabel}</span>
                  {!props.remote && (
                    <small>
                      {(channelHz / 1e6).toLocaleString(undefined, {
                        maximumFractionDigits: 6,
                      })}{" "}
                      MHz ·{" "}
                      {(inputRate / 1e6).toLocaleString(undefined, {
                        maximumFractionDigits: 3,
                      })}{" "}
                      MS/s
                    </small>
                  )}
                </div>
                <span className="decoder-state">{stateLabel}</span>
              </>
            )}
            {!satellite && hasReviewData && (
              <>
                {reviewMode === "POCSAG" && (
                  <InstrumentButton
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setClearedPaging({
                        identity,
                        keys: records.map((r) => r.key),
                      });
                      setSelection(undefined);
                    }}
                  >
                    Clear displayed messages
                  </InstrumentButton>
                )}
                <label className="decoder-filter">
                  <span className="visually-hidden">Filter results</span>
                  <AppIcon name="search" />
                  <input
                    type="search"
                    placeholder="Filter decoded results"
                    value={filter}
                    onChange={(event) => setFilter(event.currentTarget.value)}
                  />
                </label>
                <InstrumentButton
                  type="button"
                  className="secondary"
                  onClick={freezeDisplay}
                  disabled={!applied}
                >
                  <AppIcon name={held ? "play" : "pause"} />
                  {held ? "Resume live display" : "Freeze display"}
                </InstrumentButton>
                <details
                  className="decoder-export-menu"
                  ref={exportMenu}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.currentTarget.open = false;
                      event.currentTarget.querySelector("summary")?.focus();
                    }
                  }}
                >
                  <summary>
                    <AppIcon name="download" />
                    Export JSON
                  </summary>
                  <div className="decoder-popover" aria-label="Export options">
                    <p>Retained export includes unfiltered records.</p>
                    <InstrumentButton
                      type="button"
                      className="secondary"
                      disabled={!records.length}
                      onClick={() => exportResults("retained")}
                    >
                      Export retained{" "}
                      {effectiveView === "messages" ? "messages" : "results"}
                    </InstrumentButton>
                    <InstrumentButton
                      type="button"
                      className="secondary"
                      disabled={!selected}
                      onClick={() => exportResults("selected")}
                    >
                      Export selected record
                    </InstrumentButton>
                  </div>
                </details>
              </>
            )}
            <details className="decoder-input-details">
              <summary aria-label="Input details" title="Input details">
                <AppIcon name="sliders" />
                <span>Input details</span>
              </summary>
              <div className="decoder-popover">
                <dl className="decoder-context">
                  <div>
                    <dt>Input</dt>
                    <dd>{sourceLabel}</dd>
                  </div>
                  <div>
                    <dt>Channel</dt>
                    <dd>
                      {props.remote
                        ? "See remote Receiver"
                        : `${channelHz.toLocaleString()} Hz`}
                    </dd>
                  </div>
                  <div>
                    <dt>Input rate</dt>
                    <dd>
                      {props.remote
                        ? "No raw I/Q rate"
                        : `${inputRate.toLocaleString()} samples/s`}
                    </dd>
                  </div>
                  <div>
                    <dt>Applied mode</dt>
                    <dd>
                      {props.remote ? "Local decoders unavailable" : props.mode}
                    </dd>
                  </div>
                  {!props.remote && props.mode !== props.configuredMode && (
                    <div>
                      <dt>Configured for next start</dt>
                      <dd>{props.configuredMode}</dd>
                    </div>
                  )}
                </dl>
                <p className="decoder-hint">
                  Using the shared receiver. Changing views preserves its
                  current state.
                </p>
                <p className="decoder-hint">
                  Up to {retention.maximumResults} retained results
                  {retention.maximumMessages
                    ? ` and ${retention.maximumMessages} recent records`
                    : ""}
                  . Fields may come from earlier accepted records. Export to
                  save a reviewed result.
                </p>
              </div>
            </details>
          </div>
          {!props.appMode && !satellite && needsApply && (
            <div className="decoder-configuration">
              <p>
                Apply {reviewMode} to replace {props.configuredMode}.{" "}
                {props.configurationPreview(reviewMode)}
              </p>
              <InstrumentButton
                type="button"
                disabled={Boolean(applyBlocked)}
                onClick={() => {
                  props.onApply(reviewMode);
                  setIssue("");
                }}
              >
                Apply {reviewMode}
              </InstrumentButton>
              {applyBlocked && <p>{applyBlocked}</p>}
            </div>
          )}
          {applied && ["WBFM", "DAB"].includes(reviewMode) && (
            <details
              className="decoder-audio decoder-audio-disclosure"
              aria-label="Shared audio"
              open={receiver.lifecycle === "running"}
            >
              <summary>
                Shared audio ·{" "}
                {receiver.lifecycle === "running" ? "receiving" : "idle"}
              </summary>
              <div className="decoder-audio-controls">
                <label htmlFor="decoder-volume">
                  Volume · {Math.round(props.volume * 100)}%
                  <InstrumentRange
                    id="decoder-volume"

                    min="0"
                    max="1"
                    step="0.01"
                    value={props.volume}
                    onChange={(event) =>
                      props.onVolumeChange(event.currentTarget.valueAsNumber)
                    }
                  />
                </label>
                <InstrumentButton
                  type="button"
                  className="secondary"
                  onClick={() => {
                    if (props.volume > 0) {
                      setAudibleVolume(props.volume);
                      props.onVolumeChange(0);
                    } else props.onVolumeChange(audibleVolume);
                  }}
                >
                  {props.volume > 0 ? "Mute audio" : "Unmute audio"}
                </InstrumentButton>
                {reviewMode === "DAB" && !props.appMode && props.serviceControl}
              </div>
            </details>
          )}
          <section
            className={`decoder-stage${geographic ? " decoder-geographic" : ""}${props.appMode === "DAB" ? " radio-app-dab-stage" : ""}${customAppOutput ? " radio-app-output-stage" : ""}`}
            aria-label="Decoded results"
          >
            <h2 className="visually-hidden">{title}</h2>
            {issue && <p role="alert">{issue}</p>}
            {frozen && !held && (
              <p className="decoder-hint">
                The source, format or acquisition generation changed. The
                previous frozen display has been cleared.
              </p>
            )}
            {customAppOutput ? (
              <div
                className="radio-app-output-target"
                ref={props.onAppContentTarget}
              />
            ) : props.appMode === "DAB" ? (
              <>
                <nav className="radio-app-dab-tabs" aria-label="DAB content">
                  <InstrumentButton
                    type="button"
                    className="secondary"
                    aria-pressed={dabPane === "programmes"}
                    onClick={() => setDabPane("programmes")}
                  >
                    Programmes
                  </InstrumentButton>
                  <InstrumentButton
                    type="button"
                    className="secondary"
                    aria-pressed={dabPane === "media"}
                    onClick={() => setDabPane("media")}
                  >
                    Now playing
                  </InstrumentButton>
                </nav>
                <div
                  data-app-pane-selected={dabPane === "programmes"}
                  className="radio-app-programme-target"
                  ref={props.onAppContentTarget}
                />
                <section
                  className="radio-app-media"
                  data-app-pane-selected={dabPane === "media"}
                  aria-label="Selected DAB service metadata"
                >
                  <h3>Live text &amp; slideshow</h3>
                  <DabMetadata metadata={receiver.dab?.programmeMetadata} />
                </section>
              </>
            ) : satellite ? (
              <div className="decoder-empty">
                <AppIcon name="folder" />
                <h3>Start with an original I/Q recording</h3>
                <p>
                  Use Receiver’s capture and replay workflow to retain the
                  original samples and acquisition metadata. Satellite image
                  decoding is a planned extension; this build has no native LRPT
                  decoder or image output.
                </p>
                {props.remote && <p>{unavailable}</p>}
                <InstrumentButton
                  type="button"
                  disabled={props.remote}
                  onClick={props.onOpenRecording}
                >
                  Open recording workflow
                </InstrumentButton>
              </div>
            ) : (
              <>
                {!filtered.length ? (
                  <div className="decoder-empty">
                    <AppIcon name="radio" />
                    <h3>
                      {filter
                        ? "No matching results"
                        : unavailable
                          ? "Input unavailable"
                          : modeChangePending
                            ? "Applying configuration"
                            : needsApply
                              ? "Preview decoder format"
                              : receiver.lifecycle === "running"
                                ? "Waiting for decoded data"
                                : supportsMap
                                  ? "Ready for decoded positions"
                                  : "Ready for decoded data"}
                    </h3>
                    <p>
                      {filter
                        ? "Change or clear the filter to see retained results."
                        : unavailable || empty}
                    </p>
                    <div className="decoder-empty-actions">
                      {filter ? (
                        <InstrumentButton
                          type="button"
                          onClick={() => setFilter("")}
                        >
                          Clear filter
                        </InstrumentButton>
                      ) : (
                        <>
                          <InstrumentButton
                            type="button"
                            onClick={props.onOpenReceiver}
                          >
                            <AppIcon name="radio" />
                            Open Receiver
                          </InstrumentButton>
                          <InstrumentButton
                            type="button"
                            className="secondary"
                            disabled={props.remote}
                            onClick={props.onOpenRecording}
                          >
                            <AppIcon name="folder" />
                            Open I/Q recording
                          </InstrumentButton>
                        </>
                      )}
                    </div>
                  </div>
                ) : geographic ? (
                  <div
                    className={`decoder-canvas${selected ? " decoder-canvas-inspecting" : ""}`}
                  >
                    <div className="decoder-map">
                      {positioned.length > 0 ? (
                        <>
                          <div className="decoder-map-actions">
                            {hasTracks && (
                              <label className="checkbox-control target-track-toggle">
                                <input
                                  type="checkbox"
                                  checked={showTracks}
                                  onChange={(event) =>
                                    setShowTracks(event.target.checked)
                                  }
                                />
                                Show tracks
                              </label>
                            )}
                            <InstrumentButton
                              type="button"
                              className="secondary"
                              onClick={() =>
                                setFitRequest((value) => value + 1)
                              }
                            >
                              <AppIcon name="crosshair" />
                              Fit targets
                            </InstrumentButton>
                          </div>
                          <PositionMap
                            receiverLocation={props.receiverLocation}
                            pannable
                            label={`${reviewMode} decoded positions`}
                            showTracks={hasTracks && showTracks}
                            framingKey={`${identity}:${display.receiver.sessionGeneration}:${fitRequest}`}
                            points={pageRecords.map((r) => ({
                              latitude: r.latitude ?? null,
                              longitude: r.longitude ?? null,
                              label: r.label,
                              key: r.key,
                              map: r.map,
                            }))}
                            selectedKey={selected?.key}
                            onPointSelect={selectRecord}
                          />
                        </>
                      ) : (
                        <div className="decoder-no-position">
                          <AppIcon name="pin" />
                          <h3>No reported map positions</h3>
                          <p>
                            Retained records remain available below. Unknown or
                            ambiguous coordinates are not plotted.
                          </p>
                        </div>
                      )}
                    </div>
                    {inspector}
                  </div>
                ) : (
                  <div
                    className={`decoder-results-body${selected ? " decoder-results-inspecting" : ""}`}
                  >
                    {results}
                    {inspector}
                  </div>
                )}
                <div className="decoder-tray-heading">
                  <p className="decoder-review-status">
                    {reviewStatus}
                    {filter &&
                      ` · ${filtered.length} match the filter; retained export includes unfiltered records.`}
                  </p>
                  {props.appMode !== "APRS" &&
                    hasReviewData &&
                    (hasMessages || supportsMap) && (
                      <div
                        className="decoder-view-options"
                        role="group"
                        aria-label="Result presentation"
                      >
                        <InstrumentButton
                          type="button"
                          className="secondary"
                          aria-pressed={effectiveView === "results"}
                          onClick={() => setView({ format, value: "results" })}
                        >
                          Results
                        </InstrumentButton>
                        {hasMessages && (
                          <InstrumentButton
                            type="button"
                            className="secondary"
                            aria-pressed={effectiveView === "messages"}
                            onClick={() =>
                              setView({ format, value: "messages" })
                            }
                          >
                            {reviewMode === "RS41"
                              ? "Frames"
                              : reviewMode === "SRD"
                                ? "Bursts"
                                : "Messages"}
                          </InstrumentButton>
                        )}
                        {supportsMap && (
                          <InstrumentButton
                            type="button"
                            className="secondary"
                            aria-pressed={geographic}
                            onClick={() => setView({ format, value: "map" })}
                          >
                            Map & results
                          </InstrumentButton>
                        )}
                      </div>
                    )}
                  {geographic && filtered.length > 0 && (
                    <InstrumentButton
                      type="button"
                      className="secondary decoder-tray-toggle"
                      aria-expanded={!trayCollapsed}
                      aria-controls="decoder-retained-results"
                      onClick={() => setTrayCollapsed((value) => !value)}
                    >
                      <AppIcon name={trayCollapsed ? "expand" : "collapse"} />
                      {trayCollapsed ? "Show results" : "Hide results"}
                    </InstrumentButton>
                  )}
                </div>
                {geographic && filtered.length > 0 && results}
                {props.appMode && filtered.length > 0 && !trayCollapsed && (
                  <nav
                    className="radio-app-pagination"
                    aria-label="Result pages"
                  >
                    <InstrumentButton
                      type="button"
                      className="secondary"
                      disabled={!page}
                      onClick={() =>
                        setPageSelection({ key: pageKey, page: page - 1 })
                      }
                    >
                      Previous
                    </InstrumentButton>
                    <small>
                      {page + 1} / {pages} · {filtered.length} results
                    </small>
                    <InstrumentButton
                      type="button"
                      className="secondary"
                      disabled={page + 1 >= pages}
                      onClick={() =>
                        setPageSelection({ key: pageKey, page: page + 1 })
                      }
                    >
                      Next
                    </InstrumentButton>
                  </nav>
                )}
                {applied && reviewMode === "DAB" && (
                  <section
                    aria-label="Selected DAB service metadata"
                    className="decoder-broadcast"
                  >
                    <h3>Selected service · live text & slideshow</h3>
                    {held && (
                      <p className="decoder-hint">
                        Broadcast media continues live while the service list is
                        frozen.
                      </p>
                    )}
                    <DabMetadata metadata={receiver.dab?.programmeMetadata} />
                  </section>
                )}
              </>
            )}
          </section>
          {reviewMode === "POCSAG" && applied && (
            <PocsagPanel receiver={receiver} />
          )}
          {isTextMode(reviewMode) && applied && !props.appMode && (
            <TextDecodePanel receiver={receiver} mode={reviewMode} />
          )}
          <footer className="decoder-footer">
            {!satellite && (
              <details
                className="decoder-reception-details"
                open={toolsOpen}
                onToggle={(event) => setToolsOpen(event.currentTarget.open)}
              >
                <summary>
                  Reception details &amp; protocol tools ·{" "}
                  {receiver.lifecycle === "running" ? "live" : "idle"}
                </summary>
                {toolsOpen && (
                  <>
                    <p className="decoder-hint">
                      These existing audio, metadata, integrity and protocol
                      export tools follow the live receiver even when the review
                      display is frozen.
                    </p>
                    <DecodedResults
                      receiver={receiver}
                      source={props.source}
                      mode={props.mode}
                      volume={props.volume}
                      active
                      panelId="decoder-protocol-tools"
                    />
                  </>
                )}
              </details>
            )}
            {!props.appMode && (hasReviewData || satellite) && (
              <nav aria-label="Decoder handoffs">
                <InstrumentButton
                  type="button"
                  className="secondary"
                  onClick={props.onOpenReceiver}
                >
                  <AppIcon name="radio" />
                  Open Receiver
                </InstrumentButton>
                <InstrumentButton
                  type="button"
                  className="secondary"
                  disabled={props.remote}
                  onClick={props.onOpenRecording}
                >
                  <AppIcon name="folder" />
                  Open I/Q recording
                </InstrumentButton>
              </nav>
            )}
          </footer>
        </>
      )}
    </section>
  );
}

function hasPosition(record: DecoderRecord): boolean {
  return (
    record.latitude != null &&
    record.longitude != null &&
    Number.isFinite(record.latitude) &&
    Number.isFinite(record.longitude) &&
    Math.abs(record.latitude) <= 90 &&
    Math.abs(record.longitude) <= 180
  );
}
function positionText(record: DecoderRecord): string {
  return hasPosition(record)
    ? `${record.latitude!.toFixed(4)}°, ${record.longitude!.toFixed(4)}°`
    : "Unknown";
}
function geographicColumns(mode: ReceiverMode): string[] {
  switch (mode) {
    case "ADS-B":
      return [
        "Reported aircraft category",
        "Barometric altitude",
        "Ground speed",
        "Track",
      ];
    case "AIS":
      return ["MMSI", "Speed over ground", "Course", "Received channel"];

    case "APRS":
      return ["Destination", "Path", "Position ambiguity", "Status"];
    case "RS41":
      return [
        "Ellipsoidal altitude",
        "Horizontal speed",
        "Vertical velocity",
        "Frame counter",
      ];
    default:
      return [];
  }
}
