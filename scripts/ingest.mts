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
import { getMessaging } from "firebase-admin/messaging";
import type { MetaDoc } from "@/data/snapshot";
import { QUERY_CHUNK, buildPushes, chunks, isDeadToken, type PlotLabel, type Watcher } from "@/ingest/notify";
import { runSync, type ChunkDoc, type Store } from "@/ingest/run";
import { SITE_URL } from "@/lib/site";

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
/**
 * «اتحجزت أرض من مفضلتك»: one push per browser that saved a plot booked this run (watchers written by src/lib/push.ts).
 * Reads only the matching watcher docs. Never fails the sync: errors are logged and the count is returned.
 */
async function notifyWatchers(booked: PlotLabel[]): Promise<number> {
  const seen = new Map<string, Watcher>();
  for (const ids of chunks(booked.map((b) => b.id), QUERY_CHUNK)) {
    const snap = await db.collection("watchers").where("plots", "array-contains-any", ids).get();
    for (const d of snap.docs) seen.set(d.id, { id: d.id, ...(d.data() as Omit<Watcher, "id">) });
  }
  const pushes = buildPushes([...seen.values()], booked);
  let sent = 0;
  for (const batch of chunks(pushes, 500)) {
    const res = await getMessaging().sendEach(
      batch.map((p) => ({
        token: p.token,
        webpush: {
          notification: { title: p.title, body: p.body, icon: "/icon-192.png", lang: "ar", dir: "rtl" as const, tag: p.link },
          fcmOptions: { link: SITE_URL + p.link },
        },
      })),
    );
    const dead: string[] = [];
    res.responses.forEach((x, i) => {
      if (x.success) sent++;
      else if (isDeadToken(x.error?.code)) dead.push(...batch[i].watcherIds);
      else console.warn(`push failed: ${x.error?.code} ${x.error?.message}`);
    });
    for (const ids of chunks(dead, 400)) {
      const wb = db.batch();
      for (const id of ids) wb.delete(db.collection("watchers").doc(id));
      await wb.commit();
    }
    if (dead.length) console.log(`push: removed ${dead.length} watcher(s) with dead tokens`);
  }
  return sent;
}

let pushes = 0;
if (!r.error && !r.dryRun && r.newlyBookedLabels.length && !process.env.NO_PUSH) {
  try {
    pushes = await notifyWatchers(r.newlyBookedLabels);
  } catch (e) {
    console.warn(`push: skipped (${e instanceof Error ? e.message : e})`);
  }
}

console.log(
  JSON.stringify({ ...r, changedChunks: r.changedChunks.length, officialNew: r.officialNew.map((i) => i.nid), newlyBookedPlots: r.newlyBookedPlots.length, newlyBookedLabels: r.newlyBookedLabels.length, pushes }),
);
process.exit(r.error ? 1 : 0);
