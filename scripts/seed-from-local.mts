/**
 * Upload public/dev-snapshot (from `npm run sync:local`) to Firestore, so the first
 * GitHub Actions runs don't have to redo the slow OpenStreetMap work.
 *   GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json npx tsx scripts/seed-from-local.mts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { unpackTuples, type MetaDoc } from "@/data/snapshot";

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!saPath) throw new Error("set GOOGLE_APPLICATION_CREDENTIALS");
initializeApp({ credential: cert(JSON.parse(readFileSync(saPath, "utf8"))) });
const db = getFirestore();
const dir = path.join(process.cwd(), "public", "dev-snapshot");
const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8")) as MetaDoc;
const docs = meta.chunks.map((c) => ({ id: c.id, doc: JSON.parse(readFileSync(path.join(dir, `${c.id}.json`), "utf8")) }));
if (!meta.osmCities) {
  // Mark a city fresh only if some of its plots got a building distance; the rest are retried by the sync job.
  const withData = new Set<number>();
  for (const { doc } of docs) for (const t of await unpackTuples(doc.data)) if (t[17] != null) withData.add(t[3]);
  const at = meta.fullSyncAt ?? new Date().toISOString();
  meta.osmCities = Object.fromEntries(meta.cities.flatMap((c, i) => (withData.has(i) ? [[c, at]] : [])));
  console.log(`OSM data present for ${withData.size}/${meta.cities.length} cities`);
}
const batch = db.batch();
for (const { id, doc } of docs) batch.set(db.doc(`plots/${id}`), doc);
batch.set(db.doc("meta/current"), meta);
await batch.commit();
console.log(`seeded ${meta.chunks.length} chunks, ${meta.chunks.reduce((a, c) => a + c.n, 0)} plots, dataVersion ${meta.dataVersion}`);
process.exit(0);
