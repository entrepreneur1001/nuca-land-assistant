/**
 * Private compounds (public/compounds, produced offline by scripts/compounds from Nawy's listings): each one's
 * outline and name, so a plot's map shows what is being built next to it. Context only, like the earlier-stage
 * plans: optional, and a missing index simply means none.
 */
import type { PlanCorners } from "@/lib/plans";

export interface Compound {
  id: number;
  name: string;
  nameAr: string | null;
  /** Developer. */
  dev: string | null;
  devAr: string | null;
  /** Nawy's area name (a city or a part of one). */
  area: string | null;
  areaAr: string | null;
  slug: string;
  /** [[south, west], [north, east]] of the outline. */
  bounds: [[number, number], [number, number]];
  /** Outline as [lat, lng] points, not closed. */
  ring: [number, number][];
  /** The master plan fitted onto the map by its silhouette (compoundImageUrl): approximate, a marketing drawing. */
  plan: { w: number; h: number; corners: PlanCorners; clip: [number, number][] } | null;
  /** Lowest unit price Nawy lists, in EGP; null when it lists none. A moving figure: approximate as of the last fetch. */
  price: number | null;
}

const BASE = "/compounds";
export const compoundImageUrl = (id: number) => `${BASE}/img/${id}.webp`;

let promise: Promise<Compound[]> | null = null;

/** Every compound, fetched once per session; empty when there is no index (404, offline, bad JSON). */
export function loadCompounds(): Promise<Compound[]> {
  promise ??= fetch(`${BASE}/index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<{ compounds?: Compound[] }>) : null))
    .then((idx) => (Array.isArray(idx?.compounds) ? idx.compounds.filter((c) => c.ring?.length >= 3 && !!c.bounds) : []))
    .catch(() => []);
  return promise;
}

/** Whether a compound's bounds touch the view [[south, west], [north, east]]. */
export function compoundInView(c: Pick<Compound, "bounds">, view: [[number, number], [number, number]]): boolean {
  const [[s, w], [n, e]] = c.bounds;
  return s <= view[1][0] && n >= view[0][0] && w <= view[1][1] && e >= view[0][1];
}

/** Whether [lat, lng] lies inside the compound's outline. */
export function compoundContains(c: Pick<Compound, "bounds" | "ring">, lat: number, lng: number): boolean {
  const [[s, w], [n, e]] = c.bounds;
  if (lat < s || lat > n || lng < w || lng > e) return false;
  let inside = false;
  for (let i = 0, j = c.ring.length - 1; i < c.ring.length; j = i++) {
    const [yi, xi] = c.ring[i];
    const [yj, xj] = c.ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
