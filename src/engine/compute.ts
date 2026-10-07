import type { Plot, Snapshot } from "@/data/snapshot";
import { computeFreshness, type Freshness } from "@/lib/freshness";
import { MODEL } from "./config";
import { computeSurvival, learnFeatureWeights, type FeatureKey, type Survival } from "./depletion";
import { neighbourBookedShare } from "./nearbuilt";
import { estimateQueue, type QueueEstimate } from "./queue";
import { budgetLimit, scoreLands, type ExclusionStats, type Profile, type ScoredLand } from "./scoring";

export type RankedLand = Plot & ScoredLand;

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
  avoid: { projectName: string | null; cityName: string; recentBookings: number }[];
  topChoiceId: string | null;
}

export interface Dashboard {
  dataVersion: string;
  generatedAt: string;
  freshness: Freshness;
  market: { total: number; booked: number; available: number; bookedLast24h: number; bookedLast7d: number };
  budgetLimit: number;
  queue: QueueEstimate;
  reachable: { expected: number; low: number; high: number; eligible: number; gardenCorner: number; nearBuilt: number };
  featureWeights: Record<FeatureKey, number>;
  excluded: ExclusionStats;
  strategy: Strategy;
  top: RankedLand[];
  sectors: SectorOutlook[];
}

export interface Computed {
  dashboard: Dashboard;
  ranked: RankedLand[];
  byId: Map<string, Plot & { survival?: Survival; scored?: ScoredLand; neighbourShare: number | null }>;
}

/** GitHub Actions runs every 15 min but can be delayed; allow for that. */
export const FRESHNESS = { staleAfterMs: 45 * 60_000, maxFullSyncMs: 2 * 3600_000 };

const DAY = 86_400_000;
const sectorKey = (p: { projectId: string | null; cityName: string }) => p.projectId ?? `city:${p.cityName}`;

/** Top-N with at most `perSector` plots from the same sector, so the shortlist shows real alternatives. */
export function diversify<T extends { projectId: string | null; cityName: string }>(xs: T[], n: number, perSector: number): T[] {
  const out: T[] = [];
  const counts = new Map<string, number>();
  for (const x of xs) {
    const k = sectorKey(x);
    if ((counts.get(k) ?? 0) >= perSector) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
    out.push(x);
    if (out.length >= n) break;
  }
  return out;
}

const neighbourCache = new WeakMap<Snapshot, Map<string, number | null>>();

export function computeDashboard(snap: Snapshot, profile: Profile, nowMs = Date.now()): Computed {
  const now = new Date(nowMs);
  const plots = snap.plots;
  const meta = snap.meta;
  const freshness = computeFreshness({
    now: nowMs,
    lastStatsOkAt: meta.statsAt ? new Date(meta.statsAt) : null,
    lastFullOkAt: meta.fullSyncAt ? new Date(meta.fullSyncAt) : null,
    lastError: meta.lastError,
    ...FRESHNESS,
  });

  const booked = plots.filter((p) => p.status === "booked").length;
  const available = plots.length - booked;
  const since = nowMs - MODEL.demandWindowDays * DAY;
  const recentByProject = new Map<string, number>();
  let bookedLast24h = 0;
  let bookedLast7d = 0;
  for (const p of plots) {
    if (p.status !== "booked" || !p.bookingDate) continue;
    const ts = Date.parse(p.bookingDate);
    if (ts >= nowMs - DAY) bookedLast24h++;
    if (ts >= nowMs - 7 * DAY) bookedLast7d++;
    if (ts >= since) recentByProject.set(sectorKey(p), (recentByProject.get(sectorKey(p)) ?? 0) + 1);
  }

  const queue = estimateQueue({
    rank: profile.bookingRank,
    booked,
    available,
    allocations: meta.allocations.map((a) => ({ issueDate: new Date(a.d), totalCodes: a.c, plotsBooked: a.b })),
    allocatedCodes: meta.market.allocatedCodes,
    now,
  });

  const featureWeights = learnFeatureWeights(plots);
  const { survival, sectorBookings, sectorAvailable } = computeSurvival(plots, recentByProject, queue.bookingsAhead, featureWeights);

  let neighbourShare = neighbourCache.get(snap);
  if (!neighbourShare) {
    neighbourShare = neighbourBookedShare(plots);
    neighbourCache.set(snap, neighbourShare);
  }

  const cityTotals = new Map<string, { n: number; b: number }>();
  for (const p of plots) {
    const c = cityTotals.get(p.cityName) ?? { n: 0, b: 0 };
    c.n++;
    if (p.status === "booked") c.b++;
    cityTotals.set(p.cityName, c);
  }
  const rates = new Map([...cityTotals].map(([k, c]) => [k, c.b / Math.max(1, c.n)]));
  const maxRate = Math.max(0.0001, ...rates.values());
  const cityPopularity = new Map([...rates].map(([k, r]) => [k, r / maxRate]));

  const { scored, excluded } = scoreLands(plots, profile, { survival, cityPopularity, neighbourShare });
  const plotById = new Map(plots.map((p) => [p.id, p]));
  const ranked: RankedLand[] = scored.map((s) => ({ ...plotById.get(s.id)!, ...s }));
  const scoredById = new Map(scored.map((s) => [s.id, s]));
  const byId: Computed["byId"] = new Map(
    plots.map((p) => [p.id, { ...p, survival: survival.get(p.id), scored: scoredById.get(p.id), neighbourShare: neighbourShare!.get(p.id) ?? null }]),
  );

  const sum = (k: keyof Survival, f: (r: RankedLand) => boolean = () => true) =>
    ranked.reduce((a, r) => (f(r) ? a + r.survival[k] : a), 0);

  const affordableBySector = new Map<string, number>();
  for (const r of ranked) affordableBySector.set(sectorKey(r), (affordableBySector.get(sectorKey(r)) ?? 0) + 1);
  const sectorMeta = new Map<string, { projectName: string | null; cityName: string }>();
  for (const p of plots) sectorMeta.set(sectorKey(p), { projectName: p.projectName, cityName: p.cityName });
  const sectors: SectorOutlook[] = [...sectorAvailable].map(([k, n]) => {
    const exp = sectorBookings.mid.get(k) ?? 0;
    return {
      key: k,
      ...(sectorMeta.get(k) ?? { projectName: null, cityName: "" }),
      available: n,
      affordableAvailable: affordableBySector.get(k) ?? 0,
      expectedBookingsBeforeTurn: Math.round(exp),
      expectedRemaining: Math.max(0, Math.round(n - exp)),
      recentBookings: recentByProject.get(k) ?? 0,
    };
  });
  sectors.sort((a, b) => b.recentBookings - a.recentBookings || b.available - a.available);

  const high = ranked.filter((r) => r.survival.mid >= MODEL.reachableAt && r.score >= MODEL.bands.GOOD);
  const highIds = new Set(high.map((r) => r.id));
  const medium = ranked.filter((r) => !highIds.has(r.id) && r.survival.mid >= MODEL.riskyAt && r.score >= MODEL.bands.WATCH);
  const projAgg = new Map<string, Strategy["targets"][0]>();
  for (const r of [...high, ...medium]) {
    const a = projAgg.get(sectorKey(r)) ?? { projectName: r.projectName, cityName: r.cityName, count: 0, bestScore: 0 };
    a.count++;
    a.bestScore = Math.max(a.bestScore, r.score);
    projAgg.set(sectorKey(r), a);
  }
  const targets = [...projAgg.values()].sort((a, b) => b.bestScore - a.bestScore || b.count - a.count).slice(0, 3);
  const avoid = sectors
    .filter((s) => s.affordableAvailable > 0 && s.expectedRemaining === 0 && s.recentBookings > 0)
    .slice(0, 3)
    .map((s) => ({ projectName: s.projectName, cityName: s.cityName, recentBookings: s.recentBookings }));
  const topChoice = ranked.find((r) => r.recommendation === "STRONG_BUY" || r.recommendation === "GOOD") ?? ranked[0];

  const dashboard: Dashboard = {
    dataVersion: meta.dataVersion,
    generatedAt: now.toISOString(),
    freshness,
    market: { total: plots.length, booked, available, bookedLast24h, bookedLast7d },
    budgetLimit: budgetLimit(profile),
    queue,
    reachable: {
      expected: Math.round(sum("mid")),
      low: Math.round(sum("low")),
      high: Math.round(sum("high")),
      eligible: ranked.length,
      gardenCorner: Math.round(sum("mid", (r) => r.hasGarden && r.hasCorner)),
      nearBuilt: Math.round(sum("mid", (r) => r.isNearBuilt)),
    },
    featureWeights,
    excluded,
    strategy: { highConfidence: high.length, mediumConfidence: medium.length, targets, avoid, topChoiceId: topChoice?.id ?? null },
    top: diversify(ranked, 5, MODEL.topPerSector),
    sectors,
  };
  return { dashboard, ranked, byId };
}

