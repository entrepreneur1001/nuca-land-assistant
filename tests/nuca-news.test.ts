import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { OfficialNewsItem } from "@/data/snapshot";
import { fetchOfficialNews, htmlToText, isQueueNews, mergeOfficialNews, normalizeArabic, parseNewsList, parseNewsText } from "@/ingest/nuca-news";

const fixture = (name: string) => readFileSync(path.resolve(__dirname, "fixtures/official", name), "utf8");
const ERROR_PAGE = `<!DOCTYPE html><html><head><title>Error</title></head><body><h1>Server Error in '/' Application.</h1><p>Runtime Error</p></body></html>`;

describe("official news list parser", () => {
  const items = parseNewsList(fixture("newslist.html"));
  const byNid = new Map(items.map((i) => [i.nid, i]));

  it("finds the 10 items in page order with their dates", () => {
    expect(items.map((i) => i.nid)).toEqual([9117, 9116, 9114, 9113, 9112, 9111, 9110, 9109, 9108, 9107]);
    expect(items.map((i) => i.day)).toEqual([
      "2026-11-08", "2026-11-07", "2026-11-06", "2026-11-05", "2026-11-04", "2026-11-03", "2026-11-03", "2026-11-02", "2026-11-02", "2026-11-01",
    ]);
    expect(byNid.get(9117)!.title).toBe("تم الانتهاء من تسجيلات اليوم حتى مسلسل 10000");
    expect(byNid.get(9113)!.title).toBe("تنويه");
  });

  it("decodes the briefs: no tags, no entities, no trailing dots, at most 300 chars", () => {
    for (const i of items) {
      if (i.text == null) continue;
      expect(i.text).not.toMatch(/&nbsp;|&[a-z#0-9]+;|<|>| /);
      expect(i.text).not.toMatch(/\.\.\.$/);
      expect(i.text.length).toBeLessThanOrEqual(300);
      expect(i.text).not.toBe(i.title);
    }
    expect(byNid.get(9117)!.text).toBe(
      "تم الانتهاء من التسجيلات حتى مسلسل 10000 وسيتم استئناف التسجيل غدا الاثنين الموافق 09/11/2026 الساعه 10 صباحا بدء من مسلسل 10001 حتى مسلسل 10700",
    );
    expect(byNid.get(9114)!.text).toContain("«بيت الوطن»");
    expect(byNid.get(9107)!.text).toBeUndefined(); // the brief is just "..."
  });

  it("extracts the served serial and the next batch", () => {
    const facts = (nid: number) => {
      const { servedThrough, next } = byNid.get(nid)!;
      return { servedThrough, next };
    };
    expect(facts(9117)).toEqual({ servedThrough: 10000, next: { from: 10001, to: 10700, day: "2026-11-09", hour: 10 } });
    expect(facts(9116)).toEqual({ servedThrough: undefined, next: { from: 9301, to: 10000, day: "2026-11-08", hour: 10 } });
    expect(facts(9113)).toEqual({ servedThrough: undefined, next: { from: 9001, to: 9300, day: "2026-11-05", hour: 12 } });
    expect(facts(9112)).toEqual({ servedThrough: 9000, next: { from: 9001, to: 9300, day: "2026-11-05", hour: 11 } });
    expect(facts(9110)).toEqual({ servedThrough: 8700, next: { from: 8701, to: 9000, day: "2026-11-04", hour: 11 } });
    expect(facts(9109)).toEqual({ servedThrough: 8400, next: { from: 8401, to: null, day: "2026-11-03", hour: 11 } });
    expect(facts(9108)).toEqual({ servedThrough: 8100, next: { from: 8101, to: null, day: "2026-11-02", hour: 11 } });
    for (const nid of [9114, 9111, 9107]) {
      expect(byNid.get(nid)).not.toHaveProperty("servedThrough");
      expect(byNid.get(nid)).not.toHaveProperty("next");
      expect(isQueueNews(byNid.get(nid)!)).toBe(false);
    }
    expect(items.filter(isQueueNews).map((i) => i.nid)).toEqual([9117, 9116, 9113, 9112, 9110, 9109, 9108]);
  });

  it("produces Firestore-safe objects (no undefined values)", () => {
    expect(JSON.parse(JSON.stringify(items))).toEqual(items);
    for (const i of items) for (const v of Object.values(i)) expect(v).not.toBeUndefined();
  });

  it("reads the homepage's latest-news block too", () => {
    const home = parseNewsList(fixture("home.html"));
    expect(home.map((i) => i.nid)).toEqual([9117, 9116, 9114]);
    expect(home[0]).toEqual(items[0]);
    expect(home[1].next).toEqual({ from: 9301, to: 10000, day: "2026-11-08", hour: 10 });
  });

  it("returns [] for the error page and other non-news HTML", () => {
    expect(parseNewsList(ERROR_PAGE)).toEqual([]);
    expect(parseNewsList("")).toEqual([]);
    expect(parseNewsList("<html><body>nothing</body></html>")).toEqual([]);
    expect(parseNewsList(fixture("zone-available.html"))).toEqual([]);
  });
});

describe("htmlToText / normalizeArabic", () => {
  it("strips tags, decodes entities, collapses whitespace and drops a trailing ellipsis", () => {
    expect(htmlToText('<p style="x">a&nbsp; <b>b</b>&amp;&lt;&gt;&quot;&#39;&laquo;c&raquo;&#1575;&#x627;</p>...')).toBe("a b &<>\"'«c»اا");
    expect(htmlToText("  x  …")).toBe("x");
    expect(htmlToText("<div></div>")).toBe("");
    expect(htmlToText('<p>text.</p><div><span style="font-si')).toBe("text."); // brief cut mid-tag by the site
  });

  it("maps digits and letter variants for matching", () => {
    expect(normalizeArabic("١٠٠٠١ حتى ١٠٧٠٠ ۱۲")).toBe("10001 حتي 10700 12");
    expect(normalizeArabic("أإآ ى ة ـــ مَسْلسل")).toBe("ااا ي ه مسلسل");
  });
});

describe("parseNewsText", () => {
  const day = "2026-11-08";

  it("prefers «غدا» over an explicit date that is not after the item day (NUCA typo seen on 9 Nov 2026)", () => {
    const r = parseNewsText("تم الانتهاء من التسجيلات حتى مسلسل 10700", "وسيتم استئناف التسجيل غدا الثلاثاء الموافق 09/11/2026 الساعه 10 صباحا بدء من مسلسل 10701 حتى مسلسل", "2026-11-09");
    expect(r).toEqual({ servedThrough: 10700, next: { from: 10701, to: null, day: "2026-11-10", hour: 10 } });
  });

  it("accepts حتي / حتى, a glued «بدء9001» and a missing «مسلسل»", () => {
    expect(parseNewsText("تم الانتهاء من التسجيلات حتى 8100", "", day)).toEqual({ servedThrough: 8100 });
    expect(parseNewsText("تم الانتهاء من التسجيلات حتي مسلسل 8100", "", day)).toEqual({ servedThrough: 8100 });
    expect(parseNewsText("تنويه", "سيتم بدا التخصيص اليوم فى تمام الساعه 12 ظهرا بدء9001 حتى 9300", day)).toEqual({
      next: { from: 9001, to: 9300, day, hour: 12 },
    });
    expect(parseNewsText("", "استئناف التسجيل غدا بدء من 500 الي 800", day)).toEqual({ next: { from: 500, to: 800, day: "2026-11-09", hour: null } });
  });

  it("reads explicit dates in D/MM/YYYY, YYYY/MM/D and DD/MM/YYYY, preferring the one after «الموافق»", () => {
    expect(parseNewsText("", "استئناف التسجيل غدا الخميس الموافق 5/11/2026 بدء من مسلسل 9001", "2026-11-04").next!.day).toBe("2026-11-05");
    expect(parseNewsText("البدء غدا الاحد الموافق 2026/11/8 استئناف التسجيلات بدءا من مسلسل 9301 حتي مسلسل 10000", "", "2026-11-07").next).toEqual({
      from: 9301, to: 10000, day: "2026-11-08", hour: null,
    });
    expect(parseNewsText("", "استئناف التسجيل غدا الاثنين الموافق 09/11/2026 بدء من مسلسل 10001", day).next!.day).toBe("2026-11-09");
    expect(parseNewsText("", "بناء على قرار 12/3/2024 يتم استئناف التسجيل الموافق 10-11-2026 بدء من مسلسل 10001", day).next!.day).toBe("2026-11-10");
  });

  it("falls back to غدا / اليوم when no date is written, and rejects far or past dates", () => {
    expect(parseNewsText("", "استئناف التسجيل غدا بدء من مسلسل 10001", day).next!.day).toBe("2026-11-09");
    expect(parseNewsText("", "استئناف التسجيل بكره بدء من مسلسل 10001", day).next!.day).toBe("2026-11-09");
    expect(parseNewsText("", "استئناف التسجيل اليوم بدء من مسلسل 10001", day).next!.day).toBe(day);
    expect(parseNewsText("", "استئناف التسجيل بدء من مسلسل 10001", day).next!.day).toBeNull();
    expect(parseNewsText("", "استئناف التسجيل الموافق 01/11/2026 بدء من مسلسل 10001", day).next!.day).toBeNull(); // before the item
    expect(parseNewsText("", "استئناف التسجيل الموافق 20/11/2026 بدء من مسلسل 10001", day).next!.day).toBeNull(); // > 7 days ahead
    expect(parseNewsText("", "استئناف التسجيل الموافق 15/11/2026 بدء من مسلسل 10001", day).next!.day).toBe("2026-11-15"); // exactly 7 days
  });

  it("converts hours: 10 صباحا, 11 ظهرا, 12 ظهرا, 1 ظهرا, 12 صباحا, none", () => {
    const hour = (s: string) => parseNewsText("", `استئناف التسجيل غدا ${s} بدء من مسلسل 10001`, day).next!.hour;
    expect(hour("الساعه 10 صباحا")).toBe(10);
    expect(hour("الساعة 11 ظهرا")).toBe(11);
    expect(hour("الساعه 12 ظهرا")).toBe(12);
    expect(hour("الساعه 1 ظهرا")).toBe(13);
    expect(hour("الساعه 3 عصرا")).toBe(15);
    expect(hour("الساعه 12 صباحا")).toBe(0);
    expect(hour("الساعه 10:30 ص")).toBe(10);
    expect(hour("")).toBeNull();
  });

  it("copes with stray no-break spaces and Arabic-Indic digits", () => {
    expect(parseNewsText("", "تم الانتهاء  من التسجيلات حتى مسلسل   8400  وسيتم استئناف التسجيل غدا بدء من مسلسل   8401 ", "2026-11-02")).toEqual({
      servedThrough: 8400,
      next: { from: 8401, to: null, day: "2026-11-03", hour: null },
    });
    expect(parseNewsText("", "استئناف التسجيل غدا بدء من مسلسل ١٠٠٠١ حتى ١٠٧٠٠", day).next).toEqual({ from: 10001, to: 10700, day: "2026-11-09", hour: null });
  });

  it("ignores unrelated text, implausible ranges and small serials", () => {
    expect(parseNewsText("عدد الوحدات السكنية المسموح بتنفيذها", "قطع الأراضي تبدأ من 550 م² حتى 1000 م²", day)).toEqual({});
    expect(parseNewsText("إتاحة السداد النقدي الكامل", "يواصل جهاز المدينة أعمال تسليم قطع أراضي المرحلة العاشرة", day)).toEqual({});
    expect(parseNewsText("", "استئناف التسجيل غدا بدء من مسلسل 10001 حتى مسلسل 90000", day).next!.to).toBeNull(); // > 5000 codes
    expect(parseNewsText("", "استئناف التسجيل غدا بدء من مسلسل 10001 حتى مسلسل 9000", day).next!.to).toBeNull(); // to < from
    expect(parseNewsText("", "استئناف التسجيل غدا بدء من مسلسل 50", day)).toEqual({});
  });
});

describe("mergeOfficialNews", () => {
  const item = (nid: number, title = `n${nid}`): OfficialNewsItem => ({ nid, day: "2026-11-01", title });

  it("unions by NID with fresh winning, sorts newest first, trims and reports additions", () => {
    const prev = [item(5), item(4), item(3)];
    const fresh = [item(6), item(5, "updated"), item(2)];
    const { items, added } = mergeOfficialNews(prev, fresh);
    expect(items.map((i) => i.nid)).toEqual([6, 5, 4, 3, 2]);
    expect(items[1].title).toBe("updated");
    expect(added).toEqual([item(6), item(2)]);
    expect(mergeOfficialNews(prev, fresh, 3).items.map((i) => i.nid)).toEqual([6, 5, 4]);
    expect(mergeOfficialNews(prev, []).added).toEqual([]);
    expect(mergeOfficialNews(undefined, fresh).added.map((i) => i.nid)).toEqual([6, 5, 2]);
    expect(mergeOfficialNews(null, fresh).items.map((i) => i.nid)).toEqual([6, 5, 2]);
  });
});

describe("fetchOfficialNews", () => {
  const response = (status: number, body = "", headers: Record<string, string> = {}) => new Response(body, { status, headers });
  const news = fixture("newslist.html");

  it("rejects when nothing parses (the site's error page comes back with 200)", async () => {
    const fetchImpl = (async () => response(200, ERROR_PAGE)) as unknown as typeof fetch;
    await expect(fetchOfficialNews({ url: "https://example.test/news", fetchImpl, retryDelayMs: 0 })).rejects.toThrow(/no items parsed \(\d+ bytes\)/);
  });

  it("retries once after a 5xx and succeeds", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      expect((init?.headers as Record<string, string>).accept).toBe("text/html");
      expect(init?.redirect).toBe("manual");
      return calls.length === 1 ? response(503) : response(200, news);
    }) as unknown as typeof fetch;
    const items = await fetchOfficialNews({ url: "https://example.test/news", fetchImpl, retryDelayMs: 0 });
    expect(items).toHaveLength(10);
    expect(calls).toEqual(["https://example.test/news", "https://example.test/news"]);
  });

  it("retries once after a network error", async () => {
    let n = 0;
    const fetchImpl = (async () => (++n === 1 ? Promise.reject(new TypeError("fetch failed")) : response(200, news))) as unknown as typeof fetch;
    await expect(fetchOfficialNews({ url: "https://example.test/news", fetchImpl, retryDelayMs: 0 })).resolves.toHaveLength(10);
    expect(n).toBe(2);
  });

  it("gives up after the second failure", async () => {
    let n = 0;
    const fetchImpl = (async () => (n++, response(503))) as unknown as typeof fetch;
    await expect(fetchOfficialNews({ url: "https://example.test/news", fetchImpl, retryDelayMs: 0 })).rejects.toThrow(/HTTP 503/);
    expect(n).toBe(2);
  });

  it("treats a redirect as a failure without retrying", async () => {
    let n = 0;
    const fetchImpl = (async () => (n++, response(302, "", { location: "/ar/ErrorPage.aspx" }))) as unknown as typeof fetch;
    await expect(fetchOfficialNews({ url: "https://example.test/news", fetchImpl, retryDelayMs: 0 })).rejects.toThrow(/redirected \(HTTP 302\).*ErrorPage/);
    expect(n).toBe(1);
  });
});
