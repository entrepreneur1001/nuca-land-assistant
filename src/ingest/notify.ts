import { t } from "@/i18n/ar";

/**
 * «اتحجزت أرض من مفضلتك» push alerts. Visitors who turned on notifications keep `watchers/{uid}` =
 * { token, plots } (see src/lib/push.ts); after each sync the job pushes once per browser for the saved plots that
 * just got booked. Pure helpers here; the Firestore / FCM calls live in scripts/ingest.mts.
 */

export interface PlotLabel {
  id: string;
  plotNo: string;
  sector: string | null;
  city: string;
}

export interface Watcher {
  /** Firestore doc id (the visitor's anonymous uid). */
  id: string;
  token: string;
  plots: string[];
}

export interface Push {
  /** Every watcher doc this push goes to (one browser can end up under two uids after storage is cleared). */
  watcherIds: string[];
  token: string;
  title: string;
  body: string;
  /** Path opened when the notification is tapped. */
  link: string;
}

/** Firestore `array-contains-any` takes at most 30 values. */
export const QUERY_CHUNK = 30;

export function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** One push per browser token, naming the plot when only one of its saved plots got booked. */
export function buildPushes(watchers: Watcher[], booked: PlotLabel[]): Push[] {
  const byId = new Map(booked.map((b) => [b.id, b]));
  const byToken = new Map<string, { watcherIds: string[]; hits: Set<string> }>();
  for (const w of watchers) {
    if (!w.token || !Array.isArray(w.plots)) continue;
    const hits = w.plots.filter((id) => byId.has(id));
    if (!hits.length) continue;
    const e = byToken.get(w.token) ?? { watcherIds: [], hits: new Set<string>() };
    e.watcherIds.push(w.id);
    for (const h of hits) e.hits.add(h);
    byToken.set(w.token, e);
  }
  return [...byToken].map(([token, { watcherIds, hits }]) => {
    const ids = [...hits];
    if (ids.length === 1) {
      const b = byId.get(ids[0])!;
      return { watcherIds, token, title: t.fav.pushTitle, body: t.fav.label(b.plotNo, b.sector, b.city), link: `/land?id=${encodeURIComponent(b.id)}` };
    }
    return { watcherIds, token, title: t.fav.pushTitleMany(ids.length), body: t.fav.pushManyBody, link: "/favorites" };
  });
}

/** FCM errors that mean the token is gone for good (the visitor revoked permission, cleared data, …). */
export function isDeadToken(code: string | undefined): boolean {
  return code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token" || code === "messaging/invalid-argument";
}
