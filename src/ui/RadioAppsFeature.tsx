import {
  RadioAppSetupForm,
  configurableRadioApp,
  appSetupDefault,
} from "./RadioAppSetupForm";
import { FmRadioOutput, WeatherSensorOutput } from "./RadioAppOutputs";
import {
  sameAppModeSettings,
  type RadioAppSetup,
} from "../radio/radioAppSetup";
import type { Bookmark } from "../radio/bookmarks";
import { useRadioAppPageSize } from "./useRadioAppPageSize";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  Plane,
  Ship,
  Radio,
  ArrowLeft,
  ArrowRight,
  Grid2X2,
  MapPin,
  CloudSun,
  Sprout,
} from "lucide-react";
import type { ReceiverController } from "../radio/receiverController";
import type { AnalysisPipeline } from "../dsp/analysisPipeline";
import { RadioAppSession, type RadioAppHost } from "../radio/radioAppSession";
import {
  loadRadioAppPreferences,
  saveRadioAppPreferences,
  matchingRadioApps,
  profileMatches,
  radioApp,
  type RadioAppId,
} from "../radio/radioApps";
import { DAB_BAND_III_CHANNELS, dabChannelAt } from "../dab/channels";
import { InstrumentButton } from "./InstrumentButton";
import { AppIcon } from "./AppIcon";
import { useOverlayDialog } from "./useOverlayDialog";
import "./RadioApps.css";

export interface RadioAppsFeatureProps extends RadioAppHost {
  controller: ReceiverController;
  analysis: AnalysisPipeline;
  request: { revision: number; app?: RadioAppId; open: boolean };
  trigger: RefObject<HTMLButtonElement | null>;
  target: HTMLElement | null;
  contentTarget: HTMLElement | null;
  appView: boolean;
  close(): void;
  openReceiver(): void;
  reopen(app?: RadioAppId): void;
  dabAudioAvailable: boolean | null;
  fmFavorites: readonly Bookmark[];
  saveFmFavorite(name: string): void;
  favoriteMessage: string;
}
const icons = {
  aircraft: Plane,
  ships: Ship,
  dab: Radio,
  fm: Radio,
  aprs: MapPin,
  balloons: CloudSun,
  acars: Plane,
  sensors: Sprout,
};
export function RadioAppsFeature(props: RadioAppsFeatureProps) {
  const latest = useRef(props);
  latest.current = props;
  const [session] = useState(
    () =>
      new RadioAppSession(
        props.controller,
        props.analysis,
        () => latest.current,
      ),
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const scan = useSyncExternalStore(
    session.scanner.subscribe,
    session.scanner.getSnapshot,
  );
  const searching = useSyncExternalStore(
    session.searcher.subscribe,
    session.searcher.getSnapshot,
  );
  const [preferences, setPreferences] = useState(() =>
    loadRadioAppPreferences(localStorage),
  );
  const preferenceRef = useRef(preferences);
  preferenceRef.current = preferences;
  useEffect(
    () =>
      session.subscribe(() => {
        const accepted = session.getSnapshot(),
          old = preferenceRef.current;
        if (
          !accepted.app ||
          !accepted.setup ||
          session.searcher.getSnapshot().status === "searching"
        )
          return;
        if (
          old.lastApp === accepted.app &&
          JSON.stringify(old.setups?.[accepted.app]) ===
            JSON.stringify(accepted.setup)
        )
          return;
        const next = {
          ...old,
          lastApp: accepted.app,
          setups: { ...old.setups, [accepted.app]: accepted.setup },
        };
        preferenceRef.current = next;
        setPreferences(next);
        saveRadioAppPreferences(localStorage, next);
      }),
    [session],
  );
  const [query, setQuery] = useState("");
  useEffect(() => {
    session.attach();
    return () => session.dispose();
  }, [session]);
  const save = (app: RadioAppId, block: string, setup?: RadioAppSetup) => {
    const next = {
      ...preferences,
      lastApp: app,
      block,
      setups: setup
        ? { ...preferences.setups, [app]: setup }
        : preferences.setups,
    };
    setPreferences(next);
    saveRadioAppPreferences(localStorage, next);
  };
  return (
    <>
      <RadioAppDialog
        key={props.request.revision}
        props={props}
        session={session}
        initialApp={props.request.app}
        initialBlock={preferences.block}
        preferences={preferences}
        query={query}
        setQuery={setQuery}
        save={save}
      />
      {props.target &&
        createPortal(
          <RadioAppPanel
            props={props}
            session={session}
            preferences={preferences}
            saveService={(key, ensembleId, block) => {
              const next = {
                ...preferences,
                serviceKey: key,
                ensembleId,
                block,
              };
              setPreferences(next);
              saveRadioAppPreferences(localStorage, next);
            }}
          />,
          props.target,
        )}
      {state.issue && !props.request.open && !state.app && (
        <div className="radio-app-global-issue">
          <p role="alert">{state.issue}</p>
          {state.canRestore && (
            <InstrumentButton
              type="button"
              className="secondary"
              disabled={state.busy}
              onClick={() => void session.restore()}
            >
              Restore previous setup
            </InstrumentButton>
          )}
        </div>
      )}
      {state.note && !state.app && (
        <p className="radio-app-restore-note" role="status">
          {state.note}
        </p>
      )}
      {searching.status === "searching" && !props.appView && (
        <div className="radio-app-scan-indicator" role="status">
          {searching.message}
          <InstrumentButton
            type="button"
            onClick={() => void session.searcher.cancel()}
          >
            Cancel search
          </InstrumentButton>
        </div>
      )}
      {scan.status === "scanning" && !props.appView && (
        <div className="radio-app-scan-indicator" role="status">
          DAB station scan · {scan.message}{" "}
          <InstrumentButton
            type="button"
            onClick={() => void session.scanner.cancel()}
          >
            Stop scan
          </InstrumentButton>
        </div>
      )}
    </>
  );
}
function RadioAppDialog({
  props,
  session,
  initialApp,
  initialBlock,
  preferences,
  query,
  setQuery,
  save,
}: {
  props: RadioAppsFeatureProps;
  session: RadioAppSession;
  initialApp?: RadioAppId;
  initialBlock: string;
  preferences: ReturnType<typeof loadRadioAppPreferences>;
  query: string;
  setQuery(value: string): void;
  save(app: RadioAppId, block: string, setup?: RadioAppSetup): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const destination = useRef<"app" | "receiver">(undefined);
  const [selected, setSelected] = useState(initialApp);
  const [block, setBlock] = useState(initialBlock);
  const [setups, setSetups] = useState<
    Partial<Record<RadioAppId, RadioAppSetup>>
  >(preferences.setups ?? {});
  const setup =
    selected && configurableRadioApp(selected)
      ? (setups[selected] ??
        appSetupDefault(selected, props.configuration.channelFrequencyHz))
      : undefined;
  const [issue, setIssue] = useState("");
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const receiver = useSyncExternalStore(
    props.controller.subscribe,
    props.controller.getSnapshot,
  );
  useOverlayDialog(
    props.request.open,
    dialog,
    props.trigger,
    selected ? ".radio-app-setup h3" : "input[type=search]",
    () => {
      if (destination.current === "receiver") props.openReceiver();
      if (destination.current === "app")
        document.querySelector<HTMLElement>(".radio-app-context h2")?.focus();
      destination.current = undefined;
    },
  );
  const close = () => {
    destination.current = undefined;
    session.cancelNavigation();
    props.close();
  };
  let summary = "",
    reason = "",
    action = "Use settings & open";
  if (selected) {
    try {
      const plan = session.plan(selected, block, setup);
      summary = plan.summary;
      action =
        plan.action === "navigate"
          ? "Open current reception"
          : plan.action === "replay"
            ? "View this recording"
            : plan.action === "stop"
              ? "Stop & prepare app"
              : action;
    } catch (error) {
      reason = error instanceof Error ? error.message : "Receiver not ready.";
    }
  }
  return createPortal(
    <dialog
      ref={dialog}
      className="favorites-panel radio-app-dialog overlay-motion"
      aria-label="Radio Apps"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const b = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < b.left ||
            event.clientX > b.right ||
            event.clientY < b.top ||
            event.clientY > b.bottom
          )
            close();
        }
      }}
    >
      <div className="favorites-heading">
        <div>
          <span className="radio-app-eyebrow">
            YOUR RECEIVER, READY FOR A PURPOSE
          </span>
          <h2>
            <Grid2X2 size={21} aria-hidden="true" /> Radio Apps
          </h2>
          <p>Choose what you want to do. We’ll prepare the radio settings.</p>
        </div>
        <InstrumentButton
          type="button"
          className="secondary"
          aria-label="Close Radio Apps"
          onClick={close}
        >
          <AppIcon name="close" />
        </InstrumentButton>
      </div>
      <div className="radio-app-dialog-body">
        {!selected ? (
          <>
            <label>
              Find a radio app
              <input
                type="search"
                placeholder="Aircraft, ships, digital radio…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="radio-app-cards">
              {matchingRadioApps(query).map((app) => {
                const Icon = icons[app.id];
                let readiness = "Ready to configure";
                try {
                  session.plan(app.id, block);
                } catch (error) {
                  readiness =
                    error instanceof Error
                      ? error.message
                      : "Choose a receiver";
                }
                return (
                  <article key={app.id}>
                    <div className={`radio-app-art radio-app-art-${app.id}`}>
                      <Icon size={42} strokeWidth={1.3} aria-hidden="true" />
                      <span>{app.subtitle}</span>
                    </div>
                    <h3>{app.name}</h3>
                    <p>{app.description}</p>
                    <small>{readiness}</small>
                    <InstrumentButton
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setSelected(app.id);
                        setIssue("");
                      }}
                    >
                      Open app <ArrowRight size={15} aria-hidden="true" />
                    </InstrumentButton>
                  </article>
                );
              })}
            </div>
            {!matchingRadioApps(query).length && (
              <p>
                No matching Radio App. Try FM, APRS, balloons, aircraft, sensors
                or digital radio.
              </p>
            )}
          </>
        ) : (
          <section
            className="radio-app-setup"
            aria-label={`${radioApp(selected).name} setup`}
          >
            <InstrumentButton
              type="button"
              className="secondary"
              onClick={() => setSelected(undefined)}
            >
              <ArrowLeft size={15} aria-hidden="true" /> All Radio Apps
            </InstrumentButton>
            <h3 tabIndex={-1}>{radioApp(selected).name}</h3>
            <p>{radioApp(selected).description}</p>
            <p>{radioApp(selected).help}</p>
            {setup && (
              <RadioAppSetupForm
                app={selected}
                setup={setup}
                onChange={(next) =>
                  setSetups((old) => ({ ...old, [selected]: next }))
                }
              />
            )}
            {selected === "dab" && (
              <>
                <label>
                  DAB block
                  <select
                    value={block}
                    onChange={(e) => setBlock(e.target.value)}
                  >
                    {DAB_BAND_III_CHANNELS.map((channel) => (
                      <option key={channel.label} value={channel.label}>
                        {channel.label} · {channel.frequencyHz / 1e6} MHz
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  Use a known block now, or prepare DAB and choose Find stations
                  in the app. Scanning starts only after you start reception and
                  select Start station scan.
                </p>
                {props.dabAudioAvailable === false && (
                  <p>
                    Browser AAC audio is unavailable. Ensemble discovery and
                    programme labels are separate from audio playback.
                  </p>
                )}
              </>
            )}
            <div className="radio-app-settings">
              <span>RECEIVER SETUP</span>
              <p>{reason || summary}</p>
              <small>
                {props.configuration.source} · {receiver.lifecycle}
              </small>
            </div>
            {(issue || state.issue) && (
              <p role="alert">{issue || state.issue}</p>
            )}
            <div className="radio-app-actions">
              {state.canRestore && (
                <InstrumentButton
                  type="button"
                  className="secondary"
                  disabled={state.busy}
                  onClick={() => void session.restore()}
                >
                  Restore previous setup
                </InstrumentButton>
              )}
              <InstrumentButton
                type="button"
                disabled={Boolean(reason) || state.busy}
                onClick={() => {
                  setIssue("");
                  void session
                    .launch(selected, block, setup)
                    .then((accepted) => {
                      if (accepted) {
                        save(selected, block, setup);
                        destination.current = "app";
                        props.close();
                      }
                    })
                    .catch((error) => setIssue(error.message));
                }}
              >
                {state.busy ? "Preparing app…" : action}
              </InstrumentButton>
              <InstrumentButton
                type="button"
                className="secondary"
                onClick={() => {
                  close();
                  destination.current = "receiver";
                }}
              >
                Receiver settings
              </InstrumentButton>
            </div>
          </section>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
function RadioAppPanel({
  props,
  session,
  preferences,
  saveService,
}: {
  props: RadioAppsFeatureProps;
  session: RadioAppSession;
  preferences: ReturnType<typeof loadRadioAppPreferences>;
  saveService(key: string, ensembleId: number, block: string): void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const receiver = useSyncExternalStore(
    props.controller.subscribe,
    props.controller.getSnapshot,
  );
  const scan = useSyncExternalStore(
    session.scanner.subscribe,
    session.scanner.getSnapshot,
  );
  const searching = useSyncExternalStore(
    session.searcher.subscribe,
    session.searcher.getSnapshot,
  );
  const [filter, setFilter] = useState(""),
    [subset, setSubset] = useState("all");
  const [issue, setIssue] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = useRadioAppPageSize();
  if (!state.app || !state.configuration) return null;
  const app = radioApp(state.app),
    scanBusy = scan.status === "scanning";
  const matches =
    (scanBusy &&
      receiver.session?.mode === "DAB" &&
      receiver.session.source === state.configuration.source) ||
    (receiver.lifecycle === "running"
      ? profileMatches(receiver, state.configuration)
      : props.configuration.source === state.configuration.source &&
        sameAppModeSettings(
          props.configuration.modeSettings,
          state.configuration.modeSettings,
        ) &&
        props.configuration.sampleRateHz === state.configuration.sampleRateHz &&
        props.configuration.channelFrequencyHz ===
          state.configuration.channelFrequencyHz);
  const running =
    receiver.lifecycle === "running" || receiver.lifecycle === "tuning";
  const starting = ["requesting-permission", "connecting", "starting"].includes(
    receiver.lifecycle,
  );
  const stopping = ["stopping", "disconnecting"].includes(receiver.lifecycle);
  const live = matches && receiver.lifecycle === "running";
  const dab = live ? receiver.dab : undefined;
  const targets =
    state.app === "aircraft" ? receiver.adsb?.targets : receiver.ais?.targets;
  const count = matches ? (targets?.length ?? 0) : 0;
  const positioned = matches
    ? (targets?.filter((t) => t.latitude !== null && t.longitude !== null)
        .length ?? 0)
    : 0;
  const accepted = matches
    ? state.app === "aircraft"
      ? (receiver.adsb?.validFrames ?? 0)
      : (receiver.ais?.validFrames ?? 0)
    : 0;
  const dataMatches =
    !props.remote && profileMatches(receiver, state.configuration);
  const blockedStart = props.remote
    ? "Choose a local I/Q receiver in Receiver settings."
    : receiver.cleanupRequired
      ? "Use Receiver settings to finish receiver recovery before starting."
      : receiver.hardwareSettingsPending
        ? "Wait for the receiver hardware settings to finish applying."
        : !matches
          ? "Receiver settings changed. Open App setup in App tools to prepare this app again."
          : props.blockedReason;
  const metrics =
    !dataMatches && !matches
      ? "Receiver settings changed"
      : state.app === "fm"
        ? `${state.configuration.channelFrequencyHz / 1e6} MHz · ${dataMatches ? (receiver.rds?.validGroups ?? 0) : 0} RDS groups`
        : state.app === "aprs"
          ? `${dataMatches ? (receiver.aprs?.stations.length ?? 0) : 0} stations · ${dataMatches ? (receiver.aprs?.counters.validAx25Frames ?? 0) : 0} packets`
          : state.app === "balloons"
            ? `${dataMatches ? (receiver.rs41?.sondes.length ?? 0) : 0} sondes · ${state.configuration.channelFrequencyHz / 1e6} MHz`
            : state.app === "acars"
              ? `${dataMatches ? (receiver.textModem?.counters.accepted ?? 0) : 0} accepted blocks · ${state.configuration.channelFrequencyHz / 1e6} MHz`
              : state.app === "sensors"
                ? `${dataMatches ? (receiver.srd?.devices.length ?? 0) : 0} sensors · ${dataMatches ? (receiver.srd?.counters.validatedReadings ?? 0) : 0} readings`
                : undefined;
  const status = receiver.cleanupRequired
    ? "Recovery needed"
    : searching.status === "searching"
      ? "Searching"
      : !matches
        ? "Custom setup"
        : scanBusy
          ? "Scanning"
          : starting
            ? "Starting…"
            : stopping
              ? "Stopping…"
              : live
                ? receiver.session?.source === "replay"
                  ? "Replay"
                  : "Receiving"
                : receiver.lifecycle === "error"
                  ? "Receiver error"
                  : "Ready";
  const play = (
    service: import("../radio/dabStationScan").ScannedDabService,
  ) => {
    setIssue("");
    void session
      .play(service)
      .then(() => {
        const selected = props.controller.getSnapshot().dab;
        if (
          selected?.ensemble?.id === service.ensembleId &&
          selected.serviceId === service.serviceId &&
          selected.subchannelId === service.subchannelId &&
          !session.getSnapshot().awaitingProgramme
        )
          saveService(service.key, service.ensembleId, service.block);
      })
      .catch((error) => setIssue(error.message));
  };
  const currentServices: import("../radio/dabStationScan").ScannedDabService[] =
    dab?.ensemble
      ? (dab.stations ?? []).map((station) => ({
          ...station,
          label: station.label ?? `Service 0x${station.serviceId.toString(16)}`,
          block:
            dabChannelAt(receiver.session!.selectedChannelFrequencyHz)?.label ??
            "",
          frequencyHz: receiver.session!.selectedChannelFrequencyHz,
          ensembleId: dab.ensemble!.id,
          ensembleLabel: dab.ensemble!.label,
        }))
      : [];
  const services = (
    scan.services.length ? scan.services : currentServices
  ).filter((service) =>
    `${service.label} ${service.ensembleLabel} ${service.block}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(services.length / pageSize)),
    currentPage = Math.min(page, pages - 1);
  const problem = issue || state.issue;
  return (
    <>
      <section className="radio-app-context" aria-label="Active Radio App">
        <div className="radio-app-identity">
          <h2 tabIndex={-1}>{app.name}</h2>
          <span className="radio-app-state" data-receiving={live}>
            {status}
          </span>
          <small>
            {state.app === "dab"
              ? `${dabChannelAt(state.configuration.channelFrequencyHz)?.label ?? "DAB"} · ${dab?.ensemble?.label ?? "DAB+"}`
              : (metrics ??
                `${count} ${state.app === "aircraft" ? "aircraft" : "vessels"} · ${positioned} positioned · ${accepted} messages`)}
          </small>
        </div>
        <div className="radio-app-actions">
          <InstrumentButton
            type="button"
            className="radio-app-transport"
            disabled={
              props.remote ||
              stopping ||
              (!running && !starting && (state.busy || Boolean(blockedStart)))
            }
            title={!running && !starting ? blockedStart : undefined}
            onClick={() => {
              setIssue("");
              void (running || starting ? session.stop() : session.start());
            }}
          >
            <AppIcon name={running || starting ? "stop" : "play"} />
            {stopping
              ? "Stopping…"
              : starting
                ? "Cancel start"
                : running
                  ? "Stop receiving"
                  : "Start receiving"}
          </InstrumentButton>
          <InstrumentButton
            type="button"
            className="secondary radio-app-receiver-settings"
            aria-label="Receiver settings"
            title="Receiver settings"
            onClick={props.openReceiver}
          >
            <AppIcon name="sliders" />
            <span>Receiver settings</span>
          </InstrumentButton>
          <details
            className="radio-app-tools"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
                event.stopPropagation();
              }
            }}
          >
            <summary aria-label="App tools" title="App tools">
              <AppIcon name="settings" />
              <span>App tools</span>
            </summary>
            <div className="radio-app-popover">
              <p>
                {props.configuration.source} ·{" "}
                {state.configuration.channelFrequencyHz / 1e6} MHz ·{" "}
                {state.configuration.sampleRateHz / 1e6} MS/s
              </p>
              <p>{app.help}</p>
              {state.setup && (
                <RadioAppQuickSetup
                  key={`${state.app}:${state.configuration.channelFrequencyHz}`}
                  app={state.app}
                  initialSetup={state.setup}
                  session={session}
                  block={preferences.block}
                  live={live}
                  disabled={
                    state.busy || scanBusy || searching.status === "searching"
                  }
                />
              )}
              {searching.message && <p role="status">{searching.message}</p>}
              {searching.status === "searching" && (
                <InstrumentButton
                  type="button"
                  onClick={() => void session.searcher.cancel()}
                >
                  Cancel search
                </InstrumentButton>
              )}
              {state.app === "ships" && (
                <p>
                  AIS 1: {receiver.ais?.channel1Frames ?? 0} · AIS 2:{" "}
                  {receiver.ais?.channel2Frames ?? 0}
                </p>
              )}
              {problem && <p>{problem}</p>}
              <InstrumentButton
                type="button"
                className="secondary"
                onClick={() => props.reopen(state.app)}
              >
                App setup
              </InstrumentButton>
              {state.canRestore && (
                <InstrumentButton
                  type="button"
                  className="secondary"
                  disabled={state.busy || scanBusy}
                  onClick={() => void session.restore()}
                >
                  Restore previous setup
                </InstrumentButton>
              )}
            </div>
          </details>
        </div>
        {searching.status === "searching" && (
          <p className="radio-app-search-progress" role="status">
            {searching.message}
            <InstrumentButton
              type="button"
              className="secondary"
              onClick={() => void session.searcher.cancel()}
            >
              Cancel search
            </InstrumentButton>
          </p>
        )}
        {problem && (
          <p className="radio-app-issue" role="alert" title={problem}>
            {problem}
          </p>
        )}
        {!problem && blockedStart && !starting && !stopping && (
          <p className="radio-app-issue" role="status" title={blockedStart}>
            {blockedStart}
          </p>
        )}
      </section>
      {state.app === "fm" &&
        state.setup &&
        props.contentTarget &&
        createPortal(
          <FmRadioOutput
            key={state.configuration.channelFrequencyHz}
            receiver={
              dataMatches
                ? receiver
                : { ...receiver, rds: undefined, fmStereoReception: undefined }
            }
            session={session}
            setup={state.setup}
            favorites={props.fmFavorites}
            saveFavorite={props.saveFmFavorite}
            favoriteMessage={props.favoriteMessage}
            compatible={matches && !props.remote}
          />,
          props.contentTarget,
        )}
      {state.app === "sensors" &&
        props.contentTarget &&
        createPortal(
          <WeatherSensorOutput
            key={receiver.sessionGeneration}
            receiver={dataMatches ? receiver : { ...receiver, srd: undefined }}
            compatible={matches && !props.remote}
          />,
          props.contentTarget,
        )}
      {state.app === "dab" &&
        props.contentTarget &&
        createPortal(
          <section
            className="radio-app-dab"
            aria-label="DAB programmes and scan"
          >
            <div className="radio-app-dab-heading">
              <h3>Programmes</h3>
              <small>
                {state.awaitingProgramme
                  ? "Audio suppressed"
                  : (dab?.decodedAudioSeconds ?? 0) > 0
                    ? "Decoded audio"
                    : (dab?.ficBlockCount ?? 0) > 0
                      ? "Reading services"
                      : "Waiting for ensemble"}
              </small>
            </div>
            <div className="radio-app-dab-controls">
              <label>
                <span className="visually-hidden">Scan blocks</span>
                <select
                  aria-label="Scan blocks"
                  value={subset}
                  disabled={scanBusy}
                  onChange={(e) => setSubset(e.target.value)}
                >
                  <option value="all">All blocks · 5A–13F</option>
                  <option value="current">Current block only</option>
                </select>
              </label>
              <InstrumentButton
                type="button"
                className="secondary"
                disabled={
                  !live ||
                  receiver.session?.source === "replay" ||
                  state.busy ||
                  (Boolean(props.blockedReason) && !scanBusy)
                }
                onClick={() => {
                  if (scanBusy) void session.scanner.cancel();
                  else {
                    setIssue("");
                    const blocks =
                      subset === "current"
                        ? DAB_BAND_III_CHANNELS.filter(
                            (c) =>
                              c.frequencyHz ===
                              receiver.session?.selectedChannelFrequencyHz,
                          )
                        : undefined;
                    void session
                      .scan(blocks)
                      .catch((error) => setIssue(error.message));
                  }
                }}
              >
                {scanBusy ? "Stop scan" : "Start station scan"}
              </InstrumentButton>
              {state.awaitingProgramme && (
                <InstrumentButton
                  type="button"
                  className="secondary"
                  disabled={!live || state.busy || scanBusy}
                  onClick={() =>
                    void session
                      .resumeProgramme()
                      .catch((error) => setIssue(error.message))
                  }
                >
                  Resume previous programme
                </InstrumentButton>
              )}
            </div>
            <p
              className="radio-app-scan-status"
              role="status"
              title={scan.message}
            >
              {scan.status === "scanning"
                ? scan.message
                : scan.status === "complete"
                  ? `Scan finished · ${scan.visited}/${scan.total} blocks · choose a programme`
                  : scan.message ||
                    (!live
                      ? "Start reception above to find stations."
                      : "Choose a programme, or scan to find other ensembles.")}
            </p>
            {props.dabAudioAvailable === false && (
              <p className="radio-app-scan-status">
                Browser AAC audio is unavailable; service discovery can
                continue.
              </p>
            )}
            <label className="radio-app-programme-filter">
              <span className="visually-hidden">
                Filter discovered programmes
              </span>
              <input
                type="search"
                placeholder="Filter programmes"
                aria-label="Filter discovered programmes"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <div
              className="radio-app-programmes"
              aria-label="Discovered DAB programmes"
            >
              {services
                .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
                .map((service) => (
                  <article
                    key={`${service.frequencyHz}:${service.ensembleId}:${service.key}`}
                  >
                    <div>
                      <strong>{service.label}</strong>
                      <small>
                        {service.ensembleLabel} · {service.block}
                        {scan.services.length
                          ? " · observed this scan"
                          : " · current ensemble"}
                      </small>
                    </div>
                    <InstrumentButton
                      type="button"
                      className="secondary"
                      disabled={
                        !live ||
                        state.busy ||
                        scanBusy ||
                        !service.playable ||
                        Boolean(props.blockedReason)
                      }
                      onClick={() => play(service)}
                    >
                      {!service.dabPlus
                        ? "MP2 unsupported"
                        : !service.playable
                          ? "Unavailable"
                          : "Play"}
                    </InstrumentButton>
                  </article>
                ))}
            </div>
            {!services.length && (
              <p className="display-note">
                {filter
                  ? "No programmes match this filter."
                  : "No decoded programmes yet."}
              </p>
            )}
            <nav className="radio-app-pagination" aria-label="Programme pages">
              <InstrumentButton
                type="button"
                className="secondary"
                disabled={!currentPage}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </InstrumentButton>
              <small>
                {currentPage + 1} / {pages} · {services.length} programmes
                {scan.overflow ? " · list truncated" : ""}
              </small>
              <InstrumentButton
                type="button"
                className="secondary"
                disabled={currentPage + 1 >= pages}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </InstrumentButton>
            </nav>
            {preferences.serviceKey && (
              <small
                className="radio-app-remembered"
                title={preferences.serviceKey}
              >
                Remembered programme · {preferences.block}
              </small>
            )}
          </section>,
          props.contentTarget,
        )}
    </>
  );
}

function RadioAppQuickSetup({
  app,
  initialSetup,
  session,
  block,
  live,
  disabled,
}: {
  app: RadioAppId;
  initialSetup: RadioAppSetup;
  session: RadioAppSession;
  block: string;
  live: boolean;
  disabled: boolean;
}) {
  const [setup, setSetup] = useState(initialSetup),
    [issue, setIssue] = useState("");
  const apply = async (search = false) => {
    setIssue("");
    try {
      if (await session.launch(app, block, setup)) {
        if (search) await session.search();
      }
    } catch (error) {
      setIssue((error as Error).message);
    }
  };
  return (
    <>
      <RadioAppSetupForm app={app} setup={setup} onChange={setSetup} />
      <InstrumentButton
        type="button"
        disabled={disabled}
        onClick={() => void apply()}
      >
        Apply app settings
      </InstrumentButton>
      {app === "balloons" && (
        <InstrumentButton
          type="button"
          className="secondary"
          disabled={disabled || !live}
          onClick={() => void apply(true)}
        >
          Find balloon
        </InstrumentButton>
      )}
      {issue && <p role="alert">{issue}</p>}
    </>
  );
}
