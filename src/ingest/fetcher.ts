import { SOURCE } from "./source";

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FetchOptions {
  retries?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * GET JSON with timeout + exponential backoff with jitter.
 * Retries on network errors, 429 and 5xx; fails fast on other 4xx.
 */
export async function fetchJson(pathOrUrl: string, opts: FetchOptions = {}): Promise<unknown> {
  const { retries = 4, timeoutMs = 30_000, baseDelayMs = 1000, fetchImpl = fetch } = opts;
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${SOURCE.apiUrl}${pathOrUrl}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, {
        headers: { accept: "application/json", "user-agent": "nuca-land-assistant/1.0 (personal, read-only)" },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if (res.ok) return await res.json();
      const retryable = res.status === 429 || res.status >= 500;
      lastErr = new FetchError(`HTTP ${res.status} for ${url}`, res.status);
      if (!retryable) throw lastErr;
      const retryAfter = Number(res.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        await sleep(Math.min(retryAfter * 1000, 120_000));
        continue;
      }
    } catch (e) {
      if (e instanceof FetchError && e.status && e.status < 500 && e.status !== 429) throw e;
      lastErr = e;
    }
    if (attempt < retries) {
      const delay = baseDelayMs * 2 ** attempt * (0.5 + Math.random());
      await sleep(delay);
    }
  }
  throw lastErr instanceof Error ? lastErr : new FetchError(String(lastErr));
}
