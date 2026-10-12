/** Anonymous public projection v1. Deliberately independent of AtlasConnection/session DTOs. */
export const PUBLIC_STATION_VERSION =
  "browsersdr-public-station-search/1" as const;
export const PUBLIC_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface PublicSource {
  publisher: string;
  url: string | null;
  published_on: string | null;
  retrieved_at: string | null;
  reviewed_at: string | null;
}
export interface PublicTransmission {
  id: string;
  frequency_hz: number;
  broadcast_format: string | null;
  bandwidth_hz: number | null;
  site: {
    name: string | null;
    place_name: string | null;
    country: string | null;
  } | null;
  sources: PublicSource[];
  valid_from: string | null;
  valid_to: string | null;
}
export interface PublicStation {
  id: string;
  publication_version: number;
  name: string;
  aliases: string[];
  call_sign: string | null;
  network: string | null;
  service: string | null;
  country: string | null;
  sources: PublicSource[];
  transmissions: PublicTransmission[];
}
export interface PublicStationDetail {
  contract_version: typeof PUBLIC_STATION_VERSION;
  catalog_revision: string;
  station: PublicStation;
}
export interface PublicStationPage {
  contract_version: typeof PUBLIC_STATION_VERSION;
  catalog_revision: string;
  items: Array<{
    station: PublicStation;
    match: { station_fields: string[]; reference_ids: string[] };
  }>;
  next_cursor: string | null;
}
export interface PublicStationQuery {
  q?: string;
  min_frequency_hz?: number;
  max_frequency_hz?: number;
  cursor?: string;
}
const fields = [
  "name",
  "aliases",
  "call_sign",
  "network",
  "service",
  "country",
];
export function malformedPublicResponse(): never {
  throw new Error(
    "Malformed public catalog response. Check the service version and retry.",
  );
}
function object(v: unknown, keys: string[]): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    return malformedPublicResponse();
  const r = v as Record<string, unknown>;
  if (
    Object.keys(r).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(r, k))
  )
    malformedPublicResponse();
  return r;
}
function text(v: unknown, max = 200): v is string {
  return typeof v === "string" && [...v].length > 0 && [...v].length <= max;
}
function nullable(v: unknown, max = 200) {
  return v === null || text(v, max);
}
function uuid(v: unknown) {
  return typeof v === "string" && PUBLIC_UUID.test(v);
}
function array(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) return malformedPublicResponse();
  return v;
}
function unique(v: unknown[]) {
  if (new Set(v).size !== v.length) malformedPublicResponse();
}
function date(v: unknown, day = false) {
  if (v === null) return true;
  if (
    typeof v !== "string" ||
    !(
      day
        ? /^\d{4}-\d{2}-\d{2}$/
        : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
    ).test(v)
  )
    return false;
  const time = Date.parse(v);
  return (
    Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === v.slice(0, 10)
  );
}
function positive(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1e12;
}
export function safePublicSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      value.length <= 2048 &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname) &&
      !/^\d+(?:\.\d+){3}$/.test(url.hostname) &&
      !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(
        url.hostname,
      ) &&
      !/[\s\\]/.test(value)
    );
  } catch {
    return false;
  }
}
function sources(value: unknown) {
  const rows = array(value, 5);
  if (!rows.length) malformedPublicResponse();
  for (const v of rows) {
    const r = object(v, [
      "publisher",
      "url",
      "published_on",
      "retrieved_at",
      "reviewed_at",
    ]);
    if (
      !text(r.publisher) ||
      !(
        r.url === null ||
        (typeof r.url === "string" && safePublicSourceUrl(r.url))
      ) ||
      !date(r.published_on, true) ||
      !date(r.retrieved_at) ||
      !date(r.reviewed_at) ||
      !(r.published_on || r.retrieved_at || r.reviewed_at)
    )
      malformedPublicResponse();
  }
}
function station(value: unknown): PublicStation {
  const s = object(value, [
    "id",
    "publication_version",
    ...fields,
    "sources",
    "transmissions",
  ]);
  if (
    !uuid(s.id) ||
    !Number.isSafeInteger(s.publication_version) ||
    (s.publication_version as number) < 1 ||
    !text(s.name)
  )
    malformedPublicResponse();
  for (const key of fields.slice(2))
    if (!nullable(s[key])) malformedPublicResponse();
  const aliases = array(s.aliases, 30);
  if (!aliases.every((v) => text(v))) malformedPublicResponse();
  unique(aliases);
  sources(s.sources);
  const refs = array(s.transmissions, 50);
  const ids = refs.map((v) => {
    const r = object(v, [
      "id",
      "frequency_hz",
      "broadcast_format",
      "bandwidth_hz",
      "site",
      "sources",
      "valid_from",
      "valid_to",
    ]);
    if (
      !uuid(r.id) ||
      !positive(r.frequency_hz) ||
      !nullable(r.broadcast_format, 100) ||
      !(r.bandwidth_hz === null || positive(r.bandwidth_hz)) ||
      !date(r.valid_from) ||
      !date(r.valid_to) ||
      (r.valid_from &&
        r.valid_to &&
        Date.parse(String(r.valid_from)) > Date.parse(String(r.valid_to)))
    )
      malformedPublicResponse();
    if (r.site !== null) {
      const site = object(r.site, ["name", "place_name", "country"]);
      if (
        !Object.values(site).every((v) => nullable(v)) ||
        !Object.values(site).some(Boolean)
      )
        malformedPublicResponse();
    }
    sources(r.sources);
    return r.id;
  });
  unique(ids);
  return value as PublicStation;
}
function envelope(r: Record<string, unknown>) {
  if (
    r.contract_version !== PUBLIC_STATION_VERSION ||
    !uuid(r.catalog_revision)
  )
    malformedPublicResponse();
}
export function parsePublicDetail(
  value: unknown,
  expectedId: string,
): PublicStationDetail {
  const r = object(value, ["contract_version", "catalog_revision", "station"]);
  envelope(r);
  if (station(r.station).id !== expectedId) malformedPublicResponse();
  return value as PublicStationDetail;
}
export function parsePublicPage(value: unknown): PublicStationPage {
  const r = object(value, [
    "contract_version",
    "catalog_revision",
    "items",
    "next_cursor",
  ]);
  envelope(r);
  if (!(
    r.next_cursor === null ||
    (typeof r.next_cursor === "string" &&
      /^[A-Za-z0-9_-]{1,2048}$/.test(r.next_cursor))
  ))
    malformedPublicResponse();
  const ids = array(r.items, 50).map((v) => {
    const item = object(v, ["station", "match"]),
      s = station(item.station),
      m = object(item.match, ["station_fields", "reference_ids"]);
    const matched = array(m.station_fields, 6),
      references = array(m.reference_ids, 50);
    unique(matched);
    unique(references);
    if (
      !matched.every((k) => typeof k === "string" && fields.includes(k)) ||
      references.length !== s.transmissions.length ||
      !s.transmissions.every((t) => references.includes(t.id))
    )
      malformedPublicResponse();
    return s.id;
  });
  unique(ids);
  return value as PublicStationPage;
}
export function publicQueryParams(query: PublicStationQuery): URLSearchParams {
  const params = new URLSearchParams({ limit: "50" });
  if (query.q !== undefined) {
    if (
      typeof query.q !== "string" ||
      [...query.q].length > 200 ||
      [...query.q.normalize("NFKC")].length > 200
    )
      throw new Error("Search text must be at most 200 characters.");
    if (query.q.trim()) params.set("q", query.q.trim()); // Server owns Unicode casefold and literal matching.
  }
  const min = query.min_frequency_hz,
    max = query.max_frequency_hz;
  if (min !== undefined || max !== undefined) {
    if (
      min === undefined ||
      max === undefined ||
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      min < 0 ||
      max > 1e12 ||
      min >= max
    )
      throw new Error(
        "Enter both frequency bounds, from 0 to 1000000 MHz, with minimum below maximum.",
      );
    params.set("min_frequency_hz", String(min));
    params.set("max_frequency_hz", String(max));
  }
  if (query.cursor !== undefined) {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(query.cursor))
      throw new Error("Invalid public page cursor. Search again.");
    params.set("cursor", query.cursor);
  }
  if (
    new TextEncoder().encode(`/api/v1/public/stations?${params}`).length > 4096
  )
    throw new Error("Search request is too long. Narrow the query.");
  return params;
}
