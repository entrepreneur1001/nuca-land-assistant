/**
 * What a plot faces («الواجهة»): a main road, a private compound (premium or not), existing buildings, and the
 * universities / hospitals / malls / clubs / stations near it. NUCA publishes none of this; it is measured offline
 * (scripts/surroundings) from the plot's outline on the official zone plan against OpenStreetMap roads and
 * buildings, the compounds layer and the places layer, and shipped as public/surroundings.json.
 *
 * "Faces" means: within a street's width of the plot's edge with no other plot of the plan in between, so the
 * second row behind a road-front plot does not count as on the road.
 */
import { isOnMainRoad } from "./roads";

export const FACING = {
  /** Plot edge to a main road's centreline (wide NUCA axes put the centreline 20–45 m from the frontage). */
  roadM: 100,
  /** Plot edge to a compound's outline: across one street. */
  compoundM: 120,
  /** Plot edge to a compound's outline for "near a compound" (across a highway, behind services land…): no view needed. */
  nearCompoundM: 500,
  /** Plot edge to an existing building's outline: across one street. */
  builtM: 80,
  /** Plot edge to services land («اراضي خدمات», pink on the official plan): across one street. */
  servicesLandM: 60,
  /** Services this close to the plot's centre count as "near". */
  serviceM: 1500,
  /** Spacing of the sample points along the plot's edge. */
  stepM: 3,
} as const;

/** Place kinds that make a plot more attractive when near (schools are everywhere, so they don't count). */
export const MAJOR_SERVICES = new Set(["university", "college", "hospital", "mall", "sports_centre", "club", "golf_course", "station", "stop"]);

export interface FacingCompound {
  id: number;
  name: string;
  /** Among the pricier third of compounds around it (Nawy's lowest listed price). */
  premium: boolean;
  m: number;
}

export interface NearbyService {
  /** places.ts category: education, health, shopping, sport, transport, landmark. */
  cat: string;
  /** OSM kind: university, hospital, mall … */
  sub: string;
  name: string;
  m: number;
}

export interface Faces {
  /** Metres from the plot to the main road it faces; null = faces none. */
  road: number | null;
  compound: FacingCompound | null;
  /** The nearest compound within FACING.nearCompoundM when the plot does not face one directly; null = none. */
  nearCompound?: FacingCompound | null;
  /** Metres to the existing buildings it faces; null = faces none. */
  built: number | null;
  /** Metres to the services land («اراضي خدمات»: a future mosque, school, mall…) it faces on the plan; null = none. */
  servicesLand?: number | null;
  /** Nearest major services within FACING.serviceM, nearest first. */
  services: NearbyService[];
}

// ---- scoring ----

/**
 * An inner plot sits at the neutral 0.5, so adding this factor lifts plots with a good frontage without pulling
 * every other plot's score (and its band) down.
 */
export const SURROUNDINGS_VALUES = {
  premiumCompound: 1,
  compound: 0.9,
  road: 0.8,
  built: 0.75,
  servicesLand: 0.75,
  nearPremiumCompound: 0.8,
  nearCompound: 0.7,
  /** Added when two or more of the above apply (a road-front plot facing a compound). */
  combo: 0.1,
  /** Added when a major service is within FACING.serviceM. */
  service: 0.05,
  /** Measured, faces nothing in particular (an inner plot). */
  none: 0.5,
  /** Not measured (no outline on a plan): same as an inner plot. */
  unknown: 0.5,
};

export const facesSomething = (f: Faces | null | undefined) =>
  !!f && (f.road != null || f.compound != null || f.built != null || f.servicesLand != null || f.nearCompound != null);
export const hasMajorService = (f: Faces | null | undefined) => !!f && f.services.some((s) => MAJOR_SERVICES.has(s.sub));

/** 0–1: how good the plot's frontage and surroundings are. */
export function surroundingsFactor(f: Faces | null | undefined, v = SURROUNDINGS_VALUES): number {
  if (!f) return v.unknown;
  const parts = [
    f.compound ? (f.compound.premium ? v.premiumCompound : v.compound) : 0,
    f.road != null ? v.road : 0,
    f.built != null ? v.built : 0,
    f.servicesLand != null ? v.servicesLand : 0,
    f.nearCompound ? (f.nearCompound.premium ? v.nearPremiumCompound : v.nearCompound) : 0,
  ];
  const hits = parts.filter((x) => x > 0).length;
  let s = hits ? Math.max(...parts) : v.none;
  if (hits >= 2) s += v.combo;
  if (hasMajorService(f)) s += v.service;
  return Math.min(1, s);
}

// ---- geometry (local metres) ----

export type XY = [x: number, y: number];

/** Equirectangular projection to metres around a reference latitude; good to well under 1 % over a few km. */
export function projector(lat0: number) {
  const ky = 111_320;
  const kx = ky * Math.cos((lat0 * Math.PI) / 180);
  return ([lat, lng]: [number, number]): XY => [lng * kx, lat * ky];
}

function closestOnSegment(p: XY, a: XY, b: XY): XY {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const u = len2 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return [a[0] + u * dx, a[1] + u * dy];
}

export function pointInPolygon(p: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export const boxOf = (pts: XY[]): Box => {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of pts) {
    b.x0 = Math.min(b.x0, x);
    b.y0 = Math.min(b.y0, y);
    b.x1 = Math.max(b.x1, x);
    b.y1 = Math.max(b.y1, y);
  }
  return b;
};
const boxesNear = (a: Box, b: Box, pad: number) => a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1;

export interface Blocker {
  poly: XY[];
  box: Box;
}

/** Points every `step` metres along a closed ring (the vertices included). */
export function sampleRing(ring: XY[], step: number): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** Gaps narrower than this between drawn plots are plot borders, not streets: they don't give a view. */
const BORDER_GAP_M = 2.5;

function distToPolygon(p: XY, poly: XY[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const q = closestOnSegment(p, poly[j], poly[i]);
    best = Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  return best;
}

const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function segmentsCross(p: XY, q: XY, a: XY, b: XY): boolean {
  const d1 = cross(p, q, a);
  const d2 = cross(p, q, b);
  const d3 = cross(a, b, p);
  const d4 = cross(a, b, q);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Whether the straight line from p to q is obstructed: it passes through (or squeezes along the border gap
 * between) other plots, or crosses one of the walls (main roads, for "facing a compound / buildings": a compound
 * across a highway is not one the plot faces).
 */
function blocked(p: XY, q: XY, blockers: Blocker[], walls: [XY, XY][]): boolean {
  for (const [a, b] of walls) if (segmentsCross(p, q, a, b)) return true;
  const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const n = Math.max(2, Math.ceil(d / 1.5));
  const seg = boxOf([p, q]);
  const near = blockers.filter((b) => boxesNear(b.box, seg, BORDER_GAP_M));
  if (!near.length) return false;
  for (let k = 1; k < n; k++) {
    const s: XY = [p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n];
    // The first metres leave the plot's own edge, where its side neighbours touch it.
    const buffer = k * (d / n) > BORDER_GAP_M ? BORDER_GAP_M : 0;
    for (const b of near) {
      if (s[0] < b.box.x0 - buffer || s[0] > b.box.x1 + buffer || s[1] < b.box.y0 - buffer || s[1] > b.box.y1 + buffer) continue;
      if (pointInPolygon(s, b.poly) || (buffer && distToPolygon(s, b.poly) < buffer)) return true;
    }
  }
  return false;
}

/**
 * Shortest unobstructed distance (m) from the plot's edge to any of the target lines, up to `maxM`; null when
 * none is that close in plain view. Targets are polylines; pass a closed ring with its first point repeated.
 * `blockers` are the other plots around (the plot itself must not be among them); `walls` are lines the view
 * may not cross.
 */
export function facingDistance(
  plotRing: XY[],
  targets: XY[][],
  blockers: Blocker[],
  maxM: number,
  walls: XY[][] = [],
  step: number = FACING.stepM,
): number | null {
  const pb = boxOf(plotRing);
  const segsNear = (lines: XY[][], pad: number) => {
    const out: [XY, XY][] = [];
    for (const t of lines) {
      if (!boxesNear(boxOf(t), pb, pad)) continue;
      for (let i = 1; i < t.length; i++) if (boxesNear(boxOf([t[i - 1], t[i]]), pb, pad)) out.push([t[i - 1], t[i]]);
    }
    return out;
  };
  const segs = segsNear(targets, maxM);
  if (!segs.length) return null;
  const wallSegs = segsNear(walls, maxM);
  const samples = sampleRing(plotRing, step);
  // Candidate pairs nearest first, so the first unobstructed one is the answer.
  const cands: { d: number; p: XY; q: XY }[] = [];
  for (const p of samples)
    for (const [a, b] of segs) {
      const q = closestOnSegment(p, a, b);
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= maxM) cands.push({ d, p, q });
    }
  cands.sort((x, y) => x.d - y.d);
  for (const c of cands) if (!blocked(c.p, c.q, blockers, wallSegs)) return Math.round(c.d);
  return null;
}

/** On a main road: the measured frontage when there is one, else the older OpenStreetMap distance (≤ 30 m). */
export const onRoad = (faces: Faces | null | undefined, mainRoadM: number | null | undefined) => (faces ? faces.road != null : isOnMainRoad(mainRoadM));
