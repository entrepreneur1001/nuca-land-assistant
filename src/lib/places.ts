/**
 * Places around the land (public/places, produced offline by scripts/places from OpenStreetMap, logos from
 * Wikidata): universities, schools, clubs, hospitals, malls, stations and landmarks. Context only, like the
 * compounds: optional, and a missing file simply means none.
 */

export type PlaceCategory = "education" | "sport" | "health" | "shopping" | "transport" | "landmark";

export interface Place {
  /** OSM id: "n123", "w123" or "r123". */
  id: string;
  cat: PlaceCategory;
  /** OSM kind within the category: "university", "school", "golf_course", "station" … */
  sub: string;
  name: string;
  nameAr: string | null;
  lat: number;
  lng: number;
  /** Outline as [lat, lng] points when the place is an area. */
  ring?: [number, number][] | null;
  wikidata?: string | null;
  /** Logo path under /places/ ("logo/Q123.webp"). */
  logo?: string | null;
}

interface PlacesIndex {
  cities: Record<string, { count: number; bounds: [[number, number], [number, number]] }>;
}

const BASE = "/places";
/** `logo` is a path under /places/ (e.g. "logo/Q123.webp"). */
export const placeLogoUrl = (file: string) => `${BASE}/${file}`;

let indexPromise: Promise<PlacesIndex | null> | null = null;
const cityPromises = new Map<string, Promise<Place[]>>();

function loadIndex(): Promise<PlacesIndex | null> {
  indexPromise ??= fetch(`${BASE}/index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<PlacesIndex>) : null))
    .then((idx) => (idx && typeof idx.cities === "object" ? idx : null))
    .catch(() => null);
  return indexPromise;
}

function loadCity(id: string): Promise<Place[]> {
  let p = cityPromises.get(id);
  if (!p) {
    p = fetch(`${BASE}/${id}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ places?: Place[] }>) : null))
      .then((f) => (Array.isArray(f?.places) ? f.places.filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng)) : []))
      .catch(() => []);
    cityPromises.set(id, p);
  }
  return p;
}

const touches = (a: [[number, number], [number, number]], b: [[number, number], [number, number]]) =>
  a[0][0] <= b[1][0] && a[1][0] >= b[0][0] && a[0][1] <= b[1][1] && a[1][1] >= b[0][1];

/** The places of every city whose area touches `box` [[south, west], [north, east]] (de-duplicated). */
export async function loadPlacesNear(box: [[number, number], [number, number]]): Promise<Place[]> {
  const idx = await loadIndex();
  if (!idx) return [];
  const ids = Object.entries(idx.cities)
    .filter(([, c]) => c.bounds && touches(c.bounds, box))
    .map(([id]) => id);
  const all = (await Promise.all(ids.map(loadCity))).flat();
  const seen = new Set<string>();
  return all.filter((p) => !seen.has(p.id) && (seen.add(p.id), true));
}

/** Ground distance in metres (haversine). */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** The nearest place of each category to [lat, lng], within `maxM`. */
export function nearestByCategory(places: readonly Place[], lat: number, lng: number, maxM = 15000): Partial<Record<PlaceCategory, { place: Place; m: number }>> {
  const out: Partial<Record<PlaceCategory, { place: Place; m: number }>> = {};
  for (const p of places) {
    // Schools are many and small: they say little about a plot next to a university.
    if (p.sub === "school" || p.sub === "bus") continue;
    const m = distanceM(lat, lng, p.lat, p.lng);
    if (m > maxM) continue;
    const best = out[p.cat];
    if (!best || m < best.m) out[p.cat] = { place: p, m };
  }
  return out;
}
