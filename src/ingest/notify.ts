import { t } from "@/i18n/ar";

/**
 * «اتحجزت أرض من مفضلتك / في منطقة بتتابعها» push alerts. Visitors who turned on notifications keep
 * `watchers/{uid}` = { token, plots, areas } (see src/lib/push.ts); after each sync the job pushes to every browser
 * whose saved plots, or followed cities / districts (`c:<city>`, `d:<district id>`), had a plot booked this run.
 * Each push opens that plot's page. Pure helpers here; the Firestore / FCM calls live in scripts/ingest.mts.
 */

export interface PlotLabel {
  id: string;
  plotNo: string;
  sector: string | null;
  sectorId: string | null;
  city: string;
}

export interface Watcher {
  /** Firestore doc id (the visitor's anonymous uid). */
  id: string;
  token: string;
  plots?: string[];
  areas?: string[];
}

export type PushKind = "plot" | "area" | "more";

export interface Push {
  /** Every watcher doc this push goes to (one browser can end up under two uids after storage is cleared). */
  watcherIds: string[];
  token: string;
  kind: PushKind;
  /** The booked plot it opens; null for the «and N more» summary. */
  plotId: string | null;
  title: string;
  body: string;
  /** Path opened when the notification is tapped (carries `from=push` for analytics). */
  link: string;
}

/** Firestore `array-contains-any` takes at most 30 values. */
export const QUERY_CHUNK = 30;
/** Per browser per run: up to this many pushes, one per plot; past that the last one sums up the rest. */
export const MAX_PUSHES_PER_BROWSER = 5;

export const cityKey = (city: string) => `c:${city}`;
export const districtKey = (id: string) => `d:${id}`;

export function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** The follow keys that match these booked plots (what to query watchers by). */
export function areaKeys(booked: PlotLabel[]): string[] {
  const keys = new Set<string>();
  for (const b of booked) {
    keys.add(cityKey(b.city));
    if (b.sectorId) keys.add(districtKey(b.sectorId));
  }
  return [...keys];
}

export const pushLink = (plotId: string, kind: PushKind) => `/land?id=${encodeURIComponent(plotId)}&from=push&k=${kind}`;

/**
 * One push per booked plot a browser cares about, saved plots first, then followed districts, then cities; at most
 * MAX_PUSHES_PER_BROWSER, the last one summing up the rest when there are more.
 */
export function buildPushes(watchers: Watcher[], booked: PlotLabel[]): Push[] {
  const byToken = new Map<string, { watcherIds: string[]; plots: Set<string>; areas: Set<string> }>();
  for (const w of watchers) {
    if (!w.token || typeof w.token !== "string") continue;
    const e = byToken.get(w.token) ?? { watcherIds: [], plots: new Set<string>(), areas: new Set<string>() };
    e.watcherIds.push(w.id);
    for (const p of Array.isArray(w.plots) ? w.plots : []) e.plots.add(p);
    for (const a of Array.isArray(w.areas) ? w.areas : []) e.areas.add(a);
    byToken.set(w.token, e);
  }
  const out: Push[] = [];
  for (const [token, { watcherIds, plots, areas }] of byToken) {
    const hits: { b: PlotLabel; kind: "plot" | "area"; rank: number; area: string }[] = [];
    for (const b of booked) {
      const label = { b, area: "" };
      if (plots.has(b.id)) hits.push({ ...label, kind: "plot", rank: 0 });
      else if (b.sectorId && areas.has(districtKey(b.sectorId))) hits.push({ ...label, kind: "area", rank: 1, area: b.sector ?? b.city });
      else if (areas.has(cityKey(b.city))) hits.push({ ...label, kind: "area", rank: 2, area: b.city });
    }
    if (!hits.length) continue;
    hits.sort((x, y) => x.rank - y.rank);
    const single = hits.length <= MAX_PUSHES_PER_BROWSER ? hits : hits.slice(0, MAX_PUSHES_PER_BROWSER - 1);
    for (const h of single) {
      out.push({
        watcherIds,
        token,
        kind: h.kind,
        plotId: h.b.id,
        title: h.kind === "plot" ? t.fav.pushTitle : t.fav.pushAreaTitle(h.area),
        body: t.fav.label(h.b.plotNo, h.b.sector, h.b.city),
        link: pushLink(h.b.id, h.kind),
      });
    }
    const rest = hits.length - single.length;
    if (rest > 0) {
      out.push({ watcherIds, token, kind: "more", plotId: null, title: t.fav.pushMoreTitle(rest), body: t.fav.pushManyBody, link: "/favorites?from=push&k=more" });
    }
  }
  return out;
}

/** FCM errors that mean the token is gone for good (the visitor revoked permission, cleared data, …). */
export function isDeadToken(code: string | undefined): boolean {
  return code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token" || code === "messaging/invalid-argument";
}

/** Totals over a nightly read of every watcher doc, for /impact. */
export function census(watchers: Watcher[], topN = 10) {
  const areaCount = new Map<string, number>();
  const plotCount = new Map<string, number>();
  let plotsSaved = 0;
  let areasFollowed = 0;
  const tokens = new Set<string>();
  for (const w of watchers) {
    if (w.token) tokens.add(w.token);
    for (const p of w.plots ?? []) {
      plotsSaved++;
      plotCount.set(p, (plotCount.get(p) ?? 0) + 1);
    }
    for (const a of w.areas ?? []) {
      areasFollowed++;
      areaCount.set(a, (areaCount.get(a) ?? 0) + 1);
    }
  }
  const top = (m: Map<string, number>) =>
    [...m]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([key, n]) => ({ key, n }));
  return { people: tokens.size, plotsSaved, areasFollowed, topAreas: top(areaCount), topPlots: top(plotCount) };
}
