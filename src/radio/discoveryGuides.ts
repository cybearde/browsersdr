import { DAB_BAND_III_CHANNELS } from "../dab/channels";
import { defaultModeSettings, type ReceiverMode } from "./receiverConfig";
import type { Bookmark } from "./bookmarks";
import { publicQueryParams, type PublicStationQuery } from "./publicStations";
export interface FrequencyInterpretation {
  frequencyHz?: number;
  block?: string;
  notice: string;
  error?: string;
}
/** Explicit UI policy: numbers without units are MHz; no thousand separators or implicit exponent syntax. */
export function parseDiscoveryFrequency(
  input: string,
): FrequencyInterpretation {
  const text = input.normalize("NFKC").trim();
  const block = DAB_BAND_III_CHANNELS.find(
    (c) => c.label === text.toUpperCase().replace(/^DAB\s+/, ""),
  );
  if (block)
    return {
      frequencyHz: block.frequencyHz,
      block: block.label,
      notice: `DAB block ${block.label}: ${block.frequencyHz / 1e6} MHz. Ensemble tuning; choose a programme manually after reception starts.`,
    };
  const match = /^(\d+(?:[.,]\d+)?|[.,]\d+)\s*(Hz|kHz|MHz|GHz)?$/i.exec(text);
  if (!match)
    return {
      notice: "",
      ...(/^[\d.,+-]/.test(text)
        ? {
            error:
              "Use one decimal point or decimal comma and Hz, kHz, MHz or GHz; no thousands separators. Or choose Text interpretation.",
          }
        : {}),
    };
  const scale = { hz: 1, khz: 1e3, mhz: 1e6, ghz: 1e9 }[
    match[2]?.toLowerCase() ?? "mhz"
  ]!;
  const hz = Number(match[1]!.replace(",", ".")) * scale;
  if (
    !Number.isFinite(hz) ||
    hz <= 0 ||
    hz > 1e12 ||
    Math.abs(hz - Math.round(hz)) > 0.0001
  )
    return {
      notice: "",
      error: "Use a positive whole-Hz frequency, up to 1000000 MHz.",
    };
  return {
    frequencyHz: Math.round(hz),
    notice: `${match[2] ? "Frequency" : "No unit supplied: interpreted as MHz"}: ${Math.round(hz) / 1e6} MHz. Atlas nominal-frequency window is ±500 Hz, lower inclusive and upper exclusive.`,
  };
}
export function discoveryQuery(
  text: string,
  interpretation: "auto" | "text",
  minimum: string,
  maximum: string,
): PublicStationQuery {
  const parsed =
    interpretation === "auto" ? parseDiscoveryFrequency(text) : { notice: "" };
  if ("error" in parsed && parsed.error) throw new Error(parsed.error);
  const query: PublicStationQuery =
    "frequencyHz" in parsed && parsed.frequencyHz !== undefined
      ? {
          min_frequency_hz: Math.max(0, parsed.frequencyHz - 500),
          max_frequency_hz: Math.min(1e12, parsed.frequencyHz + 500),
        }
      : { q: text };
  if (minimum.trim() || maximum.trim()) {
    if (!minimum.trim() || !maximum.trim())
      throw new Error("Enter both frequency bounds in MHz.");
    if ("frequencyHz" in parsed && parsed.frequencyHz !== undefined)
      throw new Error(
        "Clear the manual bounds to use the parsed frequency window, or choose Text interpretation.",
      );
    const number = (v: string) =>
      /^\d+(?:[.,]\d+)?$/.test(v.trim())
        ? Number(v.trim().replace(",", ".")) * 1e6
        : NaN;
    query.min_frequency_hz = number(minimum);
    query.max_frequency_hz = number(maximum);
  }
  publicQueryParams(query);
  return query;
}
export interface DiscoveryGuide {
  id: string;
  name: string;
  aliases: string[];
  mode?: ReceiverMode;
  frequencyHz?: number;
  context: string;
  status: string;
  publisher: string;
  url: string;
  sourceDate: string;
}
const faa = {
  publisher: "FAA ADS-B installation",
  url: "https://www.faa.gov/air_traffic/technology/equipadsb/installation",
  sourceDate: "2023-02-07",
};
const local = {
  publisher: "BrowserSDR receiver profiles",
  url: "https://github.com/cybearde/browsersdr/blob/59af4553d58622d4a8597a85e4be0f2db15dc600/src/radio/receiverConfig.ts",
  sourceDate: "Implementation inspected 2026-10-12",
};
export const DISCOVERY_GUIDES: readonly DiscoveryGuide[] = [
  {
    id: "adsb",
    name: "ADS-B / 1090ES",
    aliases: ["ads", "adsb", "ads-b", "1090", "1090es", "aircraft"],
    mode: "ADS-B",
    frequencyHz: 1090e6,
    context: "1090 MHz · international aviation",
    status:
      "Built-in 1090ES DF17/DF18 decoder. Requires compatible raw I/Q and rate; no station identity.",
    ...faa,
  },
  {
    id: "uat",
    name: "978 UAT",
    aliases: ["978", "uat", "ads", "adsb", "ads-b", "aircraft"],
    frequencyHz: 978e6,
    context: "978 MHz · United States ADS-B",
    status:
      "Decoder unavailable in BrowserSDR. UAT is a separate system; the 1090ES preset cannot decode it.",
    ...faa,
  },
  {
    id: "ais",
    name: "AIS / maritime vessels",
    aliases: ["ais", "ship", "ships", "vessel", "boats"],
    mode: "AIS",
    frequencyHz: 162e6,
    context:
      "International AIS 1: 161.975 MHz; AIS 2: 162.025 MHz. BrowserSDR uses a 162 MHz centre to decode both.",
    status:
      "Built-in dual-channel decoder; regional channel management can differ.",
    publisher: "US Coast Guard channel table / BrowserSDR AIS profile",
    url: "https://navcen.uscg.gov/international-vhf-marine-radio-channels-freq",
    sourceDate: "Publication date unknown; inspected 2026-10-12",
  },
  {
    id: "aprs-europe",
    name: "APRS · Europe / IARU Region 1",
    aliases: ["aprs", "packet", "144.8", "europe"],
    mode: "APRS",
    frequencyHz: 144.8e6,
    context: "144.800 MHz · regional example, check local usage",
    status: "Built-in 1200-baud AX.25/APRS decoder.",
    publisher: "IARU Region 1 VHF Handbook v9.01",
    url: "https://www.iaru-r1.org/wp-content/uploads/2021/03/VHF_Handbook_V9.01.pdf",
    sourceDate: "2021-03",
  },
  {
    id: "aprs-america",
    name: "APRS · North America",
    aliases: ["aprs", "packet", "144.39", "america"],
    mode: "APRS",
    frequencyHz: 144.39e6,
    context: "144.390 MHz · regional example",
    status: "Built-in 1200-baud AX.25/APRS decoder.",
    publisher: "APRS.org",
    url: "https://www.aprs.org/",
    sourceDate: "Publication date unknown; inspected 2026-10-12",
  },
  {
    id: "dab",
    name: "DAB / DAB+ Band III",
    aliases: ["dab", "dab+", "digital radio", "ensemble"],
    mode: "DAB",
    context:
      "Type a block such as 11C or 12D; uses BrowserSDR's existing channel table.",
    status:
      "Mode I / DAB+; manual service selection. Legacy MP2/encrypted services are unsupported; AAC availability depends on browser.",
    ...local,
  },
  ...(
    [
      ["WBFM", "Broadcast FM / RDS", ["fm", "wbfm", "wfm", "rds", "radio"]],
      ["AM", "Amplitude modulation", ["am", "mediumwave", "shortwave"]],
      ["NBFM", "Narrow FM", ["nfm", "nbfm"]],
      ["USB", "Upper sideband", ["usb", "ssb"]],
      ["LSB", "Lower sideband", ["lsb", "ssb"]],
      ["CW", "CW / Morse", ["cw", "morse"]],
      ["RS41", "RS41 radiosondes", ["rs41", "radiosonde", "weather balloon"]],
      ["SRD", "Short-range devices", ["srd", "ook", "2fsk", "sensors"]],
    ] as const
  ).map(([mode, name, aliases]) => ({
    id: mode.toLowerCase(),
    name,
    aliases: [...aliases],
    mode,
    context:
      "Uses your current channel frequency. Enter a sourced local assignment to choose another frequency.",
    status:
      "Built-in receiver profile; frequency and mode alone do not identify a transmitter.",
    ...local,
  })),
];
export const normalizeDiscoveryText = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
export function matchingGuides(query: string) {
  const q = normalizeDiscoveryText(query);
  return DISCOVERY_GUIDES.map((guide, index) => {
    const aliases = [guide.name, ...guide.aliases].map(normalizeDiscoveryText);
    const score = !q
      ? 3
      : aliases.includes(q)
        ? 0
        : aliases.some((a) => a.startsWith(q))
          ? 1
          : aliases.some((a) => a.includes(q))
            ? 2
            : 99;
    return { guide, score, index };
  })
    .filter((row) => row.score < 99)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((row) => ({
      ...row.guide,
      match:
        row.score === 0
          ? "Exact name or curated alias"
          : row.score === 1
            ? "Name or alias prefix"
            : row.score === 2
              ? "Name or alias contains query"
              : "Local guide",
    }));
}
export function guideBookmark(
  name: string,
  mode: ReceiverMode,
  frequencyHz: number,
): Bookmark {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    name: name.slice(0, 100),
    frequencyHz,
    settings: defaultModeSettings(mode),
    tags: [],
    notes: "",
  };
}
