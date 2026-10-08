import { hashString } from "@/data/snapshot";
import { diversify, type Dashboard, type RankedLand } from "@/engine/compute";
import type { BuildingRules } from "@/data/snapshot";
import type { Profile } from "@/engine/scoring";

export const AI_CANDIDATES = 20;
export const AI_PER_SECTOR = 4;
/** Bump when the prompt or payload shape changes, so cached answers built on the old one are dropped. */
export const PROMPT_VERSION = 4;

export const AI_SYSTEM = `إنت محلل بيساعد مشتري في طرح "بيت الوطن" بتاع هيئة المجتمعات العمرانية في مصر (الأسعار بالدولار).
القواعد:
- اتكلم بالعامية المصرية بس، ومتستخدمش ولا كلمة إنجليزي.
- استخدم البيانات اللي في الـ JSON بس. متخترعش أراضي ولا أسعار ولا مساحات ولا أماكن.
- أي land_id تكتبه لازم يكون منسوخ بالظبط من قايمة lands.
- لو معلومة مش موجودة قول إنها مش معروفة.
- الأرقام والاحتمالات محسوبة عندنا، اعتبرها هي الصح. شغلتك تقارن الاختيارات المتشابهة، توضح المميزات والعيوب، وتدي خطة واضحة.
- المشتري بيفضل الأراضي اللي على حديقة واللي ناصية واللي قريبة من مباني قائمة (العمار).
- on_main_road معلومة إضافية بس (مش تفضيل للمشتري)، محسوبة من الخرايط ومش تميّز رسمي من الهيئة، وبتتبعت بس للأراضي اللي متأكدين إنها على شارع رئيسي. لو مش موجودة متقولش إن الأرض مش على شارع.
- corner (ناصية) معناها إن الأرض على شارعين، ودي من بيانات الهيئة.
- building_rules فيها الاشتراطات البنائية المعروفة بس. لو مش موجودة لأرض أو ناقص منها حاجة، متتكلمش عن ده خالص ومتقولش إنها مش معروفة.
- الاحتمالات تقديرية، وضّح ده لما يكون مهم.
- رجّع JSON بس بنفس الشكل المطلوب. خلي الأسباب قصيرة (جملة أو اتنين).`;

export function aiCacheKey(profile: Profile, dataVersion: string, model: string) {
  return hashString(JSON.stringify(profile) + "|" + dataVersion + "|" + model + "|" + PROMPT_VERSION);
}

export function buildPayload(d: Dashboard, ranked: RankedLand[], profile: Profile) {
  const candidates = diversify(ranked, AI_CANDIDATES, AI_PER_SECTOR);
  return {
    candidates,
    payload: {
      user: {
        rank: profile.bookingRank,
        money_paid_usd: profile.moneyPaid,
        preferred_cities: profile.preferredCities,
        garden: profile.preferences?.garden ?? "prefer",
        corner: profile.preferences?.corner ?? "prefer",
        near_built: profile.preferences?.nearBuilt ?? "prefer",
        multi_unit: profile.preferences?.units ?? "prefer",
      },
      market: {
        total_plots: d.market.total,
        booked: d.market.booked,
        available: d.market.available,
        booked_last_24h: d.market.bookedLast24h,
        codes_issued: d.queue.codesIssued,
        people_ahead: d.queue.peopleAhead,
        expected_bookings_before_turn: Math.round(d.queue.bookingsAhead.mid),
        expected_turn_date: d.queue.eta.expected ? new Date(d.queue.eta.expected).toISOString().slice(0, 10) : "unknown",
        reachable_affordable_plots: d.reachable.expected,
        sectors_expected_to_sell_out: d.strategy.avoid,
        data_stale: d.freshness.stale,
      },
      lands: candidates.map((r) => ({
        land_id: r.id,
        city: r.cityName,
        project: r.projectName ?? "unknown",
        plot_number: r.plotNumber,
        area_m2: r.area,
        total_price_usd: r.totalPrice,
        down_payment_usd: r.downPayment,
        garden: r.hasGarden,
        corner: r.hasCorner,
        ...(r.hasStreet ? { on_main_road: true } : {}),
        apartments_per_floor: r.unitsPerFloor,
        ...knownRules(r.rules),
        km_to_existing_buildings: r.builtKm == null ? "unknown" : Number(r.builtKm.toFixed(2)),
        share_of_neighbours_booked: r.neighbourShare == null ? "unknown" : Number(r.neighbourShare.toFixed(2)),
        survival_probability: Number(r.survival.mid.toFixed(2)),
        score: r.score,
        recommendation: r.recommendation,
      })),
    },
  };
}

/** Only the regulation fields that are actually known; nothing at all when none are. */
function knownRules(r: BuildingRules | null): { building_rules?: Record<string, string> } {
  const out = Object.fromEntries(
    Object.entries({ coverage: r?.ratio, floors: r?.floors, setbacks: r?.setbacks }).filter((e): e is [string, string] => !!e[1]),
  );
  return Object.keys(out).length ? { building_rules: out } : {};
}
