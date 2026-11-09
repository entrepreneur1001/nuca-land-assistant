/**
 * The official NUCA news list (lands.nuca.gov.eg/ar/NewsList.aspx): one item per day announcing the serial (rank)
 * the booking codes reached and the next day's range. Node-only (the ingest); browser code gets the parsed items
 * through `meta.officialNews` and reduces them in engine/queue.ts.
 */
import type { OfficialNewsItem } from "@/data/snapshot";
import { officialUrl } from "./official";

export { isQueueNews } from "../engine/queue";

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", laquo: "«", raquo: "»" };

/**
 * Tags → spaces (the site truncates briefs mid-tag, so an unclosed trailing tag goes too), common + numeric
 * entities decoded, whitespace collapsed, a trailing "..." / "…" removed.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*(?:>|$)/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*(?:\.{3,}|…)$/, "")
    .trim();
}

/** Matching form only (never stored): ASCII digits, unified alef/yaa/taa marbuta, no tashkeel or tatweel. */
export function normalizeArabic(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

const RELEVANT = /مسلسل|تسجيل|التخصيص|استئناف/;
const SERVED = /الانتهاء[^\d]{0,60}?(?:حتي|الي|لغايه)\s*(?:مسلسل\s*)?(\d{2,6})/;
const NEXT = /(?<!\S)بد[ءا]?ا?\s*(?:من\s*)?(?:مسلسل\s*)?(\d{2,6})(?:\s*(?:و?حتي|الي|لغايه|[-–])\s*(?:مسلسل\s*)?(\d{2,6}))?/;
const DATE = /(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})/g;
const HOUR = /الساع[هة]?\s*(\d{1,2})(?:[:.]\d{2})?\s*(صباحا|ص(?![ؠ-ي])|ظهرا|عصرا|مساء)?/;
const MAX_BATCH = 5000;
const MAX_NEXT_DAYS = 7;
const DAY = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const validDate = (y: number, m: number, d: number) => y >= 2020 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
const dayMs = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 12);
};
const shiftDay = (iso: string, days: number) => new Date(dayMs(iso) + days * DAY).toISOString().slice(0, 10);

function explicitDate(s: string): string | null {
  const all = [...s.matchAll(DATE)];
  const pick = all.find((m) => /الموافق\s*$/.test(s.slice(Math.max(0, m.index! - 12), m.index))) ?? all[0];
  if (!pick) return null;
  const [a, b, c] = [Number(pick[1]), Number(pick[2]), Number(pick[3])];
  const [y, m, d] = pick[1].length === 4 ? [a, b, c] : [c, b, a];
  return validDate(y, m, d) ? isoOf(y, m, d) : null;
}

function hourOf(s: string): number | null {
  const m = HOUR.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const period = m[2];
  if (period === "صباحا" || period === "ص") {
    if (h === 12) h = 0;
  } else if (period && h <= 6) h += 12;
  return h >= 0 && h <= 23 ? h : null;
}

/**
 * Facts from one item's title + brief (title first: some items carry the range only in the title).
 * Returns only the keys that were found, so the result can be stored as is.
 */
export function parseNewsText(title: string, text: string, day: string): Pick<OfficialNewsItem, "servedThrough" | "next"> {
  const s = normalizeArabic(`${title} ${text}`);
  if (!RELEVANT.test(s)) return {};
  const out: Pick<OfficialNewsItem, "servedThrough" | "next"> = {};

  const served = SERVED.exec(s);
  if (served) out.servedThrough = Number(served[1]);

  const next = NEXT.exec(s);
  if (next) {
    const from = Number(next[1]);
    if (from >= 100) {
      const toRaw = next[2] != null ? Number(next[2]) : null;
      const to = toRaw != null && toRaw > from && toRaw - from + 1 <= MAX_BATCH ? toRaw : null;
      let nextDay = explicitDate(s);
      const tomorrow = /غدا|بكره/.test(s);
      // «غدا … الموافق <today's date>» happens (a typo in the item): "tomorrow" wins over a date that is not after the item day.
      if (tomorrow && (!nextDay || dayMs(nextDay) <= dayMs(day))) nextDay = shiftDay(day, 1);
      else if (!nextDay && /اليوم/.test(s)) nextDay = day;
      if (nextDay) {
        const delta = (dayMs(nextDay) - dayMs(day)) / DAY;
        if (delta < 0 || delta > MAX_NEXT_DAYS) nextDay = null;
      }
      out.next = { from, to, day: nextDay, hour: hourOf(s) };
    }
  }
  return out;
}

const NID = /NewsItemViewer\.aspx\?NID=(\d+)/;
const TITLE = /<span[^>]*\bid="[^"]*lblTitle[^"]*"[^>]*>([\s\S]*?)<\/span>/;
const LIST_DATE = /<span[^>]*\bid="[^"]*lblDate[^"]*"[^>]*>([\s\S]*?)<\/span>/;
const BRIEF = /<div[^>]*\bclass="NewsBrief"[^>]*>([\s\S]*?)<\/div>/;
const MAX_TEXT = 300;

/** "DD-MM-YYYY" (the list's date label) → "YYYY-MM-DD", or null. */
function listDay(s: string): string | null {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(htmlToText(s));
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return validDate(y, mo, d) ? isoOf(y, mo, d) : null;
}

/**
 * Items of the news list (or the homepage's "latest news" block) in page order. Items without a title or a valid
 * date are skipped; non-news HTML (the site's error page) yields []. Never throws.
 */
export function parseNewsList(html: string): OfficialNewsItem[] {
  if (typeof html !== "string" || !html) return [];
  // Each item has two anchors to its viewer (image + header); group consecutive chunks of the same NID.
  const chunks = html.split(/(?=<a\b[^>]*NewsItemViewer\.aspx\?NID=\d+)/).slice(1);
  const groups: { nid: number; html: string }[] = [];
  for (const chunk of chunks) {
    const nid = Number(NID.exec(chunk)?.[1]);
    if (!Number.isFinite(nid)) continue;
    const last = groups.at(-1);
    if (last && last.nid === nid) last.html += chunk;
    else groups.push({ nid, html: chunk });
  }
  const items: OfficialNewsItem[] = [];
  for (const g of groups) {
    const title = htmlToText(TITLE.exec(g.html)?.[1] ?? "");
    const day = listDay(LIST_DATE.exec(g.html)?.[1] ?? "");
    if (!title || !day) continue;
    const brief = htmlToText(BRIEF.exec(g.html)?.[1] ?? "").slice(0, MAX_TEXT).trim();
    const item: OfficialNewsItem = { nid: g.nid, day, title };
    if (brief && brief !== title) item.text = brief;
    Object.assign(item, parseNewsText(title, brief, day));
    items.push(item);
  }
  return items;
}

/** Union by NID (fresh wins), newest first, trimmed to `keep`; `added` = the fresh items whose NID was not seen before. */
export function mergeOfficialNews(
  prev: OfficialNewsItem[] | null | undefined,
  fresh: OfficialNewsItem[],
  keep = 30,
): { items: OfficialNewsItem[]; added: OfficialNewsItem[] } {
  const byNid = new Map<number, OfficialNewsItem>();
  for (const p of prev ?? []) byNid.set(p.nid, p);
  const known = new Set(byNid.keys());
  const added: OfficialNewsItem[] = [];
  for (const f of fresh) {
    byNid.set(f.nid, f);
    if (!known.has(f.nid) && !added.some((a) => a.nid === f.nid)) added.push(f);
  }
  const items = [...byNid.values()].sort((a, b) => b.nid - a.nid).slice(0, keep);
  return { items, added };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchOfficialNewsOptions {
  url?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Pause before the single retry (network error, 429 or 5xx). */
  retryDelayMs?: number;
}

/**
 * GET the news list and parse it. Any non-200 answer (redirects included: the site redirects to its error page)
 * fails; network errors, 429 and 5xx are retried once. An empty parse is an error too, so a changed page layout
 * is noticed rather than silently emptying the data.
 */
export async function fetchOfficialNews(opts: FetchOfficialNewsOptions = {}): Promise<OfficialNewsItem[]> {
  const { url = officialUrl.news(), fetchImpl = fetch, timeoutMs = 20_000, retryDelayMs = 1000 } = opts;
  const init: RequestInit = {
    headers: { accept: "text/html", "user-agent": "nuca-land-assistant/1.0 (personal, read-only)" },
    cache: "no-store",
    redirect: "manual",
  };
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(retryDelayMs);
    let res: Response;
    let html: string;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`official news: HTTP ${res.status} for ${url}`);
      continue;
    }
    if (res.status !== 200) {
      const location = res.headers.get("location");
      const redirect = res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);
      throw new Error(`official news: ${redirect ? "redirected" : "failed"} (HTTP ${res.status}) for ${url}${location ? ` → ${location}` : ""}`);
    }
    try {
      html = await res.text();
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      continue;
    }
    const items = parseNewsList(html);
    if (!items.length) throw new Error(`official news: no items parsed (${new TextEncoder().encode(html).length} bytes)`);
    return items;
  }
  throw lastErr ?? new Error("official news: fetch failed");
}
