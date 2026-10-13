import international from "./band-guide-plans.json";

export type BandGuidePlan =
  keyof typeof international.profiles | "DE" | "general";
export type BandCategory = "broadcast" | "navigation" | "amateur" | "shared";
export interface GuideReference {
  sourceId: string;
  section: string;
}
export interface GuideSource {
  title: string;
  url: string;
  edition: string;
  inspected: string;
  method: string;
  sourceDate?: string;
  sha256?: string;
}
export interface GuideBand {
  id: string;
  startHz: number;
  endHz: number;
  label: string;
  category: BandCategory;
  notes: string;
  references: readonly GuideReference[];
}

export const BAND_GUIDE_SOURCE = {
  title: "German frequency allocation table (FreqV)",
  url: "https://www.gesetze-im-internet.de/freqv/anlage.html",
  inspected: "2026-10-13",
};
export const BAND_GUIDE_SOURCES: Readonly<Record<string, GuideSource>> = {
  ...international.sources,
  DE: {
    ...BAND_GUIDE_SOURCE,
    edition: "Curated FreqV reference; publication date not established",
    method: "Official annex rows inspected",
  },
};

// Curated reference intervals, not a complete allocation database. Source rows
// and footnotes are retained in details; end points use [start, end).
const band = (
  id: string,
  startMHz: number,
  endMHz: number,
  label: string,
  category: BandCategory,
  notes: string,
): GuideBand => ({
  id,
  startHz: Math.round(startMHz * 1e6),
  endHz: Math.round(endMHz * 1e6),
  label,
  category,
  notes,
  references: [{ sourceId: "DE", section: notes }],
});
export const GERMAN_GUIDE_BANDS: readonly GuideBand[] = [
  band("lw", 0.1485, 0.255, "Longwave broadcast", "broadcast", "Row 20."),
  band("mw", 0.5265, 1.6065, "Mediumwave broadcast", "broadcast", "Row 32."),
  band(
    "160m",
    1.81,
    1.85,
    "160 m amateur",
    "amateur",
    "Row 37. Adjacent amateur use is shared and is not included here.",
  ),
  band(
    "49m",
    5.9,
    6.2,
    "49 m broadcast",
    "broadcast",
    "Rows 80–81; national footnotes apply.",
  ),
  band(
    "40m",
    7,
    7.2,
    "40 m amateur",
    "amateur",
    "Rows 86–87; satellite use in part of the band.",
  ),
  band("41m", 7.2, 7.35, "41 m broadcast", "broadcast", "Row 88."),
  band("31m", 9.4, 9.9, "31 m broadcast", "broadcast", "Rows 98–99."),
  band(
    "30m",
    10.1,
    10.15,
    "30 m amateur / fixed",
    "shared",
    "Row 104: amateur use shares this interval with the fixed service.",
  ),
  band("25m", 11.6, 12.1, "25 m broadcast", "broadcast", "Rows 109–111."),
  band("22m", 13.57, 13.87, "22 m broadcast", "broadcast", "Rows 121–123."),
  band(
    "20m",
    14,
    14.35,
    "20 m amateur",
    "amateur",
    "Rows 125–126; satellite use in part of the band.",
  ),
  band("19m", 15.1, 15.8, "19 m broadcast", "broadcast", "Rows 131–132."),
  band(
    "17m",
    18.068,
    18.168,
    "17 m amateur",
    "amateur",
    "Row 145; includes amateur satellite use.",
  ),
  band(
    "15m",
    21,
    21.45,
    "15 m amateur",
    "amateur",
    "Row 155; national footnotes apply.",
  ),
  band("13m", 21.45, 21.85, "13 m broadcast", "broadcast", "Row 156."),
  band(
    "cb",
    26.56,
    27.41,
    "CB / shared uses",
    "shared",
    "Note 9 permits CB use in this interval. Other allocations and ISM/SRD notes apply; this is not a channel assignment.",
  ),
  band(
    "fm",
    87.5,
    108,
    "FM broadcast",
    "broadcast",
    "Row 203; additional uses and national footnotes apply.",
  ),
  band(
    "air-nav",
    108,
    117.975,
    "Air navigation",
    "navigation",
    "Row 204 and D197A: navigation and additional aeronautical mobile systems supporting navigation.",
  ),
  band(
    "air-voice",
    117.975,
    137,
    "Airband",
    "navigation",
    "Row 205: aeronautical mobile (R).",
  ),
  band(
    "weather-sat",
    137,
    138,
    "Satellite / shared uses",
    "shared",
    "Rows 206–209 include weather, research, telemetry and mobile satellite uses; allocations vary within this interval.",
  ),
  band(
    "2m",
    144,
    146,
    "2 m amateur",
    "amateur",
    "Row 211; includes amateur satellite use.",
  ),
  band(
    "marine-dsc",
    156.4875,
    156.5625,
    "Marine DSC",
    "navigation",
    "Row 216; maritime distress/calling reference, not detected traffic.",
  ),
  band(
    "marine-call",
    156.7625,
    156.8375,
    "Marine calling / shared",
    "shared",
    "Row 218; maritime calling and satellite uses. Consult source notes.",
  ),
  band(
    "ais1",
    161.9625,
    161.9875,
    "AIS / shared uses",
    "shared",
    "Row 220; D228F and additional shared-service notes apply.",
  ),
  band(
    "ais2",
    162.0125,
    162.0375,
    "AIS / shared uses",
    "shared",
    "Row 222; D228F and additional shared-service notes apply.",
  ),
  band(
    "band3",
    174,
    230,
    "Band III broadcast / shared",
    "shared",
    "Rows 224–225: broadcast plus mobile/fixed uses, with different allocations on each side of 223 MHz.",
  ),
  band(
    "70cm",
    430,
    440,
    "70 cm amateur / shared",
    "shared",
    "Row 247: amateur and radiolocation; ISM/SRD use in 433.05–434.79 MHz and satellite notes apply.",
  ),
  band(
    "uhf-tv",
    470,
    694,
    "UHF broadcast / shared",
    "shared",
    "Row 249: broadcast and additional land-mobile uses; source footnotes apply.",
  ),
  band(
    "l-nav",
    960,
    1164,
    "Air navigation / shared",
    "shared",
    "Row 252: navigation and aeronautical mobile. A frequency alone does not establish ADS-B or another format.",
  ),
  band(
    "gnss",
    1164,
    1215,
    "Satellite / air navigation",
    "shared",
    "Row 253: satellite and aeronautical navigation.",
  ),
  band(
    "2g4",
    2400,
    2483.5,
    "2.4 GHz shared uses",
    "shared",
    "Rows 302–303 and notes 10/26: mobile, radiolocation, WLAN/SRD; amateur use in part. This does not identify a protocol.",
  ),
];

export const BAND_GUIDE_GROUPS = [
  "Europe",
  "North America",
  "Oceania",
  "Asia",
  "South America",
  "Africa",
] as const;
export const BAND_GUIDE_PLANS = {
  DE: {
    label: "Germany",
    group: "Europe",
    scope:
      "Selected German FreqV reference intervals; national footnotes and shared uses apply.",
    bands: GERMAN_GUIDE_BANDS,
  },
  ...international.profiles,
  general: {
    label: "No country",
    group: "",
    scope: "No country or common profile selected.",
    bands: [],
  },
};
export function isBandGuidePlan(value: unknown): value is BandGuidePlan {
  return typeof value === "string" && Object.hasOwn(BAND_GUIDE_PLANS, value);
}
export function guideBands(plan: BandGuidePlan): readonly GuideBand[] {
  return BAND_GUIDE_PLANS[plan].bands as readonly GuideBand[];
}

export interface GuideSegment {
  startHz: number;
  endHz: number;
  leftPercent: number;
  widthPercent: number;
  bands: readonly GuideBand[];
}

/** Preserve gaps and overlapping references without stretching tiny intervals. */
export function guideSegments(
  startHz: number,
  endHz: number,
  plan: BandGuidePlan,
  bands: readonly GuideBand[] = guideBands(plan),
): GuideSegment[] {
  if (!Number.isFinite(startHz) || !Number.isFinite(endHz) || endHz <= startHz)
    return [];
  const matches =
    plan !== "general"
      ? bands.filter((b) => b.startHz < endHz && b.endHz > startHz)
      : [];
  const edges = [
    ...new Set([
      startHz,
      endHz,
      ...matches.flatMap((b) => [
        Math.max(startHz, b.startHz),
        Math.min(endHz, b.endHz),
      ]),
    ]),
  ].sort((a, b) => a - b);
  return edges.slice(0, -1).map((start, i) => {
    const end = edges[i + 1]!;
    return {
      startHz: start,
      endHz: end,
      leftPercent: ((start - startHz) / (endHz - startHz)) * 100,
      widthPercent: ((end - start) / (endHz - startHz)) * 100,
      bands: matches.filter((b) => b.startHz <= start && b.endHz >= end),
    };
  });
}

export function segmentLabel(segment: GuideSegment): string {
  return segment.bands.length > 1
    ? "Shared uses"
    : (segment.bands[0]?.label ?? "No guide data");
}
