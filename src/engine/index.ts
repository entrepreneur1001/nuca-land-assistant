import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, type DB } from "@/db/client";
import { allocations, ingestRuns, landStatusHistory, lands, marketSnapshots } from "@/db/schema";
import { config } from "@/lib/config";
import { computeFreshness, type Freshness } from "@/lib/freshness";
import { getProfile, type ProfileRow } from "@/lib/profile";
import { MODEL } from "./config";
import { computeSurvival, learnFeatureWeights, type FeatureKey, type Survival } from "./depletion";
import { estimateQueue, type QueueEstimate } from "./queue";
import { scoreLands, type ExclusionStats, type ScoredLand } from "./scoring";

export interface LandView {
  id: string;
  externalPlotId: string | null;
  cityName: string;
  projectId: string | null;
  projectName: string | null;
  zoneName: string | null;
  square: string | null;
  plotNumber: string;
  area: number;
  pricePerMeter: number;
  totalPrice: number;
  downPayment: number;
  gardenPct: number;
  cornerPct: number;
  seaPct: number;
  latitude: number | null;
  longitude: number | null;
  status: string;
  bookingDate: string | null;
  source: string;
  sourceUpdatedAt: string | null;
  lastSeenAt: string;
}

export type RankedLand = LandView & ScoredLand;

export interface SectorOutlook {
  key: string;
  projectName: string | null;
  cityName: string;
  available: number;
  affordableAvailable: number;
  expectedBookingsBeforeTurn: number;
  expectedRemaining: number;
  recentBookings: number;
}

export interface Strategy {
  highConfidence: number;
  mediumConfidence: number;
  targets: { projectName: string | null; cityName: string; count: number; bestScore: number }[];
  avoid: { projectName: string | null; cityName: string; reason: string }[];
  topChoiceId: string | null;
  summary: string[];
}

export interface Dashboard {
  generatedAt: string;
  freshness: Freshness;
  source: { name: string; url: string };
  market: {
    total: number;
    booked: number;
    available: number;
    sourceStats: { total: number; booked: number; available: number; takenAt: string } | null;
    bookedLast24h: number;
    bookedToday: number;
  };
  profile: ProfileRow;
  budgetLimit: number;
  queue: QueueEstimate;
  reachable: {
    expected: number;
    low: number;
    high: number;
    eligible: number;
    gardenCorner: number;
    garden: number;
    corner: number;
  };
  featureWeights: Record<FeatureKey, number>;
  excluded: ExclusionStats;
  strategy: Strategy;
  top: RankedLand[];
  sectors: SectorOutlook[];
}

type Computed = {
  dashboard: Dashboard;
  ranked: RankedLand[];
  byId: Map<string, LandView & { survival?: Survival; scored?: ScoredLand }>;
};

const g = globalThis as unknown as { __nucaEngineCache?: { key: string; at: number; value: Computed } };

async function loadFreshness(db: DB): Promise<Freshness> {
  const last = async (kind: string) => {
    const [r] = await db
      .select({ at: ingestRuns.finishedAt })
      .from(ingestRuns)
      .where(and(eq(ingestRuns.kind, kind), eq(ingestRuns.ok, true)))
      .orderBy(desc(ingestRuns.startedAt))
      .limit(1);
    return r?.at ?? null;
  };
  const [lastErr] = await db
    .select({ error: ingestRuns.error, ok: ingestRuns.ok })
    .from(ingestRuns)
    .orderBy(desc(ingestRuns.startedAt))
    .limit(1);
  return computeFreshness({
    now: Date.now(),
    lastStatsOkAt: await last("stats"),
    lastFullOkAt: await last("full"),
    lastError: lastErr && !lastErr.ok ? lastErr.error : null,
    staleAfterMs: config.staleAfterMs,
    maxFullSyncMs: config.maxFullSyncMs,
  });
}

function toView(r: typeof lands.$inferSelect): LandView {
  return {
    id: r.id,
    externalPlotId: r.externalPlotId,
    cityName: r.cityName,
    projectId: r.projectId,
    projectName: r.projectName,
    zoneName: r.zoneName,
    square: r.square,
    plotNumber: r.plotNumber,
    area: r.area,
    pricePerMeter: r.pricePerMeter,
    totalPrice: r.totalPrice,
    downPayment: r.downPayment,
    gardenPct: r.gardenPct,
    cornerPct: r.cornerPct,
    seaPct: r.seaPct,
    latitude: r.latitude,
    longitude: r.longitude,
    status: r.status,
    bookingDate: r.bookingDate?.toISOString() ?? null,
    source: r.source,
    sourceUpdatedAt: r.sourceUpdatedAt?.toISOString() ?? null,
    lastSeenAt: r.lastSeenAt.toISOString(),
  };
}

async function compute(db: DB): Promise<Computed> {
  const now = new Date();
  const [profile, freshness] = await Promise.all([getProfile(db), loadFreshness(db)]);
  const rows = await db.select().from(lands);
  const views = rows.map(toView);
  const allocs = await db.select().from(allocations);
  const [snap] = await db.select().from(marketSnapshots).orderBy(desc(marketSnapshots.takenAt)).limit(1);

  const booked = views.filter((v) => v.status === "booked").length;
  const available = views.length - booked;

  const since = new Date(now.getTime() - MODEL.demandWindowDays * 86_400_000);
  const eventTime = sql`coalesce(${landStatusHistory.sourceBookingDate}, ${landStatusHistory.detectedAt})`;
  const recent = await db
    .select({ projectId: lands.projectId, cityName: lands.cityName, n: sql<number>`count(*)::int` })
    .from(landStatusHistory)
    .innerJoin(lands, eq(lands.id, landStatusHistory.landId))
    .where(and(eq(landStatusHistory.newStatus, "booked"), gte(eventTime, since)))
    .groupBy(lands.projectId, lands.cityName);
  const recentByProject = new Map<string, number>();
  for (const r of recent) recentByProject.set(r.projectId ?? `city:${r.cityName}`, r.n);

  const dayAgo = new Date(now.getTime() - 86_400_000);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const bookedLast24h = views.filter((v) => v.bookingDate && new Date(v.bookingDate) >= dayAgo).length;
  const bookedToday = views.filter((v) => v.bookingDate && new Date(v.bookingDate) >= startOfToday).length;

  const queue = estimateQueue({
    rank: profile.bookingRank,
    booked,
    available,
    allocations: allocs.map((a) => ({ issueDate: a.issueDate, totalCodes: a.totalCodes, plotsBooked: a.plotsBooked })),
    allocatedCodes: snap?.allocatedCodes ?? null,
    now,
  });

  const featureWeights = learnFeatureWeights(views);
  const { survival, sectorBookings, sectorAvailable } = computeSurvival(views, recentByProject, queue.bookingsAhead, featureWeights);

  // City popularity = booked rate normalised to the hottest city.
  const cityTotals = new Map<string, { n: number; b: number }>();
  for (const v of views) {
    const c = cityTotals.get(v.cityName) ?? { n: 0, b: 0 };
    c.n++;
    if (v.status === "booked") c.b++;
    cityTotals.set(v.cityName, c);
  }
  const rates = new Map([...cityTotals].map(([k, c]) => [k, c.b / Math.max(1, c.n)]));
  const maxRate = Math.max(0.0001, ...rates.values());
  const cityPopularity = new Map([...rates].map(([k, r]) => [k, r / maxRate]));

  const dataConfidence = freshness.stale ? 0.5 : 1;
  const { scored, excluded } = scoreLands(views, profile, { survival, cityPopularity, dataConfidence });

  const byIdView = new Map(views.map((v) => [v.id, v]));
  const ranked: RankedLand[] = scored.map((s) => ({ ...byIdView.get(s.id)!, ...s }));
  const scoredById = new Map(scored.map((s) => [s.id, s]));
  const byId = new Map(
    views.map((v) => [v.id, { ...v, survival: survival.get(v.id), scored: scoredById.get(v.id) }]),
  );

  const sumSurv = (k: keyof Survival, f: (r: RankedLand) => boolean = () => true) =>
    ranked.filter(f).reduce((a, r) => a + r.survival[k], 0);

  // Sector outlook
  const affordableBySector = new Map<string, number>();
  for (const r of ranked) {
    const k = r.projectId ?? `city:${r.cityName}`;
    affordableBySector.set(k, (affordableBySector.get(k) ?? 0) + 1);
  }
  const sectorMeta = new Map<string, { projectName: string | null; cityName: string }>();
  for (const v of views) sectorMeta.set(v.projectId ?? `city:${v.cityName}`, { projectName: v.projectName, cityName: v.cityName });
  const sectors: SectorOutlook[] = [...sectorAvailable].map(([k, n]) => {
    const exp = sectorBookings.mid.get(k) ?? 0;
    return {
      key: k,
      ...(sectorMeta.get(k) ?? { projectName: null, cityName: "?" }),
      available: n,
      affordableAvailable: affordableBySector.get(k) ?? 0,
      expectedBookingsBeforeTurn: Math.round(exp),
      expectedRemaining: Math.max(0, Math.round(n - exp)),
      recentBookings: recentByProject.get(k) ?? 0,
    };
  });
  sectors.sort((a, b) => b.recentBookings - a.recentBookings || b.available - a.available);

  // Strategy (deterministic)
  const high = ranked.filter((r) => r.survival.mid >= MODEL.reachableAt && r.score >= MODEL.bands.GOOD);
  const medium = ranked.filter(
    (r) => r.survival.mid >= MODEL.riskyAt && r.score >= MODEL.bands.WATCH && !high.includes(r),
  );
  const projAgg = new Map<string, { projectName: string | null; cityName: string; count: number; bestScore: number }>();
  for (const r of [...high, ...medium]) {
    const k = r.projectId ?? r.cityName;
    const a = projAgg.get(k) ?? { projectName: r.projectName, cityName: r.cityName, count: 0, bestScore: 0 };
    a.count++;
    a.bestScore = Math.max(a.bestScore, r.score);
    projAgg.set(k, a);
  }
  const targets = [...projAgg.values()].sort((a, b) => b.bestScore - a.bestScore || b.count - a.count).slice(0, 3);
  const avoid = sectors
    .filter((s) => s.affordableAvailable > 0 && s.expectedRemaining === 0 && s.recentBookings > 0)
    .sort((a, b) => b.recentBookings - a.recentBookings)
    .slice(0, 3)
    .map((s) => ({
      projectName: s.projectName,
      cityName: s.cityName,
      reason: `${s.recentBookings} booked in the last ${MODEL.demandWindowDays} days; expected to sell out before your turn`,
    }));
  const topChoice = ranked.find((r) => r.recommendation === "STRONG_BUY" || r.recommendation === "GOOD") ?? ranked[0];
  const summary: string[] = [];
  summary.push(
    `About ${Math.round(queue.peopleAhead).toLocaleString("en-US")} people are ahead of you; ~${Math.round(queue.bookingsAhead.mid).toLocaleString("en-US")} of them are expected to book first.`,
  );
  if (queue.eta.expected)
    summary.push(`Your booking code is expected around ${queue.eta.expected.toDateString()} (range ${queue.eta.best?.toDateString()} – ${queue.eta.worst?.toDateString()}).`);
  if (!ranked.length) summary.push("No available plot matches your budget and filters. Consider raising the max extra payment or relaxing filters.");

  const dashboard: Dashboard = {
    generatedAt: now.toISOString(),
    freshness,
    source: { name: config.sourceName, url: config.sourceApiUrl },
    market: {
      total: views.length,
      booked,
      available,
      sourceStats: snap ? { total: snap.total, booked: snap.booked, available: snap.available, takenAt: snap.takenAt.toISOString() } : null,
      bookedLast24h,
      bookedToday,
    },
    profile,
    budgetLimit: profile.moneyPaid + Math.max(0, profile.maxAdditional),
    queue,
    reachable: {
      expected: Math.round(sumSurv("mid")),
      low: Math.round(sumSurv("low")),
      high: Math.round(sumSurv("high")),
      eligible: ranked.length,
      gardenCorner: Math.round(sumSurv("mid", (r) => r.hasGarden && r.hasCorner)),
      garden: Math.round(sumSurv("mid", (r) => r.hasGarden)),
      corner: Math.round(sumSurv("mid", (r) => r.hasCorner)),
    },
    featureWeights,
    excluded,
    strategy: {
      highConfidence: high.length,
      mediumConfidence: medium.length,
      targets,
      avoid,
      topChoiceId: topChoice?.id ?? null,
      summary,
    },
    top: diversify(ranked, 5, MODEL.topPerSector),
    sectors: sectors.slice(0, 40),
  };
  return { dashboard, ranked, byId };
}

/** Top-N with at most `perSector` plots from the same sector, so the shortlist shows real alternatives. */
export function diversify<T extends { projectId: string | null; cityName: string }>(xs: T[], n: number, perSector: number): T[] {
  const out: T[] = [];
  const counts = new Map<string, number>();
  for (const x of xs) {
    const k = x.projectId ?? x.cityName;
    if ((counts.get(k) ?? 0) >= perSector) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
    out.push(x);
    if (out.length >= n) break;
  }
  return out;
}

/** Cached per (latest successful ingest run, profile version). */
export async function getComputed(): Promise<Computed> {
  const db = await getDb();
  const [lastRun] = await db
    .select({ id: ingestRuns.id })
    .from(ingestRuns)
    .where(eq(ingestRuns.ok, true))
    .orderBy(desc(ingestRuns.id))
    .limit(1);
  const profile = await getProfile(db);
  const key = `${lastRun?.id ?? 0}|${profile.updatedAt}`;
  const c = g.__nucaEngineCache;
  // Recompute at least every 30s so freshness/ages stay honest.
  if (c && c.key === key && Date.now() - c.at < 30_000) return c.value;
  const value = await compute(db);
  g.__nucaEngineCache = { key, at: Date.now(), value };
  return value;
}

export function invalidateEngineCache() {
  g.__nucaEngineCache = undefined;
}
