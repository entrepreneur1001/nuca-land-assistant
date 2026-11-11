/**
 * Firestore side of the data sync, Node-only (not used by the app); shared by scripts/ingest.mts (one run) and scripts/live.mts (the 1-minute loop):
 * the snapshot store, the «مفضلتك» push alerts and the watcher census. Importing it initialises firebase-admin from
 * FIREBASE_SERVICE_ACCOUNT (or the emulator when FIRESTORE_EMULATOR_HOST is set).
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import type { MetaDoc } from "@/data/snapshot";
import { QUERY_CHUNK, areaKeys, buildPushes, census, chunks, isDeadToken, testPush, type PlotLabel, type Push, type PushEvent, type Watcher } from "@/ingest/notify";
import type { ZoneProbe } from "@/ingest/nuca-plots";
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

/** Sends the pushes; drops watcher docs whose token is gone for good. */
async function send(pushes: Push[]) {
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
          notification: { title: p.title, body: p.body, icon: "/icon-192.png", badge: "/icon-192.png", lang: "ar", dir: "rtl" as const, tag: p.plotId ?? p.kind },
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
  return { sent, failed, people: people.size, plots: plots.size };
}

export async function notifyWatchers(booked: PlotLabel[], event: PushEvent = "booked") {
  const seen = new Map<string, Watcher>();
  const collect = async (field: "plots" | "areas", values: string[]) => {
    for (const vs of chunks(values, QUERY_CHUNK)) {
      const snap = await db.collection("watchers").where(field, "array-contains-any", vs).get();
      for (const d of snap.docs) seen.set(d.id, { id: d.id, ...(d.data() as Omit<Watcher, "id">) });
    }
  };
  await collect("plots", booked.map((b) => b.id));
  await collect("areas", areaKeys(booked));
  // In the job log: what changed and how many browsers asked to hear about it (why an alert did or didn't go out).
  const shown = booked.slice(0, 20).map((b) => `${b.plotNo} · ${b.sector ?? "?"} · ${b.city}`);
  console.log(`push: ${booked.length} plot(s) ${event}: ${shown.join(" | ")}${booked.length > shown.length ? " | …" : ""}; ${seen.size} watcher(s) matched`);
  const r = await send(buildPushes([...seen.values()], booked, event));
  if (r.sent || r.failed) {
    const inc = FieldValue.increment;
    const day = { sent: inc(r.sent), people: inc(r.people), plots: inc(r.plots) };
    await db.doc("stats/impact").set({ totals: { sent: inc(r.sent), failed: inc(r.failed), people: inc(r.people), plots: inc(r.plots) }, daily: { [cairoDay()]: day }, updatedAt: new Date().toISOString() }, { merge: true });
  }
  return r;
}

/**
 * «ابعتلي إشعار تجريبي» (/favorites): the browser sets `test: true` on its watcher doc; this sends it one push and
 * clears the flag. One small query per call, so the loop can run it every minute.
 */
export async function sendTestPushes() {
  const snap = await db.collection("watchers").where("test", "==", true).limit(50).get();
  if (snap.empty) return null;
  const watchers = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Watcher, "id">) })).filter((w) => typeof w.token === "string" && w.token);
  const r = await send(watchers.map(testPush));
  const wb = db.batch();
  // A doc deleted meanwhile (dead token, or the visitor cleared the list) must not be re-created: update, not set.
  const alive = new Set((await db.getAll(...snap.docs.map((d) => d.ref))).filter((d) => d.exists).map((d) => d.id));
  for (const d of snap.docs) if (alive.has(d.id)) wb.update(d.ref, { test: FieldValue.delete() });
  await wb.commit();
  console.log(`push: ${watchers.length} test alert(s) asked for: ${JSON.stringify(r)}`);
  return r;
}

/**
 * The loop's probe state (`live/s0..s7`, gzipped JSON), so the next job picks up where this one stopped instead of
 * walking every zone again first. Only the sync job touches it.
 */
const STATE_SHARDS = 8;
const STATE_MAX_BYTES = 900_000;
export const liveState = {
  async load(): Promise<{ probes: Map<number, ZoneProbe>; savedAt: number } | null> {
    const snap = await db.collection("live").get();
    const probes = new Map<number, ZoneProbe>();
    let savedAt = Infinity;
    for (const d of snap.docs) {
      const x = d.data() as { at?: number; gz?: Buffer };
      if (!x.gz || typeof x.at !== "number") continue;
      savedAt = Math.min(savedAt, x.at);
      for (const [zid, p] of JSON.parse(gunzipSync(x.gz).toString("utf8")) as [number, ZoneProbe][]) probes.set(zid, p);
    }
    return probes.size ? { probes, savedAt } : null;
  },
  async save(probes: Map<number, ZoneProbe>): Promise<void> {
    const shards: [number, ZoneProbe][][] = Array.from({ length: STATE_SHARDS }, () => []);
    for (const e of probes) shards[e[0] % STATE_SHARDS].push(e);
    const batch = db.batch();
    const at = Date.now();
    shards.forEach((entries, i) => {
      const gz = gzipSync(JSON.stringify(entries));
      if (gz.length > STATE_MAX_BYTES) {
        // Too big for one document: leave these zones out (they are walked again after a restart).
        console.warn(`live state: shard ${i} is ${gz.length} bytes, not saved`);
        batch.set(db.doc(`live/s${i}`), { at, gz: gzipSync("[]") });
      } else batch.set(db.doc(`live/s${i}`), { at, gz });
    });
    await batch.commit();
  },
};

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

