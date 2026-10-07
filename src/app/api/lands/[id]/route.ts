import { connection } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { landStatusHistory, lands } from "@/db/schema";
import { getComputed } from "@/engine";
import { getAiState } from "@/ai/service";

export async function GET(_req: Request, ctx: RouteContext<"/api/lands/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const db = await getDb();
  const [row] = await db.select().from(lands).where(eq(lands.id, id));
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  const { dashboard, ranked, byId } = await getComputed();
  const history = await db
    .select()
    .from(landStatusHistory)
    .where(eq(landStatusHistory.landId, id))
    .orderBy(desc(landStatusHistory.detectedAt));
  const ai = await getAiState(dashboard, ranked);
  const aiRec = ai.analysis?.recommendations.find((r) => r.land_id === id) ?? null;
  const computed = byId.get(id);
  const sectorKey = row.projectId ?? `city:${row.cityName}`;
  return Response.json({
    land: { ...row, geometry: row.geometry },
    survival: computed?.survival ?? null,
    scored: computed?.scored ?? null,
    rankPosition: computed?.scored ? ranked.findIndex((r) => r.id === id) + 1 : null,
    sector: dashboard.sectors.find((s) => s.key === sectorKey) ?? null,
    history,
    ai: aiRec,
    freshness: dashboard.freshness,
    budgetLimit: dashboard.budgetLimit,
  });
}
