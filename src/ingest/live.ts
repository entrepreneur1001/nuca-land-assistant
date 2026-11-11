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
 * Firestore is written only by those walks: a quiet minute costs one request per probed zone and no writes.
 */
import { fetchText } from "./fetcher";
import { createClient, probeZone, type FetchHtml, type ZoneProbe } from "./nuca-plots";
import { OFFICIAL_SITE } from "./official";
import { runSync, type RunOptions, type RunResult, type Store } from "./run";

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
  /** Walk the longest-unwalked zones every this many ticks. */
  rotateEvery?: number;
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
  /** Called after a successful, non-dry walk that booked plots (push alerts). */
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
}

export async function runLive(store: Store, opts: LiveOptions): Promise<LiveStats> {
  const {
    durationMs,
    tickMs = 60_000,
    probeBudgetMs = 40_000,
    probeTimeoutMs = 8_000,
    emptyEveryMs = 5 * 60_000,
    hotForMs = 60 * 60_000,
    rotateEvery = 5,
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
  const stats: LiveStats = { ticks: 0, probes: 0, probeErrors: 0, walks: 0, newlyBooked: 0, backoffs: 0, reseeds: 0 };
  const probes = new Map<number, ZoneProbe>();
  const lastProbeAt = new Map<number, number>();
  const lastWalkAt = new Map<number, number>();
  const changedAt = new Map<number, number>();
  const end = now() + durationMs;

  async function walk(zids: number[] | undefined, budgetMs: number, news: boolean): Promise<RunResult> {
    // Zones are stamped with the walk's start: a zone read early in a long (seed) walk is due early.
    const t = now();
    const r = await runSync(store, {
      ...(opts.fetchHtml ? { fetchHtml: opts.fetchHtml } : {}),
      delayMs,
      concurrency,
      sleep,
      log,
      ...opts.sync,
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
    }
    stats.walks++;
    stats.newlyBooked += r.newlyBooked;
    if (!r.error && !dryRun && opts.onRun) await opts.onRun(r).catch((e) => log("after-run step failed:", e instanceof Error ? e.message : e));
    return r;
  }

  // Seed: one walk of every zone (stalest first) gives each a probe. Zones it misses are walked by the rotation.
  const seed = await walk(undefined, seedBudgetMs, true);
  log(`seed: ${seed.probes.size} zone(s) probed-ready, ${seed.newlyBooked} newly booked${seed.error ? `, error: ${seed.error}` : ""}`);
  let known: number[] = (await store.getMeta())?.official?.zones?.map((z) => z.zid) ?? [...probes.keys()];

  for (let tick = 1; now() < end; tick++) {
    const t0 = now();
    stats.ticks++;

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
      continue;
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

    // 3. wait for the next minute
    const wait = t0 + tickMs - now();
    if (wait > 0) await sleep(Math.min(wait, Math.max(0, end - now())));
  }
  return stats;
}
