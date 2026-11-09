/**
 * Data sync job (run by GitHub Actions every 15 min, or manually):
 *   FIREBASE_SERVICE_ACCOUNT='<json>' npx tsx scripts/ingest.mts [--full] [--zones] [--bootstrap] [--accept-large] [--dry-run]
 * Reads the official NUCA site (no credentials needed). Uses the Firestore emulator when FIRESTORE_EMULATOR_HOST is set.
 *   --full          also crawl the booked views (daily)
 *   --zones         re-discover the zone list now
 *   --bootstrap     allow starting with an empty store (no ids/coordinates to freeze)
 *   --accept-large  accept a run that marks more plots booked than the safety limit
 *   --dry-run       crawl and report, write nothing
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { MetaDoc } from "@/data/snapshot";
import { runSync, type ChunkDoc, type Store } from "@/ingest/run";

const projectId = process.env.FIREBASE_PROJECT_ID ?? "nuca-lands-assistant";
const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
initializeApp(sa && !process.env.FIRESTORE_EMULATOR_HOST ? { credential: cert(JSON.parse(sa)), projectId } : { projectId });
const db = getFirestore();

const store: Store = {
  async getMeta() {
    const s = await db.doc("meta/current").get();
    return s.exists ? (s.data() as MetaDoc) : null;
  },
  async getChunk(id) {
    const s = await db.doc(`plots/${id}`).get();
    return s.exists ? (s.data() as ChunkDoc) : null;
  },
  async commit(chunks, meta) {
    const batch = db.batch();
    for (const [id, doc] of Object.entries(chunks)) batch.set(db.doc(`plots/${id}`), doc);
    batch.set(db.doc("meta/current"), meta);
    await batch.commit();
  },
  async putMeta(meta) {
    await db.doc("meta/current").set(meta);
  },
};

const args = new Set(process.argv.slice(2));
const r = await runSync(store, {
  full: args.has("--full"),
  forceZones: args.has("--zones"),
  bootstrap: args.has("--bootstrap"),
  acceptLarge: args.has("--accept-large"),
  dryRun: args.has("--dry-run"),
});
console.log(JSON.stringify({ ...r, changedChunks: r.changedChunks.length, officialNew: r.officialNew.map((i) => i.nid), newlyBookedPlots: r.newlyBookedPlots.length }));
process.exit(r.error ? 1 : 0);
