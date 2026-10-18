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
