import { connection } from "next/server";
import { getComputed } from "@/engine";
import { runAnalysis } from "@/ai/service";

export const maxDuration = 120;

export async function POST(req: Request) {
  await connection();
  const body = (await req.json().catch(() => ({}))) as { force?: boolean };
  const { dashboard, ranked } = await getComputed();
  const r = await runAnalysis(dashboard, ranked, { force: !!body.force });
  return Response.json(r, { status: r.ok ? 200 : 502 });
}
