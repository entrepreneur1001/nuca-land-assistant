import { GridIndex, type LatLng } from "@/engine/nearbuilt";
import type { Segment } from "@/engine/roads";

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type BBox = [south: number, west: number, north: number, east: number];

/** Search radius: the near-built score is zero beyond 5 km, so nothing farther matters. */
export const OSM_RADIUS_M = 5000;

/** POST an Overpass query (with retries across endpoints) and return the response body. */
async function overpass(query: string, fetchImpl: typeof fetch): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "nuca-land-assistant/1.0 (personal, read-only)" },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(240_000),
      });
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await sleep(10_000 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const aroundOf = (centers: LatLng[]) => centers.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`);

/**
 * Existing buildings and developed land (residential/commercial/industrial) within
 * `radiusM` of any of the given centres (district centroids), as centre points.
 */
export async function fetchBuiltPoints(centers: LatLng[], radiusM = OSM_RADIUS_M, fetchImpl: typeof fetch = fetch): Promise<LatLng[]> {
  if (!centers.length) return [];
  const parts = aroundOf(centers)
    .map((c) => `way["building"](around:${radiusM},${c});way["landuse"~"^(residential|commercial|retail|industrial)$"](around:${radiusM},${c});`)
    .join("");
  const text = await overpass(`[out:csv(::lat,::lon;false)][timeout:180];(${parts});out center;`, fetchImpl);
  const pts: LatLng[] = [];
  for (const line of text.split("\n")) {
    const [lat, lon] = line.split("\t").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat, lon]);
  }
  return pts;
}

/** Main roads (motorway…tertiary) within `radiusM` of the given centres, as line segments. */
export async function fetchMainRoads(centers: LatLng[], radiusM = OSM_RADIUS_M, fetchImpl: typeof fetch = fetch): Promise<Segment[]> {
  if (!centers.length) return [];
  const parts = aroundOf(centers)
    .map((c) => `way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"](around:${radiusM},${c});`)
    .join("");
  const text = await overpass(`[out:json][timeout:180];(${parts});out geom;`, fetchImpl);
  const json = JSON.parse(text) as { elements?: { geometry?: { lat: number; lon: number }[] }[] };
  const segs: Segment[] = [];
  for (const el of json.elements ?? []) {
    const g = el.geometry ?? [];
    for (let i = 1; i < g.length; i++) segs.push([[g[i - 1].lat, g[i - 1].lon], [g[i].lat, g[i].lon]]);
  }
  return segs;
}

/** Bounding box of points padded by `padDeg` (≈3 km at 0.03). */
export function bboxOf(points: LatLng[], padDeg = 0.03): BBox | null {
  if (!points.length) return null;
  let [s, w, n, e] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lat, lng] of points) {
    s = Math.min(s, lat);
    n = Math.max(n, lat);
    w = Math.min(w, lng);
    e = Math.max(e, lng);
  }
  return [s - padDeg, w - padDeg, n + padDeg, e + padDeg];
}

export function buildIndex(points: LatLng[]): GridIndex<null> {
  const g = new GridIndex<null>(0.01);
  for (const p of points) g.add(p, null);
  return g;
}
