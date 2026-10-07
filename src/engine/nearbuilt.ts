/**
 * "Near already-built places" signal.
 * - builtKm: distance to the nearest existing building / developed area (OpenStreetMap),
 *   measured from the plot, or from its sector's centre when the plot has no coordinates.
 * - neighbour share: how many plots around it are already booked (where people will build first).
 */

export type LatLng = [lat: number, lng: number];

/** Distances at or beyond this are shown as "5 km or more" (matches the OSM search radius). */
export const FAR_KM = 5;

const KM_PER_DEG_LAT = 111.32;
export function distanceKm(a: LatLng, b: LatLng): number {
  const kx = KM_PER_DEG_LAT * Math.cos(((a[0] + b[0]) / 2) * (Math.PI / 180));
  return Math.hypot((a[0] - b[0]) * KM_PER_DEG_LAT, (a[1] - b[1]) * kx);
}

/** Uniform grid over lat/lng for nearest-neighbour and radius queries. */
export class GridIndex<T> {
  private cells = new Map<string, { p: LatLng; v: T }[]>();
  constructor(private readonly cellDeg = 0.01) {}
  private key(lat: number, lng: number) {
    return `${Math.floor(lat / this.cellDeg)}:${Math.floor(lng / this.cellDeg)}`;
  }
  add(p: LatLng, v: T) {
    const k = this.key(p[0], p[1]);
    const c = this.cells.get(k);
    if (c) c.push({ p, v });
    else this.cells.set(k, [{ p, v }]);
  }
  get size() {
    let n = 0;
    for (const c of this.cells.values()) n += c.length;
    return n;
  }
  /** All entries within `km` of `q`. */
  within(q: LatLng, km: number): { p: LatLng; v: T; d: number }[] {
    const cellKm = this.cellDeg * KM_PER_DEG_LAT * Math.cos((Math.abs(q[0]) * Math.PI) / 180);
    const r = Math.ceil(km / cellKm) + 1;
    const ci = Math.floor(q[0] / this.cellDeg);
    const cj = Math.floor(q[1] / this.cellDeg);
    const out: { p: LatLng; v: T; d: number }[] = [];
    for (let i = ci - r; i <= ci + r; i++)
      for (let j = cj - r; j <= cj + r; j++)
        for (const e of this.cells.get(`${i}:${j}`) ?? []) {
          const d = distanceKm(q, e.p);
          if (d <= km) out.push({ ...e, d });
        }
    return out;
  }
  /** Distance (km) to the nearest entry, searching up to `maxKm`. null if none. */
  nearest(q: LatLng, maxKm = 15): number | null {
    const ci = Math.floor(q[0] / this.cellDeg);
    const cj = Math.floor(q[1] / this.cellDeg);
    // Smallest km width of one cell (longitude shrinks with latitude).
    const cellKm = this.cellDeg * KM_PER_DEG_LAT * Math.cos((Math.abs(q[0]) * Math.PI) / 180);
    const maxRing = Math.ceil(maxKm / cellKm) + 1;
    let best = Infinity;
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let i = ci - ring; i <= ci + ring; i++)
        for (let j = cj - ring; j <= cj + ring; j++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue;
          for (const e of this.cells.get(`${i}:${j}`) ?? []) best = Math.min(best, distanceKm(q, e.p));
        }
      // Anything in a farther ring is at least (ring) cells away.
      if (best !== Infinity && best <= ring * cellKm) break;
    }
    return best <= maxKm ? best : null;
  }
}

interface Locatable {
  id: string;
  projectId: string | null;
  zoneName?: string | null;
  cityName: string;
  latitude: number | null;
  longitude: number | null;
}

/** Mean position of plots with coordinates, per sector. */
export function sectorCentroids(plots: Locatable[]): Map<string, LatLng> {
  const acc = new Map<string, { lat: number; lng: number; n: number }>();
  for (const p of plots) {
    if (p.latitude == null || p.longitude == null || !p.projectId) continue;
    const a = acc.get(p.projectId) ?? { lat: 0, lng: 0, n: 0 };
    a.lat += p.latitude;
    a.lng += p.longitude;
    a.n++;
    acc.set(p.projectId, a);
  }
  return new Map([...acc].map(([k, a]) => [k, [a.lat / a.n, a.lng / a.n] as LatLng]));
}

/** builtKm per plot: from the plot (src 0), from its sector centre (src 1), or unknown (src 2). */
export function computeBuiltDistances(
  plots: Locatable[],
  built: GridIndex<null>,
): Map<string, { km: number | null; src: 0 | 1 | 2 }> {
  const centroids = sectorCentroids(plots);
  // No mapped buildings at all → unknown (likely a map coverage gap).
  // Buildings are only fetched within FAR_KM, so anything beyond is reported as FAR_KM ("5 km or more").
  const hasData = built.size > 0;
  const near = (q: LatLng) => (hasData ? Math.min(FAR_KM, built.nearest(q, FAR_KM + 1) ?? FAR_KM) : null);
  const sectorKm = new Map<string, number | null>();
  for (const [k, c] of centroids) sectorKm.set(k, near(c));
  const out = new Map<string, { km: number | null; src: 0 | 1 | 2 }>();
  for (const p of plots) {
    if (p.latitude != null && p.longitude != null) {
      out.set(p.id, { km: near([p.latitude, p.longitude]), src: hasData ? 0 : 2 });
    } else if (p.projectId && sectorKm.has(p.projectId)) {
      const k = sectorKm.get(p.projectId) ?? null;
      out.set(p.id, { km: k, src: k == null ? 2 : 1 });
    } else out.set(p.id, { km: null, src: 2 });
  }
  return out;
}

export const NEIGHBOUR_RADIUS_KM = 0.4;

/**
 * Share of nearby plots that are already booked. Uses a 400 m radius when the plot has
 * coordinates, otherwise its zone. null when there are no neighbours to judge by.
 */
export function neighbourBookedShare(plots: (Locatable & { status: string })[]): Map<string, number | null> {
  const grid = new GridIndex<{ id: string; booked: boolean }>(0.005);
  const zone = new Map<string, { n: number; b: number }>();
  for (const p of plots) {
    const booked = p.status === "booked";
    if (p.latitude != null && p.longitude != null) grid.add([p.latitude, p.longitude], { id: p.id, booked });
    const zk = `${p.cityName}|${p.projectId}|${p.zoneName ?? ""}`;
    const z = zone.get(zk) ?? { n: 0, b: 0 };
    z.n++;
    if (booked) z.b++;
    zone.set(zk, z);
  }
  const out = new Map<string, number | null>();
  for (const p of plots) {
    if (p.latitude != null && p.longitude != null) {
      const ns = grid.within([p.latitude, p.longitude], NEIGHBOUR_RADIUS_KM).filter((e) => e.v.id !== p.id);
      out.set(p.id, ns.length >= 3 ? ns.filter((e) => e.v.booked).length / ns.length : null);
    } else {
      const z = zone.get(`${p.cityName}|${p.projectId}|${p.zoneName ?? ""}`)!;
      const self = p.status === "booked" ? 1 : 0;
      out.set(p.id, z.n - 1 >= 3 ? (z.b - self) / (z.n - 1) : null);
    }
  }
  return out;
}

export const NEAR_BUILT = {
  /** Full credit within this distance. */
  fullKm: 0.5,
  /** No credit beyond this distance. */
  zeroKm: 5,
  distanceWeight: 0.6,
  neighbourWeight: 0.4,
  /** Value used when a part is unknown. */
  unknown: 0.3,
  /** Threshold for the "near built-up" badge / filter. */
  badgeKm: 1.5,
};

export function nearBuiltFactor(builtKm: number | null, neighbourShare: number | null): number {
  const c = NEAR_BUILT;
  const dist =
    builtKm == null ? c.unknown : Math.min(1, Math.max(0, (c.zeroKm - builtKm) / (c.zeroKm - c.fullKm)));
  const neigh = neighbourShare == null ? c.unknown : Math.min(1, neighbourShare * 2); // 50%+ booked around = full
  return c.distanceWeight * dist + c.neighbourWeight * neigh;
}
