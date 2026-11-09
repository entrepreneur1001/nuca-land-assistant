import { describe, expect, it } from "vitest";
import { ParseError, crawlZone, crawlZones, createClient, discoverZones, parseZonePage } from "@/ingest/nuca-plots";
import { officialUrl } from "@/ingest/official";
import { createFakeSite, genPlots, type FakeSiteData } from "./fake-site";

const data = (): FakeSiteData => ({
  cities: [
    { id: 1, name: "القاهرة الجديدة" },
    { id: 24, name: "أكتوبر الجديدة" },
  ],
  projects: {
    1262: { cityId: 1, name: "المرحلة الحادية عشر - الحى الرابع", green: true, zones: [3624, 3625] },
    2284: { cityId: 1, name: "المرحلة الحادية عشر - الامتداد الجنوبى", green: true, zones: [4797, 3625] },
    57: { cityId: 1, name: "مرحلة قديمة", green: false, zones: [100] },
    9: { cityId: 24, name: "الحي الأول", green: true, zones: [9] },
  },
  zones: {
    3624: { name: "الحى الرابع - منطقة (N)", egpPerM: 25800, plots: [] },
    3625: { name: "الحى الرابع - منطقة ( Q )", egpPerM: 25800, plots: genPlots(28, { square: ["بيت الوطن Q", "بيت الوطن Q2"] }) },
    4797: { name: "الامتداد الجنوبى", egpPerM: 23455, plots: genPlots(759, { square: "الامتداد الجنوبى بالقرب من ديستركت 5" }) },
    100: { name: "منطقة مغلقة", egpPerM: null, plots: genPlots(5) },
    9: { name: "الحي الأول", egpPerM: 7725, plots: [...genPlots(25, { status: () => "booked" }), ...genPlots(10, { start: 1000 })] },
  },
});

const site = (opts?: Parameters<typeof createFakeSite>[1]) => {
  const s = createFakeSite(data(), opts);
  return { site: s, client: createClient(s.fetchHtml) };
};

describe("crawlZone", () => {
  it("walks every page of the available view", async () => {
    const { site: s, client } = site();
    const c = await crawlZone(client, 3625, "available");
    expect(c).toMatchObject({ zid: 3625, view: "available", ok: true, pages: 2, egpPerM: 25800 });
    expect(c.rows).toHaveLength(28);
    expect(c.rows.filter((r) => r.status === "held")).toHaveLength(10);
    expect(c.rows.filter((r) => r.status === "free")).toHaveLength(18);
    expect(c.rows[0]).toMatchObject({ square: "بيت الوطن Q", plotNo: "1", area: 500, basePpm: 450, corner: 10, ppm: 495, total: 247500, dp: 61875, status: "held" });
    expect(s.requests.map((r) => `${r.method} ${r.argument ?? ""}`.trim())).toEqual(["GET", "POST Page$2"]);
    expect(s.requests[1].body?.get("ctl00$MainContent$PlotType")).toBe("rdShowAvailable");
    expect(s.requests[1].body?.get("ctl00$MainContent$txtPlotNumber")).toBe("");
  });

  it("crosses the pager's '...' boundaries (759 plots → 38 pages) and dedupes rows", async () => {
    const { site: s, client } = site();
    const c = await crawlZone(client, 4797, "available");
    expect(c.ok).toBe(true);
    expect(c.pages).toBe(38);
    expect(c.rows).toHaveLength(759);
    expect(new Set(c.rows.map((r) => `${r.square}|${r.plotNo}`)).size).toBe(759);
    expect(s.requests).toHaveLength(38);
    expect(s.requests.at(-1)?.argument).toBe("Page$38");
    expect(s.requests.map((r) => r.argument)).toEqual(expect.arrayContaining(["Page$10", "Page$11", "Page$20", "Page$21", "Page$30", "Page$31"]));
  });

  it("dedupes plots the site lists twice", async () => {
    const d = data();
    d.zones[3625].plots.push({ ...d.zones[3625].plots[0] });
    const s = createFakeSite(d);
    const c = await crawlZone(createClient(s.fetchHtml), 3625, "available");
    expect(c.ok).toBe(true);
    expect(c.rows).toHaveLength(28);
  });

  it("switches to the booked view with the radio postback, then pages", async () => {
    const { site: s, client } = site();
    const booked = await crawlZone(client, 9, "booked");
    expect(booked).toMatchObject({ ok: true, view: "booked", pages: 2 });
    expect(booked.rows).toHaveLength(25);
    expect(booked.rows.every((r) => r.status === "booked")).toBe(true);
    expect(s.requests.map((r) => [r.method, r.target, r.argument, r.body?.get("ctl00$MainContent$PlotType") ?? null])).toEqual([
      ["GET", null, null, null],
      ["POST", "ctl00$MainContent$rdShowBooked", "", "rdShowBooked"],
      ["POST", "ctl00$MainContent$grdPlots", "Page$2", "rdShowBooked"],
    ]);
    const avail = await crawlZone(client, 9, "available");
    expect(avail.rows).toHaveLength(10);
    expect(avail.rows.every((r) => r.status !== "booked")).toBe(true);
  });

  it("reports an empty zone as ok with no rows", async () => {
    const { client } = site();
    const c = await crawlZone(client, 3624, "available");
    expect(c).toMatchObject({ ok: true, rows: [], pages: 1, egpPerM: 25800 });
    const b = await crawlZone(client, 3624, "booked");
    expect(b).toMatchObject({ ok: true, rows: [], pages: 1 });
  });

  it("restarts from a fresh GET after one failed page and succeeds", async () => {
    const { site: s, client } = site();
    s.failOnce((r) => r.argument === "Page$2", "503");
    const c = await crawlZone(client, 3625, "available");
    expect(c.ok).toBe(true);
    expect(c.rows).toHaveLength(28);
    expect(s.requests.map((r) => r.argument ?? "GET")).toEqual(["GET", "Page$2", "GET", "Page$2"]);
  });

  it("recovers from a connection reset and from a redirect to the error page", async () => {
    const { site: s, client } = site();
    s.failOnce(officialUrl.zone(3625), "reset");
    expect((await crawlZone(client, 3625, "available")).ok).toBe(true);
    s.failOnce(officialUrl.zone(3625), "302");
    expect((await crawlZone(client, 3625, "available")).ok).toBe(true);
  });

  it("fails without partial rows after repeated failures", async () => {
    const { site: s, client } = site();
    s.failOnce((r) => r.argument === "Page$2", "503");
    s.failOnce((r) => r.argument === "Page$2", "503");
    const c = await crawlZone(client, 3625, "available");
    expect(c).toMatchObject({ ok: false, rows: [], pages: 0, egpPerM: null });
    expect(c.error).toMatch(/503/);
  });

  it("treats a page without the table as a failure", async () => {
    const { site: s, client } = site();
    s.failOnce(officialUrl.zone(3625), "no-table");
    expect((await crawlZone(client, 3625, "available")).ok).toBe(true);
    s.failOnce(officialUrl.zone(3625), "no-table");
    s.failOnce(officialUrl.zone(3625), "no-table");
    const c = await crawlZone(client, 3625, "available");
    expect(c.ok).toBe(false);
    expect(c.rows).toEqual([]);
    expect(c.error).toMatch(/grdPlots/);
  });

  it("stops at maxPages", async () => {
    const { client } = site();
    const c = await crawlZone(client, 4797, "available", { maxPages: 3 });
    expect(c.ok).toBe(true);
    expect(c.pages).toBe(3);
    expect(c.rows).toHaveLength(60);
  });
});

describe("fake site postback validation", () => {
  it("answers a postback with stale or forged state with the error page", async () => {
    const { client } = site();
    const url = officialUrl.zone(4797);
    const p1 = parseZonePage(await client.get(url));
    // a page the pager on page 1 does not link to
    expect(() => parseZonePage("")).toThrow(ParseError);
    await expect(client.postback(url, p1.hidden, "ctl00$MainContent$grdPlots", "Page$15", { "ctl00$MainContent$PlotType": "rdShowAvailable" }).then(parseZonePage)).rejects.toThrow(ParseError);
    // the wrong radio value for the current view
    await expect(client.postback(url, p1.hidden, "ctl00$MainContent$grdPlots", "Page$2", { "ctl00$MainContent$PlotType": "rdShowBooked" }).then(parseZonePage)).rejects.toThrow(ParseError);
    // a missing event validation
    const noValidation = { ...p1.hidden };
    delete noValidation.__EVENTVALIDATION;
    await expect(client.postback(url, noValidation, "ctl00$MainContent$grdPlots", "Page$2", { "ctl00$MainContent$PlotType": "rdShowAvailable" }).then(parseZonePage)).rejects.toThrow(ParseError);
    // the right one works
    expect(parseZonePage(await client.postback(url, p1.hidden, "ctl00$MainContent$grdPlots", "Page$2", { "ctl00$MainContent$PlotType": "rdShowAvailable" })).rows).toHaveLength(20);
  });
});

describe("crawlZones", () => {
  it("runs at most `concurrency` zones at once and returns every zone", async () => {
    const { site: s, client } = site({ latencyMs: 2 });
    const out = await crawlZones(client, [3625, 9, 3624, 100], ["available"], { concurrency: 2, budgetMs: 60_000 });
    expect([...out.keys()].sort((a, b) => a - b)).toEqual([9, 100, 3624, 3625]);
    expect(s.maxInFlight).toBe(2);
    expect(out.get(3625)?.[0].rows).toHaveLength(28);
  });

  it("stops starting zones once the budget is spent; unstarted zones are absent", async () => {
    const { client } = site();
    let t = 0;
    const now = () => (t += 1000);
    const out = await crawlZones(client, [3625, 9, 3624, 100], ["available"], { concurrency: 1, budgetMs: 2500, now });
    expect([...out.keys()]).toEqual([3625, 9]);
  });

  it("runs both views for each zone when asked", async () => {
    const { client } = site();
    const logs: unknown[][] = [];
    const out = await crawlZones(client, [9, 3624], ["available", "booked"], { concurrency: 2, budgetMs: 60_000, log: (...a) => void logs.push(a) });
    expect(out.get(9)?.map((c) => [c.view, c.ok, c.rows.length])).toEqual([
      ["available", true, 10],
      ["booked", true, 25],
    ]);
    expect(out.get(3624)?.map((c) => [c.view, c.ok, c.rows.length])).toEqual([
      ["available", true, 0],
      ["booked", true, 0],
    ]);
    expect(logs).toHaveLength(4);
  });

  it("keeps a failed zone in the result with ok=false", async () => {
    const { site: s, client } = site();
    s.failOnce(officialUrl.zone(9), "503");
    s.failOnce(officialUrl.zone(9), "503");
    const out = await crawlZones(client, [9, 3625], ["available"], { concurrency: 1, budgetMs: 60_000 });
    expect(out.get(9)?.[0]).toMatchObject({ ok: false, rows: [] });
    expect(out.get(3625)?.[0].ok).toBe(true);
  });
});

describe("discoverZones", () => {
  it("returns the zones of green projects only, deduped by zid", async () => {
    const { site: s, client } = site();
    const zones = await discoverZones(client, s.fetchJsonPost);
    expect(zones.map((z) => z.zid).sort((a, b) => a - b)).toEqual([9, 3624, 3625, 4797]);
    expect(zones.find((z) => z.zid === 3625)).toEqual({ zid: 3625, pid: 1262, cityId: 1, cityName: "القاهرة الجديدة", name: "الحى الرابع - منطقة ( Q )" });
    expect(zones.find((z) => z.zid === 9)).toMatchObject({ pid: 9, cityId: 24, cityName: "أكتوبر الجديدة" });
    expect(zones.some((z) => z.zid === 100)).toBe(false);
    const urls = s.requests.map((r) => r.url);
    expect(urls[0]).toBe(officialUrl.cities());
    expect(urls).toContain(officialUrl.city(1));
    expect(urls).toContain(officialUrl.project(1262));
    expect(urls).not.toContain(officialUrl.project(57));
  });

  it("propagates a failure so the caller keeps its previous zone list", async () => {
    const { site: s, client } = site();
    s.failOnce(officialUrl.city(1), "503");
    await expect(discoverZones(client, s.fetchJsonPost)).rejects.toThrow(/503/);
  });
});
