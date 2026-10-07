import { connection } from "next/server";
import { getDb } from "@/db/client";
import { getProfile, profileInputSchema, saveProfile } from "@/lib/profile";
import { invalidateEngineCache } from "@/engine";

export async function GET() {
  await connection();
  return Response.json(await getProfile(await getDb()));
}

export async function PUT(req: Request) {
  await connection();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsed = profileInputSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  const saved = await saveProfile(await getDb(), parsed.data);
  invalidateEngineCache();
  return Response.json(saved);
}
