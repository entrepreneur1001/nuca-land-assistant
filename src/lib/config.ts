const num = (v: string | undefined, d: number) => {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Runtime configuration. Everything personal or tunable comes from env or the DB profile. */
export const config = {
  sourceApiUrl: (process.env.SOURCE_API_URL ?? "https://api.baytwaten4all.online").replace(/\/$/, ""),
  sourceName: "baytwaten4all",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-flash-latest",
  /** Cheap stats poll. */
  statsPollMs: num(process.env.STATS_POLL_SECONDS, 60) * 1000,
  /** Minimum gap between full plot syncs, even if stats changed. */
  minFullSyncMs: num(process.env.MIN_FULL_SYNC_MINUTES, 5) * 60_000,
  /** Force a full sync at least this often. */
  maxFullSyncMs: num(process.env.MAX_FULL_SYNC_MINUTES, 30) * 60_000,
  /** Reference data (cities, sectors, allocations). */
  referencePollMs: num(process.env.REFERENCE_POLL_MINUTES, 30) * 60_000,
  pageSize: num(process.env.PAGE_SIZE, 1000),
  pageDelayMs: num(process.env.PAGE_DELAY_MS, 1000),
  staleAfterMs: num(process.env.STALE_AFTER_MINUTES, 10) * 60_000,
  aiTtlMs: num(process.env.AI_TTL_MINUTES, 60) * 60_000,
  workerEnabled: process.env.DISABLE_WORKER !== "1",
  defaults: {
    bookingRank: num(process.env.DEFAULT_RANK, 17000),
    moneyPaid: num(process.env.DEFAULT_MONEY_PAID, 39500),
  },
};
