/**
 * "On a main road" signal (على شارع رئيسي). NUCA doesn't publish it, so it is derived from
 * OpenStreetMap: the distance from the plot's outline to the nearest mapped main road.
 */
import { GridIndex, type LatLng } from "./nearbuilt";

export type Segment = [LatLng, LatLng];

export const MAIN_ROAD = {
  /** A plot whose outline is within this many metres of a main road's centreline faces it. */
  frontM: 30,
  /** Roads farther than this don't matter; such plots are stored with this value ("far"). */
  searchM: 200,
};

const KM_PER_DEG_LAT = 111.32;

type XY = [number, number];
/** Equirectangular projection to km around latitude `lat0`. */
const xy = (p: LatLng, lat0: number): XY => [p[1] * KM_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180), p[0] * KM_PER_DEG_LAT];

function pointSeg(P: XY, A: XY, B: XY): number {
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const len2 = dx * dx + dy * dy;
  const u = len2 ? Math.min(1, Math.max(0, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / len2)) : 0;
  return Math.hypot(P[0] - (A[0] + u * dx), P[1] - (A[1] + u * dy));
}

const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Distance (km) from point p to segment ab. */
export function segmentDistanceKm(p: LatLng, a: LatLng, b: LatLng): number {
  return pointSeg(xy(p, p[0]), xy(a, p[0]), xy(b, p[0]));
}

/** Distance (km) between segments pq and ab; 0 when they cross. */
export function segmentsDistanceKm(p: LatLng, q: LatLng, a: LatLng, b: LatLng): number {
  const lat0 = p[0];
  const [P, Q, A, B] = [xy(p, lat0), xy(q, lat0), xy(a, lat0), xy(b, lat0)];
  const d1 = cross(P, Q, A);
  const d2 = cross(P, Q, B);
  const d3 = cross(A, B, P);
  const d4 = cross(A, B, Q);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(pointSeg(P, A, B), pointSeg(Q, A, B), pointSeg(A, P, Q), pointSeg(B, P, Q));
}

/** Grid of segments, registered in every cell along them so radius queries can't miss long segments. */
export function buildRoadIndex(segments: Segment[], cellDeg = 0.002): GridIndex<Segment> {
  const g = new GridIndex<Segment>(cellDeg);
  for (const s of segments) {
    const [a, b] = s;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) / cellDeg));
    const seen = new Set<string>();
    for (let i = 0; i <= steps; i++) {
      const p: LatLng = [a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps];
      const k = `${Math.floor(p[0] / cellDeg)}:${Math.floor(p[1] / cellDeg)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      g.add(p, s);
    }
  }
  return g;
}

/** Vertices of the first ring of a stored polygon geometry. */
function ringOf(geometry: unknown): LatLng[] {
  const ring = (geometry as { coordinates?: number[][][] } | null)?.coordinates?.[0];
  return Array.isArray(ring) ? ring.filter((p) => p.length >= 2).map((p) => [p[1], p[0]] as LatLng) : [];
}

interface RoadPlot {
  id: string;
  latitude: number | null;
  longitude: number | null;
  geometry?: unknown;
}

/**
 * Metres from each plot's outline (or centre) to the nearest main road, capped at MAIN_ROAD.searchM.
 * null when the plot has no position or the city has no mapped main roads (coverage gap).
 */
export function computeRoadDistances(plots: RoadPlot[], roads: GridIndex<Segment>): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const searchKm = MAIN_ROAD.searchM / 1000;
  // Segment entries can sit up to one cell away from the part of the segment that is closest.
  const pad = 0.3;
  for (const p of plots) {
    const ring = ringOf(p.geometry);
    const pts: LatLng[] = ring.length ? ring : p.latitude != null && p.longitude != null ? [[p.latitude, p.longitude]] : [];
    if (!pts.length || roads.size === 0) {
      out.set(p.id, null);
      continue;
    }
    let best = Infinity;
    const segs = new Set<Segment>();
    for (const q of pts) for (const e of roads.within(q, searchKm + pad)) segs.add(e.v);
    // Polygon edges (closed ring) against road segments; a lone point is a zero-length edge.
    const edges: Segment[] = pts.length > 1 ? pts.slice(1).map((q, i) => [pts[i], q] as Segment) : [[pts[0], pts[0]]];
    for (const s of segs) for (const [e0, e1] of edges) best = Math.min(best, segmentsDistanceKm(e0, e1, s[0], s[1]));
    out.set(p.id, Math.round(Math.min(best * 1000, MAIN_ROAD.searchM)));
  }
  return out;
}

export const isOnMainRoad = (m: number | null | undefined) => m != null && m <= MAIN_ROAD.frontM;
