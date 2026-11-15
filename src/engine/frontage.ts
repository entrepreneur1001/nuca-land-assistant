/**
 * Which way a plot's street side faces («اتجاه الواجهة»: بحري / قبلي / شرقي / غربي and the four in between).
 * Measured offline (scripts/frontage/build.mts) from the plot's outline on the official zone plan: every side of
 * the outline is tested for a street right outside it (the plan draws streets grey), and the compass bearing of a
 * street side's outward normal is its direction. Shipped as public/frontage.json.
 *
 * Geometry is in local metres, x = east, y = north, so a bearing is relative to true north and never to the screen.
 */
import { ORIENTATION_VALUES } from "./config";
import { boxOf, pointInPolygon, type Blocker, type XY } from "./surroundings";

/**
 * What the official plan shows at a point: a street, a street drawn faded (outside the zone), a pavement, greenery,
 * a plot, one of the red blocks the plans draw along their streets, something else drawn on or beside a street
 * (a tree's crown, a kerb or lane line, a pavement in an unusual tint), anything else.
 */
export type Ground = "road" | "pale" | "pave" | "green" | "plot" | "block" | "clutter" | "other";
export type Probe = (x: number, y: number) => Ground;

/** 0 = not determined («غير محدد»), 1 = medium, 2 = high. */
export type Confidence = 0 | 1 | 2;

export interface FrontSide {
  /** Direction the side faces: degrees clockwise from true north, 0–360. */
  bearing: number;
  /** The side runs along the plot's outline from vertex `from` forward to vertex `to` (indices into the plan polygon, wrapping). */
  from: number;
  to: number;
  /** Width of the street outside it, metres (0 = not measured). */
  widthM: number;
}

export interface Frontage {
  conf: Confidence;
  /** Street sides, the main one first; empty when not determined. */
  sides: FrontSide[];
}

export const FRONTAGE = {
  /** Consecutive edges turning less than this off the side's mean heading belong to the same side. */
  mergeDeg: 25,
  /** Spacing of the test points along a side. */
  stepM: 2,
  /** The street must begin within this distance of the outline (the plot's drawn border and a kerb fit in it). */
  roadStartM: 6,
  /** A pavement drawn between the plot and the street does not count towards that distance, up to this far out. */
  paveReachM: 16,
  /** …and be at least this wide to be a street rather than a drawn line. */
  minRoadM: 3,
  /** How far outward a test looks for the street's far side and the plots across it. */
  reachM: 60,
  /** Share of a side's test points that must see a street for the side to be a frontage. */
  sideShare: 0.6,
  /** …and for a high-confidence one. */
  sureShare: 0.8,
  /** Sides shorter than this, or than `minRatio` of the longest frontage, are corner cuts, not frontages. */
  minSideM: 4,
  minRatio: 0.3,
  /**
   * Second look, only for a plot the rules above find no street for: the plan often draws trees and red blocks on
   * the street, which hide it. A red block counts as street; up to this many metres of clutter, pavement or planting
   * in a row are looked through once the street has begun, and before it begins they count like a pavement. Such a
   * side is never "high".
   */
  coveredGapM: 14,
  /**
   * …and a test point that sees no street at all because a tree's crown covers it (nothing but planting, clutter and
   * pavement for the first `hiddenM` metres, at least `hiddenMinM` of them planting or clutter) stands in for one, as
   * long as this share of the side's points do see the street.
   */
  hiddenM: 10,
  hiddenMinM: 4,
  coveredShare: 0.25,
} as const;

// ---- compass ----

/** 0 بحري, 1 بحري شرقي, 2 شرقي, 3 قبلي شرقي, 4 قبلي, 5 قبلي غربي, 6 غربي, 7 بحري غربي. */
export type Compass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const normDeg = (d: number) => ((d % 360) + 360) % 360;

/** The 45° sector a bearing falls in: 337.5–22.5 north, 22.5–67.5 north-east, … (lower bound included). */
export const compass8 = (bearing: number): Compass => (Math.floor((normDeg(bearing) + 22.5) / 45) % 8) as Compass;

const angleBetween = (a: number, b: number) => {
  const d = Math.abs(normDeg(a) - normDeg(b));
  return d > 180 ? 360 - d : d;
};

const isRightAngle = (a: number, b: number) => {
  const d = angleBetween(a, b);
  return d >= 45 && d <= 135;
};

/** Two street sides at roughly a right angle (ناصية), as opposed to a plot running through between two streets. */
export function isCornerPlot(f: Frontage | null | undefined): boolean {
  if (!f || f.sides.length < 2) return false;
  for (let i = 0; i < f.sides.length; i++)
    for (let j = i + 1; j < f.sides.length; j++) if (isRightAngle(f.sides[i].bearing, f.sides[j].bearing)) return true;
  return false;
}

/** The plot's distinct directions, the main frontage first. */
export function directions(f: Frontage | null | undefined): Compass[] {
  const out: Compass[] = [];
  for (const s of f?.sides ?? []) {
    const c = compass8(s.bearing);
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** Has a determined frontage facing the given direction, on any of its street sides. */
export const facesDirection = (f: Frontage | null | undefined, c: Compass) => !!f && f.conf > 0 && directions(f).includes(c);

/** Has a determined frontage facing north (بحري), on any of its street sides. */
export const facesNorth = (f: Frontage | null | undefined) => !!f && f.conf > 0 && directions(f).includes(0);

/**
 * 0–1: how sought-after the plot's direction is (بحري best, قبلي least). A plot with several street sides takes its
 * best one. Not determined scores the neutral 0.5, so unmeasured plots are not pushed down.
 */
export function orientationFactor(f: Frontage | null | undefined, v: typeof ORIENTATION_VALUES = ORIENTATION_VALUES): number {
  if (!f || f.conf === 0 || !f.sides.length) return v.unknown;
  return Math.max(...directions(f).map((c) => v.byCompass[c]));
}

// ---- sides of the outline ----

export interface Side {
  from: number;
  to: number;
  /** Indices of the ring edges it is made of (edge i runs from vertex i to vertex i + 1). */
  edges: number[];
  lengthM: number;
  bearing: number;
}

const signedArea = (ring: XY[]) => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
};

/** Outward unit normal of the edge a → b of a ring with the given winding. */
const outward = (dx: number, dy: number, ccw: boolean): XY => {
  const len = Math.hypot(dx, dy) || 1;
  return ccw ? [dy / len, -dx / len] : [-dy / len, dx / len];
};

/**
 * The outline as straight sides: consecutive edges that keep (nearly) the same heading are one side, so a plot
 * traced with extra vertices still has four. Each side's bearing is the direction it faces (outward normal).
 */
export function plotSides(ring: XY[], mergeDeg: number = FRONTAGE.mergeDeg): Side[] {
  const n = ring.length;
  if (n < 3) return [];
  const ccw = signedArea(ring) > 0;
  const vec = (i: number): XY => [ring[(i + 1) % n][0] - ring[i][0], ring[(i + 1) % n][1] - ring[i][1]];
  const heading = ([dx, dy]: XY) => (Math.atan2(dy, dx) * 180) / Math.PI;
  const real = (i: number) => Math.hypot(...vec(i)) > 1e-6;
  // Start at the sharpest turn, so the first side is not the tail of the last one.
  let start = 0;
  let sharpest = -1;
  for (let i = 0; i < n; i++) {
    const prev = (i + n - 1) % n;
    if (!real(i) || !real(prev)) continue;
    const turn = angleBetween(heading(vec(i)), heading(vec(prev)));
    if (turn > sharpest) {
      sharpest = turn;
      start = i;
    }
  }
  const sides: (Side & { sx: number; sy: number })[] = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const cur = sides[sides.length - 1];
    if (!real(i)) {
      if (cur) cur.to = (i + 1) % n;
      continue;
    }
    const [dx, dy] = vec(i);
    if (cur && angleBetween(heading([dx, dy]), heading([cur.sx, cur.sy])) < mergeDeg) {
      cur.edges.push(i);
      cur.sx += dx;
      cur.sy += dy;
      cur.lengthM += Math.hypot(dx, dy);
      cur.to = (i + 1) % n;
    } else sides.push({ from: i, to: (i + 1) % n, edges: [i], lengthM: Math.hypot(dx, dy), bearing: 0, sx: dx, sy: dy });
  }
  return sides.map(({ sx, sy, ...s }) => {
    const [nx, ny] = outward(sx, sy, ccw);
    return { ...s, bearing: normDeg((Math.atan2(nx, ny) * 180) / Math.PI) };
  });
}

// ---- what lies outside a side ----

export interface SideEvidence {
  /** Test points along the side. */
  n: number;
  /** Share of them with a street right outside. */
  road: number;
  /** Share with a faded street (drawn outside the zone), or a street behind a planted strip, right outside. */
  pale: number;
  /** Share with nothing built against them for the first metres (no neighbouring plot, no greenery). */
  open: number;
  /** Share with no neighbouring plot against them for the first metres, whatever the plan draws there. */
  free: number;
  /** Share that reach another plot across the gap. */
  across: number;
  /** Median width of the street seen, metres. */
  widthM: number;
  /** Second look only: share that see no street because a tree's crown or the like covers the first metres. */
  hidden: number;
}

const inBlockers = (x: number, y: number, blockers: Blocker[]) => {
  for (const b of blockers) if (x >= b.box.x0 && x <= b.box.x1 && y >= b.box.y0 && y <= b.box.y1 && pointInPolygon([x, y], b.poly)) return true;
  return false;
};

/** Looks outward from every test point of a side: is there a street, how wide, and what is across it. */
export function sideEvidence(ring: XY[], side: Side, probe: Probe, blockers: Blocker[], F: typeof FRONTAGE = FRONTAGE, covered = false): SideEvidence {
  const n = ring.length;
  const ccw = signedArea(ring) > 0;
  let tests = 0;
  let road = 0;
  let pale = 0;
  let open = 0;
  let free = 0;
  let across = 0;
  let hidden = 0;
  const widths: number[] = [];
  for (const i of side.edges) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const [nx, ny] = outward(dx, dy, ccw);
    const m = Math.max(1, Math.round(Math.hypot(dx, dy) / F.stepM));
    for (let k = 0; k < m; k++) {
      const u = (k + 0.5) / m;
      const px = a[0] + dx * u;
      const py = a[1] + dy * u;
      tests++;
      // Walk outward a metre at a time: where the street begins, how far it runs, where the next plot stands.
      let blockedAt = Infinity;
      let first = -1;
      let firstKind: Ground = "road";
      let last = -1;
      let gap = 0;
      let ended = false;
      let green = 0;
      let pave = 0;
      let planted = 0;
      let yellow = 0;
      let cover = 0; // planting, clutter and red blocks in the first metres
      let bare = 0; // …and anything that is neither those nor pavement nor street
      let grey = 0; // metres of street actually seen (what is looked through does not count)
      for (let d = 1; d <= F.reachM; d++) {
        const x = px + nx * d;
        const y = py + ny * d;
        if (inBlockers(x, y, blockers)) {
          blockedAt = d;
          break;
        }
        if (ended && !(covered && d <= F.hiddenM)) continue;
        const g = probe(x, y);
        if (covered && d <= F.hiddenM) {
          if (g === "green" || g === "clutter" || g === "block") cover++;
          else if (g === "plot" || g === "other") bare++;
        }
        // Second look: yellow right outside is a plot that was not outlined, not a street's edge.
        if (ended) continue;
        if (covered && first < 0 && g === "plot" && ++yellow > 1) {
          ended = true;
          continue;
        }
        if (d <= F.roadStartM && g === "green") green++;
        // A pavement, or a planted strip, between the plot and its street is part of the street's edge.
        const soft = g === "pave" || g === "green" || (covered && g === "clutter");
        if (soft && first < 0) pave++;
        if ((g === "green" || (covered && g === "clutter")) && first < 0) planted++;
        const lead = d - pave; // metres walked so far that are not pavement
        if (g === "road" || g === "pale" || (covered && g === "block")) {
          if (first < 0) {
            if (lead > F.roadStartM || d > F.paveReachM) ended = true;
            else {
              first = d;
              firstKind = g;
              last = d;
              grey = 1;
            }
          } else {
            last = d;
            gap = 0;
            grey++;
          }
        } else if (first >= 0 && ++gap > (covered && soft ? F.coveredGapM : 1)) ended = true; // one odd sample (a lane line, a kerb) does not end the street
        else if (first < 0 && (lead >= F.roadStartM || d >= F.paveReachM)) ended = true;
      }
      const width = first >= 0 ? last - first + 1 : 0;
      if ((covered ? grey : width) >= F.minRoadM) {
        // Behind more than a kerb's width of planting the street is less certain: counted like a faded one.
        if (!covered && firstKind === "road" && planted <= 2) road++;
        else pale++;
        widths.push(width);
      } else if (covered && blockedAt > F.hiddenM && bare <= 2 && cover >= F.hiddenMinM) hidden++;
      if (blockedAt > F.roadStartM) free++;
      if (blockedAt > F.roadStartM && green < F.roadStartM / 2) open++;
      if (blockedAt > F.roadStartM && blockedAt <= F.reachM) across++;
    }
  }
  widths.sort((x, y) => x - y);
  const share = (x: number) => (tests ? x / tests : 0);
  return { n: tests, road: share(road), pale: share(pale), open: share(open), free: share(free), across: share(across), widthM: widths.length ? widths[widths.length >> 1] : 0, hidden: share(hidden) };
}

export interface FrontageContext {
  /** The zone's placement and its north are trusted (not an approximate placement, official north arrow agrees). */
  trusted: boolean;
  /** The zone's plan draws streets in the usual grey; without it only a plot row across the gap can confirm a street. */
  roadColour: boolean;
  /** The official corner premium (ناصية) of the plot, when known. */
  corner?: boolean | null;
}

/**
 * The plot's street sides and how sure they are. High: every reported side clearly lies on a street the plan
 * draws, in a trusted zone, and the corner count matches the official corner premium. Medium: measured but with a
 * doubt (partly on a street, a faded street outside the zone, a corner count that disagrees, an approximate zone).
 * Otherwise not determined: nothing is guessed from the plot's shape alone.
 */
export function plotFrontage(ring: XY[], probe: Probe, blockers: Blocker[], ctx: FrontageContext, F: typeof FRONTAGE = FRONTAGE): Frontage {
  const pb = boxOf(ring);
  const near = blockers.filter((b) => b.box.x0 <= pb.x1 + F.reachM + 5 && pb.x0 - F.reachM - 5 <= b.box.x1 && b.box.y0 <= pb.y1 + F.reachM + 5 && pb.y0 - F.reachM - 5 <= b.box.y1);
  const found: { side: Side; ev: SideEvidence; sure: boolean }[] = [];
  /** Sides with no plot against them that are not on a street: a footpath or a garden strip runs along them. */
  const flanks: Side[] = [];
  for (const side of plotSides(ring, F.mergeDeg)) {
    if (side.lengthM < F.minSideM) continue;
    const ev = sideEvidence(ring, side, probe, near, F);
    if (ev.free >= F.sideShare && ev.road + ev.pale < F.sideShare) flanks.push(side);
    if (ctx.roadColour) {
      if (ev.road >= F.sideShare) found.push({ side, ev, sure: ev.road >= F.sureShare });
      else if (ev.road + ev.pale >= F.sideShare) found.push({ side, ev, sure: false });
    } else if (ev.open >= F.sideShare && ev.across >= 0.5) found.push({ side, ev, sure: false });
  }
  // No street side: look again through what the plan draws on top of its streets. Medium at best.
  if (!found.length && ctx.roadColour)
    for (const side of plotSides(ring, F.mergeDeg)) {
      if (side.lengthM < F.minSideM) continue;
      const ev = sideEvidence(ring, side, probe, near, F, true);
      if (ev.road + ev.pale >= F.coveredShare && ev.road + ev.pale + ev.hidden >= F.sideShare) found.push({ side, ev, sure: false });
    }
  if (!found.length) return { conf: 0, sides: [] };
  const longest = Math.max(...found.map((f) => f.side.lengthM));
  const kept = found.filter((f) => f.side.lengthM >= F.minRatio * longest);
  // Main frontage: the widest street, then the longest side.
  kept.sort((a, b) => b.ev.widthM - a.ev.widthM || b.side.lengthM - a.side.lengthM);
  const sides: FrontSide[] = kept.map(({ side, ev }) => ({ bearing: Math.round(side.bearing * 10) / 10, from: side.from, to: side.to, widthM: ev.widthM }));
  const out: Frontage = { conf: 1, sides };
  // The official corner premium (ناصية) also goes to plots beside a footpath or a garden strip, not only to plots
  // on two streets: a free side next to a frontage explains it.
  const beside = flanks.some((s) => kept.some((f) => isRightAngle(s.bearing, f.side.bearing)));
  const cornerOk = ctx.corner == null || (ctx.corner ? isCornerPlot(out) || beside : !isCornerPlot(out));
  if (ctx.trusted && ctx.roadColour && cornerOk && kept.every((f) => f.sure)) out.conf = 2;
  return out;
}

/** The outline vertices a side runs over, in order (for drawing it): from `from` forward to `to`, wrapping. */
export function sideVertices<T>(ring: readonly T[], side: Pick<FrontSide, "from" | "to">): T[] {
  const n = ring.length;
  const out: T[] = [];
  if (!n || side.from < 0 || side.from >= n || side.to < 0 || side.to >= n) return out;
  for (let i = side.from, k = 0; k <= n; i = (i + 1) % n, k++) {
    out.push(ring[i]);
    if (i === side.to && k > 0) break;
  }
  return out;
}
