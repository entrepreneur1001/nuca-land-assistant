import { connection, type NextRequest } from "next/server";
import { getComputed } from "@/engine";
import { getAiState } from "@/ai/service";

const num = (v: string | null) => (v === null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export async function GET(req: NextRequest) {
  await connection();
  const q = req.nextUrl.searchParams;
  const { dashboard, ranked } = await getComputed();
  const ai = await getAiState(dashboard, ranked);
  const aiScore = new Map((ai.analysis?.recommendations ?? []).map((r) => [r.land_id, r.score]));

  const city = q.get("city");
  const project = q.get("project")?.trim();
  const minArea = num(q.get("minArea"));
  const maxArea = num(q.get("maxArea"));
  const maxPrice = num(q.get("maxPrice"));
  const maxDp = num(q.get("maxDownPayment"));
  const maxPpm = num(q.get("maxPricePerMeter"));
  const minReach = num(q.get("minReach"));
  const minScore = num(q.get("minScore"));
  const minAi = num(q.get("minAi"));
  const garden = q.get("garden") === "1";
  const corner = q.get("corner") === "1";
  const reach = q.get("reach"); // REACHABLE | RISKY | UNLIKELY
  const sort = q.get("sort") ?? "score";
  const limit = Math.min(500, Math.max(1, num(q.get("limit")) ?? 100));
  const offset = Math.max(0, num(q.get("offset")) ?? 0);

  let rows = ranked.filter(
    (r) =>
      (!city || r.cityName === city) &&
      (!project || (r.projectName ?? "").includes(project) || (r.zoneName ?? "").includes(project)) &&
      (minArea == null || r.area >= minArea) &&
      (maxArea == null || r.area <= maxArea) &&
      (maxPrice == null || r.totalPrice <= maxPrice) &&
      (maxDp == null || r.downPayment <= maxDp) &&
      (maxPpm == null || r.pricePerMeter <= maxPpm) &&
      (minReach == null || r.survival.mid * 100 >= minReach) &&
      (minScore == null || r.score >= minScore) &&
      (minAi == null || (aiScore.get(r.id) ?? -1) >= minAi) &&
      (!garden || r.hasGarden) &&
      (!corner || r.hasCorner) &&
      (!reach || r.reach === reach),
  );
  const sorters: Record<string, (a: (typeof rows)[0], b: (typeof rows)[0]) => number> = {
    score: () => 0, // already ordered by band, then score
    reach: (a, b) => b.survival.mid - a.survival.mid,
    price: (a, b) => a.totalPrice - b.totalPrice,
    ppm: (a, b) => a.pricePerMeter - b.pricePerMeter,
    area: (a, b) => b.area - a.area,
    ai: (a, b) => (aiScore.get(b.id) ?? -1) - (aiScore.get(a.id) ?? -1),
  };
  rows = [...rows].sort(sorters[sort] ?? sorters.score);
  const page = rows.slice(offset, offset + limit).map((r) => ({ ...r, aiScore: aiScore.get(r.id) ?? null }));
  return Response.json({ total: rows.length, offset, limit, items: page });
}
