import { atlasReferenceMode } from "./atlasStationSelection";
import { validateBookmark, type Bookmark } from "./bookmarks";
import { compatibleSourceRate } from "./sourcePreferences";
import { normalizeModeSettings } from "./receiverConfig";
import {
  validateSourceConfiguration,
  validateSourceRoute,
  type SourceConfiguration,
} from "./sourceCapabilities";
import type { ReceiverController } from "./receiverController";
import type { ReceptionCandidate } from "./receptionEvidence";
import type { PublicStation } from "./publicStations";
export function publicReceptionCandidate(
  station: PublicStation,
  transmissionId: string,
): ReceptionCandidate {
  const ref = station.transmissions.find((t) => t.id === transmissionId);
  if (!ref)
    throw new Error(
      "The public reference is no longer available. Search again.",
    );
  const mode = atlasReferenceMode(ref.broadcast_format);
  if (!mode)
    throw new Error(
      "This declared format has no supported station handoff. Use a local frequency guide; station identity will not be attached.",
    );
  return {
    station_id: station.id,
    transmission_id: ref.id,
    station_name: station.name,
    frequency_hz: ref.frequency_hz,
    bandwidth_hz:
      ref.bandwidth_hz ??
      (mode === "WBFM" ? 200000 : mode === "AM" ? 10000 : 12500),
    mode,
  };
}
/** Full preflight for a preview; the existing application callbacks repeat guards at mutation time. */
export function previewDiscovery(
  controller: ReceiverController,
  item: Bookmark,
  config: SourceConfiguration,
): string {
  const bookmark = validateBookmark(item),
    before = controller.getSnapshot(),
    source = config.source ?? "rtl-sdr";
  if (
    source === "replay" ||
    before.cleanupRequired ||
    !["idle", "connected", "running", "error"].includes(before.lifecycle) ||
    controller.getRecordingStatus()
  )
    throw new Error(
      "Finish recording, replay or the current receiver operation before applying search settings.",
    );
  const running = before.lifecycle === "running";
  const rate = running
    ? before.session?.actualSampleRateHz
    : compatibleSourceRate(
        source,
        bookmark.settings.mode,
        config.sampleRateHz ?? 1024000,
      );
  if (rate === undefined)
    throw new Error("This profile needs a compatible source and sample rate.");
  const settings = normalizeModeSettings(bookmark.settings);
  if (running) {
    validateSourceRoute(source, settings, rate, bookmark.frequencyHz);
    if (before.session?.source !== source)
      throw new Error("Receiver source changed. Preview again.");
    validateSourceRoute(
      source,
      settings,
      rate,
      before.session.selectedChannelFrequencyHz,
    );
    controller.validateTune(bookmark.frequencyHz, {}, settings);
  } else
    validateSourceConfiguration({
      ...config,
      sampleRateHz: rate,
      channelFrequencyHz: bookmark.frequencyHz,
      modeSettings: settings,
    });
  return `${source} · ${bookmark.frequencyHz / 1e6} MHz · ${settings.mode} · ${settings.bandwidthHz.toLocaleString()} Hz bandwidth · ${(rate / 1e6).toLocaleString()} MS/s. ${running ? "Apply will reconfigure active reception." : "Settings only; Connect and Start remain manual."}`;
}
export function unchangedPublicReference(
  original: PublicStation,
  current: PublicStation,
  referenceId: string,
): void {
  if (
    original.id !== current.id ||
    original.publication_version !== current.publication_version ||
    JSON.stringify(original.transmissions.find((t) => t.id === referenceId)) !==
      JSON.stringify(current.transmissions.find((t) => t.id === referenceId)) ||
    !current.transmissions.some((t) => t.id === referenceId)
  )
    throw new Error(
      "The public reference changed or was retired. Search again before applying it.",
    );
}
