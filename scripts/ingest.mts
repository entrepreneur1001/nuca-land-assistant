/**
 * Data sync job (run by GitHub Actions every 15 min, or manually):
 *   FIREBASE_SERVICE_ACCOUNT='<json>' npx tsx scripts/ingest.mts [--full] [--osm]
 * Uses the Firestore emulator when FIRESTORE_EMULATOR_HOST is set.
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
const r = await runSync(store, { forceFull: args.has("--full"), forceOsm: args.has("--osm") });
console.log(JSON.stringify({ ...r, changedChunks: r.changedChunks.length }));
process.exit(r.error ? 1 : 0);
