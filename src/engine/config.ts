/**
 * Tunable model + scoring constants. Everything here is documented in README.md
 * ("How the model works"). Weights can be overridden per user in Settings.
 */

export const DEFAULT_WEIGHTS = {
  reachability: 20,
  nearBuilt: 20,
  premium: 20,
  budget: 15,
  location: 10,
  value: 10,
  area: 5,
} as const;
export type Weights = Record<keyof typeof DEFAULT_WEIGHTS, number>;

/** Premium factor (0–1) per feature combination. Garden + corner (ناصية) are a priority. */
export const DEFAULT_PREMIUM_VALUES = {
  gardenAndCorner: 1,
  garden: 0.75,
  corner: 0.6,
  seaOnly: 0.4,
  none: 0,
  /** Added on top of the above for a plot on a main road (OpenStreetMap; not a NUCA premium). */
  street: 0.2,
  /** Added on top for 3 / 4 apartments per floor (area licensing rule, see engine/units.ts; not a NUCA premium). */
  units3: 0.1,
  units4: 0.2,
};
export type PremiumValues = typeof DEFAULT_PREMIUM_VALUES;

export const MODEL = {
  /** Fallback booking conversion (codes → bookings) when allocation history is missing. */
  defaultConversion: 0.7,
  /** Fallback codes per batch / batches per week. */
  defaultCodesPerBatch: 300,
  defaultBatchesPerWeek: 5,
  /** How many most recent completed batches feed the rate/conversion estimate. */
  recentBatches: 6,
  /** Optimistic scenario: NUCA enlarges daily batches by this factor. */
  optimisticBatchGrowth: 1.33,
  /** Max plots from the same sector in the Top-5 list (diversity). */
  topPerSector: 2,
  /** Days of booking history used for sector demand shares. */
  demandWindowDays: 7,
  /** Share of future demand spread by inventory share instead of recent popularity (smoothing). */
  demandSmoothing: 0.25,
  /** Simulation resolution (steps). */
  simSteps: 400,
  /** Reachability label thresholds on survival probability. */
  reachableAt: 0.7,
  riskyAt: 0.3,
  /** Aggregate (market-level) reachability label thresholds on remaining/available. */
  aggregateHighAt: 0.5,
  aggregateMediumAt: 0.15,
  /** Recommendation bands on overall score (0–100). */
  bands: { STRONG_BUY: 80, GOOD: 65, WATCH: 50 },
  /** A plot with reachability below `riskyAt` can never be better than WATCH. */
};
