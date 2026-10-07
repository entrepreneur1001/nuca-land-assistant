import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aiAnalyses } from "@/db/schema";
import { config } from "@/lib/config";
import { diversify, type Dashboard, type RankedLand } from "@/engine";
import { parseAiResponse, type AiResponse } from "./schema";

const CANDIDATES = 40;
/** Max candidates from one sector, so Gemini can compare genuinely different options. */
const CANDIDATES_PER_SECTOR = 6;

export const pickCandidates = (ranked: RankedLand[]) => diversify(ranked, CANDIDATES, CANDIDATES_PER_SECTOR);
/** Never call Gemini more often than this, whatever triggers it. */
const MIN_INTERVAL_MS = 60_000;

export interface AiState {
  analysis: (AiResponse & { createdAt: string; model: string }) | null;
  error: string | null;
  needsRefresh: boolean;
  refreshReasons: string[];
  configured: boolean;
  running: boolean;
}

const g = globalThis as unknown as { __nucaAiRunning?: Promise<unknown> | null; __nucaAiLastCall?: number };

const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);

function profileHash(d: Dashboard) {
  return hash({ ...d.profile, updatedAt: undefined });
}

export function buildPayload(d: Dashboard, ranked: RankedLand[]) {
  const candidates = pickCandidates(ranked);
  return {
    candidates,
    payload: {
      user: {
        rank: d.profile.bookingRank,
        money_paid_usd: d.profile.moneyPaid,
        max_additional_usd: d.profile.maxAdditional,
        money_available_usd: d.profile.moneyAvailable ?? "unknown",
        preferred_cities: d.profile.preferredCities,
        preferred_projects: d.profile.preferredProjects,
        preferred_area_m2: d.profile.preferredArea ?? "unknown",
        min_area_m2: d.profile.minArea ?? "unknown",
        max_area_m2: d.profile.maxArea ?? "unknown",
        garden_preference: d.profile.preferences?.garden ?? "prefer",
        corner_preference: d.profile.preferences?.corner ?? "prefer",
      },
      market: {
        total_plots: d.market.total,
        booked_count: d.market.booked,
        available_count: d.market.available,
        booked_last_24h: d.market.bookedLast24h,
        codes_issued: d.queue.codesIssued,
        people_ahead_of_user: d.queue.peopleAhead,
        expected_bookings_before_user_turn: Math.round(d.queue.bookingsAhead.mid),
        expected_turn_date: d.queue.eta.expected?.toString() ?? "unknown",
        estimated_reachable_affordable_plots: d.reachable.expected,
        sectors_expected_to_sell_out_before_turn: d.strategy.avoid,
        assumptions: d.queue.assumptions,
        data_stale: d.freshness.stale,
      },
      lands: candidates.map((r) => ({
        land_id: r.id,
        city: r.cityName,
        project: r.projectName ?? "unknown",
        zone: r.zoneName ?? "unknown",
        plot_number: r.plotNumber,
        area_m2: r.area,
        price_per_m2_usd: r.pricePerMeter,
        total_price_usd: r.totalPrice,
        down_payment_usd: r.downPayment,
        extra_needed_beyond_paid_usd: Math.round(r.extraNeeded),
        garden_view: r.hasGarden,
        corner: r.hasCorner,
        sea_or_nile_view: r.seaPct > 0,
        survival_probability_expected: Number(r.survival.mid.toFixed(3)),
        survival_probability_range: [Number(r.survival.low.toFixed(3)), Number(r.survival.high.toFixed(3))],
        deterministic_score: r.score,
        deterministic_recommendation: r.recommendation,
        factor_scores: Object.fromEntries(Object.entries(r.factors).map(([k, v]) => [k, Number(v.toFixed(2))])),
      })),
    },
  };
}

async function latest() {
  const db = await getDb();
  const [row] = await db.select().from(aiAnalyses).orderBy(desc(aiAnalyses.id)).limit(1);
  const [valid] = await db
    .select()
    .from(aiAnalyses)
    .where(eq(aiAnalyses.valid, true))
    .orderBy(desc(aiAnalyses.id))
    .limit(1);
  return { last: row ?? null, lastValid: valid ?? null };
}

/** Decide whether the cached analysis should be refreshed. */
export function refreshReasons(input: {
  cached: { createdAt: Date; profileHash: string; candidateIds: string[]; topIds: string[] } | null;
  currentProfileHash: string;
  currentCandidateIds: string[];
  availableIds: Set<string>;
  now: number;
  ttlMs: number;
}): string[] {
  const { cached } = input;
  if (!cached) return ["no analysis yet"];
  const reasons: string[] = [];
  if (cached.profileHash !== input.currentProfileHash) reasons.push("your preferences changed");
  const prev = new Set(cached.candidateIds);
  const cur = new Set(input.currentCandidateIds);
  const changed = [...cur].filter((x) => !prev.has(x)).length;
  if (cur.size && changed / cur.size >= 0.05) reasons.push("candidate inventory changed ≥5%");
  if (cached.topIds.some((id) => !input.availableIds.has(id))) reasons.push("a previously recommended plot is no longer available or eligible");
  if (input.now - cached.createdAt.getTime() > input.ttlMs) reasons.push("analysis is older than the refresh interval");
  return reasons;
}

export async function getAiState(d: Dashboard, ranked: RankedLand[]): Promise<AiState> {
  const { last, lastValid } = await latest();
  const candidateIds = pickCandidates(ranked).map((r) => r.id);
  const availableIds = new Set(ranked.map((r) => r.id));
  const resp = (lastValid?.response ?? null) as (AiResponse & { model: string }) | null;
  const reasons = refreshReasons({
    cached: lastValid
      ? {
          createdAt: lastValid.createdAt,
          profileHash: lastValid.profileHash,
          candidateIds: lastValid.candidateIds,
          topIds: resp?.recommendations.slice(0, 5).map((r) => r.land_id) ?? [],
        }
      : null,
    currentProfileHash: profileHash(d),
    currentCandidateIds: candidateIds,
    availableIds,
    now: Date.now(),
    ttlMs: config.aiTtlMs,
  });
  // Hide recommendations whose land has since been booked/excluded.
  const analysis = resp && lastValid
    ? {
        ...resp,
        recommendations: resp.recommendations.filter((r) => availableIds.has(r.land_id)),
        createdAt: lastValid.createdAt.toISOString(),
      }
    : null;
  return {
    analysis,
    error: last && !last.valid ? last.error : null,
    needsRefresh: reasons.length > 0,
    refreshReasons: reasons,
    configured: !!process.env.GEMINI_API_KEY,
    running: !!g.__nucaAiRunning,
  };
}

export async function runAnalysis(d: Dashboard, ranked: RankedLand[], opts: { force?: boolean } = {}) {
  if (!process.env.GEMINI_API_KEY) return { ok: false as const, error: "GEMINI_API_KEY is not configured" };
  if (g.__nucaAiRunning) {
    await g.__nucaAiRunning;
    return { ok: true as const, skipped: "already running" };
  }
  if (!opts.force) {
    const state = await getAiState(d, ranked);
    if (!state.needsRefresh) return { ok: true as const, skipped: "cache is fresh" };
  }
  if (Date.now() - (g.__nucaAiLastCall ?? 0) < MIN_INTERVAL_MS)
    return { ok: false as const, error: "Rate limited: please wait a minute between AI analyses." };
  if (!ranked.length) return { ok: false as const, error: "No eligible plots to analyse." };

  const job = (async () => {
    g.__nucaAiLastCall = Date.now();
    const db = await getDb();
    const { candidates, payload } = buildPayload(d, ranked);
    const ids = candidates.map((c) => c.id);
    const base = { inputHash: hash(payload), profileHash: profileHash(d), candidateIds: ids };
    try {
      const { callGemini } = await import("./gemini");
      const text = await callGemini(payload, config.geminiModel);
      const parsed = parseAiResponse(text, new Set(ids));
      if (!parsed.ok) {
        await db.insert(aiAnalyses).values({ ...base, valid: false, error: parsed.error, response: { raw: text?.slice(0, 5000) ?? null } });
        return { ok: false as const, error: parsed.error };
      }
      await db.insert(aiAnalyses).values({ ...base, valid: true, response: { ...parsed.data, model: config.geminiModel } });
      return { ok: true as const };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.insert(aiAnalyses).values({ ...base, valid: false, error: msg.slice(0, 2000) });
      return { ok: false as const, error: msg };
    }
  })();
  g.__nucaAiRunning = job;
  try {
    return await job;
  } finally {
    g.__nucaAiRunning = null;
  }
}
