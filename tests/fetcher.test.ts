import { describe, expect, it } from "vitest";
import { createTokenProvider } from "@/ingest/auth";
import { FetchError, fetchJson } from "@/ingest/fetcher";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const loginRedirect = () => new Response(null, { status: 302, headers: { location: "/Account/Login?ReturnUrl=%2Fapi" } });

function tokenServer() {
  let n = 0;
  const calls: string[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const refresh = new URLSearchParams(String(init?.body)).get("refresh_token")!;
    calls.push(refresh);
    if (refresh === "dead") return json({ error: "invalid_grant" }, 400);
    n++;
    return json({ access_token: `at${n}`, refresh_token: `rt${n}`, expires_in: 3600 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function memTokens(initial: string | null) {
  let t = initial;
  return { getRefreshToken: async () => t, putRefreshToken: async (v: string) => void (t = v), get current() { return t; } };
}

describe("token provider", () => {
  it("exchanges the refresh token, persists the rotated one and caches the access token", async () => {
    const srv = tokenServer();
    const store = memTokens("rt0");
    const p = createTokenProvider(store, { fetchImpl: srv.fetchImpl });
    expect(await p.get()).toBe("at1");
    expect(await p.get()).toBe("at1");
    expect(store.current).toBe("rt1");
    p.invalidate();
    expect(await p.get()).toBe("at2");
    expect(srv.calls).toEqual(["rt0", "rt1"]);
  });

  it("falls back to the seed secret when the stored token is stale", async () => {
    const srv = tokenServer();
    const store = memTokens("dead");
    const p = createTokenProvider(store, { fetchImpl: srv.fetchImpl, seedRefreshToken: "fresh" });
    expect(await p.get()).toBe("at1");
    expect(store.current).toBe("rt1");
  });

  it("fails clearly when no token works", async () => {
    const p = createTokenProvider(memTokens("dead"), { fetchImpl: tokenServer().fetchImpl });
    await expect(p.get()).rejects.toThrow(/SOURCE_REFRESH_TOKEN/);
    await expect(createTokenProvider(memTokens(null)).get()).rejects.toThrow(/SOURCE_REFRESH_TOKEN/);
  });

  /** Token endpoint that answers the first `outages` calls with the given failure, then works. */
  function flakyServer(outages: number, fail: () => Response | Promise<never>) {
    let calls = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls++;
      if (calls <= outages) return fail();
      const refresh = new URLSearchParams(String(init?.body)).get("refresh_token")!;
      return json({ access_token: `at-${refresh}`, refresh_token: `rt-${calls}`, expires_in: 3600 });
    }) as typeof fetch;
    return { fetchImpl, get calls() { return calls; } };
  }
  const noSleep = async () => {};

  it("retries the token endpoint after a 503 and a network error, then succeeds", async () => {
    const srv = flakyServer(2, () => (srv.calls === 1 ? json({ error: "temporarily_unavailable" }, 503) : Promise.reject(new Error("ECONNRESET"))));
    const store = memTokens("rt0");
    const p = createTokenProvider(store, { fetchImpl: srv.fetchImpl, seedRefreshToken: "seed", sleep: noSleep });
    expect(await p.get()).toBe("at-rt0");
    expect(srv.calls).toBe(3);
    expect(store.current).toBe("rt-3");
  });

  it("does not retry a rejected token; moves straight to the next candidate", async () => {
    const srv = tokenServer();
    const p = createTokenProvider(memTokens("dead"), { fetchImpl: srv.fetchImpl, seedRefreshToken: "fresh", sleep: noSleep });
    expect(await p.get()).toBe("at1");
    expect(srv.calls).toEqual(["dead", "fresh"]);
  });

  it("gives up on an outage without blaming the secret, and leaves the seed token untouched", async () => {
    const srv = flakyServer(99, () => json({}, 503));
    const p = createTokenProvider(memTokens("rt0"), { fetchImpl: srv.fetchImpl, seedRefreshToken: "seed", retries: 2, sleep: noSleep });
    const err = await p.get().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect(String(err)).toMatch(/HTTP 503.*unavailable/);
    expect(String(err)).not.toMatch(/update the SOURCE_REFRESH_TOKEN/);
    expect((err as FetchError).status).toBe(503);
    expect(srv.calls).toBe(3); // 1 + 2 retries for the stored token only; the seed is never spent on an outage
  });

  it("shares one exchange between parallel callers so a single-use refresh token is spent once", async () => {
    const srv = tokenServer();
    const p = createTokenProvider(memTokens("rt0"), { fetchImpl: srv.fetchImpl });
    const tokens = await Promise.all([p.get(), p.get(), p.get()]);
    expect(tokens).toEqual(["at1", "at1", "at1"]);
    expect(srv.calls).toEqual(["rt0"]);
  });
});

describe("fetchJson auth", () => {
  const opts = { retries: 0, baseDelayMs: 0 };

  it("sends the bearer token", async () => {
    let seen: string | undefined;
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      seen = (init?.headers as Record<string, string>).authorization;
      return json({ ok: 1 });
    }) as typeof fetch;
    const auth = { get: async () => "tok", invalidate() {} };
    expect(await fetchJson("/x", { ...opts, fetchImpl, auth })).toEqual({ ok: 1 });
    expect(seen).toBe("Bearer tok");
  });

  it("re-authenticates once after a login redirect", async () => {
    let calls = 0;
    let invalidated = 0;
    const fetchImpl = (async () => (++calls === 1 ? loginRedirect() : json({ ok: 1 }))) as unknown as typeof fetch;
    const auth = { get: async () => "tok", invalidate: () => void invalidated++ };
    expect(await fetchJson("/x", { ...opts, fetchImpl, auth })).toEqual({ ok: 1 });
    expect(invalidated).toBe(1);
  });

  it("fails with a clear auth error instead of a JSON parse error", async () => {
    const fetchImpl = (async () => loginRedirect()) as unknown as typeof fetch;
    await expect(fetchJson("/x", { ...opts, fetchImpl })).rejects.toThrow(/requires auth/);
    const auth = { get: async () => "tok", invalidate() {} };
    await expect(fetchJson("/x", { ...opts, fetchImpl, auth })).rejects.toThrow(/token rejected/);
  });

  it("rejects HTML bodies", async () => {
    const fetchImpl = (async () => new Response("<!DOCTYPE html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const err = (await fetchJson("/x", { ...opts, fetchImpl }).catch((e) => e)) as FetchError;
    expect(err).toBeInstanceOf(FetchError);
    expect(err.message).toMatch(/expected JSON/);
  });
});
