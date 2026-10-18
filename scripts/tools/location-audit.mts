/**
 * Read-only report: per district, how many plots have a real location (the source's `geoJson`) and how their
 * building distances were measured (src 0 = from the plot, 1 = sector centre, 2 = unknown).
 *   GOOGLE_APPLICATION_CREDENTIALS=<adc.json> npx tsx scripts/tools/location-audit.mts
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { ChunkDoc } from "@/ingest/run";
import { unpackTuples, type MetaDoc, type PlotTuple } from "@/data/snapshot";
initializeApp({ projectId: "nuca-lands-assistant" });
const db = getFirestore();
const meta = (await db.doc("meta/current").get()).data() as MetaDoc;
console.log("fullSyncAt", meta.fullSyncAt, "statsAt", meta.statsAt, "osmAt", meta.osmAt);
const all: PlotTuple[] = [];
for (const c of meta.chunks) all.push(...(await unpackTuples(((await db.doc(`plots/${c.id}`).get()).data() as ChunkDoc).data)));
const by: Record<number, { n: number; miss: number; src: number[] }> = {};
for (const t of all) { const b = (by[t[4]] ??= { n: 0, miss: 0, src: [0, 0, 0] }); b.n++; if (t[13] == null) b.miss++; else b.src[t[18]]++; }
let miss = 0;
for (const v of Object.values(by)) miss += v.miss;
console.log("plots", all.length, "missing", miss);
for (const [k, v] of Object.entries(by).sort((a, b) => b[1].miss - a[1].miss)) {
  const s = meta.sectors[+k];
  console.log([v.miss, v.n, "located src0/1/2=" + v.src.join("/"), meta.cities[s?.city], s?.name, s?.id].join(" | "));
}
process.exit(0);
