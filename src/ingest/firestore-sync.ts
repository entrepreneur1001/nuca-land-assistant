/**
 * Firestore side of the data sync, Node-only (not used by the app); shared by scripts/ingest.mts (one run) and scripts/live.mts (the 1-minute loop):
 * the snapshot store, the «مفضلتك» push alerts and the watcher census. Importing it initialises firebase-admin from
 * FIREBASE_SERVICE_ACCOUNT (or the emulator when FIRESTORE_EMULATOR_HOST is set).
 */
import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import type { MetaDoc } from "@/data/snapshot";
import { QUERY_CHUNK, areaKeys, buildPushes, census, chunks, isDeadToken, type PlotLabel, type Watcher } from "@/ingest/notify";
import type { ChunkDoc, Store } from "@/ingest/run";
import { SITE_URL } from "@/lib/site";

const projectId = process.env.FIREBASE_PROJECT_ID ?? "nuca-lands-assistant";
const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
initializeApp(sa && !process.env.FIRESTORE_EMULATOR_HOST ? { credential: cert(JSON.parse(sa)), projectId } : { projectId });
export const db = getFirestore();

export const store: Store = {
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

/**
 * «اتحجزت أرض من مفضلتك / في منطقة بتتابعها»: pushes to every browser that saved a plot booked this run or follows its
 * city / district (watchers written by src/lib/push.ts), each opening that plot. Reads only the matching watcher docs.
 * Counts go to `stats/impact` for /impact. Never fails the sync: errors are logged.
 */
const cairoDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());

export async function notifyWatchers(booked: PlotLabel[]) {
  const seen = new Map<string, Watcher>();
  const collect = async (field: "plots" | "areas", values: string[]) => {
    for (const vs of chunks(values, QUERY_CHUNK)) {
      const snap = await db.collection("watchers").where(field, "array-contains-any", vs).get();
      for (const d of snap.docs) seen.set(d.id, { id: d.id, ...(d.data() as Omit<Watcher, "id">) });
    }
  };
  await collect("plots", booked.map((b) => b.id));
  await collect("areas", areaKeys(booked));
  const pushes = buildPushes([...seen.values()], booked);
  let sent = 0;
  let failed = 0;
  const people = new Set<string>();
  const plots = new Set<string>();
  const dead = new Set<string>();
  for (const batch of chunks(pushes, 500)) {
    const res = await getMessaging().sendEach(
      batch.map((p) => ({
        token: p.token,
        webpush: {
          notification: { title: p.title, body: p.body, icon: "/icon-192.png", badge: "/icon-192.png", lang: "ar", dir: "rtl" as const, tag: p.plotId ?? "more" },
          fcmOptions: { link: SITE_URL + p.link },
        },
        data: { link: p.link, kind: p.kind },
      })),
    );
    res.responses.forEach((x, i) => {
      const p = batch[i];
      if (x.success) {
        sent++;
        people.add(p.token);
        if (p.plotId) plots.add(p.plotId);
      } else {
        failed++;
        if (isDeadToken(x.error?.code)) for (const id of p.watcherIds) dead.add(id);
        else console.warn(`push failed: ${x.error?.code} ${x.error?.message}`);
      }
    });
  }
  for (const ids of chunks([...dead], 400)) {
    const wb = db.batch();
    for (const id of ids) wb.delete(db.collection("watchers").doc(id));
    await wb.commit();
  }
  if (dead.size) console.log(`push: removed ${dead.size} watcher(s) with dead tokens`);
  if (sent || failed) {
    const inc = FieldValue.increment;
    const day = { sent: inc(sent), people: inc(people.size), plots: inc(plots.size) };
    await db.doc("stats/impact").set({ totals: { sent: inc(sent), failed: inc(failed), people: inc(people.size), plots: inc(plots.size) }, daily: { [cairoDay()]: day }, updatedAt: new Date().toISOString() }, { merge: true });
  }
  return { sent, failed, people: people.size, plots: plots.size };
}

/** How many browsers have alerts on (cheap count every run) and, on full runs, what they save and follow. */
export async function updateCensus(full: boolean) {
  const count = (await db.collection("watchers").count().get()).data().count;
  const patch: Record<string, unknown> = { watchers: count, watchersAt: new Date().toISOString() };
  if (full) {
    const all = await db.collection("watchers").get();
    const c = census(all.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Watcher, "id">) })));
    // Readable names for the most-followed areas: `c:<city>` already is one; `d:<id>` → «district · city».
    const meta = (await db.doc("meta/current").get()).data() as MetaDoc | undefined;
    const sectors = new Map((meta?.sectors ?? []).map((x) => [x.id, `${x.name} · ${meta!.cities[x.city] ?? ""}`]));
    const topAreas = c.topAreas.map((a) => ({ ...a, name: a.key.startsWith("d:") ? (sectors.get(a.key.slice(2)) ?? a.key) : a.key.slice(2) }));
    patch.census = { ...c, topAreas, at: new Date().toISOString() };
  }
  await db.doc("stats/impact").set(patch, { merge: true });
}

