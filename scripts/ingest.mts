/**
 * Data sync job (run by GitHub Actions every 15 min, or manually):
 *   FIREBASE_SERVICE_ACCOUNT='<json>' SOURCE_REFRESH_TOKEN='<token>' npx tsx scripts/ingest.mts [--full] [--osm]
 * Uses the Firestore emulator when FIRESTORE_EMULATOR_HOST is set.
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { MetaDoc } from "@/data/snapshot";
import { createTokenProvider } from "@/ingest/auth";
import { fetchJson } from "@/ingest/fetcher";
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

// The source requires OAuth since 2026-10-16; the rotated refresh token is kept in an admin-only doc.
const authDoc = db.doc("private/sourceAuth");
const auth = createTokenProvider(
  {
    async getRefreshToken() {
      const s = await authDoc.get();
      return (s.get("refreshToken") as string | undefined) ?? null;
    },
    async putRefreshToken(refreshToken) {
      await authDoc.set({ refreshToken, updatedAt: new Date().toISOString() });
    },
  },
  { staticToken: process.env.SOURCE_API_TOKEN || undefined, seedRefreshToken: process.env.SOURCE_REFRESH_TOKEN || undefined },
);

const args = new Set(process.argv.slice(2));
const r = await runSync(store, { forceFull: args.has("--full"), forceOsm: args.has("--osm"), fetchJson: (p) => fetchJson(p, { auth }) });
console.log(JSON.stringify({ ...r, changedChunks: r.changedChunks.length }));
process.exit(r.error ? 1 : 0);
