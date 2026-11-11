/**
 * The 1-minute loop (scripts/live.mts, GitHub Actions job `live.yml` during the peak hours): bookings show up on the
 * site within about a minute without re-walking every zone every minute.
 *
 * Each tick:
 *  1. probe zones with one request each (`probeZone`: the zone's last page, whose row count changes whenever any plot
 *     in the zone is booked or offered again), most overdue first, for at most `probeBudgetMs`;
 *  2. walk the zones that changed (plus, every `rotateEvery` ticks, the zones walked longest ago, so held ↔ free flips
 *     stay fresh) with `runSync({ onlyZones })`, which writes Firestore and reports what got booked;
 *  3. sleep until the next tick.
 * The loop is the only regular writer of the snapshot, around the clock: it keeps its own copy of what it last wrote
 * (no Firestore reads per tick), saves its probes (`state`) so the next job resumes without walking everything again,
 * does the nightly full pass (booked views, zone list) itself, and a tick that throws is logged and skipped.
 */
import { fetchText } from "./fetcher";
import { createClient, probeZone, type FetchHtml, type ZoneProbe } from "./nuca-plots";
import { OFFICIAL_SITE } from "./official";
import { runSync, type ChunkDoc, type RunOptions, type RunResult, type Store } from "./run";
import type { MetaDoc } from "@/data/snapshot";

/** Where the loop keeps its probes between jobs (Firestore `live/*` in production). */
export interface LiveState {
  load(): Promise<{ probes: Map<number, ZoneProbe>; savedAt: number } | null>;
  save(probes: Map<number, ZoneProbe>): Promise<void>;
}

/**
 * The store with the loop's own copy of meta and chunks in front of it: the loop is the only writer, so what it last
 * wrote is what is there, and a walk a minute would otherwise read the whole snapshot a minute. The copy is dropped
 * every `maxAgeMs` in case someone else wrote (a manual sync run).
 */
export function cachingStore(store: Store, now: () => number, maxAgeMs = 15 * 60_000): Store {
  let meta: MetaDoc | null = null;
  const chunks = new Map<string, ChunkDoc>();
  let filledAt = 0;
  const fresh = () => {
    if (now() - filledAt > maxAgeMs) {
      meta = null;
      chunks.clear();
      filledAt = now();
    }
  };
  const drop = () => {
    meta = null;
    chunks.clear();
  };
  return {
    async getMeta() {
      fresh();
      if (!meta) meta = await store.getMeta();
      return meta ? structuredClone(meta) : null;
    },
    async getChunk(id) {
      fresh();
      const hit = chunks.get(id);
      if (hit) return hit;
      const doc = await store.getChunk(id);
      if (doc) chunks.set(id, doc);
      return doc;
    },
    async commit(written, m) {
      try {
        await store.commit(written, m);
      } catch (e) {
        drop();
        throw e;
      }
      for (const [id, doc] of Object.entries(written)) chunks.set(id, doc);
      meta = structuredClone(m);
    },
    async putMeta(m) {
      try {
        await store.putMeta(m);
      } catch (e) {
        drop();
        throw e;
      }
      meta = structuredClone(m);
    },
  };
}

const cairoHour = (ms: number) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", hourCycle: "h23" }).format(new Date(ms)));

export interface LiveOptions {
  /** Stop starting ticks after this many ms (Date.now clock). */
  durationMs: number;
  tickMs?: number;
  /** Time a tick may spend probing. */
  probeBudgetMs?: number;
  /** Per-probe request timeout. */
  probeTimeoutMs?: number;
  /** A zone with plots is probed every tick when possible; an empty zone (nothing on offer) this often. */
  emptyEveryMs?: number;
  /** A zone that changed within this window is probed before the others. */
  hotForMs?: number;
  /** Walk the longest-unwalked zones every this many ticks (in the time the tick has left). */
  rotateEvery?: number;
  /** Probes saved by the previous job: with them the loop starts probing at once instead of walking every zone first. */
  state?: LiveState;
  /** Save the probes every this many ticks (and when the loop ends). */
  saveEvery?: number;
  /** Saved probes older than this are not used. */
  resumeMaxAgeMs?: number;
  /** Cairo hour (0–23) at which, once a day, everything is walked in full (booked views too, zone list re-read). */
  fullHour?: number;
  /** Do the full pass on the first tick, whatever the hour (a manual "run it now"). */
  fullNow?: boolean;
  /** Called once per tick, after the walks (test alerts). */
  onTick?: () => Promise<void>;
  /** Re-read the official news every this many ticks. */
  newsEvery?: number;
  /** Time budget of the seed walk and of a tick's walks. */
  seedBudgetMs?: number;
  walkBudgetMs?: number;
  concurrency?: number;
  delayMs?: number;
  dryRun?: boolean;
  fetchHtml?: FetchHtml;
  /** Options passed through to every runSync (tests: fake site, zone table, …). */
  sync?: Partial<RunOptions>;
  /** Called after every successful, non-dry walk (push alerts, census). */
  onRun?: (r: RunResult) => Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (...a: unknown[]) => void;
}

export interface LiveStats {
  ticks: number;
  probes: number;
  probeErrors: number;
  walks: number;
  newlyBooked: number;
  backoffs: number;
  reseeds: number;
  /** Ticks that threw and were skipped. */
  tickErrors: number;
  /** Started from the previous job's probes (no seed walk). */
  resumed: boolean;
}

export async function runLive(rawStore: Store, opts: LiveOptions): Promise<LiveStats> {
  const {
    durationMs,
    tickMs = 60_000,
    probeBudgetMs = 40_000,
    probeTimeoutMs = 8_000,
    emptyEveryMs = 5 * 60_000,
    hotForMs = 60 * 60_000,
    rotateEvery = 1,
    saveEvery = 5,
    resumeMaxAgeMs = 2 * 3600_000,
    newsEvery = 15,
    seedBudgetMs = 9 * 60_000,
    walkBudgetMs = 45_000,
    concurrency = OFFICIAL_SITE.concurrency,
    delayMs = OFFICIAL_SITE.delayMs,
    dryRun = false,
    now = Date.now,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    log = (...a: unknown[]) => console.log("[live]", ...a),
  } = opts;
  // Probes must not eat the minute: a short timeout and no retry (a probe that fails is simply tried next tick).
  // Walks use runSync's own fetcher (15 s, 2 retries) unless a test passes one.
  const probeFetch: FetchHtml = opts.fetchHtml ?? ((url, init) => fetchText(url, { method: init?.method, body: init?.body, headers: init?.headers, timeoutMs: probeTimeoutMs, retries: 0 }));
  const client = createClient(probeFetch, { delayMs, sleep, now });
  const store = cachingStore(rawStore, now);
  const stats: LiveStats = { ticks: 0, probes: 0, probeErrors: 0, walks: 0, newlyBooked: 0, backoffs: 0, reseeds: 0, tickErrors: 0, resumed: false };
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
  let dirty = false;
  const probes = new Map<number, ZoneProbe>();
  const lastProbeAt = new Map<number, number>();
  const lastWalkAt = new Map<number, number>();
  const changedAt = new Map<number, number>();
  const end = now() + durationMs;

  async function walk(zids: number[] | undefined, budgetMs: number | undefined, news: boolean, extra: Partial<RunOptions> = {}): Promise<RunResult> {
    // Zones are stamped with the walk's start: a zone read early in a long (seed) walk is due early.
    const t = now();
    const r = await runSync(store, {
      ...(opts.fetchHtml ? { fetchHtml: opts.fetchHtml } : {}),
      delayMs,
      concurrency,
      sleep,
      log,
      // A tick's walk has seconds, not the minutes a re-read of the zone list takes: that is left to the seed and the nightly full pass.
      ...(zids ? { zonesMaxAgeMs: Infinity } : {}),
      ...opts.sync,
      ...extra,
      onlyZones: zids,
      skipNews: !news,
      budgetMs,
      osmBudgetMs: 0,
      dryRun,
    });
    for (const [zid, p] of r.probes) {
      probes.set(zid, p);
      lastWalkAt.set(zid, t);
      lastProbeAt.set(zid, t);
      dirty = true;
    }
    stats.walks++;
    stats.newlyBooked += r.newlyBooked;
    if (!r.error && !dryRun && opts.onRun) await opts.onRun(r).catch((e) => log("after-run step failed:", message(e)));
    return r;
  }

  const save = async () => {
    if (!opts.state || dryRun || !dirty || !probes.size) return;
    try {
      await opts.state.save(probes);
      dirty = false;
    } catch (e) {
      log("saving the probes failed:", message(e));
    }
  };

  // Start from the previous job's probes when they are recent: a booking made in between changes the zone's last
  // page, so the first probe finds it. Otherwise seed: one walk of every zone (stalest first) gives each a probe;
  // zones it misses are walked by the rotation.
  let known: number[] = [];
  try {
    const meta = await store.getMeta();
    const zones = meta?.official?.zones ?? [];
    known = zones.map((z) => z.zid);
    const saved = opts.state ? await opts.state.load() : null;
    if (saved && now() - saved.savedAt < resumeMaxAgeMs) {
      const listed = new Set(known);
      for (const [zid, p] of saved.probes) if (listed.has(zid)) probes.set(zid, p);
      if (probes.size && probes.size >= known.length / 2) {
        for (const z of zones) if (z.lastOkAt) lastWalkAt.set(z.zid, Date.parse(z.lastOkAt));
        stats.resumed = true;
        log(`resumed with ${probes.size} of ${known.length} zone(s) probe-ready from ${Math.round((now() - saved.savedAt) / 60_000)} min ago, no seed walk`);
      } else probes.clear();
    }
  } catch (e) {
    probes.clear();
    log("could not resume:", message(e));
  }
  if (!stats.resumed) {
    try {
      const seed = await walk(undefined, seedBudgetMs, true);
      log(`seed: ${seed.probes.size} zone(s) probed-ready, ${seed.newlyBooked} newly booked${seed.error ? `, error: ${seed.error}` : ""}`);
      known = (await store.getMeta())?.official?.zones?.map((z) => z.zid) ?? [...probes.keys()];
      await save();
    } catch (e) {
      log("seed failed:", message(e));
    }
  }
  let fullTriedAt = -Infinity;

  for (let tick = 1; now() < end; tick++) {
    const t0 = now();
    stats.ticks++;
    try {
      await runTick(tick, t0);
    } catch (e) {
      // Firestore or the site hiccuping must not end the job: skip this minute.
      stats.tickErrors++;
      log(`tick ${tick} failed:`, message(e));
    }
    if (opts.onTick && !dryRun) await opts.onTick().catch((e) => log("tick step failed:", message(e)));
    if (tick % saveEvery === 0) await save();

    // wait for the next minute
    const wait = t0 + tickMs - now();
    if (wait > 0) await sleep(Math.min(wait, Math.max(0, end - now())));
  }
  await save();
  return stats;

  async function runTick(tick: number, t0: number): Promise<void> {
    // Once a night: everything in full (booked views too) and the zone list read again. Skipped when this job is
    // about to end; the next one does it.
    const forced = !!opts.fullNow && fullTriedAt === -Infinity;
    if ((opts.fullHour != null || forced) && now() - fullTriedAt > 3 * 3600_000 && end - now() > 30 * 60_000) {
      const h = cairoHour(now());
      if (forced || h === opts.fullHour || h === (opts.fullHour! + 1) % 24) {
        fullTriedAt = now();
        const zones = (await store.getMeta())?.official?.zones ?? [];
        const newest = Math.max(0, ...zones.map((z) => (z.lastFullAt ? Date.parse(z.lastFullAt) : 0)));
        if (forced || now() - newest > 20 * 3600_000) {
          const r = await walk(undefined, undefined, true, { full: true, forceZones: true });
          known = (await store.getMeta())?.official?.zones?.map((z) => z.zid) ?? known;
          log(`tick ${tick}: ${forced ? "requested" : "nightly"} full pass: ${r.error ? `error: ${r.error}` : `${r.zonesOk} zone(s) ok, ${r.zonesFailed} failed, ${r.newlyBooked} newly booked`}`);
          return;
        }
      }
    }

    // 1. probes, most overdue first; recently changed zones get a minute's head start
    const due = (zid: number) => {
      const p = probes.get(zid)!;
      const every = p.sig === "1:0" ? emptyEveryMs : tickMs;
      const hot = t0 - (changedAt.get(zid) ?? -Infinity) < hotForMs ? tickMs : 0;
      return (lastProbeAt.get(zid) ?? 0) + every - hot;
    };
    const queue = [...probes.keys()].filter((zid) => due(zid) <= t0 + tickMs / 2).sort((a, b) => due(a) - due(b));
    const changed: number[] = [];
    let probed = 0;
    let errors = 0;
    let netErrors = 0;
    let staleErrors = 0;
    const samples = new Set<string>();
    let next = 0;
    const worker = async () => {
      while (next < queue.length && now() - t0 < probeBudgetMs) {
        const zid = queue[next++];
        const p = await probeZone(client, zid, probes.get(zid)!);
        probed++;
        lastProbeAt.set(zid, now());
        if (p.error) {
          errors++;
          if (samples.size < 2) samples.add(p.error.replace(/ for https?:\/\/\S+/, "").slice(0, 120));
          if (p.changed) staleErrors++;
          else {
            netErrors++;
            lastProbeAt.set(zid, 0); // unanswered: first in line next tick
          }
        }
        if (p.changed) {
          changed.push(zid);
          changedAt.set(zid, now());
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
    stats.probes += probed;
    stats.probeErrors += errors;

    const why = samples.size ? ` (${[...samples].join("; ")})` : "";
    // The site not answering most probes (down, or blocking us): don't turn that into walks; wait and try again.
    if (netErrors >= 5 && netErrors * 2 > probed) {
      stats.backoffs++;
      log(`tick ${tick}: ${netErrors}/${probed} probes got no answer${why}; backing off 5 min`);
      await sleep(Math.max(0, Math.min(5 * 60_000, end - now())));
      return;
    }
    // The site answering most replayed postbacks with its error page: the saved page state no longer validates (the
    // site restarted, which voids every ViewState at once). Walk everything again for fresh state.
    const stale = staleErrors >= 5 && staleErrors * 2 > probed;
    if (stale) {
      stats.reseeds++;
      probes.clear();
      changed.length = 0;
    }

    // 2. walks: changed zones first, then on rotation ticks the zones walked longest ago (never-walked first)
    let walkList: number[] | undefined = [...changed];
    let budget = Math.max(15_000, Math.min(walkBudgetMs, tickMs - (now() - t0) - 5_000));
    if (stale || tick % rotateEvery === 0) {
      known = (await store.getMeta())?.official?.zones?.map((z) => z.zid) ?? known;
      if (!known.length || probes.size < known.length / 2) {
        // The seed failed (site down when the loop started): seed again, every zone stalest first, rather than
        // catching up a few zones at a time.
        walkList = undefined;
        budget = seedBudgetMs;
      } else {
        walkList.push(...known.filter((zid) => !changed.includes(zid)).sort((a, b) => (lastWalkAt.get(a) ?? 0) - (lastWalkAt.get(b) ?? 0)));
      }
    }
    let summary = "";
    if (!walkList || walkList.length) {
      const r = await walk(walkList, budget, tick % newsEvery === 0);
      summary = r.error ? `, walk error: ${r.error}` : `, walked ${r.zonesOk} (${r.zonesFailed} failed), ${r.newlyBooked} newly booked, ${r.newlyAvailable} re-available, ${r.changedChunks.length} chunk(s) written`;
    }
    log(`tick ${tick}: ${probed}/${queue.length} probed in ${Math.round((now() - t0) / 1000)} s, ${errors} error(s)${why}, ${stale ? "page state stale, walked everything again" : `${changed.length} changed${changed.length ? ` [${changed.join(", ")}]` : ""}`}${summary}`);

  }
}
