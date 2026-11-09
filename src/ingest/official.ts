/**
 * The official NUCA lands portal (lands.nuca.gov.eg): the only data source since Nov 2026.
 * Everything is public and server-rendered (ASP.NET WebForms); see README "Data sync".
 */
const base = (process.env.OFFICIAL_BASE_URL ?? "https://lands.nuca.gov.eg").replace(/\/$/, "");

export const OFFICIAL_SITE = {
  name: "lands.nuca.gov.eg",
  url: "https://lands.nuca.gov.eg/",
  base,
  /**
   * Pace: the site's firewall drops connections from a datacenter IP above roughly one request per second
   * (2 workers at 500 ms got ECONNRESET/timeouts from GitHub's runners; 1 request per 1.5 s was 60/60 fine), so
   * one worker with a 1 s pause. Zones not reached within the budget roll over to the next run.
   */
  delayMs: Number(process.env.OFFICIAL_DELAY_MS ?? 1000),
  concurrency: Number(process.env.OFFICIAL_CONCURRENCY ?? 1),
  /** Time budget for the per-run crawl of the available views; zones not reached wait for the next run. */
  budgetMs: Number(process.env.OFFICIAL_BUDGET_MS ?? 13 * 60_000),
  /** Budget for a `--full` run (available + booked views). */
  fullBudgetMs: Number(process.env.OFFICIAL_FULL_BUDGET_MS ?? 20 * 60_000),
  /** Per-request timeout; the site occasionally hangs a connection and a zone is better retried next run. */
  requestTimeoutMs: Number(process.env.OFFICIAL_TIMEOUT_MS ?? 15_000),
  /** Rows per page of the zone table. */
  pageSize: 20,
  /** Re-discover the zone list (cities → projects → zones) this often. */
  zonesMaxAgeMs: 24 * 3600_000,
  /** A run that would mark more plots booked than this is refused unless --accept-large (protects against a broken page). */
  maxNewlyBookedPerRun: Number(process.env.OFFICIAL_MAX_NEWLY_BOOKED ?? 1500),
  /** A district is "hot" when its bookings in the last 7 days reach max(hotMinBookings, hotShare × its plots). */
  hotMinBookings: 10,
  hotShare: 0.05,
};

export const officialUrl = {
  cities: () => `${base}/ar/Cities.aspx/GetSiteCities`,
  city: (id: number) => `${base}/ar/ViewCity.aspx?ID=${id}`,
  project: (id: number) => `${base}/ar/ViewProject.aspx?ID=${id}`,
  zone: (id: number) => `${base}/ar/ViewZone.aspx?ID=${id}`,
  news: () => process.env.NUCA_NEWS_URL || `${base}/ar/NewsList.aspx`,
};
