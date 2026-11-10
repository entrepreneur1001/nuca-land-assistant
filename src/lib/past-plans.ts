/**
 * Plans of earlier offerings (public/plans/past, produced offline): the official plan images of zones that are no
 * longer open, placed on the map like the current ones (src/lib/plans.ts) but with no plots: the official site
 * keeps their drawings and drops their plot lists. The maps draw them muted behind the current stage. Optional
 * like every plan: a missing index simply means none.
 */
import type { PlanCorners } from "@/lib/plans";

export interface PastPlanZone {
  /** City name as in `MetaDoc.cities`. */
  city: string;
  name: string;
  /** Offering the zone belonged to: "10", "9", "9c" (complementary) …; "0" when its project name gives none. */
  stage: string;
  /** Official project id. */
  pid: number;
  /** Image size in pixels. */
  w: number;
  h: number;
  corners: PlanCorners;
  /** [[south, west], [north, east]] of the image corners. */
  bounds: [[number, number], [number, number]];
  /** The drawn site as [x, y] image pixels; the rest of the image (margins, title) is not shown. */
  clip?: [number, number][];
}

export interface PastPlanIndex {
  zones: Record<string, PastPlanZone>;
}

const BASE = "/plans/past";
export const pastImageUrl = (zid: string) => `${BASE}/${zid}.webp`;

let indexPromise: Promise<PastPlanIndex | null> | null = null;

/** The earlier-stage index, fetched once per session; null when there is none (404, offline, bad JSON). */
export function loadPastIndex(): Promise<PastPlanIndex | null> {
  indexPromise ??= fetch(`${BASE}/index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<PastPlanIndex>) : null))
    .then((idx) => (idx && typeof idx.zones === "object" ? idx : null))
    .catch(() => null);
  return indexPromise;
}

/** The earlier-stage zones of `city`, as [zid, zone] pairs. */
export function pastZonesOfCity(index: PastPlanIndex | null, city: string): [string, PastPlanZone][] {
  return index ? Object.entries(index.zones).filter(([, z]) => z.city === city && z.w > 0 && z.h > 0 && !!z.corners && !!z.bounds) : [];
}

/** Whether a zone's bounds touch the view [[south, west], [north, east]]. */
export function pastZoneInView(zone: Pick<PastPlanZone, "bounds">, view: [[number, number], [number, number]]): boolean {
  const [[s, w], [n, e]] = zone.bounds;
  return s <= view[1][0] && n >= view[0][0] && w <= view[1][1] && e >= view[0][1];
}
