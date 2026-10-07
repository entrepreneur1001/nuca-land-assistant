import { connection } from "next/server";
import { getComputed } from "@/engine";
import { getAiState } from "@/ai/service";

export async function GET() {
  await connection();
  try {
    const { dashboard, ranked, byId } = await getComputed();
    const ai = await getAiState(dashboard, ranked);
    // Attach land details for AI picks so the UI can render them without another call.
    const aiLands = Object.fromEntries(
      (ai.analysis?.recommendations ?? []).map((r) => [r.land_id, byId.get(r.land_id) ?? null]),
    );
    const cities = [...new Set([...byId.values()].map((l) => l.cityName))].sort();
    return Response.json({ ...dashboard, ai, aiLands, cities });
  } catch (e) {
    console.error("summary failed", e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
