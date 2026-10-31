import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { planChannelTune } from "../radio/receiverConfig";
import {
  isWidebandRate,
  sourceCapabilities,
  validateSourceFrequency,
} from "../radio/sourceCapabilities";
import type { SourceSessionMetadata } from "../radio/types";
import { rtlDeviceFrequency } from "../radio/rtlInput";
import { editableFrequencyMHz, formatFrequencyMHz } from "./frequencyFormat";
import { ActionButton } from "./ActionButton";

export function ReceiverTuningControl({
  session,
  configuredFrequencyHz,
  disabled,
  autoRecenter,
  onAutoRecenter,
  onTuneCenter,
  channelPending = false,
  channelSelectionWarning,
}: {
  session?: SourceSessionMetadata;
  configuredFrequencyHz: number;
  disabled: boolean;
  channelPending?: boolean;
  channelSelectionWarning?: string;
  autoRecenter: boolean;
  onAutoRecenter: (enabled: boolean) => void;
  onTuneCenter: (frequencyHz: number) => Promise<string | undefined>;
}) {
  const centerHz = session?.hardwareCenterFrequencyHz ?? configuredFrequencyHz;
  const [draft, setDraft] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [applying, setApplying] = useState(false);
  useEffect(() => {
    setDraft(undefined);
    setMessage(undefined);
  }, [session?.source]);
  const value = draft ?? formatFrequencyMHz(centerHz);
  let requestedHz = value.trim() ? Number(value) * 1_000_000 : NaN;
  if (session && sourceCapabilities(session.source).frequency.integerHz)
    requestedHz = Math.round(requestedHz);
  const replay = session?.source === "replay";
  const channelHz = channelPending ? configuredFrequencyHz : session?.selectedChannelFrequencyHz;
  const busy = disabled || applying || !session || replay;
  const busyReason = replay
    ? "The receiver center is fixed in a recording."
    : !session
      ? "Start reception to adjust the receiver center."
      : applying || disabled
        ? "Wait for reception to resume and any tuning or scan to finish."
        : undefined;
  const requiresCenter =
    session &&
    ["airspy", "hackrf", "bladerf", "usrp-b205"].includes(session.source) &&
    !isWidebandRate(session.actualSampleRateHz) &&
    ["DAB", "ADS-B"].includes(session.mode);
  let invalid: string | undefined;
  let channelWarning: string | undefined;
  if (session && draft !== undefined) {
    try {
      if (session.source === "rtl-sdr" && session.rtlInput) rtlDeviceFrequency(requestedHz, session.rtlInput);
      validateSourceFrequency(
        session.source,
        requestedHz,
        ["airspy", "hackrf", "bladerf", "usrp-b205"].includes(session.source)
          ? session.actualSampleRateHz
          : 0,
        session.hackrf?.capabilities.identity,
      );
    } catch (error) {
      invalid = error instanceof Error ? error.message : "Enter a valid receiver center.";
    }
    if (!invalid && session.mode !== "OFF") try {
      planChannelTune(
        centerHz,
        channelHz!,
        session.actualSampleRateHz,
        session.channelBandwidthHz,
        { centerFrequencyHz: requestedHz },
      );
      if (requiresCenter && requestedHz !== channelHz)
        throw new Error(
          `${session.mode} requires the receiver center to match the channel at this sample rate.`,
        );
    } catch {
      channelWarning = "This move clears the channel and switches to Spectrum only because the complete channel cannot play in the new window.";
    }
  }
  const pending =
    draft !== undefined && (channelPending || Math.round(requestedHz) !== Math.round(centerHz));
  let channelInvalid: string | undefined;
  if (session && channelHz !== undefined) {
    try {
      validateSourceFrequency(session.source, channelHz,
        ["airspy", "hackrf", "bladerf", "usrp-b205"].includes(session.source) ? session.actualSampleRateHz : 0,
        session.hackrf?.capabilities.identity);
      planChannelTune(centerHz, channelHz, session.actualSampleRateHz, session.channelBandwidthHz,
        { centerFrequencyHz: channelHz });
    } catch (error) {
      channelInvalid = error instanceof Error ? error.message : "Enter a valid channel frequency.";
    }
  }
  const apply = async (frequencyHz: number) => {
    if (busy) return;
    setApplying(true);
    setMessage(undefined);
    try {
      const error = await onTuneCenter(frequencyHz);
      if (error) setMessage(error);
      else setDraft(undefined);
    } finally {
      setApplying(false);
    }
  };
  return (
    <div className="receiver-tuning" aria-label="Receiver window tuning">
      <div className="receiver-frequency-controls">
        <label className="receiver-center-field">
          <span title="Hardware capture center; the listening channel is set in Channel settings">Capture center</span>
          <span className="unit-input">
            <input
              type="number"
              step="0.000001"
              value={value}
              title={`${centerHz.toLocaleString(undefined, { maximumFractionDigits: 3 })} Hz accepted receiver center`}
              aria-label="Receiver center frequency"
              aria-describedby={
                replay
                  ? "receiver-center-help receiver-center-state"
                  : "receiver-center-state"
              }
              aria-invalid={Boolean(invalid)}
              disabled={!session || replay || applying}
              onFocus={(event) => {
                flushSync(() =>
                  setDraft(
                    (current) => current ?? editableFrequencyMHz(centerHz),
                  ),
                );
                event.currentTarget.select();
              }}
              onBlur={() => {
                if (Math.round(requestedHz) === Math.round(centerHz))
                  setDraft(undefined);
              }}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
                setMessage(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setDraft(undefined);
                  setMessage(undefined);
                }
                if (event.key === "Enter" && pending && !invalid) {
                  event.preventDefault();
                  void apply(requestedHz);
                }
              }}
            />
            <span>MHz</span>
          </span>
        </label>

        <ActionButton
          type="button"
          className="secondary toolbar-action"
          title="Apply the entered receiver frequency"
          disabled={busy || !pending || Boolean(invalid)}
          disabledReason={
            busyReason ?? invalid ?? "Edit the receiver frequency first."
          }
          onClick={() => void apply(requestedHz)}
        >
          Set
        </ActionButton>
      </div>
      <div className="receiver-tuning-actions">
        <label
          className="receiver-auto-center"
          title="Move the receiver window when needed to keep the complete channel in range"
        >
          <input
            type="checkbox"
            role="switch"
            aria-label="Follow channel"
            checked={autoRecenter}
            disabled={disabled || applying || replay}
            onChange={(event) => onAutoRecenter(event.currentTarget.checked)}
          />
          <span className="receiver-switch-track" aria-hidden="true" />
          <span>Follow channel</span>
          <span className="receiver-switch-state" aria-hidden="true">
            {autoRecenter ? "On" : "Off"}
          </span>
        </label>
        <ActionButton
          type="button"
          className="secondary toolbar-action"
          icon="crosshair"
          title={channelPending ? "Apply the pending channel and recenter the receiver once" : "Set the receiver frequency to the current channel once"}
          disabled={busy || Boolean(channelInvalid) || (!channelPending && channelHz === centerHz)}
          disabledReason={
            busyReason ?? channelInvalid ?? "The receiver is already centered on the channel."
          }
          onClick={() =>
            channelHz !== undefined && void apply(channelHz)
          }
        >
          To channel
        </ActionButton>
      </div>
      {replay && (
        <small id="receiver-center-help">
          Capture center is fixed during replay
        </small>
      )}
      {channelPending && !replay && <small>To channel applies the pending channel and recenters once. Follow channel stays {autoRecenter ? "on" : "off"}.</small>}
      {(channelWarning ?? channelSelectionWarning) && <small role="status" className="receiver-tuning-error">{channelWarning ?? channelSelectionWarning}</small>}
      <small
        id="receiver-center-state"
        role="status"
        className={
          invalid || message ? "receiver-tuning-error" : "pending-change"
        }
      >
        {invalid ??
          message ??
          (applying
            ? "Applying receiver frequency…"
            : pending
              ? "Change pending · press Set or Enter"
              : "")}
      </small>
    </div>
  );
}
