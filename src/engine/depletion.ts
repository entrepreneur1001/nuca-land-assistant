import { MODEL } from "./config";
import type { Range } from "./queue";

export type FeatureKey = "plain" | "corner" | "garden" | "gardenCorner" | "sea";

export function featureKey(p: { gardenPct: number; cornerPct: number; seaPct: number }): FeatureKey {
  if (p.seaPct > 0) return "sea";
  const g = p.gardenPct > 0;
  const c = p.cornerPct > 0;
  return g && c ? "gardenCorner" : g ? "garden" : c ? "corner" : "plain";
}

export interface PlotLike {
  id: string;
  projectId: string | null;
  cityName: string;
  status: string;
  gardenPct: number;
  cornerPct: number;
  seaPct: number;
}

/**
 * Relative pick weight per feature combo, learned from what has been booked so far:
 * weight = booked-rate(combo) / booked-rate(plain), Laplace-smoothed.
 * Today's data: garden+corner plots get booked ~3x as often as plain ones.
 */
export function learnFeatureWeights(all: PlotLike[]): Record<FeatureKey, number> {
  const n: Record<FeatureKey, number> = { plain: 0, corner: 0, garden: 0, gardenCorner: 0, sea: 0 };
  const b: Record<FeatureKey, number> = { plain: 0, corner: 0, garden: 0, gardenCorner: 0, sea: 0 };
  for (const p of all) {
    const k = featureKey(p);
    n[k]++;
    if (p.status === "booked") b[k]++;
  }
  const rate = (k: FeatureKey) => (b[k] + 1) / (n[k] + 10);
  const base = rate("plain");
  const out = {} as Record<FeatureKey, number>;
  for (const k of Object.keys(n) as FeatureKey[]) out[k] = Math.min(10, Math.max(0.2, rate(k) / base));
  return out;
}

export interface SegmentDemand {
  /** projectId (sector) → recent bookings in the demand window */
  recentBookings: Map<string, number>;
}

/**
 * Distribute future bookings across sectors (projects). Each step allocates bookings
 * proportionally to demand weight among sectors that still have inventory, so demand
 * from a sector that runs out spills over to the others.
 * Returns expected bookings per sector for each scenario of total bookings ahead.
 */
export function simulateSectorDepletion(
  available: Map<string, number>,
  recentBookings: Map<string, number>,
  bookingsAhead: Range,
  smoothing = MODEL.demandSmoothing,
  steps = MODEL.simSteps,
): { low: Map<string, number>; mid: Map<string, number>; high: Map<string, number> } {
  const ids = [...available.keys()].filter((k) => (available.get(k) ?? 0) > 0);
  const totalInv = ids.reduce((a, k) => a + available.get(k)!, 0);
  const totalRecent = ids.reduce((a, k) => a + (recentBookings.get(k) ?? 0), 0);
  // weight = (1-α)·popularity share + α·inventory share
  const weight = new Map<string, number>();
  for (const k of ids) {
    const pop = totalRecent > 0 ? (recentBookings.get(k) ?? 0) / totalRecent : 0;
    const inv = totalInv > 0 ? available.get(k)! / totalInv : 0;
    weight.set(k, totalRecent > 0 ? (1 - smoothing) * pop + smoothing * inv : inv);
  }

  const remaining = new Map(ids.map((k) => [k, available.get(k)!]));
  const taken = new Map(ids.map((k) => [k, 0]));

  /** Allocate `amount` bookings among sectors with stock; saturated sectors spill over. */
  const allocate = (amount: number) => {
    let left = amount;
    for (let guard = 0; left > 1e-9 && guard < 100; guard++) {
      const active = ids.filter((k) => remaining.get(k)! > 1e-9);
      if (!active.length) return;
      const wsum = active.reduce((acc, k) => acc + weight.get(k)!, 0);
      let spent = 0;
      for (const k of active) {
        const share = wsum > 0 ? weight.get(k)! / wsum : 1 / active.length;
        const give = Math.min(remaining.get(k)!, left * share);
        remaining.set(k, remaining.get(k)! - give);
        taken.set(k, taken.get(k)! + give);
        spent += give;
      }
      left -= spent;
      if (spent < 1e-9) return;
    }
  };

  const step = Math.max(1, Math.max(bookingsAhead.high, 0) / steps);
  const results = {} as { low: Map<string, number>; mid: Map<string, number>; high: Map<string, number> };
  let done = 0;
  for (const name of ["low", "mid", "high"] as const) {
    const cp = Math.max(0, bookingsAhead[name]);
    while (done < cp - 1e-9) {
      const s = Math.min(step, cp - done);
      allocate(s);
      done += s;
    }
    results[name] = new Map(taken);
  }
  return results;
}

/**
 * Survival probabilities for plots inside one sector receiving `bookings` picks,
 * using weighted sampling without replacement (exponential-clock approximation):
 * P(survive_i) = exp(-w_i·t), with t chosen so Σ(1 - exp(-w_j·t)) = bookings.
 */
export function plotSurvival(weights: number[], bookings: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (bookings <= 1e-9) return weights.map(() => 1);
  if (bookings >= n - 1e-9) return weights.map(() => 0);
  const expected = (t: number) => weights.reduce((a, w) => a + (1 - Math.exp(-w * t)), 0);
  let lo = 0;
  let hi = 1;
  while (expected(hi) < bookings && hi < 1e9) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (expected(m) < bookings) lo = m;
    else hi = m;
  }
  const t = (lo + hi) / 2;
  return weights.map((w) => Math.exp(-w * t));
}

export interface Survival {
  low: number;
  mid: number;
  high: number;
}

/**
 * Per-plot survival bands for all available plots.
 * low = pessimistic (most bookings ahead), high = optimistic.
 */
export function computeSurvival(
  plots: PlotLike[],
  recentBookingsByProject: Map<string, number>,
  bookingsAhead: Range,
  featureWeights: Record<FeatureKey, number>,
): { survival: Map<string, Survival>; sectorBookings: ReturnType<typeof simulateSectorDepletion>; sectorAvailable: Map<string, number> } {
  const avail = plots.filter((p) => p.status === "available");
  const key = (p: PlotLike) => p.projectId ?? `city:${p.cityName}`;
  const bySector = new Map<string, PlotLike[]>();
  for (const p of avail) {
    const k = key(p);
    if (!bySector.has(k)) bySector.set(k, []);
    bySector.get(k)!.push(p);
  }
  const sectorAvailable = new Map([...bySector].map(([k, v]) => [k, v.length]));
  const sectorBookings = simulateSectorDepletion(sectorAvailable, recentBookingsByProject, bookingsAhead);
  const survival = new Map<string, Survival>();
  for (const [k, ps] of bySector) {
    const w = ps.map((p) => featureWeights[featureKey(p)]);
    // optimistic scenario = fewest bookings ahead
    const hi = plotSurvival(w, sectorBookings.low.get(k) ?? 0);
    const mid = plotSurvival(w, sectorBookings.mid.get(k) ?? 0);
    const lo = plotSurvival(w, sectorBookings.high.get(k) ?? 0);
    ps.forEach((p, i) => survival.set(p.id, { low: lo[i], mid: mid[i], high: hi[i] }));
  }
  return { survival, sectorBookings, sectorAvailable };
}
