import { DEFAULT_PREMIUM_VALUES, DEFAULT_WEIGHTS, MODEL, type PremiumValues, type Weights } from "./config";
import { featureKey, type Survival } from "./depletion";
import { NEAR_BUILT, nearBuiltFactor } from "./nearbuilt";
import { km as fmtKm, t } from "@/i18n/ar";

export type FeatureMode = "ignore" | "prefer" | "require";

export interface Profile {
  bookingRank: number;
  moneyPaid: number;
  moneyAvailable: number | null;
  maxAdditional: number;
  preferredCities: string[];
  preferredProjects: string[];
  minArea: number | null;
  maxArea: number | null;
  preferredArea: number | null;
  maxPrice: number | null;
  preferredPricePerMeter: number | null;
  weights?: Partial<Weights> | null;
  preferences?: {
    garden?: FeatureMode;
    corner?: FeatureMode;
    nearBuilt?: FeatureMode;
    onlyPreferredCities?: boolean;
    premiumValues?: Partial<PremiumValues>;
  } | null;
}

export interface ScorableLand {
  id: string;
  cityName: string;
  projectId: string | null;
  projectName: string | null;
  plotNumber: string;
  area: number;
  pricePerMeter: number;
  totalPrice: number;
  downPayment: number;
  gardenPct: number;
  cornerPct: number;
  seaPct: number;
  status: string;
  latitude: number | null;
  builtKm?: number | null;
}

export type Recommendation = "STRONG_BUY" | "GOOD" | "WATCH" | "SKIP";
export type ReachLabel = "REACHABLE" | "RISKY" | "UNLIKELY" | "BOOKED";

export interface Factors {
  reachability: number;
  nearBuilt: number;
  premium: number;
  budget: number;
  location: number;
  value: number;
  area: number;
}

export interface ScoredLand {
  id: string;
  score: number;
  factors: Factors;
  survival: Survival;
  reach: ReachLabel;
  recommendation: Recommendation;
  hasGarden: boolean;
  hasCorner: boolean;
  /** Within NEAR_BUILT.badgeKm of existing buildings. */
  isNearBuilt: boolean;
  neighbourShare: number | null;
  /** Extra money needed beyond what was already paid to cover the down payment. */
  extraNeeded: number;
  reasons: string[];
}

export interface ExclusionStats {
  booked: number;
  overBudget: number;
  areaOrPrice: number;
  featureRequired: number;
  city: number;
}

export const isNearBuilt = (builtKm: number | null | undefined) => builtKm != null && builtKm <= NEAR_BUILT.badgeKm;

export function budgetLimit(p: Profile) {
  return p.moneyPaid + Math.max(0, p.maxAdditional || 0);
}

export function reachLabel(s: number, status: string): ReachLabel {
  if (status !== "available") return "BOOKED";
  return s >= MODEL.reachableAt ? "REACHABLE" : s >= MODEL.riskyAt ? "RISKY" : "UNLIKELY";
}

export function band(score: number, survivalMid: number): Recommendation {
  let r: Recommendation =
    score >= MODEL.bands.STRONG_BUY ? "STRONG_BUY" : score >= MODEL.bands.GOOD ? "GOOD" : score >= MODEL.bands.WATCH ? "WATCH" : "SKIP";
  // Never recommend something you very likely can't reach.
  if (survivalMid < MODEL.riskyAt && (r === "STRONG_BUY" || r === "GOOD")) r = "WATCH";
  return r;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Hard filters. Returns the reason a land is excluded, or null if eligible. */
export function exclusionReason(l: ScorableLand, p: Profile): keyof ExclusionStats | null {
  if (l.status !== "available") return "booked";
  if (l.downPayment > budgetLimit(p)) return "overBudget";
  if (p.maxPrice != null && l.totalPrice > p.maxPrice) return "areaOrPrice";
  if (p.minArea != null && l.area < p.minArea) return "areaOrPrice";
  if (p.maxArea != null && l.area > p.maxArea) return "areaOrPrice";
  if (p.preferences?.garden === "require" && !(l.gardenPct > 0)) return "featureRequired";
  if (p.preferences?.corner === "require" && !(l.cornerPct > 0)) return "featureRequired";
  if (p.preferences?.nearBuilt === "require" && !isNearBuilt(l.builtKm)) return "featureRequired";
  if (p.preferences?.onlyPreferredCities && p.preferredCities.length && !p.preferredCities.includes(l.cityName))
    return "city";
  return null;
}

export interface ScoreContext {
  survival: Map<string, Survival>;
  /** City popularity 0–1 (share of bookings normalised to the most popular city). */
  cityPopularity: Map<string, number>;
  /** Share of neighbouring plots already booked (null = unknown). */
  neighbourShare?: Map<string, number | null>;
}

/**
 * Deterministic, explainable scoring. Booked and over-budget lands are excluded
 * up front and can never be returned.
 */
export function scoreLands(lands: ScorableLand[], profile: Profile, ctx: ScoreContext) {
  const weights: Weights = { ...DEFAULT_WEIGHTS, ...(profile.weights ?? {}) };
  const premiumValues: PremiumValues = { ...DEFAULT_PREMIUM_VALUES, ...(profile.preferences?.premiumValues ?? {}) };
  const excluded: ExclusionStats = { booked: 0, overBudget: 0, areaOrPrice: 0, featureRequired: 0, city: 0 };
  const eligible: ScorableLand[] = [];
  for (const l of lands) {
    const r = exclusionReason(l, profile);
    if (r) excluded[r]++;
    else eligible.push(l);
  }

  // Value benchmark: median price/m² of comparable plots (same city + same feature combo).
  const groups = new Map<string, number[]>();
  const gk = (l: ScorableLand) => `${l.cityName}|${featureKey(l)}`;
  for (const l of lands) {
    if (!groups.has(gk(l))) groups.set(gk(l), []);
    groups.get(gk(l))!.push(l.pricePerMeter);
  }
  const medians = new Map([...groups].map(([k, v]) => [k, median(v)]));
  const areas = eligible.map((l) => l.area).sort((a, b) => a - b);
  const areaPct = (a: number) => {
    if (areas.length < 2) return 0.5;
    let lo = 0;
    let hi = areas.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (areas[m] < a) lo = m + 1;
      else hi = m;
    }
    return lo / (areas.length - 1);
  };
  const budget = budgetLimit(profile);
  const wsum = Object.values(weights).reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const gardenMode = profile.preferences?.garden ?? "prefer";
  const cornerMode = profile.preferences?.corner ?? "prefer";
  const nearMode = profile.preferences?.nearBuilt ?? "prefer";

  const scored: ScoredLand[] = eligible.map((l) => {
    const s = ctx.survival.get(l.id) ?? { low: 0, mid: 0, high: 0 };
    const hasGarden = l.gardenPct > 0;
    const hasCorner = l.cornerPct > 0;
    const extraNeeded = Math.max(0, l.downPayment - profile.moneyPaid);

    // Budget: fully covered by what's paid = 1; needing extra money decays to 0.4 at the limit.
    let budgetF = extraNeeded <= 0 ? 1 : 1 - 0.6 * (extraNeeded / Math.max(1, budget - profile.moneyPaid));
    if (profile.moneyAvailable != null && l.totalPrice > profile.moneyAvailable + profile.moneyPaid) budgetF *= 0.7;

    const med = medians.get(gk(l)) ?? l.pricePerMeter;
    let value = clamp01(0.5 + (med - l.pricePerMeter) / med);
    if (profile.preferredPricePerMeter)
      value = 0.5 * value + 0.5 * clamp01(1 - Math.max(0, l.pricePerMeter - profile.preferredPricePerMeter) / profile.preferredPricePerMeter);

    const areaF = profile.preferredArea
      ? clamp01(1 - Math.abs(l.area - profile.preferredArea) / profile.preferredArea)
      : areaPct(l.area);

    let location: number;
    const ci = profile.preferredCities.indexOf(l.cityName);
    const pi = l.projectName ? profile.preferredProjects.indexOf(l.projectName) : -1;
    if (pi >= 0) location = 1 - 0.05 * pi;
    else if (ci >= 0) location = 0.95 - (0.35 * ci) / Math.max(1, profile.preferredCities.length);
    else if (profile.preferredCities.length || profile.preferredProjects.length)
      location = 0.25 * (ctx.cityPopularity.get(l.cityName) ?? 0);
    else location = 0.2 + 0.8 * (ctx.cityPopularity.get(l.cityName) ?? 0);

    let premium =
      l.seaPct > 0 && !hasGarden && !hasCorner
        ? premiumValues.seaOnly
        : hasGarden && hasCorner
          ? premiumValues.gardenAndCorner
          : hasGarden
            ? premiumValues.garden
            : hasCorner
              ? premiumValues.corner
              : premiumValues.none;
    if (gardenMode === "ignore" && cornerMode === "ignore") premium = 0.5;

    const neighbourShare = ctx.neighbourShare?.get(l.id) ?? null;
    const near = nearMode === "ignore" ? 0.5 : nearBuiltFactor(l.builtKm ?? null, neighbourShare);
    const factors: Factors = {
      reachability: s.mid,
      nearBuilt: clamp01(near),
      premium: clamp01(premium),
      budget: clamp01(budgetF),
      location: clamp01(location),
      value,
      area: areaF,
    };
    const score =
      (100 *
        (Object.keys(weights) as (keyof Weights)[]).reduce((a, k) => a + Math.max(0, weights[k]) * factors[k], 0)) /
      wsum;

    const R = t.reasons;
    const reasons: string[] = [];
    if (hasGarden && hasCorner) reasons.push(R.gardenCorner);
    else if (hasGarden) reasons.push(R.garden);
    else if (hasCorner) reasons.push(R.corner);
    if (isNearBuilt(l.builtKm)) reasons.push(R.nearBuilt(fmtKm(l.builtKm)));
    if (neighbourShare != null && neighbourShare >= 0.4) reasons.push(R.neighbours);
    if (extraNeeded <= 0) reasons.push(R.covered);
    else reasons.push(R.extra(Math.round(extraNeeded)));
    const p100 = Math.round(s.mid * 100);
    reasons.push(s.mid >= MODEL.reachableAt ? R.high(p100) : s.mid >= MODEL.riskyAt ? R.mid(p100) : R.low(p100));
    if (value >= 0.6) reasons.push(R.cheap);
    if (ci >= 0 || pi >= 0) reasons.push(R.preferred);

    return {
      id: l.id,
      score: Math.round(score * 10) / 10,
      factors,
      survival: s,
      reach: reachLabel(s.mid, l.status),
      recommendation: band(score, s.mid),
      hasGarden,
      hasCorner,
      isNearBuilt: isNearBuilt(l.builtKm),
      neighbourShare,
      extraNeeded,
      reasons,
    };
  });
  const order: Record<Recommendation, number> = { STRONG_BUY: 0, GOOD: 1, WATCH: 2, SKIP: 3 };
  // Plots you can realistically reach (≥ riskyAt survival) always come first, then band, then score.
  const reachable = (x: ScoredLand) => (x.survival.mid >= MODEL.riskyAt ? 0 : 1);
  scored.sort((a, b) => reachable(a) - reachable(b) || order[a.recommendation] - order[b.recommendation] || b.score - a.score);
  return { scored, excluded, weights, eligibleCount: eligible.length };
}
