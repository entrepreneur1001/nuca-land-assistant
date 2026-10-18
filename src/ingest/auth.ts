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
}

/**
 * OAuth2 refresh-token flow against the source's OpenIddict server.
 * OpenIddict rotates refresh tokens, so every new one is written back to the store.
 */
export function createTokenProvider(store: TokenStore, opts: TokenOptions = {}): TokenProvider {
  const { clientId = "NucaApp_App", staticToken, seedRefreshToken, fetchImpl = fetch, now = Date.now } = opts;
  let cached: { token: string; expiresAt: number } | null = null;

  return {
    async get() {
      if (staticToken) return staticToken;
      if (cached && now() < cached.expiresAt) return cached.token;
      // The stored (rotated) token first; a freshly set secret wins if the stored one went stale.
      const candidates = [...new Set([await store.getRefreshToken(), seedRefreshToken].filter((t): t is string => !!t))];
      if (!candidates.length) throw new FetchError("source requires auth: set the SOURCE_REFRESH_TOKEN secret", 401);
      let failure = "";
      for (const refresh of candidates) {
        const res = await fetchImpl(`${SOURCE.apiUrl}/connect/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: refresh }),
          signal: AbortSignal.timeout(30_000),
        });
        const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
        if (!res.ok || !body.access_token) {
          failure = `HTTP ${res.status}${body.error ? `, ${body.error}` : ""}`;
          continue;
        }
        if (body.refresh_token && body.refresh_token !== refresh) await store.putRefreshToken(body.refresh_token);
        // Refresh a minute early so a long full sync never sends an expired token.
        cached = { token: body.access_token, expiresAt: now() + Math.max(0, (body.expires_in ?? 3600) - 60) * 1000 };
        return cached.token;
      }
      throw new FetchError(`token refresh failed (${failure}): update the SOURCE_REFRESH_TOKEN secret`, 401);
    },
    invalidate() {
      cached = null;
    },
  };
}
