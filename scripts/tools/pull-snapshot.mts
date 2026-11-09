/**
 * Download the production snapshot (meta/current + plots/c*) into public/dev-snapshot, so a local sync starts
 * from the same ids, coordinates and booking history as production (the inverse of seed-from-local.mts).
 *   npx tsx scripts/tools/pull-snapshot.mts            # public REST read, no credentials
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const project = process.env.FIREBASE_PROJECT_ID ?? "nuca-lands-assistant";
const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
const dir = path.join(process.cwd(), "public", "dev-snapshot");
mkdirSync(dir, { recursive: true });

type FsValue = Record<string, unknown>;
function decode(v: FsValue): unknown {
  if ("mapValue" in v) return Object.fromEntries(Object.entries(((v.mapValue as FsValue).fields as Record<string, FsValue>) ?? {}).map(([k, x]) => [k, decode(x)]));
  if ("arrayValue" in v) return (((v.arrayValue as FsValue).values as FsValue[]) ?? []).map(decode);
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("nullValue" in v) return null;
  return Object.values(v)[0];
}
async function readDoc(p: string) {
  const res = await fetch(`${base}/${p}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${p}`);
  const j = (await res.json()) as { fields: Record<string, FsValue> };
  return Object.fromEntries(Object.entries(j.fields).map(([k, v]) => [k, decode(v)]));
}

const meta = (await readDoc("meta/current")) as { chunks: { id: string }[] };
for (const c of meta.chunks) writeFileSync(path.join(dir, `${c.id}.json`), JSON.stringify(await readDoc(`plots/${c.id}`)));
writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
console.log(`pulled meta + ${meta.chunks.length} chunks into ${dir}`);
