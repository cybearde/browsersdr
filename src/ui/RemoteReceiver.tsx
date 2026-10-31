import { InstrumentRange } from "./InstrumentRange";
import { AudioCapturePanel } from "./AudioCaptureSection";
import { RemoteLocationPanel } from "./ReceiverLocationPanel";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { SourceKind } from "../radio/types";
import type { WorkspaceLayout } from "./WorkspaceLayout";
import { ReceiverWorkspace, ReceiverSourceOptions } from "./ReceiverWorkspace";
import { AppIcon } from "./AppIcon";

interface RemoteWorkspaceProps {
  active: boolean;
  /** Presentation can be hidden while Decoder keeps the shared stream active. */
  visible?: boolean;
  layout: WorkspaceLayout;
  onLayoutChange: Dispatch<SetStateAction<WorkspaceLayout>>;
  onSource: (source: SourceKind) => void;
}
import { OpenWebRxClient } from "../remote/openWebRxClient";
import { KiwiClient, type KiwiSnapshot } from "../remote/kiwiClient";
import {
  defaultTune,
  REMOTE_MODES,
  type RemoteMode,
  type RemoteTune,
} from "../remote/openWebRxProtocol";
import { RemoteSpectrum } from "../remote/RemoteSpectrum";
import { RemotePresetsPanel, useRemotePresets } from "./RemotePresetsPanel";
import {
  validateRemotePreset,
  type RemotePreset,
  type RemoteKind,
} from "../remote/remotePresets";
function savedAddress(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function RemoteReceiver({
  onStatus,
  initialPreset,
  ...workspace
}: {
  onStatus: (status: string) => void;
  initialPreset?: RemotePreset;
} & RemoteWorkspaceProps) {
  const [selection, setSelection] = useState<{
    kind: RemoteKind;
    preset?: RemotePreset;
    revision: number;
  }>(() => ({
    kind: initialPreset?.kind ?? "openwebrx",
    preset: initialPreset,
    revision: 0,
  }));
  const external = useRef(initialPreset);
  const library = useRemotePresets();
  useEffect(() => {
    if (initialPreset && initialPreset !== external.current) {
      external.current = initialPreset;
      setSelection((old) => ({
        kind: initialPreset.kind,
        preset: initialPreset,
        revision: old.revision + 1,
      }));
    }
  }, [initialPreset]);
  return (
    <RemoteReceiverView
      key={`${selection.kind}-${selection.revision}`}
      kind={selection.kind}
      onKind={(kind) =>
        setSelection((old) => ({ kind, revision: old.revision + 1 }))
      }
      onStatus={onStatus}
      loaded={selection.preset}
      library={library}
      workspace={workspace}
      onLoad={(value) => {
        const preset = validateRemotePreset(value);
        setSelection((old) => ({
          kind: preset.kind,
          preset,
          revision: old.revision + 1,
        }));
      }}
    />
  );
}

function RemoteReceiverView({
  kind,
  onKind,
  onStatus,
  loaded,
  library,
  onLoad,
  workspace,
}: {
  kind: "openwebrx" | "kiwi";
  onKind: (kind: "openwebrx" | "kiwi") => void;
  onStatus: (status: string) => void;
  loaded?: RemotePreset;
  library: ReturnType<typeof useRemotePresets>;
  onLoad: (preset: RemotePreset) => void;
  workspace: RemoteWorkspaceProps;
}) {
  const { active, layout, onLayoutChange, onSource } = workspace;
  const [tool, setTool] = useState<"audio" | "session">("audio");
  const [client] = useState(() =>
    kind === "kiwi" ? new KiwiClient() : new OpenWebRxClient(),
  );
  const addressKey = `browsersdr.${kind === "kiwi" ? "kiwisdr" : "openwebrx"}.address`;
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const kiwiState = kind === "kiwi" ? (state as KiwiSnapshot) : undefined;
  const [address, setAddress] = useState(
    () => loaded?.address ?? savedAddress(addressKey),
  );
  const [draft, setDraft] = useState<RemoteTune>();
  const [frequency, setFrequency] = useState("");
  const [volume, setVolume] = useState(0.38);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const [savedChannel, setSavedChannel] = useState(() =>
    loaded?.tune ? loaded : undefined,
  );
  const [applyingPreset, setApplyingPreset] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Lazy mounting may finish after the user has already opened another tool.
    // Only move focus while they are still entering through the source control.
    const focused = document.activeElement;
    const entering = focused === document.body ||
      (focused instanceof HTMLSelectElement && focused.getAttribute("aria-label") === "Signal source");
    if (entering && input.current?.getClientRects().length) input.current.focus();
    return () => client.stop();
  }, [client]);
  useEffect(() => {
    if (!active) client.stop();
  }, [active, client]);
  useEffect(() => {
    onStatus(state.status);
  }, [onStatus, state.status]);
  useEffect(() => {
    if (!state.tune) return;
    setDraft(state.tune);
    setFrequency(String(state.tune.frequency / 1e6));
  }, [state.tune]);
  useEffect(() => {
    if (state.status === "connected") {
      try {
        localStorage.setItem(addressKey, state.website);
      } catch {
        /* Optional address preference. */
      }
    }
  }, [addressKey, state.status, state.website]);
  const connected =
    state.status === "connected" || state.status === "listening";
  const listening = state.status === "listening";
  const pending =
    state.status === "connecting" || Boolean(state.pendingProfile);
  const currentTune = () => {
    if (!draft || !frequency.trim())
      throw new Error("Enter a channel frequency.");
    const hz = Number(frequency) * 1e6;
    if (!Number.isFinite(hz))
      throw new Error("Enter a valid frequency in MHz.");
    return { ...draft, frequency: Math.round(hz) };
  };
  const apply = async () => {
    if (savedChannel || pending || !connected) return;
    setError("");
    try {
      const tune = currentTune();
      if (listening) client.tune(tune);
      else await client.start(tune, volume);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  const modes = state.modes.length
    ? state.modes
    : (Object.keys(REMOTE_MODES) as RemoteMode[]);
  const finishPreset = (preset: RemotePreset) => {
    if (!preset.tune) return;
    client.validateTune(preset.tune);
    if (client instanceof KiwiClient && preset.zoom !== undefined) {
      if (preset.zoom > (kiwiState?.maxZoom ?? 0))
        throw new Error(
          "The saved zoom is unavailable on this receiver. Edit the preset or choose another receiver.",
        );
      client.setZoom(preset.zoom);
    }
    setDraft(preset.tune);
    setFrequency(String(preset.tune.frequency / 1e6));
    setSavedChannel(undefined);
    setApplyingPreset(false);
    setError("");
  };
  const preparePreset = () => {
    if (!savedChannel?.tune || state.status !== "connected" || pending) return;
    setError("");
    try {
      if (
        kind === "openwebrx" &&
        savedChannel.profile &&
        savedChannel.profile !== state.config?.profile
      ) {
        if (
          !state.profiles.some((profile) => profile.id === savedChannel.profile)
        )
          throw new Error(
            "The saved receiver band is unavailable. Edit the preset or choose another receiver.",
          );
        setApplyingPreset(true);
        client.selectProfile(savedChannel.profile);
      } else finishPreset(savedChannel);
    } catch (reason) {
      setApplyingPreset(false);
      setError((reason as Error).message);
    }
  };
  useEffect(() => {
    if (!applyingPreset || !savedChannel) return;
    if (state.status === "error" || state.status === "disconnected") {
      setApplyingPreset(false);
      return;
    }
    if (state.pendingProfile || state.config?.profile !== savedChannel.profile)
      return;
    try {
      finishPreset(savedChannel);
    } catch (reason) {
      setApplyingPreset(false);
      setError((reason as Error).message);
    }
    // Wait for this explicitly requested band's actual confirmation. Never Listen here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    applyingPreset,
    savedChannel,
    state.config,
    state.pendingProfile,
    state.status,
  ]);
  return (
    <ReceiverWorkspace id="remote-view" hidden={!(workspace.visible ?? active)}>
      <section
        className="signal-stage acquire-stage remote-source"
        aria-labelledby="remote-heading"
      >
        <div className="stage-heading">
          <span aria-hidden="true">01</span>
          <div>
            <p>Acquire</p>
            <h3 id="remote-heading" className="icon-label">
              <AppIcon name="radio" />
              Signal source
            </h3>
          </div>
          <button
            type="button"
            className="stage-collapse secondary"
            aria-label={
              layout.sourceCollapsed
                ? "Expand source panel"
                : "Collapse source panel"
            }
            aria-expanded={!layout.sourceCollapsed}
            aria-controls="remote-source-body"
            onClick={() =>
              onLayoutChange((old) => ({
                ...old,
                sourceCollapsed: !old.sourceCollapsed,
              }))
            }
          >
            {layout.sourceCollapsed ? "+" : "−"}
          </button>
        </div>
        <div
          id="remote-source-body"
          className="stage-body"
          hidden={layout.sourceCollapsed}
        >
          <div className="stage-controls acquire-controls remote-source-controls">
            <label>
              Source
              <select
                aria-label="Signal source"
                value="remote"
                onChange={(e) => {
                  if (e.currentTarget.value !== "remote") {
                    client.stop();
                    onSource(e.currentTarget.value as SourceKind);
                  }
                }}
              >
                <ReceiverSourceOptions />
              </select>
            </label>
            <label>
              Receiver type
              <select
                aria-label="Remote receiver type"
                title="Changing receiver type disconnects the current remote stream"
                value={kind}
                onChange={(e) => onKind(e.currentTarget.value as typeof kind)}
              >
                <option value="openwebrx">OpenWebRX</option>
                <option value="kiwi">KiwiSDR</option>
              </select>
            </label>
            <h4 className="remote-kind">
              {kind === "kiwi" ? "KiwiSDR" : "OpenWebRX"}
            </h4>
            <div className="remote-connect-row">
              <label className="remote-address">
                Receiver website
                <input
                  ref={input}
                  type="url"
                  value={address}
                  disabled={connected || pending}
                  placeholder="https://receiver.example/"
                  onChange={(e) => setAddress(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !connected && !pending)
                      client.connect(address);
                  }}
                />
              </label>
              {!connected && !pending ? (
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    client.connect(address);
                  }}
                >
                  Connect
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => client.stop()}
                >
                  {listening ? "Stop listening" : "Disconnect"}
                </button>
              )}
              {state.website && (
                <a
                  href={state.website}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open receiver website ↗
                </a>
              )}
            </div>
            <p className="remote-message" role="status">
              {state.title && `${state.title} · `}
              {state.message}
            </p>
            {error && (
              <p role="alert" className="remote-error">
                {error}
              </p>
            )}
            {kind === "openwebrx" && (
              <div className="remote-band-control">
                {" "}
                <label>
                  Band
                  <select
                    aria-label="Remote band"
                    disabled={!connected || listening || pending}
                    value={state.pendingProfile || state.config?.profile || ""}
                    onChange={(e) => {
                      setError("");
                      try {
                        client.selectProfile(e.currentTarget.value);
                      } catch (reason) {
                        setError((reason as Error).message);
                      }
                    }}
                  >
                    <option value="" disabled>
                      Receiver band
                    </option>
                    {state.config &&
                      !state.profiles.some(
                        (p) => p.id === state.config?.profile,
                      ) && (
                        <option value={state.config.profile}>
                          Current band
                        </option>
                      )}
                    {state.profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {connected && !pending && state.website && <RemoteLocationPanel
              key={`${kind}:${state.website}:${state.config?.profile ?? "unknown"}`}
              scope={`remote:${kind}:${state.website}:${state.config?.profile ?? "unknown"}`}
            />}
            <a
              href="https://www.receiverbook.de/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Find a receiver ↗
            </a>
          </div>
        </div>
      </section>
      <section
        className="signal-stage demodulate-stage remote-channel"
        aria-labelledby="remote-channel-heading"
      >
        <div className="stage-heading">
          <span aria-hidden="true">03</span>
          <div>
            <p>Tune & listen</p>
            <h3 id="remote-channel-heading" className="icon-label">
              <AppIcon name="sliders" />
              Channel settings
            </h3>
          </div>
          <button
            type="button"
            className="stage-collapse secondary"
            aria-label={
              layout.channelCollapsed
                ? "Expand channel panel"
                : "Collapse channel panel"
            }
            aria-expanded={!layout.channelCollapsed}
            aria-controls="remote-channel-body"
            onClick={() =>
              onLayoutChange((old) => ({
                ...old,
                channelCollapsed: !old.channelCollapsed,
              }))
            }
          >
            {layout.channelCollapsed ? "+" : "−"}
          </button>
        </div>
        <div
          id="remote-channel-body"
          className="stage-body"
          hidden={layout.channelCollapsed}
        >
          {savedChannel && (
            <div className="remote-preset-review">
              <p>
                {loaded?.name} · {savedChannel.tune!.frequency / 1e6} MHz ·{" "}
                {REMOTE_MODES[savedChannel.tune!.mode]}. Connect, then apply
                this saved channel before Listen.
                {savedChannel.profile &&
                  " Applying can select the saved receiver band."}
              </p>
              <button
                type="button"
                className="secondary"
                disabled={!connected || listening || pending || applyingPreset}
                onClick={preparePreset}
              >
                {applyingPreset
                  ? "Waiting for saved band…"
                  : "Apply saved channel"}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={pending}
                onClick={() => {
                  setSavedChannel(undefined);
                  setApplyingPreset(false);
                  setError("");
                }}
              >
                Use receiver defaults
              </button>
            </div>
          )}
          <div className="stage-controls remote-channel-controls">
            <label>
              Channel · MHz
              <input
                aria-label="Remote channel MHz"
                inputMode="decimal"
                value={frequency}
                disabled={!connected || pending}
                onChange={(e) => setFrequency(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void apply();
                }}
              />
            </label>
            <label>
              Mode
              <select
                aria-label="Remote mode"
                value={draft?.mode ?? "am"}
                disabled={!connected || pending}
                onChange={(e) => {
                  if (!state.config || !draft) return;
                  const tune = defaultTune(
                    state.config,
                    e.currentTarget.value as RemoteMode,
                  );
                  if (kind === "kiwi" && tune.mode === "nfm") {
                    tune.lowCut = -Math.min(
                      5000,
                      Math.floor((kiwiState?.sampleRate ?? 12000) / 2),
                    );
                    tune.highCut = -tune.lowCut;
                  }
                  setDraft({ ...tune, frequency: draft.frequency });
                }}
              >
                {modes.map((mode) => (
                  <option key={mode} value={mode}>
                    {REMOTE_MODES[mode]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!connected || pending || Boolean(savedChannel)}
              onClick={() => void apply()}
            >
              {listening ? "Tune" : "Listen"}
            </button>
            <RemotePresetsPanel
              library={library}
              receiver={{ kind, address }}
              channel={
                connected && !pending && !savedChannel
                  ? () => {
                      const tune = currentTune();
                      client.validateTune(tune);
                      return {
                        kind,
                        address: state.website,
                        tune,
                        ...(kind === "kiwi"
                          ? { zoom: kiwiState?.zoom ?? 0 }
                          : { profile: state.config?.profile }),
                      };
                    }
                  : undefined
              }
              onLoad={onLoad}
            />
          </div>
          <details className="advanced-controls">
            <summary>Filter settings</summary>
            <div className="remote-filters">
              {(["lowCut", "highCut", "squelch"] as const)
                .filter((key) => kind !== "kiwi" || key !== "squelch")
                .map((key) => (
                  <label key={key}>
                    {key === "lowCut"
                      ? "Low cut · Hz"
                      : key === "highCut"
                        ? "High cut · Hz"
                        : "Squelch · relative dB"}
                    <input
                      type="number"
                      value={draft?.[key] ?? ""}
                      disabled={!connected || pending}
                      onChange={(e) => {
                        if (draft)
                          setDraft({
                            ...draft,
                            [key]: Number(e.currentTarget.value),
                          });
                      }}
                    />
                  </label>
                ))}
            </div>
            <p>
              CW uses a 700 Hz beat tone; CW filter edges are relative to that
              oscillator. Filter and mode changes take effect with Listen or
              Tune. Tuning is requested, without a hardware acknowledgement or
              transmitter identity claim.
            </p>
          </details>
        </div>
      </section>
      <section
        className="graphics-panel remote-graphics"
        aria-labelledby="remote-spectrum-heading"
      >
        <div className="panel-heading spectrum-heading">
          <div className="stage-heading">
            <span aria-hidden="true">02</span>
            <div>
              <p>View</p>
              <h2 id="remote-spectrum-heading">Spectrum & waterfall</h2>
            </div>
          </div>
          <span className="remote-spectrum-origin">
            Server FFT · relative power
          </span>
        </div>
        <div className="spectrum-toolbar remote-spectrum-toolbar">
          <span>
            {state.config
              ? `${(state.config.center / 1e6).toFixed(6)} MHz · ${(state.config.rate / 1e6).toFixed(3)} MHz span`
              : "Connect to view the receiver band"}
            {listening && state.tune && (
              <small className="remote-requested">
                Requested channel {(state.tune.frequency / 1e6).toFixed(6)} MHz
                · {REMOTE_MODES[state.tune.mode]}
              </small>
            )}
          </span>
          {kind === "kiwi" && (
            <div className="remote-zoom-control">
              <label>
                Waterfall zoom
                <select
                  aria-label="Waterfall zoom"
                  disabled={!connected}
                  value={kiwiState?.zoom ?? 0}
                  onChange={(e) => {
                    setError("");
                    try {
                      if (client instanceof KiwiClient)
                        client.setZoom(Number(e.currentTarget.value));
                    } catch (reason) {
                      setError((reason as Error).message);
                    }
                  }}
                >
                  {Array.from(
                    {
                      length: (kiwiState?.maxZoom ?? 0) + 1,
                    },
                    (_, zoom) => (
                      <option key={zoom} value={zoom}>
                        {zoom === 0 ? "Full band" : `${2 ** zoom}×`}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>
          )}
          <button
            type="button"
            className="secondary"
            aria-pressed={paused}
            onClick={() => setPaused((p) => !p)}
          >
            <AppIcon name={paused ? "play" : "pause"} />
            {paused ? "Resume display" : "Pause display"}
          </button>
        </div>
        <div className="spectrum-display">
          <div className="canvas-frame">
            <RemoteSpectrum
              client={client}
              config={state.config}
              paused={paused}
              active={active}
            />
          </div>
        </div>
      </section>
      <section
        className={`receiver-dock remote-footer ${layout.dockExpanded ? "is-expanded" : "is-collapsed"}`}
        aria-label="Receiver tools"
      >
        <div className="receiver-dock-bar">
          <div
            className="receiver-dock-tabs"
            role="tablist"
            aria-label="Receiver tool panels"
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                return;
              e.preventDefault();
              const next =
                e.key === "Home"
                  ? "audio"
                  : e.key === "End"
                    ? "session"
                    : tool === "audio"
                      ? "session"
                      : "audio";
              setTool(next);
              onLayoutChange((old) => ({ ...old, dockExpanded: true }));
              document.getElementById(`remote-${next}-tab`)?.focus();
            }}
          >
            {(["audio", "session"] as const).map((view) => (
              <button
                key={view}
                type="button"
                role="tab"
                id={`remote-${view}-tab`}
                aria-selected={tool === view}
                tabIndex={tool === view ? 0 : -1}
                aria-controls={`remote-${view}-panel`}
                onClick={() => {
                  setTool(view);
                  onLayoutChange((old) => ({ ...old, dockExpanded: true }));
                }}
              >
                <AppIcon name={view === "audio" ? "headphones" : "file"} />
                {view === "audio" ? "Audio" : "Session"}
              </button>
            ))}
          </div>
          <div className="dock-actions">
            <button
              type="button"
              className="secondary dock-toggle"
              aria-expanded={layout.dockExpanded}
              onClick={() =>
                onLayoutChange((old) => ({
                  ...old,
                  dockExpanded: !old.dockExpanded,
                }))
              }
            >
              <AppIcon name={layout.dockExpanded ? "collapse" : "expand"} />
              {layout.dockExpanded ? "Collapse" : "Expand"}
            </button>
          </div>
        </div>
        <section
          id="remote-audio-panel"
          role="tabpanel"
          aria-labelledby="remote-audio-tab"
          className="receiver-dock-panel"
          hidden={!layout.dockExpanded || tool !== "audio"}
        >
          <AudioCapturePanel />
          <div className="remote-audio-controls">
            <label className="remote-volume">
              Volume
              <InstrumentRange

                min="0"
                max="100"
                value={Math.round(volume * 100)}
                onChange={(e) => {
                  const value = Number(e.currentTarget.value) / 100;
                  setVolume(value);
                  client.volume(value);
                }}
              />
            </label>
            {listening && state.audioState !== "running" && (
              <button
                type="button"
                onClick={() => {
                  void client
                    .resume(volume)
                    .catch((reason) => setError((reason as Error).message));
                }}
              >
                Resume audio
              </button>
            )}
            <span className="status-pill">
              {listening ? `Audio ${state.audioState}` : "Audio off"}
            </span>
          </div>
          <details className="remote-stream-details">
            <summary>Stream details</summary>
            <p>
              {state.version || "Version not received"} ·{" "}
              {state.fftFrames.toLocaleString()} spectrum frames ·{" "}
              {state.audioSamples.toLocaleString()} audio samples · audio{" "}
              {state.audioState} · {state.audioDrops} audio drops/resets
            </p>
            {state.config && (
              <p>
                Receiver {(state.config.center / 1e6).toFixed(6)} MHz ·{" "}
                {(state.config.rate / 1e6).toFixed(3)} MHz span ·{" "}
                {state.config.fftSize} bins · audio{" "}
                {state.config.audioCompression}, spectrum{" "}
                {state.config.fftCompression}.{" "}
                {kind === "kiwi"
                  ? `${kiwiState?.sampleRate.toFixed(3) ?? ""} samples/s server audio; ${kiwiState?.packetDiscontinuities ?? 0} audio packet discontinuities.`
                  : "Band selection can change a shared receiver; use its website for access rules."}
              </p>
            )}
          </details>
        </section>
        <section
          id="remote-session-panel"
          role="tabpanel"
          aria-labelledby="remote-session-tab"
          className="receiver-dock-panel"
          hidden={!layout.dockExpanded || tool !== "session"}
        >
          <p>
            Audio and spectrum are processed by{" "}
            {kind === "kiwi" ? "KiwiSDR" : "OpenWebRX"}. This source does not
            provide raw I/Q for recording, local decoders or Explorer. Remote
            presets and links are available in Remote favorites.
          </p>
          <p>
            Changing source or leaving Receiver disconnects this stream. Return,
            Connect and Listen explicitly to resume.
            {kind === "kiwi" &&
              " Connect reserves a remote receiver channel with browser audio off."}
          </p>
        </section>
      </section>
    </ReceiverWorkspace>
  );
}
