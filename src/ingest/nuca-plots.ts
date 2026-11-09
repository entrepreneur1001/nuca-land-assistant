/**
 * The official plot tables (lands.nuca.gov.eg, ASP.NET WebForms): parsers for the zone, city,
 * project pages and the cities JSON; a small WebForms client (hidden fields + postbacks);
 * and the crawlers that walk a zone's pages and the cities → projects → zones tree.
 */
import { asciiDigits } from "./official-map";
import { officialUrl } from "./official";

export type PlotState = "free" | "held" | "booked";

export interface ZoneRow {
  square: string;
  plotNo: string;
  area: number;
  basePpm: number;
  corner: number;
  garden: number;
  sea: number;
  ppm: number;
  total: number;
  dp: number;
  status: PlotState;
}

export type ZoneView = "available" | "booked";

export interface ZonePage {
  rows: ZoneRow[];
  /** The table says the zone has no plots (in this view). */
  empty: boolean;
  /** Page numbers the pager links to (never the current page). */
  pages: number[];
  hidden: Record<string, string>;
  egpPerM: number | null;
  view: ZoneView;
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Visible text of an HTML fragment: tags removed, entities decoded, whitespace collapsed. */
function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/[\s ]+/g, " ")
    .trim();
}

/** "223,875.00" → 223875; Arabic-Indic digits and separators accepted; anything else throws. */
export function parseNum(s: string): number {
  const cleaned = asciiDigits(s)
    .replace(/[\s ,٬]/g, "")
    .replace(/٫/g, ".");
  const n = cleaned === "" ? NaN : Number(cleaned);
  if (!Number.isFinite(n)) throw new ParseError(`not a number: «${s}»`);
  return n;
}

/** Attributes of a tag's opening markup (`name="value"` or bare); values entity-decoded. */
function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=<>"'/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  const body = tag.replace(/^<\s*[^\s>]+/, "").replace(/\/?>$/, "");
  for (let m = re.exec(body); m; m = re.exec(body)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

/** The outer HTML of the element whose opening tag starts at `start`, balancing nested tags of the same name. */
function elementAt(html: string, start: number, tag: string): string {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  return html.slice(start);
}

function statusOf(label: string): PlotState {
  if (label === "") return "free";
  if (/حجز\s*مبدئ/.test(label)) return "held";
  if (/غير\s*متاح/.test(label)) return "booked";
  throw new ParseError(`unknown plot status label «${label}»`);
}

/** All `<input type="hidden">` fields of the page (WebForms state to echo back in a postback). */
function hiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const a = attrsOf(m[0]);
    if (a.type?.toLowerCase() === "hidden" && a.name) out[a.name] = a.value ?? "";
  }
  return out;
}

function checkedView(html: string): ZoneView {
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const a = attrsOf(m[0]);
    if (a.type?.toLowerCase() === "radio" && a.name === "ctl00$MainContent$PlotType" && "checked" in a) return a.value === "rdShowBooked" ? "booked" : "available";
  }
  return "available";
}

const COLUMNS = 11;

/** Parse a zone page (ViewZone.aspx, either view, any page). Throws ParseError when the plot table is absent. */
export function parseZonePage(html: string): ZonePage {
  const open = /<table\b[^>]*\bid="MainContent_grdPlots"[^>]*>/i.exec(html);
  if (!open) throw new ParseError("plot table #MainContent_grdPlots not found");
  const table = elementAt(html, open.index, "table");

  const rows: ZoneRow[] = [];
  let marker = false;
  for (const tr of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cells.length === 1 && /colspan/i.test(cells[0][0]) && !/<table\b/i.test(cells[0][1]) && textOf(cells[0][1]) !== "") {
      marker = true;
      continue;
    }
    if (cells.length !== COLUMNS || !/lblPlotStatus/.test(cells[COLUMNS - 1][1])) continue;
    const t = cells.map((c) => textOf(c[1]));
    const label = /<span\b[^>]*lblPlotStatus[^>]*>([\s\S]*?)<\/span>/i.exec(cells[COLUMNS - 1][1]);
    // Premium percentages are blank when there is none.
    const pct = (s: string) => (s === "" ? 0 : parseNum(s));
    rows.push({
      square: t[0],
      plotNo: asciiDigits(t[1]),
      area: parseNum(t[2]),
      basePpm: parseNum(t[3]),
      corner: pct(t[4]),
      garden: pct(t[5]),
      sea: pct(t[6]),
      ppm: parseNum(t[7]),
      total: parseNum(t[8]),
      dp: parseNum(t[9]),
      status: statusOf(textOf(label?.[1] ?? "")),
    });
  }

  const pages = [...new Set([...table.matchAll(/Page\$(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  const egp = /سعر المتر بالجنيه المصري\s*:?\s*([\d.,٠-٩٫٬]+)/.exec(html);
  let egpPerM: number | null = null;
  if (egp) {
    try {
      egpPerM = parseNum(egp[1]);
    } catch {
      egpPerM = null;
    }
  }
  return { rows, empty: rows.length === 0 && marker, pages, hidden: hiddenFields(html), egpPerM, view: checkedView(html) };
}

/**
 * Projects of a city page (ViewCity.aspx): the ball image next to each title says whether the
 * project is open in the current phase. The legend's two balls have no ViewProject link and are skipped.
 */
export function parseCityPage(html: string): { pid: number; name: string; green: boolean }[] {
  const balls = [...html.matchAll(/<img\b[^>]*ball_(green|red)\.png[^>]*>/gi)];
  const out: { pid: number; name: string; green: boolean }[] = [];
  balls.forEach((m, i) => {
    const seg = html.slice(m.index, i + 1 < balls.length ? balls[i + 1].index : html.length);
    const link = /ViewProject\.aspx\?ID=(\d+)/i.exec(seg);
    if (!link) return;
    const title = /<span\b[^>]*_lblProjectTitle"[^>]*>([\s\S]*?)<\/span>/i.exec(seg) ?? /<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(seg);
    out.push({ pid: Number(link[1]), name: textOf(title?.[1] ?? ""), green: m[1].toLowerCase() === "green" });
  });
  return out;
}

/** Zones of a project page (ViewProject.aspx): name label + ViewZone link per region; deduped by zid. */
export function parseProjectPage(html: string): { zid: number; name: string }[] {
  const links = [...html.matchAll(/<a\b[^>]*ViewZone\.aspx\?ID=(\d+)[^>]*>([\s\S]*?)<\/a>/gi)];
  const out = new Map<number, string>();
  let from = 0;
  for (const m of links) {
    const seg = html.slice(from, m.index);
    from = m.index + m[0].length;
    const names = [...seg.matchAll(/<span\b[^>]*_lblName"[^>]*>([\s\S]*?)<\/span>/gi)];
    const h3s = [...seg.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
    const name = textOf((names.at(-1) ?? h3s.at(-1))?.[1] ?? m[2]);
    const zid = Number(m[1]);
    if (!out.has(zid)) out.set(zid, name);
  }
  return [...out].map(([zid, name]) => ({ zid, name }));
}

/** The `Cities.aspx/GetSiteCities` answer: `{"d": "<JSON array as a string>"}` (the string or array forms are accepted too). */
export function parseCitiesJson(body: unknown): { id: number; name: string }[] {
  let v: unknown = body;
  for (let i = 0; i < 3 && v !== null && typeof v === "object" && !Array.isArray(v) && "d" in v; i++) v = (v as { d: unknown }).d;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      throw new ParseError("cities: payload is not JSON");
    }
  }
  if (!Array.isArray(v)) throw new ParseError("cities: expected an array");
  const out: { id: number; name: string }[] = [];
  for (const item of v) {
    if (item === null || typeof item !== "object") continue;
    const { ID, Name } = item as { ID?: unknown; Name?: unknown };
    const id = Number(ID);
    if (!Number.isInteger(id) || typeof Name !== "string" || !Name.trim()) continue;
    out.push({ id, name: Name.replace(/\s+/g, " ").trim() });
  }
  if (!out.length) throw new ParseError("cities: no entries");
  return out;
}

// ---- WebForms client ----

export type FetchHtml = (url: string, init?: { method?: "GET" | "POST"; body?: URLSearchParams; headers?: Record<string, string> }) => Promise<string>;

export interface WebFormsClient {
  get(url: string): Promise<string>;
  /** POST the page's hidden fields back with `__EVENTTARGET`/`__EVENTARGUMENT` set, plus any form values. */
  postback(url: string, hidden: Record<string, string>, target: string, argument: string, extra?: Record<string, string>): Promise<string>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * A polite client over `fetchHtml`: at least `delayMs` passes between one request ending
 * (or starting) and the next one starting, across all callers of this client.
 */
export function createClient(fetchHtml: FetchHtml, opts: { delayMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {}): WebFormsClient {
  const { delayMs = 0, sleep = defaultSleep, now = Date.now } = opts;
  let nextAt = -Infinity;
  let gate: Promise<void> = Promise.resolve();
  async function paced(run: () => Promise<string>): Promise<string> {
    const turn = gate.then(async () => {
      const wait = nextAt - now();
      if (wait > 0) await sleep(wait);
      nextAt = now() + delayMs;
    });
    gate = turn.catch(() => undefined);
    await turn;
    try {
      return await run();
    } finally {
      nextAt = Math.max(nextAt, now() + delayMs);
    }
  }
  return {
    get: (url) => paced(() => fetchHtml(url)),
    postback(url, hidden, target, argument, extra = {}) {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(hidden)) body.set(k, v);
      body.set("__EVENTTARGET", target);
      body.set("__EVENTARGUMENT", argument);
      for (const [k, v] of Object.entries(extra)) body.set(k, v);
      return paced(() => fetchHtml(url, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8", referer: url } }));
    },
  };
}

// ---- crawlers ----

export interface ZoneCrawl {
  zid: number;
  view: ZoneView;
  ok: boolean;
  rows: ZoneRow[];
  /** Pages read. */
  pages: number;
  egpPerM: number | null;
  error?: string;
  ms: number;
}

const GRID = "ctl00$MainContent$grdPlots";
const RADIO_BOOKED = "ctl00$MainContent$rdShowBooked";
const formFields = (view: ZoneView) => ({ "ctl00$MainContent$PlotType": view === "booked" ? "rdShowBooked" : "rdShowAvailable", "ctl00$MainContent$txtPlotNumber": "" });

async function walkZone(client: WebFormsClient, url: string, view: ZoneView, maxPages: number): Promise<{ rows: ZoneRow[]; pages: number; egpPerM: number | null }> {
  let page = parseZonePage(await client.get(url));
  if (view === "booked") {
    page = parseZonePage(await client.postback(url, page.hidden, RADIO_BOOKED, "", formFields("booked")));
  }
  if (page.view !== view) throw new ParseError(`expected the ${view} view but the ${page.view} radio is checked`);
  if (!page.rows.length && !page.empty) throw new ParseError("page 1 has neither rows nor the empty marker");
  const seen = new Map<string, ZoneRow>();
  const add = (rows: ZoneRow[]) => {
    for (const r of rows) {
      const key = `${r.square}\u0000${r.plotNo}`;
      if (!seen.has(key)) seen.set(key, r);
    }
  };
  add(page.rows);
  let n = 1;
  while (page.pages.includes(n + 1) && n < maxPages) {
    page = parseZonePage(await client.postback(url, page.hidden, GRID, `Page$${n + 1}`, formFields(view)));
    if (page.view !== view) throw new ParseError(`page ${n + 1}: the ${page.view} radio is checked`);
    if (!page.rows.length) throw new ParseError(`page ${n + 1} has no rows`);
    n++;
    add(page.rows);
  }
  return { rows: [...seen.values()], pages: n, egpPerM: page.egpPerM };
}

/**
 * Read every page of one zone in one view. A page that fails (network, parse, no rows) makes
 * the whole walk restart once from a fresh GET; a second failure yields ok=false with no rows.
 */
export async function crawlZone(client: WebFormsClient, zid: number, view: ZoneView, opts: { maxPages?: number; url?: string } = {}): Promise<ZoneCrawl> {
  const { maxPages = 200, url = officialUrl.zone(zid) } = opts;
  const t0 = Date.now();
  let error = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await walkZone(client, url, view, maxPages);
      return { zid, view, ok: true, rows: r.rows, pages: r.pages, egpPerM: r.egpPerM, ms: Date.now() - t0 };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  return { zid, view, ok: false, rows: [], pages: 0, egpPerM: null, error, ms: Date.now() - t0 };
}

/**
 * Crawl zones with a worker pool. Zones are started in the given order until `budgetMs` has
 * elapsed; a started zone runs all requested views. Zones never started are absent from the result.
 */
export async function crawlZones(
  client: WebFormsClient,
  zids: number[],
  views: ZoneView[],
  opts: { concurrency: number; budgetMs: number; now?: () => number; log?: (...a: unknown[]) => void },
): Promise<Map<number, ZoneCrawl[]>> {
  const { concurrency, budgetMs, now = Date.now, log = () => undefined } = opts;
  const start = now();
  const out = new Map<number, ZoneCrawl[]>();
  let next = 0;
  async function worker() {
    while (next < zids.length) {
      if (now() - start >= budgetMs) return;
      const zid = zids[next++];
      const results: ZoneCrawl[] = [];
      for (const view of views) {
        const c = await crawlZone(client, zid, view);
        results.push(c);
        log(c.ok ? `zone ${zid} ${view}: ${c.rows.length} rows in ${c.pages} page(s), ${c.ms} ms` : `zone ${zid} ${view}: failed: ${c.error}`);
      }
      out.set(zid, results);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, zids.length)) }, worker));
  return out;
}

/** Cities → each city page's open (green) projects → their zones. Deduped by zid. */
export async function discoverZones(
  client: WebFormsClient,
  fetchJsonPost: (url: string, body: unknown) => Promise<unknown>,
): Promise<{ zid: number; pid: number; cityId: number; cityName: string; name: string }[]> {
  const cities = parseCitiesJson(await fetchJsonPost(officialUrl.cities(), {}));
  const out = new Map<number, { zid: number; pid: number; cityId: number; cityName: string; name: string }>();
  for (const city of cities) {
    const projects = parseCityPage(await client.get(officialUrl.city(city.id)));
    for (const p of projects) {
      if (!p.green) continue;
      for (const z of parseProjectPage(await client.get(officialUrl.project(p.pid)))) {
        if (!out.has(z.zid)) out.set(z.zid, { zid: z.zid, pid: p.pid, cityId: city.id, cityName: city.name, name: z.name });
      }
    }
  }
  return [...out.values()];
}
