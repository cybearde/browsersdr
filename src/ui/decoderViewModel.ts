import { isTextMode } from "../textmodem/settings";
import type { ReceiverSnapshot } from "../radio/receiverController";
import type { ReceiverMode } from "../radio/receiverConfig";
import type { Ax25Address } from "../aprs/types";
import type { DigitalProvenance } from "../digital";

import {
  aircraftCategory,
  type TargetMapPresentation,
} from "./targetMapPresentation";

export interface DecoderRecord {
  key: string;
  label: string;
  summary: string;
  integrity: string;
  clock: string;
  latitude?: number;
  longitude?: number;
  fields: readonly (readonly [string, string])[];
  raw: unknown;
  map?: TargetMapPresentation;
  category?: string;
  hasWeather?: boolean;
}
export const DECODER_FORMATS = [
  {mode:"POCSAG",label:"POCSAG · Paging",title:"Paging messages"},
  { mode: "WEFAX", label: "WEFAX · Images", title: "Weather charts" },
  { mode: "SSTV", label: "SSTV · Images", title: "Amateur pictures" },
  { mode: "CW-TEXT", label: "CW + text", title: "Tentative Morse transcription" },
  { mode: "RTTY", label: "RTTY · Text", title: "Radioteletype text" },
  { mode: "PSK31", label: "BPSK31 · Text", title: "Amateur text" },
  { mode: "NAVTEX", label: "NAVTEX / SITOR-B", title: "Marine weather & safety messages" },
  { mode: "ACARS", label: "ACARS · Aviation", title: "VHF aviation messages" },
  { mode: "WBFM", label: "FM / RDS", title: "Broadcast metadata" },
  {
    mode: "DAB",
    label: "DAB / DAB+",
    title: "Services & broadcast data",
  },
  { mode: "ADS-B", label: "ADS-B · Aircraft", title: "Aircraft" },
  { mode: "AIS", label: "AIS · Vessels", title: "Vessels" },
  { mode: "APRS", label: "APRS · Packets", title: "Stations & packets" },
  { mode: "RS41", label: "RS41 · Radiosondes", title: "Radiosonde telemetry" },
  { mode: "SRD", label: "SRD · Devices", title: "Devices & bursts" },
] as const;
export type DecoderFormat =
  (typeof DECODER_FORMATS)[number]["mode"] | "satellite";
const value = (n: number | null | undefined, unit: string) =>
  n == null ? "Unknown" : `${n.toLocaleString()} ${unit}`;
const address = (a: Ax25Address) =>
  `${a.callsign}${a.ssid ? `-${a.ssid}` : ""}${a.repeated ? "*" : ""}`;
const clock = (p: DigitalProvenance) =>
  `sample ${p.lastInputSampleIndex.toLocaleString()} · generation ${p.generation}`;

// EOF invalidates callbacks while retaining the completed acquisition.
const acquisitionGeneration = (receiver: ReceiverSnapshot) =>
  receiver.session?.sessionGeneration ?? receiver.sessionGeneration;

export function decoderIdentity(
  receiver: ReceiverSnapshot,
  mode: ReceiverMode,
  source: string,
): string {
  const generation = acquisitionGeneration(receiver);
  return `${source}:${mode}:${generation}`;
}
export function decoderAcceptedCount(
  receiver: ReceiverSnapshot,
  mode: ReceiverMode,
): number {
  if (mode === "WEFAX" || mode === "SSTV") return receiver.textModem?.image?.rows ? 1 : 0;
  if (isTextMode(mode)) return receiver.textModem?.counters.accepted ?? 0;
  switch (mode) {
    case "ADS-B":
      return receiver.adsb?.validFrames ?? 0;
    case "AIS":
      return receiver.ais?.validFrames ?? 0;
    case "POCSAG": return receiver.pocsag?.counters.complete ?? 0;
    case "APRS":
      return receiver.aprs?.counters.validAx25Frames ?? 0;
    case "RS41":
      return (
        (receiver.rs41?.counters.uncorrectedFrames ?? 0) +
        (receiver.rs41?.counters.correctedFrames ?? 0)
      );
    case "SRD":
      return receiver.srd?.counters.validatedReadings ?? 0;
    case "WBFM":
      return receiver.rds?.validGroups ?? 0;
    case "DAB":
      return receiver.dab?.ficBlockCount ?? 0;
    default:
      return 0;
  }
}

/** Presentation adapters preserve protocol clocks/integrity and existing publication caps. */
export function decoderRecords(
  receiver: ReceiverSnapshot,
  mode: ReceiverMode,
  messages = false,
): DecoderRecord[] {
  const generation = acquisitionGeneration(receiver);
  const key = (id: string | number) => `${mode}:${generation}:${id}`;
  if (mode === "POCSAG") return (receiver.pocsag?.messages ?? []).map((m): DecoderRecord => ({
    key: key(m.sequence), label: m.address === null ? "Unknown address" : `RIC ${m.address}`, summary: m.text || "Address only",
    integrity: `${m.complete ? "Complete framing" : "Partial"} · ${m.erasures.length ? "Erasures" : m.correctedBits ? "Corrected codewords" : "Clean codewords"}`, clock: clock(m.provenance),
    fields: [["Display",m.displayTruncated ? "Truncated at 2,048 characters; raw payload retained" : "Full bounded text"],["Bit rate",`${m.rate} bit/s`],["Function",String(m.function ?? "Unknown")],["Polarity",m.polarity],["Interpretation",m.interpretation],["Corrected bits",String(m.correctedBits)],["Ending",m.ending],["Payload bits",m.payloadBits],["First input sample",String(m.provenance.firstInputSampleIndex)]], raw:m,
  })).reverse();
  if ((mode === "WEFAX" || mode === "SSTV") && receiver.textModem?.image?.rows) {
    const image = receiver.textModem.image;
    return [{ key: key(image.id), label: `${image.mode} image`, summary: `${image.width} × ${image.rows} received rows`, integrity: image.reason, clock: clock(image.provenance), fields: [["Rows", String(image.rows)], ["Complete", image.complete ? "Yes · synchronization only" : "Partial"], ["Checksum", "None"]], raw: image }];
  }
  if (isTextMode(mode)) return (receiver.textModem?.messages ?? []).slice(-16).map((message): DecoderRecord => ({
    key: key(message.sequence), label: message.address || message.header || `${mode} text ${message.sequence}`,
    summary: message.text, integrity: message.integrity, clock: clock(message.provenance),
    fields: [["Complete message", message.complete ? "Yes" : "Text segment / incomplete"], ["Header", message.header || "None"], ["Reported address", message.address || "None"], ["Label", message.label || "None"]], raw: message,
  })).reverse();
  if (mode === "ADS-B")
    return (receiver.adsb?.targets ?? [])
      .slice(0, 50)
      .map((t): DecoderRecord => ({
        key: key(t.id ?? t.icao ?? "unknown"),
        map: {
          symbol: aircraftCategory(t.category).symbol,
          categoryLabel: aircraftCategory(t.category).label,
          direction: t.trackDegrees,
          track: t.track ?? [],
          maximumGapMs: 30_000,
        },
        label: t.callsign || t.address || t.icao || "Unknown address",
        summary: `${t.onGround ? "On ground" : value(t.altitudeFt, "ft barometric")} · ${t.surfaceSpeedRangeKt ? surfaceSpeed(t.surfaceSpeedRangeKt) : value(t.groundSpeedKt, "kt")}`,
        integrity: "CRC-valid supported 1090ES frames",
        clock: `${t.lastSeenMs.toLocaleString()} ms on decoder input clock`,
        latitude: t.latitude ?? undefined,
        longitude: t.longitude ?? undefined,
        fields: [
          [t.addressType === "icao" || !t.addressType ? "ICAO address" : "Reported address", t.address || t.icao || "Unknown"],
          ["Address type", t.addressType || "ICAO (legacy snapshot)"],
          ["Transmission source", t.origin || "Unspecified (legacy snapshot)"],
          ["Frame format", t.downlinkFormat ? `DF${t.downlinkFormat}${t.controlField == null ? "" : ` / CF${t.controlField}`}` : "Unspecified"],
          ["Position decoding", t.positionStatus || "Airborne global CPR"],
          ["Air / ground", t.onGround === undefined ? "Unknown" : t.onGround ? "Ground" : "Airborne"],
          ["Reported identification", t.callsign || "Unknown"],
          ["Reported aircraft category", aircraftCategory(t.category).label],
          ["Barometric altitude", value(t.altitudeFt, "ft")],
          ["Geometric altitude", value(t.geometricAltitudeFt ?? null, "ft")],
          ["Ground speed", t.surfaceSpeedRangeKt ? surfaceSpeed(t.surfaceSpeedRangeKt) : value(t.groundSpeedKt, "kt")],
          ["Reported ADS-B version", t.quality ? String(t.quality.version) : "Unknown / expired"],
          ["Reported NACp", t.quality?.nacP == null ? "Unknown / unsupported" : String(t.quality.nacP)],
          ["Reported SIL", t.quality?.sil == null ? "Unknown / unsupported" : `${t.quality.sil} · ${t.quality.silBasis}`],
          ["Track", value(t.trackDegrees, "°")],
          ["Vertical rate", value(t.verticalRateFpm, "ft/min")],
          ["Emergency", t.emergency || "Unknown"],
        ],
        raw: t,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  if (mode === "AIS")
    return (receiver.ais?.targets ?? [])
      .slice(0, 50)
      .map((t): DecoderRecord => ({
        key: key(t.mmsi),
        map: {
          symbol: "vessel",
          categoryLabel: "Vessel",
          direction: t.headingDegrees ?? t.courseDegrees,
          track: t.track ?? [],
          maximumGapMs: 120_000,
        },
        label: t.name || String(t.mmsi),
        summary: `${value(t.speedKnots, "kt")} · ${t.channel}`,
        integrity: "FCS-valid supported AIS messages",
        clock: `${t.lastSeenMs.toLocaleString()} ms on decoder input clock`,
        latitude: t.latitude ?? undefined,
        longitude: t.longitude ?? undefined,
        fields: [
          ["MMSI", String(t.mmsi)],
          ["Reported name", t.name || "Unknown"],
          ["Call sign", t.callSign || "Unknown"],
          ["Speed over ground", value(t.speedKnots, "kt")],
          ["Course", value(t.courseDegrees, "°")],
          ["Heading", value(t.headingDegrees, "°")],
          ["Received channel", t.channel],
        ],
        raw: t,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  if (mode === "APRS" && messages)
    return (receiver.aprs?.recentPackets ?? [])
      .slice(-32)
      .map((p): DecoderRecord => ({
        key: key(`packet-${p.sequence}`),
        category: p.payload.kind === "message" ? "messages" : p.payload.kind,
        hasWeather: p.payload.kind === "weather" || "weather" in p.payload && Boolean(p.payload.weather),
        label: `${address(p.frame.source)} → ${address(p.frame.destination)}`,
        summary:
          p.payload.kind === "status" || p.payload.kind === "message"
            ? p.payload.text
            : "comment" in p.payload
              ? `${p.payload.kind} · ${p.payload.comment}`
              : p.payload.kind,
        integrity:
          p.payload.kind === "unsupported"
            ? "AX.25 FCS valid · unsupported APRS payload"
            : "AX.25 FCS valid",
        clock: clock(p.provenance),
        fields: [
          ["Path", p.frame.path.map(address).join(", ") || "Direct"],
          ["Payload", p.payload.kind],
          ...("weather" in p.payload && p.payload.weather ? weatherFields(p.payload.weather) : []),
        ],
        raw: p,
      }))
      .reverse();
  if (mode === "APRS")
    return (receiver.aprs?.stations ?? [])
      .slice(0, 32)
      .map((s): DecoderRecord => ({
        key: key(s.key),
        label: address(s.source),
        summary: s.statusText || `${s.packets} accepted packet(s)`,
        integrity:
          "AX.25 FCS valid · retained fields may come from earlier packets",
        clock: clock(s.lastHeard),
        // A reported ambiguous position remains a text range; do not turn it into an exact map point.
        latitude:
          s.position?.ambiguityDigits === 0
            ? s.position.latitudeDegrees
            : undefined,
        longitude:
          s.position?.ambiguityDigits === 0
            ? s.position.longitudeDegrees
            : undefined,
        fields: [
          ["Destination", address(s.destination)],
          ["Path", s.path.map(address).join(", ") || "Direct"],
          [
            "Position ambiguity",
            s.position ? `${s.position.ambiguityDigits} digit(s)` : "Unknown",
          ],
          [
            "Reported position",
            s.position
              ? `${s.position.latitudeDegrees}, ${s.position.longitudeDegrees} · retained`
              : "Unknown",
          ],
          ["Status", s.statusText || "Unknown"],
          ...(s.weather ? weatherFields(s.weather) : []),
        ],
        raw: s,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  if (mode === "RS41" && messages)
    return (receiver.rs41?.recentFrames ?? [])
      .slice(-32)
      .map((f, i): DecoderRecord => ({
        key: key(`frame-${f.provenance.lastInputSampleIndex}-${i}`),
        label:
          f.fecStatus === "rejected"
            ? "Rejected frame"
            : f.sondeId || "No valid STATUS identity",
        summary:
          f.fecStatus === "rejected"
            ? "No identity or position accepted"
            : `${f.correctedErrors} corrected symbol(s)`,
        integrity: `FEC ${f.fecStatus} · GPS-POS CRC ${f.subblockIntegrity.gpsPosition ? "passed" : "not passed"}`,
        clock: clock(f.provenance),
        fields: [
          ["FEC", f.fecStatus],
          [
            "Sub-block checks",
            Object.entries(f.subblockIntegrity)
              .map(
                ([name, valid]) =>
                  `${name}: ${valid ? "passed" : "not passed"}`,
              )
              .join(" · "),
          ],
        ],
        raw:
          f.fecStatus === "rejected"
            ? {
                fecStatus: f.fecStatus,
                correctedErrors: f.correctedErrors,
                subblockIntegrity: f.subblockIntegrity,
                provenance: f.provenance,
              }
            : f,
      }))
      .reverse();
  if (mode === "RS41")
    return (receiver.rs41?.sondes ?? [])
      .slice(0, 32)
      .map((s): DecoderRecord => ({
        key: key(s.sondeId),
        label: s.sondeId,
        map: { symbol: "generic", categoryLabel: "RS41 radiosonde", direction: s.position?.headingDegrees ?? null, maximumGapMs: 10_000, track: s.track.filter(point => point.provenance.generation === s.lastHeard.generation).map(point => ({ latitude: point.position.latitudeDegrees, longitude: point.position.longitudeDegrees, timeMs: point.provenance.lastInputSampleIndex / point.provenance.actualInputSampleRateHz * 1000 })) },
        summary: `${value(s.position?.altitudeMeters, "m ellipsoidal")} · ${s.track.length} retained fixes`,
        integrity: "STATUS and position fields individually integrity-gated",
        clock: clock(s.lastHeard),
        latitude: s.position?.latitudeDegrees,
        longitude: s.position?.longitudeDegrees,
        fields: [
          ["Frame counter", String(s.lastFrameCounter)],
          ["Battery", value(s.batteryVolts, "V")],
          ["Ellipsoidal altitude", value(s.position?.altitudeMeters, "m")],
          [
            "Horizontal speed",
            value(s.position?.horizontalSpeedMetersPerSecond, "m/s"),
          ],
          [
            "Vertical velocity",
            value(s.position?.upVelocityMetersPerSecond, "m/s"),
          ],
          [
            "Last valid GPS-POS",
            s.track.length
              ? clock(s.track[s.track.length - 1]!.provenance)
              : "No retained fix provenance",
          ],
          [
            "GPS time",
            s.gpsTime
              ? `week ${s.gpsTime.week} · ${s.gpsTime.timeOfWeekMilliseconds} ms · not UTC`
              : "Unknown",
          ],
        ],
        raw: s,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  if (mode === "SRD" && messages)
    return (receiver.srd?.bursts ?? [])
      .slice(-4)
      .map((b): DecoderRecord => ({
        key: key(`burst-${b.id}`),
        label: `Burst ${b.id}`,
        summary: `${b.pulses.length} pulses${b.truncated ? " · truncated" : ""}`,
        integrity: "Pulse inspection · no device identity inferred",
        clock: clock(b.provenance),
        fields: [
          ["Modulation", b.modulation],
          [
            "Truncation",
            b.truncated
              ? b.truncationReason || "Unknown"
              : "Not marked truncated",
          ],
        ],
        raw: b,
      }))
      .reverse();
  if (mode === "SRD")
    return (receiver.srd?.devices ?? [])
      .slice(0, 32)
      .map((d): DecoderRecord => ({
        key: key(d.key),
        label: String(d.reading.deviceId),
        summary:
          "temperatureC" in d.reading
            ? `${d.reading.temperatureC} °C`
            : `${d.reading.moisturePercent}% moisture`,
        integrity: d.reading.integrity,
        clock: `sample ${d.lastInputSampleIndex.toLocaleString()} · generation ${generation}`,
        fields: [
          ["Protocol", d.reading.protocol],
          ["Validated readings", String(d.readings)],
        ],
        raw: d,
      }));
  if (mode === "WBFM" && receiver.rds?.validGroups) {
    const r = receiver.rds;
    return [
      {
        key: key(r.pi || "rds"),
        label: r.programmeService || r.pi || "Received RDS groups",
        summary: r.radioText || "RadioText not received",
        integrity: "CRC and block-offset validation",
        clock: "Field receive times are not published by this decoder",
        fields: [
          ["PI", r.pi || "Unknown"],
          ["Programme Service", r.programmeService || "Unknown"],
          ["RadioText", r.radioText || "Unknown"],
        ],
        raw: r,
      },
    ];
  }
  if (mode === "DAB")
    return (receiver.dab?.stations ?? [])
      .slice(0, 64)
      .map((s): DecoderRecord => ({
        key: key(s.key),
        label: s.label || `Service ${s.serviceId.toString(16).toUpperCase()}`,
        summary: s.playable
          ? "Playable service"
          : "Not playable with current configuration",
        integrity: "Decoded ensemble/service information",
        clock: [s.dabPlus ? "HE-AAC · DAB+" : "MPEG Layer II · DAB", s.bitrateKbps ? `${s.bitrateKbps} kbit/s` : "Bitrate unavailable", s.protection || "Protection unavailable"].join(" · "),
        fields: [
          ["Service ID", `0x${s.serviceId.toString(16).toUpperCase()}`],
          ["Subchannel", String(s.subchannelId)],
          ["Bitrate", s.bitrateKbps ? `${s.bitrateKbps} kbit/s` : "Unavailable"],
          ["Protection", s.protection || "Unavailable"],
          ["Format", s.dabPlus ? "DAB+" : "DAB · audio unsupported"],
        ],
        raw: {
          key: s.key,
          label: s.label,
          serviceId: s.serviceId,
          subchannelId: s.subchannelId,
          playable: s.playable,
          dabPlus: s.dabPlus,
          bitrateKbps: s.bitrateKbps,
          protection: s.protection,
        },
      }));
  return [];
}

export function decoderJson(value: unknown, indentation = 2): string {
  return JSON.stringify(
    value,
    (_key, item: unknown) =>
      item instanceof Uint8Array || item instanceof Uint32Array ? Array.from(item) : item,
    indentation,
  );
}
export const DECODER_EXPORT_MAX_BYTES = 256 * 1024;
export function decoderRetention(mode: ReceiverMode) {
  return {
    maximumResults:
      mode === "POCSAG" || isTextMode(mode) ? 16 : mode === "DAB"
        ? 64
        : mode === "WBFM"
          ? 1
          : mode === "ADS-B" || mode === "AIS"
            ? 50
            : 32,
    maximumMessages:
      mode === "POCSAG" || isTextMode(mode) ? 16 : mode === "SRD" ? 4 : mode === "APRS" || mode === "RS41" ? 32 : 0,
    policy:
      "Bounded current published state, not durable history; protocol fields may have been retained from earlier accepted records.",
  };
}
export function decoderViewExport(
  receiver: ReceiverSnapshot,
  mode: ReceiverMode,
  records: readonly DecoderRecord[],
  scope: "retained" | "selected",
  frozen: boolean,
) {
  const session = receiver.session;
  const data = {
    schema: "browsersdr-decoder-view-v1",
    applicationBuild: import.meta.env.VITE_BUILD_ID || "development",
    exportedAt: new Date().toISOString(),
    mode,
    scope,
    display: frozen ? "frozen snapshot" : "current retained snapshot",
    acquisition: session
      ? {
          source: session.source,
          generation: session.sessionGeneration,
          nativeSampleRateHz: session.actualSampleRateHz,
          centerFrequencyHz: session.hardwareCenterFrequencyHz,
          selectedFrequencyHz: session.selectedChannelFrequencyHz,
        }
      : null,
    clock: "Original decoder input clock; export time is not receive time",
    limits: {
      maximumExportBytes: DECODER_EXPORT_MAX_BYTES,
      records: records.length,
      ...decoderRetention(mode),
    },
    // Derived map data duplicates protocol fixes already preserved in raw.
    records: records.map(({ map: _map, ...record }) => record),
  };
  let json = decoderJson(data);
  // Keep all bounded fixes when indentation alone would exceed the envelope.
  if (new TextEncoder().encode(json).byteLength > DECODER_EXPORT_MAX_BYTES)
    json = decoderJson(data, 0);
  if (new TextEncoder().encode(json).byteLength > DECODER_EXPORT_MAX_BYTES)
    throw new Error(
      "This selection exceeds the 256 KiB export limit. Export one selected record instead.",
    );
  return json;
}

function surfaceSpeed(range: readonly [number, number | null]): string {
  return range[1] === null ? `≥${range[0]} kt` : `${range[0]}–${range[1]} kt`;
}

function weatherFields(weather: import("../aprs/types").AprsWeather): [string, string][] {
  const labels: Record<keyof typeof weather, [string, string]> = { windDirectionDegrees: ["Wind direction", "°"], windSpeedMetersPerSecond: ["Wind speed", "m/s"], windGustMetersPerSecond: ["Wind gust", "m/s"], temperatureCelsius: ["Temperature", "°C"], rainLastHourMillimeters: ["Rain · last hour", "mm"], rainLast24HoursMillimeters: ["Rain · last 24 hours", "mm"], rainSinceMidnightMillimeters: ["Rain · since midnight", "mm"], humidityPercent: ["Humidity", "%"], pressureHectopascals: ["Pressure", "hPa"], luminosityWattsPerSquareMeter: ["Luminosity", "W/m²"] };
  return Object.entries(weather).filter(([, value]) => value !== undefined).map(([name, value]) => { const [label, unit] = labels[name as keyof typeof weather]; return [`Weather · ${label}`, `${value} ${unit} · retained`]; });
}
