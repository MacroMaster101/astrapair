import "server-only";
import tzlookup from "@photostructure/tz-lookup";
import { z } from "zod";
import { isValidTimezone } from "@/lib/astrology/time";

const PHOTON_ENDPOINT = "https://photon.komoot.io/api/";
const OPEN_METEO_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const USER_AGENT = "AstraPair/1.0 (birthplace search)";
const MAX_RESULTS = 8;

export interface PlaceResult {
  /** Unique across sources, e.g. "osm:N4878217750" or "om:1224099". */
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  timezone: string;
  country: string;
}

export class GeocodingUnavailableError extends Error {}

/** Areas that are not a sensible place of birth for a chart. */
const EXCLUDED_OSM_VALUES = new Set([
  "country",
  "state",
  "region",
  "province",
  "county",
  "archipelago",
  "island",
  "continent",
  "ocean",
  "sea",
]);

const photonFeatureSchema = z.object({
  geometry: z.object({
    coordinates: z.tuple([
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
    ]),
  }),
  properties: z.object({
    osm_type: z.enum(["N", "W", "R"]),
    osm_id: z.number(),
    osm_value: z.string().optional(),
    name: z.string().min(1),
    city: z.string().optional(),
    county: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
  }),
});

const openMeteoResultSchema = z.object({
  id: z.number(),
  name: z.string().min(1),
  admin1: z.string().optional(),
  country: z.string().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().optional(),
});

/** Matches the limit on a saved place label (birth profile schema and database). */
const MAX_LABEL_LENGTH = 200;

/** Parts run from most to least specific; over-long labels lose the least specific first. */
function joinLabel(parts: (string | undefined)[]): string {
  const unique = [...new Set(parts.filter((p): p is string => Boolean(p)))];
  let label = unique.join(", ");
  while (label.length > MAX_LABEL_LENGTH && unique.length > 1) {
    unique.pop();
    label = unique.join(", ");
  }
  return label.length > MAX_LABEL_LENGTH
    ? `${label.slice(0, MAX_LABEL_LENGTH - 1).trimEnd()}…`
    : label;
}

function timezoneFor(latitude: number, longitude: number): string | null {
  try {
    const zone = tzlookup(latitude, longitude);
    return isValidTimezone(zone) ? zone : null;
  } catch {
    return null;
  }
}

/** Fetches and parses a JSON object body; any failure is "unavailable". */
async function fetchJsonObject(
  url: URL,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json", "user-agent": USER_AGENT },
    });
  } catch {
    throw new GeocodingUnavailableError();
  }
  if (!res.ok) throw new GeocodingUnavailableError();

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new GeocodingUnavailableError();
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GeocodingUnavailableError();
  }
  return body as Record<string, unknown>;
}

async function searchPhoton(
  query: string,
  fetchImpl: typeof fetch,
): Promise<PlaceResult[]> {
  const url = new URL(PHOTON_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "10");
  url.searchParams.set("lang", "en");
  url.searchParams.set("osm_tag", "place");

  const body = await fetchJsonObject(url, fetchImpl);
  if (!Array.isArray(body.features)) throw new GeocodingUnavailableError();

  const places: PlaceResult[] = [];
  for (const item of body.features) {
    const parsed = photonFeatureSchema.safeParse(item);
    if (!parsed.success) continue;
    const { geometry, properties: p } = parsed.data;
    if (p.osm_value && EXCLUDED_OSM_VALUES.has(p.osm_value)) continue;

    const [longitude, latitude] = geometry.coordinates;
    const timezone = timezoneFor(latitude, longitude);
    if (!timezone) continue;

    places.push({
      id: `osm:${p.osm_type}${p.osm_id}`,
      label: joinLabel([p.name, p.city, p.county, p.state, p.country]),
      latitude,
      longitude,
      timezone,
      country: p.country ?? "",
    });
  }
  return places;
}

async function searchOpenMeteo(
  query: string,
  fetchImpl: typeof fetch,
): Promise<PlaceResult[]> {
  const url = new URL(OPEN_METEO_ENDPOINT);
  url.searchParams.set("name", query);
  url.searchParams.set("count", String(MAX_RESULTS));
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const body = await fetchJsonObject(url, fetchImpl);
  if (body.results !== undefined && !Array.isArray(body.results)) {
    throw new GeocodingUnavailableError();
  }

  const places: PlaceResult[] = [];
  for (const item of (body.results as unknown[] | undefined) ?? []) {
    const parsed = openMeteoResultSchema.safeParse(item);
    if (!parsed.success) continue;
    const r = parsed.data;
    if (!r.timezone || !isValidTimezone(r.timezone)) continue;
    places.push({
      id: `om:${r.id}`,
      label: joinLabel([r.name, r.admin1, r.country]),
      latitude: r.latitude,
      longitude: r.longitude,
      timezone: r.timezone,
      country: r.country ?? "",
    });
  }
  return places;
}

function dedupeByLabel(places: PlaceResult[]): PlaceResult[] {
  const seen = new Set<string>();
  return places.filter((p) => {
    if (seen.has(p.label)) return false;
    seen.add(p.label);
    return true;
  });
}

/**
 * Searches places by name. Photon (OpenStreetMap) is tried first because it
 * tolerates spelling differences and knows small towns; Open-Meteo is the
 * fallback when Photon fails or finds nothing.
 */
export async function searchPlaces(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PlaceResult[]> {
  let photon: PlaceResult[] | null = null;
  try {
    photon = dedupeByLabel(await searchPhoton(query, fetchImpl));
  } catch {
    // Photon is down or returned garbage: fall through to Open-Meteo.
  }
  if (photon && photon.length > 0) return photon.slice(0, MAX_RESULTS);

  try {
    return dedupeByLabel(await searchOpenMeteo(query, fetchImpl));
  } catch (e) {
    // Photon answered with no matches, so an Open-Meteo outage is not fatal.
    if (photon) return [];
    throw e;
  }
}
