import tls from "node:tls";
import { describe, expect, it } from "vitest";
import { FetchError, fetchJsonPost, fetchText } from "@/ingest/fetcher";

const html = (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
const redirect = () => new Response(null, { status: 302, headers: { location: "~/Error.aspx" } });

/** A fetch whose answers are taken from `script` in order; records calls and sleeps. */
function server(script: (() => Response | Promise<Response>)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const next = script.shift();
    if (!next) throw new Error("script exhausted");
    return next();
  }) as unknown as typeof fetch;
  const sleep = async (ms: number) => void sleeps.push(ms);
  return { fetchImpl, sleep, calls, sleeps, opts: { fetchImpl, sleep, baseDelayMs: 10 } };
}

describe("fetchText", () => {
  it("sends the browser-like headers and never follows redirects", async () => {
    const s = server([() => html("<p>hi</p>")]);
    expect(await fetchText("https://x/ar/ViewZone.aspx?ID=1", s.opts)).toBe("<p>hi</p>");
    const { init, url } = s.calls[0];
    expect(url).toBe("https://x/ar/ViewZone.aspx?ID=1");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const h = init.headers as Record<string, string>;
    expect(h.accept).toMatch(/^text\/html/);
    expect(h["accept-language"]).toBe("ar,en;q=0.5");
    expect(h["user-agent"]).toMatch(/nuca-land-assistant/);
  });

  it("retries a 503 then succeeds", async () => {
    const s = server([() => html("busy", 503), () => html("ok")]);
    expect(await fetchText("https://x/a", s.opts)).toBe("ok");
    expect(s.calls).toHaveLength(2);
    expect(s.sleeps).toHaveLength(1);
    expect(s.sleeps[0]).toBeGreaterThan(0);
  });

  it("treats a redirect as a failure and does not retry it", async () => {
    const s = server([redirect, () => html("never")]);
    const err = (await fetchText("https://x/a", s.opts).catch((e: unknown) => e)) as FetchError;
    expect(err).toBeInstanceOf(FetchError);
    expect(err.status).toBe(302);
    expect(err.message).toMatch(/redirected to ~\/Error\.aspx/);
    expect(s.calls).toHaveLength(1);
    expect(s.sleeps).toHaveLength(0);
  });

  it("fails fast on a 404", async () => {
    const s = server([() => html("gone", 404), () => html("never")]);
    const err = (await fetchText("https://x/a", s.opts).catch((e: unknown) => e)) as FetchError;
    expect(err).toBeInstanceOf(FetchError);
    expect(err.status).toBe(404);
    expect(s.calls).toHaveLength(1);
  });

  it("retries a network error", async () => {
    const s = server([() => Promise.reject(new TypeError("fetch failed")), () => html("ok")]);
    expect(await fetchText("https://x/a", s.opts)).toBe("ok");
    expect(s.calls).toHaveLength(2);
  });

  it("gives up after the configured retries with the last error", async () => {
    const s = server([() => html("busy", 503), () => html("busy", 503), () => Promise.reject(new TypeError("fetch failed"))]);
    const err = (await fetchText("https://x/a", { ...s.opts, retries: 2 }).catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/fetch failed/);
    expect(s.calls).toHaveLength(3);
    expect(s.sleeps).toHaveLength(2);
    // jittered exponential backoff: the second wait is drawn from a doubled base
    expect(s.sleeps[1]).toBeGreaterThanOrEqual(10);
    expect(s.sleeps[1]).toBeLessThanOrEqual(30);
  });

  it("honours retry-after (seconds, capped at 120 s)", async () => {
    const s = server([() => html("busy", 503, { "retry-after": "7" }), () => html("busy", 429, { "retry-after": "1000" }), () => html("ok")]);
    expect(await fetchText("https://x/a", s.opts)).toBe("ok");
    expect(s.sleeps).toEqual([7000, 120_000]);
  });
});

describe("fetchJsonPost", () => {
  it("POSTs a JSON body with the JSON content type and parses the answer", async () => {
    const s = server([() => new Response('{"d":"[1,2]"}', { headers: { "content-type": "application/json" } })]);
    expect(await fetchJsonPost("https://x/ar/Cities.aspx/GetSiteCities", { a: 1 }, s.opts)).toEqual({ d: "[1,2]" });
    const { init } = s.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    const h = init.headers as Record<string, string>;
    expect(h["content-type"]).toBe("application/json; charset=utf-8");
    expect(h.accept).toMatch(/application\/json/);
  });

  it("rejects a non-JSON answer with a FetchError", async () => {
    const s = server([() => html("<html>oops</html>")]);
    const err = (await fetchJsonPost("https://x/a", {}, s.opts).catch((e: unknown) => e)) as FetchError;
    expect(err).toBeInstanceOf(FetchError);
    expect(err.status).toBe(422);
  });

  it("retries a 503 like fetchText", async () => {
    const s = server([() => html("busy", 503), () => new Response("[1]", { headers: { "content-type": "application/json" } })]);
    expect(await fetchJsonPost("https://x/a", {}, s.opts)).toEqual([1]);
    expect(s.calls).toHaveLength(2);
  });
});

describe("TLS cap for the official site", () => {
  it("caps the default TLS version at 1.2 once the fetcher is imported", () => {
    expect(tls.DEFAULT_MAX_VERSION).toBe("TLSv1.2");
  });

  it("names the network error code instead of a bare 'fetch failed'", async () => {
    const failing = (async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    }) as unknown as typeof fetch;
    await expect(fetchText("https://x.test/", { fetchImpl: failing, retries: 0 })).rejects.toThrow(/fetch failed: ECONNRESET for https:\/\/x.test\//);
  });
});
