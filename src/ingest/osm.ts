import { GridIndex, type LatLng } from "@/engine/nearbuilt";

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type BBox = [south: number, west: number, north: number, east: number];

/** Search radius: the near-built score is zero beyond 5 km, so nothing farther matters. */
export const OSM_RADIUS_M = 5000;

/**
 * Existing buildings and developed land (residential/commercial/industrial) within
 * `radiusM` of any of the given centres (district centroids), as centre points.
 */
export async function fetchBuiltPoints(centers: LatLng[], radiusM = OSM_RADIUS_M, fetchImpl: typeof fetch = fetch): Promise<LatLng[]> {
  if (!centers.length) return [];
  const around = centers.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`);
  const parts = around
    .map((c) => `way["building"](around:${radiusM},${c});way["landuse"~"^(residential|commercial|retail|industrial)$"](around:${radiusM},${c});`)
    .join("");
  const query = `[out:csv(::lat,::lon;false)][timeout:180];(${parts});out center;`;
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
      const text = await res.text();
      const pts: LatLng[] = [];
      for (const line of text.split("\n")) {
        const [lat, lon] = line.split("\t").map(Number);
        if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat, lon]);
      }
      return pts;
    } catch (e) {
      lastErr = e;
      await sleep(10_000 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
