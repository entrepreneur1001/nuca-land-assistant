import { FetchError } from "./fetcher";
import { SOURCE } from "./source";

/** Where the current refresh token lives (Firestore `private/sourceAuth` in production). */
export interface TokenStore {
  getRefreshToken(): Promise<string | null>;
  putRefreshToken(token: string): Promise<void>;
}

export interface TokenProvider {
  /** Cached access token, refreshed shortly before it expires. */
  get(): Promise<string>;
  /** Drop the cached access token (e.g. after the source rejected it). */
  invalidate(): void;
}

export interface TokenOptions {
  clientId?: string;
  /** A fixed access token (SOURCE_API_TOKEN) skips the refresh flow — handy for one-off manual runs. */
  staticToken?: string;
  /** Used when the store has no refresh token yet (first run after setting the secret). */
  seedRefreshToken?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Extra attempts per refresh token when the token endpoint is down (network error, 429, 5xx). */
  retries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface TokenBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}

/**
 * OAuth2 refresh-token flow against the source's OpenIddict server.
 * OpenIddict rotates refresh tokens, so every new one is written back to the store.
 * A token-endpoint outage (5xx / network) is retried with backoff like any other source call;
 * a rejected token (4xx, e.g. invalid_grant) is permanent for that token and moves on to the next candidate.
 */
export function createTokenProvider(store: TokenStore, opts: TokenOptions = {}): TokenProvider {
  const {
    clientId = "NucaApp_App",
    staticToken,
    seedRefreshToken,
    fetchImpl = fetch,
    now = Date.now,
    retries = 3,
    baseDelayMs = 1000,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  } = opts;
  let cached: { token: string; expiresAt: number } | null = null;
  // Parallel callers (the stats poll fires two requests at once) must share one exchange: refresh tokens are single-use.
  let inflight: Promise<string> | null = null;

  /** One refresh-token exchange with retries on transient failures. `rejected` means the token itself was refused. */
  async function exchange(refresh: string): Promise<{ body: TokenBody; status: number; rejected: boolean }> {
    let last: { body: TokenBody; status: number } = { body: {}, status: 0 };
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchImpl(`${SOURCE.apiUrl}/connect/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: refresh }),
          signal: AbortSignal.timeout(30_000),
        });
        const body = (await res.json().catch(() => ({}))) as TokenBody;
        last = { body, status: res.status };
        if (res.ok && body.access_token) return { ...last, rejected: false };
        const transient = res.status === 429 || res.status >= 500;
        if (!transient) return { ...last, rejected: true };
        const retryAfter = Number(res.headers.get("retry-after"));
        if (attempt < retries && Number.isFinite(retryAfter) && retryAfter > 0) {
          await sleep(Math.min(retryAfter * 1000, 120_000));
          continue;
        }
      } catch {
        last = { body: {}, status: 0 };
      }
      if (attempt < retries) await sleep(baseDelayMs * 2 ** attempt * (0.5 + Math.random()));
    }
    return { ...last, rejected: false };
  }

  return {
    async get() {
      if (staticToken) return staticToken;
      if (cached && now() < cached.expiresAt) return cached.token;
      if (!inflight) inflight = refresh().finally(() => void (inflight = null));
      return inflight;
    },
    invalidate() {
      cached = null;
    },
  };

  async function refresh(): Promise<string> {
    // The stored (rotated) token first; a freshly set secret wins if the stored one went stale.
    const candidates = [...new Set([await store.getRefreshToken(), seedRefreshToken].filter((t): t is string => !!t))];
    if (!candidates.length) throw new FetchError("source requires auth: set the SOURCE_REFRESH_TOKEN secret", 401);
    let failure = "";
    let anyRejected = false;
    for (const candidate of candidates) {
      const { body, status, rejected } = await exchange(candidate);
      if (!body.access_token) {
        failure = `${status ? `HTTP ${status}` : "network error"}${body.error ? `, ${body.error}` : ""}`;
        anyRejected ||= rejected;
        // The endpoint is down: trying the other candidate would not help, and would waste its single-use rotation.
        if (!rejected) break;
        continue;
      }
      if (body.refresh_token && body.refresh_token !== candidate) await store.putRefreshToken(body.refresh_token);
      // Refresh a minute early so a long full sync never sends an expired token.
      cached = { token: body.access_token, expiresAt: now() + Math.max(0, (body.expires_in ?? 3600) - 60) * 1000 };
      return cached.token;
    }
    const hint = anyRejected ? "update the SOURCE_REFRESH_TOKEN secret" : "source token endpoint unavailable, will retry next run";
    throw new FetchError(`token refresh failed (${failure}): ${hint}`, anyRejected ? 401 : 503);
  }
}
