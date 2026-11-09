/**
 * HTTP for the official portal (lands.nuca.gov.eg): plain text/HTML GETs and WebForms POSTs,
 * with timeout and jittered exponential backoff. The site answers unknown paths and HEAD
 * requests with `302 → ~/Error.aspx`, so any redirect is a failure and is never retried.
 */
import "./tls";

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface FetchTextOptions {
  method?: "GET" | "POST";
  body?: URLSearchParams | string;
  headers?: Record<string, string>;
  /** Extra attempts after the first (default 3). */
  retries?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const USER_AGENT = "nuca-land-assistant/1.0 (personal, read-only)";
/** Longest pause a `retry-after` header can impose. */
const MAX_RETRY_AFTER_MS = 120_000;

/** Seconds or HTTP-date forms of `retry-after`, as milliseconds; null when absent or unusable. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const secs = Number(raw);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(raw) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

const isRedirect = (res: Response) => res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);

/**
 * Fetch a body as text. Retries on network errors, 429 and 5xx (jittered exponential
 * backoff, `retry-after` honoured); fails fast on redirects and other 4xx.
 */
async function fetchBody(url: string, accept: string, opts: FetchTextOptions): Promise<string> {
  const { method = "GET", body, retries = 3, timeoutMs = 30_000, baseDelayMs = 1000, fetchImpl = fetch, sleep = defaultSleep } = opts;
  const headers: Record<string, string> = { accept, "accept-language": "ar,en;q=0.5", "user-agent": USER_AGENT, ...opts.headers };
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let delay: number | null = null;
    try {
      const res = await fetchImpl(url, { method, headers, body, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      if (isRedirect(res)) throw new FetchError(`redirected to ${res.headers.get("location") ?? "?"} (HTTP ${res.status}) for ${url}`, res.status);
      if (res.ok) return await res.text();
      lastErr = new FetchError(`HTTP ${res.status} for ${url}`, res.status);
      if (res.status !== 429 && res.status < 500) throw lastErr;
      delay = retryAfterMs(res);
    } catch (e) {
      // Our own verdicts (redirect, 4xx) are final; anything else is the network and is retried.
      if (e instanceof FetchError && e.status !== undefined && e.status !== 429 && e.status < 500) throw e;
      lastErr = e;
    }
    if (attempt < retries) await sleep(delay ?? baseDelayMs * 2 ** attempt * (0.5 + Math.random()));
  }
  throw lastErr instanceof Error ? describe(lastErr, url) : new FetchError(String(lastErr));
}

/** Node reports every network failure as "fetch failed"; the useful part (ECONNRESET, ETIMEDOUT, …) is the cause. */
function describe(e: Error, url: string): Error {
  if (e instanceof FetchError) return e;
  const cause = (e as { cause?: { code?: string; message?: string } }).cause;
  const detail = cause?.code ?? cause?.message;
  return detail ? new FetchError(`${e.message}: ${detail} for ${url}`) : e;
}

/** GET (or POST a form) and return the HTML/text body. */
export async function fetchText(url: string, opts: FetchTextOptions = {}): Promise<string> {
  return fetchBody(url, "text/html,*/*;q=0.8", opts);
}

/** POST a JSON body (ASP.NET page methods such as `Cities.aspx/GetSiteCities`) and parse the JSON answer. */
export async function fetchJsonPost(url: string, body: unknown, opts: FetchTextOptions = {}): Promise<unknown> {
  const text = await fetchBody(url, "application/json, text/javascript, */*;q=0.1", {
    ...opts,
    method: "POST",
    body: JSON.stringify(body ?? {}),
    headers: { "content-type": "application/json; charset=utf-8", ...opts.headers },
  });
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new FetchError(`expected JSON for ${url} but got: ${text.slice(0, 80)}`, 422);
  }
}
