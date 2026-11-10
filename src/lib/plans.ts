/**
 * Official NUCA zone plans (public/plans, produced offline): a georeferenced plan image per zone plus one
 * polygon per plot in image pixels. Everything here is optional: a missing or failing file simply means no overlay.
 */

export interface PlanIndexZone {
  /** City name as in `MetaDoc.cities`. */
  city: string;
  name: string;
  /** Source sector (`Plot.projectId`) the zone belongs to; null when the pipeline couldn't tell. */
  sector: string | null;
  /** [[south, west], [north, east]] of the image corners. */
  bounds: [[number, number], [number, number]];
  plots: number;
}

export interface PlanIndex {
  zones: Record<string, PlanIndexZone>;
}

/** Image corners as [lat, lng]: top-left, top-right, bottom-left (the fourth corner is implied). */
export interface PlanCorners {
  tl: [number, number];
  tr: [number, number];
  bl: [number, number];
}

export interface PlanZone {
  zid: number | string;
  /** Image size in pixels. */
  w: number;
  h: number;
  corners: PlanCorners;
  /** Plot id → polygon in image pixels. */
  plots: Record<string, [number, number][]>;
  /** Plot shapes the pipeline couldn't match to a plot id. */
  unassigned: [number, number][][];
}

export interface LoadedPlan {
  zid: string;
  info: PlanIndexZone;
  zone: PlanZone;
  /** URL of the plan image. */
  image: string;
}

const BASE = "/plans";
export const planImageUrl = (zid: string) => `${BASE}/${zid}.webp`;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

let indexPromise: Promise<PlanIndex | null> | null = null;
const zoneCache = new Map<string, Promise<PlanZone | null>>();

/** The plan index, fetched once per session; null when there are no plans (404, offline, bad JSON). */
export function loadPlanIndex(): Promise<PlanIndex | null> {
  indexPromise ??= getJson<PlanIndex>(`${BASE}/index.json`).then((idx) => (idx && typeof idx.zones === "object" ? idx : null));
  return indexPromise;
}

/** One zone's plan, fetched once per session; null when the file is missing or malformed. */
export function loadPlanZone(zid: string): Promise<PlanZone | null> {
  let p = zoneCache.get(zid);
  if (!p) {
    p = getJson<PlanZone>(`${BASE}/${zid}.json`).then((z) =>
      z && z.w > 0 && z.h > 0 && z.corners?.tl && z.corners.tr && z.corners.bl && z.plots && typeof z.plots === "object" ? z : null,
    );
    zoneCache.set(zid, p);
  }
  return p;
}

/** Zone ids whose sector is one of `sectorIds` (the main way plans are matched to the map). */
export function zonesForSectors(index: PlanIndex, sectorIds: Iterable<string | null | undefined>): string[] {
  const want = new Set<string>();
  for (const s of sectorIds) if (s) want.add(s);
  return Object.entries(index.zones)
    .filter(([, z]) => z.sector != null && want.has(z.sector))
    .map(([zid]) => zid);
}

/**
 * Zones of `city` the index has no sector for, which draw at least one of `plotIds`. Their files are only
 * fetched when such zones exist, so the common case costs nothing.
 */
export async function zonesForPlots(
  index: PlanIndex,
  city: string,
  plotIds: ReadonlySet<string>,
  load: (zid: string) => Promise<PlanZone | null> = loadPlanZone,
): Promise<string[]> {
  const candidates = Object.entries(index.zones)
    .filter(([, z]) => z.sector == null && z.city === city)
    .map(([zid]) => zid);
  if (!candidates.length || !plotIds.size) return [];
  const zones = await Promise.all(candidates.map(load));
  return candidates.filter((_, i) => {
    const z = zones[i];
    return !!z && Object.keys(z.plots).some((id) => plotIds.has(id));
  });
}

/**
 * The plans to draw for a set of districts (and, for zones the index has no sector for, a set of plots in `city`).
 * Never rejects: zones that fail to load are left out.
 */
export async function loadPlans(city: string, sectorIds: Iterable<string | null | undefined>, plotIds: ReadonlySet<string>): Promise<LoadedPlan[]> {
  try {
    const index = await loadPlanIndex();
    if (!index) return [];
    const zids = new Set(zonesForSectors(index, sectorIds));
    for (const zid of await zonesForPlots(index, city, plotIds)) zids.add(zid);
    const loaded = await Promise.all([...zids].map(async (zid) => ({ zid, info: index.zones[zid], zone: await loadPlanZone(zid) })));
    return loaded.flatMap((l) => (l.zone ? [{ zid: l.zid, info: l.info, zone: l.zone, image: planImageUrl(l.zid) }] : []));
  } catch {
    return [];
  }
}

/** The subset of Leaflet's CRS the plan maths needs (`L.CRS.EPSG3857` / `map.options.crs` satisfy it). */
export interface PlanCrs {
  project(latlng: { lat: number; lng: number }): { x: number; y: number };
  unproject(point: { x: number; y: number }): { lat: number; lng: number };
}

/**
 * Maps image pixels to the map. The plan is an affine (scaled, rotated) rectangle on the projected plane, so pixel
 * (x, y) is tl + (x/w)·(tr − tl) + (y/h)·(bl − tl) in projected metres, then unprojected; interpolating raw
 * lat/lng would bend rotated plans.
 */
export function planProjector(corners: PlanCorners, w: number, h: number, crs: PlanCrs): (x: number, y: number) => { lat: number; lng: number } {
  const at = ([lat, lng]: [number, number]) => crs.project({ lat, lng });
  const tl = at(corners.tl);
  const tr = at(corners.tr);
  const bl = at(corners.bl);
  const ax = (tr.x - tl.x) / w;
  const ay = (tr.y - tl.y) / w;
  const bx = (bl.x - tl.x) / h;
  const by = (bl.y - tl.y) / h;
  return (x, y) => {
    const p = crs.unproject({ x: tl.x + ax * x + bx * y, y: tl.y + ay * x + by * y });
    return { lat: p.lat, lng: p.lng };
  };
}

export function imagePointToLatLng(corners: PlanCorners, w: number, h: number, x: number, y: number, crs: PlanCrs): { lat: number; lng: number } {
  return planProjector(corners, w, h, crs)(x, y);
}

/**
 * The part of a plan image worth showing: the convex hull of every plot drawn on it, pushed outwards by `pad`
 * pixels (clamped to the image), as [x, y] image pixels. Plans carry wide white margins, a title banner and often
 * the neighbouring zones' drawings; where several zones of a district overlap, those would cover each other.
 * Null when the plan has no shapes (then the whole image shows).
 */
export function planClip(zone: Pick<PlanZone, "w" | "h" | "plots" | "unassigned">, pad = Math.round(Math.max(zone.w, zone.h) * 0.04)): [number, number][] | null {
  const pts: [number, number][] = [];
  for (const poly of [...Object.values(zone.plots), ...(zone.unassigned ?? [])]) if (Array.isArray(poly)) for (const [x, y] of poly) pts.push([x, y]);
  if (pts.length < 3) return null;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: [number, number][]) => {
    const out: [number, number][] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  const hull = [...half(pts), ...half([...pts].reverse())];
  if (hull.length < 3) return null;
  // Push each edge outwards by `pad` and intersect neighbours: a true offset, so thin plans keep their boundary road.
  const n = hull.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += hull[i][0] * hull[(i + 1) % n][1] - hull[(i + 1) % n][0] * hull[i][1];
  const sign = area >= 0 ? 1 : -1;
  const lines = hull.map((a, i) => {
    const b = hull[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = (sign * (b[1] - a[1])) / len;
    const ny = (-sign * (b[0] - a[0])) / len;
    return { px: a[0] + nx * pad, py: a[1] + ny * pad, dx: b[0] - a[0], dy: b[1] - a[1] };
  });
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  return lines.map((l, i) => {
    const m = lines[(i + n - 1) % n];
    const det = m.dx * l.dy - m.dy * l.dx;
    // Near-parallel neighbours: the offset point of this edge's start is good enough.
    const k = Math.abs(det) < 1e-9 ? 0 : ((l.px - m.px) * l.dy - (l.py - m.py) * l.dx) / det;
    const x = Math.abs(det) < 1e-9 ? l.px : m.px + m.dx * k;
    const y = Math.abs(det) < 1e-9 ? l.py : m.py + m.dy * k;
    return [Math.round(clamp(x, zone.w)), Math.round(clamp(y, zone.h))] as [number, number];
  });
}
