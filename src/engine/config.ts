/**
 * Tunable model + scoring constants. Everything here is documented in README.md
 * ("How the model works"). Weights can be overridden per user in Settings.
 */

export const DEFAULT_WEIGHTS = {
  reachability: 20,
  nearBuilt: 20,
  premium: 20,
  location: 10,
  value: 10,
  area: 5,
  /** How fast the plot's district is selling now; only counts when the user's turn is near (see engine/demand.ts). */
  demand: 15,
} as const;
export type Weights = Record<keyof typeof DEFAULT_WEIGHTS, number>;

/** Premium factor (0–1) per feature combination. Garden + corner (ناصية) are a priority. */
export const DEFAULT_PREMIUM_VALUES = {
  gardenAndCorner: 1,
  garden: 0.75,
  corner: 0.6,
  seaOnly: 0.4,
  none: 0,
  /** Added on top for 3 / 4 apartments per floor (area licensing rule, see engine/units.ts; not a NUCA premium). */
  units3: 0.1,
  units4: 0.2,
};
export type PremiumValues = typeof DEFAULT_PREMIUM_VALUES;

export const MODEL = {
  /** Fallback booking conversion (codes → bookings) when allocation history is missing. */
  defaultConversion: 0.7,
  /** Fallback codes per batch when there is no allocation history (NUCA sends 300 a day since 1 Oct 2026). */
  defaultCodesPerBatch: 300,
  /** Booking codes go out one batch per working day; Friday and Saturday (Cairo time) are off. */
  batchWeekdays: [0, 1, 2, 3, 4],
  batchTimeZone: "Africa/Cairo",
  /** Data sync runs every 15 min during these Cairo hours on batch weekdays (cron-job.org), hourly otherwise. */
  syncWindowHours: { start: 10, end: 22 },
  /**
   * Code holders from earlier batches who haven't booked may still book later (low / mid / high share).
   * The source shows no late bookings so far, so the expected case is small and the worst case is wider.
   */
  lateBookingShare: { low: 0, mid: 0.1, high: 0.25 },
  /** How many most recent completed batches feed the rate/conversion estimate. */
  recentBatches: 6,
  /** Optimistic scenario: NUCA enlarges daily batches by this factor (300 → 400). Batches never shrink below the latest size. */
  optimisticBatchGrowth: 4 / 3,
  /** Max plots from the same sector in the Top-10 list (diversity). */
  topPerSector: 2,
  /** Days of booking history used for sector demand shares. */
  demandWindowDays: 7,
  /** Booking speed counts fully when the user's turn is this many days away or less… */
  demandNearTurnDays: 3,
  /** …and not at all from this many days. */
  demandFadeDays: 21,
  /** Recent bookings a district needs before its own speed is trusted over its city's. */
  demandMinBookings: 5,
  /** Districts at or above this booking speed (0–1) are called fast-selling. */
  fastSellingAt: 0.6,
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
