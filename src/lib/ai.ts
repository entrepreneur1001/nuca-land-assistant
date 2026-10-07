"use client";

import { doc, getDoc, setDoc } from "firebase/firestore";
import { aiResponseJsonSchema, parseAiResponse, type AiResponse } from "@/ai/schema";
import { hashString } from "@/data/snapshot";
import { diversify, type Dashboard, type RankedLand } from "@/engine/compute";
import type { Profile } from "@/engine/scoring";
import { ensureAnonymousAuth, firebaseApp, firestore, track } from "./firebase";

export const AI_MODEL = process.env.NEXT_PUBLIC_GEMINI_MODEL ?? "gemini-2.5-flash";
const COOLDOWN_MS = 30_000;
const CD_KEY = "nuca-ai-last";

const SYSTEM = `إنت محلل بيساعد مشتري في طرح "بيت الوطن" بتاع هيئة المجتمعات العمرانية في مصر (الأسعار بالدولار).
القواعد:
- اتكلم بالعامية المصرية بس، ومتستخدمش ولا كلمة إنجليزي.
- استخدم البيانات اللي في الـ JSON بس. متخترعش أراضي ولا أسعار ولا مساحات ولا أماكن.
- أي land_id تكتبه لازم يكون منسوخ بالظبط من قايمة lands.
- لو معلومة مش موجودة قول إنها مش معروفة.
- الأرقام والاحتمالات محسوبة عندنا، اعتبرها هي الصح. شغلتك تقارن الاختيارات المتشابهة، توضح المميزات والعيوب، وتدي خطة واضحة.
- المشتري بيفضل الأراضي اللي على حديقة واللي ناصية واللي قريبة من مباني قائمة (العمار).
- الاحتمالات تقديرية، وضّح ده لما يكون مهم.
- رجّع JSON بس بنفس الشكل المطلوب. خلي الأسباب قصيرة (جملة أو اتنين).`;

export function aiCacheKey(profile: Profile, dataVersion: string) {
  return hashString(JSON.stringify(profile) + "|" + dataVersion + "|" + AI_MODEL);
}

export function buildPayload(d: Dashboard, ranked: RankedLand[], profile: Profile) {
  const candidates = diversify(ranked, 40, 6);
  return {
    candidates,
    payload: {
      user: {
        rank: profile.bookingRank,
        money_paid_usd: profile.moneyPaid,
        max_additional_usd: profile.maxAdditional,
        preferred_cities: profile.preferredCities,
        garden: profile.preferences?.garden ?? "prefer",
        corner: profile.preferences?.corner ?? "prefer",
        near_built: profile.preferences?.nearBuilt ?? "prefer",
      },
      market: {
        total_plots: d.market.total,
        booked: d.market.booked,
        available: d.market.available,
        booked_last_24h: d.market.bookedLast24h,
        codes_issued: d.queue.codesIssued,
        people_ahead: d.queue.peopleAhead,
        expected_bookings_before_turn: Math.round(d.queue.bookingsAhead.mid),
        expected_turn_date: d.queue.eta.expected?.toISOString().slice(0, 10) ?? "unknown",
        reachable_affordable_plots: d.reachable.expected,
        sectors_expected_to_sell_out: d.strategy.avoid,
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
        extra_needed_usd: Math.round(r.extraNeeded),
        garden: r.hasGarden,
        corner: r.hasCorner,
        km_to_existing_buildings: r.builtKm == null ? "unknown" : Number(r.builtKm.toFixed(2)),
        share_of_neighbours_booked: r.neighbourShare == null ? "unknown" : Number(r.neighbourShare.toFixed(2)),
        survival_probability: Number(r.survival.mid.toFixed(3)),
        survival_range: [Number(r.survival.low.toFixed(3)), Number(r.survival.high.toFixed(3))],
        score: r.score,
        recommendation: r.recommendation,
      })),
    },
  };
}

export function cooldownLeft(): number {
  try {
    const last = Number(localStorage.getItem(CD_KEY) ?? 0);
    return Math.max(0, COOLDOWN_MS - (Date.now() - last));
  } catch {
    return 0;
  }
}

export type AiOutcome = { ok: true; data: AiResponse; cached: boolean } | { ok: false; error: string };

/** Cached in Firestore per (profile, data version, model); otherwise calls Gemini via Firebase AI Logic. */
export async function analyze(d: Dashboard, ranked: RankedLand[], profile: Profile): Promise<AiOutcome> {
  const key = aiCacheKey(profile, d.dataVersion);
  const { candidates, payload } = buildPayload(d, ranked, profile);
  const allowed = new Set(candidates.map((c) => c.id));
  if (!allowed.size) return { ok: false, error: "no-candidates" };

  try {
    const cached = await getDoc(doc(firestore(), "ai_cache", key));
    if (cached.exists()) {
      const parsed = parseAiResponse(JSON.stringify(cached.data().response), allowed);
      if (parsed.ok) {
        void track("ai_analyze", { cached: true });
        return { ok: true, data: parsed.data, cached: true };
      }
    }
  } catch {
    /* cache miss / offline */
  }

  if (cooldownLeft() > 0) return { ok: false, error: "cooldown" };
  try {
    localStorage.setItem(CD_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }

  try {
    const { getAI, getGenerativeModel, GoogleAIBackend } = await import("firebase/ai");
    const ai = getAI(firebaseApp(), { backend: new GoogleAIBackend() });
    const model = getGenerativeModel(ai, {
      model: AI_MODEL,
      systemInstruction: SYSTEM,
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: aiResponseJsonSchema, temperature: 0.2 },
    });
    const res = await model.generateContent(JSON.stringify(payload));
    const parsed = parseAiResponse(res.response.text(), allowed);
    void track("ai_analyze", { cached: false, ok: parsed.ok });
    if (!parsed.ok) return { ok: false, error: parsed.error };
    try {
      await ensureAnonymousAuth();
      await setDoc(doc(firestore(), "ai_cache", key), {
        response: parsed.data,
        model: AI_MODEL,
        dataVersion: d.dataVersion,
        createdAt: new Date().toISOString(),
      });
    } catch {
      /* caching is best-effort */
    }
    return { ok: true, data: parsed.data, cached: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
