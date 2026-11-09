import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ParseError, createClient, decodeEntities, parseCitiesJson, parseCityPage, parseNum, parseProjectPage, parseZonePage } from "@/ingest/nuca-plots";
import { buildOfficialIndex, normalizeName, officialPlotId, type OfficialZoneEntry } from "@/ingest/official-map";

const fixture = (name: string) => readFileSync(path.resolve(__dirname, "fixtures/official", name), "utf8");

describe("parseZonePage", () => {
  it("reads the available view of zone 4797 (page 1 of 11)", () => {
    const p = parseZonePage(fixture("zone-available.html"));
    expect(p.rows).toHaveLength(20);
    expect(p.rows[0]).toEqual({
      square: "الامتداد الجنوبى بالقرب من ديستركت 5",
      plotNo: "10",
      area: 497.5,
      basePpm: 450,
      corner: 0,
      garden: 0,
      sea: 0,
      ppm: 450,
      total: 223875,
      dp: 55968.75,
      status: "held",
    });
    expect(p.empty).toBe(false);
    expect(p.view).toBe("available");
    expect(p.pages).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(p.egpPerM).toBe(23455);
    // the fixture had its >5000-char __VIEWSTATE line stripped; the other WebForms fields are there
    expect(p.hidden.__VIEWSTATEGENERATOR).toBe("D2B568B2");
    expect(p.hidden.__EVENTVALIDATION).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
    expect(p.hidden.__EVENTTARGET).toBe("");
    expect(p.hidden.__EVENTARGUMENT).toBe("");
    expect(p.hidden.__VIEWSTATEENCRYPTED).toBe("");
  });

  it("tells held from free plots and tolerates cells that wrap onto a new line", () => {
    const p = parseZonePage(fixture("zone-held.html"));
    expect(p.rows).toHaveLength(20);
    expect(p.rows.filter((r) => r.status === "held")).toHaveLength(17);
    expect(p.rows.filter((r) => r.status === "free")).toHaveLength(3);
    expect(p.rows[3]).toMatchObject({ square: "منطقة عمرانى 2 جنوب طريق الواحات", plotNo: "102", area: 500, basePpm: 150, status: "free" });
    expect(p.egpPerM).toBe(7725);
    expect(p.pages).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("reads the booked view", () => {
    const p = parseZonePage(fixture("zone-booked.html"));
    expect(p.rows).toHaveLength(20);
    expect(p.rows.every((r) => r.status === "booked")).toBe(true);
    expect(p.view).toBe("booked");
    expect(p.rows[0]).toMatchObject({ square: "الامتداد الجنوبى بالقرب من ديستركت 5", plotNo: "1", area: 519.3 });
    expect(p.pages).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("recognises a zone without plots", () => {
    const p = parseZonePage(fixture("zone-empty.html"));
    expect(p.rows).toEqual([]);
    expect(p.empty).toBe(true);
    expect(p.pages).toEqual([]);
    expect(p.egpPerM).toBe(25800);
    expect(p.view).toBe("available");
    expect(p.hidden.__VIEWSTATE.length).toBeGreaterThan(20);
    expect(p.hidden.__EVENTVALIDATION.length).toBeGreaterThan(20);
    expect(p.hidden.__VIEWSTATEGENERATOR).toBe("D2B568B2");
  });

  it("throws ParseError when the plot table is missing (error page, home page)", () => {
    expect(() => parseZonePage("<html><body>خطأ أثناء تنفيذ الأمر</body></html>")).toThrow(ParseError);
    expect(() => parseZonePage(fixture("home.html"))).toThrow(/grdPlots/);
  });

  it("refuses an unknown status label rather than guessing", () => {
    const row = (label: string) =>
      `<table id="MainContent_grdPlots"><tr>${"<td>1</td>".repeat(10)}<td><span id="MainContent_grdPlots_lblPlotStatus_0">${label}</span></td></tr></table>`;
    expect(() => parseZonePage(row("محجوزة نهائياً"))).toThrow(ParseError);
    expect(parseZonePage(row("")).rows[0].status).toBe("free");
    expect(parseZonePage(row(" حجز مبدئى ")).rows[0].status).toBe("held");
    expect(parseZonePage(row("غير متاحة")).rows[0].status).toBe("booked");
  });

  it("does not mistake a pager-only table for an empty zone", () => {
    const p = parseZonePage(fixture("zone-available.html").replace(/<tr class="(alt)?row">[\s\S]*?<\/tr>/g, ""));
    expect(p.rows).toEqual([]);
    expect(p.empty).toBe(false);
  });
});

describe("number and entity helpers", () => {
  it("parseNum handles thousands separators, decimals and Arabic-Indic digits", () => {
    expect(parseNum("223,875.00")).toBe(223875);
    expect(parseNum("55,968.75")).toBe(55968.75);
    expect(parseNum(" 450 ")).toBe(450);
    expect(parseNum("٢٣٬٤٥٥")).toBe(23455);
    expect(parseNum("٤٩٧٫٥")).toBe(497.5);
    expect(() => parseNum("")).toThrow(ParseError);
    expect(() => parseNum("n/a")).toThrow(ParseError);
  });

  it("decodeEntities covers the named and numeric forms the site uses", () => {
    expect(decodeEntities("__doPostBack(&#39;a&#39;,&#39;Page$2&#39;)")).toBe("__doPostBack('a','Page$2')");
    expect(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#x27;e&#x27;&nbsp;")).toBe("a & b <c> \"d\" 'e' ");
    expect(decodeEntities("&unknown; &#99999999;")).toBe("&unknown; &#99999999;");
  });
});

describe("parseCityPage", () => {
  it("lists the projects of New Cairo with their phase flag, skipping the legend", () => {
    const projects = parseCityPage(fixture("viewcity-1.html"));
    expect(projects).toHaveLength(30);
    const green = projects.filter((p) => p.green);
    expect(green.map((p) => p.pid)).toEqual([2284, 1262]);
    for (const p of green) expect(p.name).toContain("المرحلة الحادية عشر");
    expect(green[0].name).toBe("المرحلة الحادية عشر - الامتداد الجنوبى بالقرب من ديستركت 5 - القاهرة الجديدة");
    const red = projects.filter((p) => !p.green).map((p) => p.pid);
    expect(red).toEqual(expect.arrayContaining([57, 52, 1]));
    expect(new Set(projects.map((p) => p.pid)).size).toBe(30);
  });
});

describe("parseProjectPage", () => {
  it("lists the zones of project 1262 with their names", () => {
    const zones = parseProjectPage(fixture("project-1262.html"));
    expect(zones).toEqual([
      { zid: 3625, name: "الحى الرابع - منطقة ( Q )" },
      { zid: 3626, name: "الحى الرابع - منطقة (E)" },
      { zid: 3624, name: "الحى الرابع - منطقة (N)" },
    ]);
  });
});

describe("parseCitiesJson", () => {
  it("unwraps the {d: '<json>'} envelope", () => {
    const cities = parseCitiesJson(JSON.parse(fixture("cities.json")));
    expect(cities).toHaveLength(27);
    expect(cities.find((c) => c.id === 1)?.name).toBe("القاهرة الجديدة");
    expect(cities.every((c) => Number.isInteger(c.id) && c.name.length > 0)).toBe(true);
  });

  it("accepts the already-parsed and bare-array forms and rejects garbage", () => {
    expect(parseCitiesJson({ d: [{ ID: 3, Name: " س " }] })).toEqual([{ id: 3, name: "س" }]);
    expect(parseCitiesJson([{ ID: "4", Name: "x" }])).toEqual([{ id: 4, name: "x" }]);
    expect(() => parseCitiesJson({ d: "not json" })).toThrow(ParseError);
    expect(() => parseCitiesJson({ d: "[]" })).toThrow(ParseError);
    expect(() => parseCitiesJson("<html>")).toThrow(ParseError);
  });
});

describe("createClient", () => {
  it("posts the hidden fields back with the event target, argument and extra form values", async () => {
    const calls: { url: string; init?: Parameters<Parameters<typeof createClient>[0]>[1] }[] = [];
    const client = createClient(async (url, init) => {
      calls.push({ url, init });
      return "<html />";
    });
    await client.get("https://x/ar/ViewZone.aspx?ID=7");
    await client.postback("https://x/ar/ViewZone.aspx?ID=7", { __VIEWSTATE: "vs", __EVENTVALIDATION: "ev", __EVENTTARGET: "stale" }, "ctl00$MainContent$grdPlots", "Page$2", { "ctl00$MainContent$PlotType": "rdShowAvailable", "ctl00$MainContent$txtPlotNumber": "" });
    expect(calls[0]).toEqual({ url: "https://x/ar/ViewZone.aspx?ID=7", init: undefined });
    const post = calls[1].init!;
    expect(post.method).toBe("POST");
    expect(post.headers?.referer).toBe("https://x/ar/ViewZone.aspx?ID=7");
    expect(post.headers?.["content-type"]).toMatch(/x-www-form-urlencoded/);
    expect(Object.fromEntries(post.body!)).toEqual({
      __VIEWSTATE: "vs",
      __EVENTVALIDATION: "ev",
      __EVENTTARGET: "ctl00$MainContent$grdPlots",
      __EVENTARGUMENT: "Page$2",
      "ctl00$MainContent$PlotType": "rdShowAvailable",
      "ctl00$MainContent$txtPlotNumber": "",
    });
  });

  it("waits delayMs between consecutive requests", async () => {
    const sleeps: number[] = [];
    let t = 0;
    const client = createClient(async () => "", { delayMs: 500, now: () => t, sleep: async (ms) => void sleeps.push(ms) });
    await client.get("a");
    expect(sleeps).toEqual([]);
    await client.get("b");
    expect(sleeps).toEqual([500]);
    t = 10_000;
    await client.get("c");
    expect(sleeps).toEqual([500]);
  });
});

describe("normalizeName", () => {
  it("canonicalises Arabic and Latin place names", () => {
    expect(normalizeName("موقع3")).toBe("موقع 3");
    expect(normalizeName("القاهرة الجديدة")).toBe("القاهره الجديده");
    expect(normalizeName("الحى الرابع - منطقة ( Q )")).toBe("الحي الرابع منطقه q");
    expect(normalizeName("أكتوبر  الجديدة")).toBe("اكتوبر الجديده");
    expect(normalizeName("مَدِينَة")).toBe("مدينه");
    expect(normalizeName("مـنـطـقـة")).toBe("منطقه");
    expect(normalizeName("المربع ١٢")).toBe("المربع 12");
    expect(normalizeName("  New   Cairo / District_5 ")).toBe("new cairo district 5");
    expect(normalizeName("إمتداد، [شرق]: «بيت الوطن»")).toBe("امتداد شرق بيت الوطن");
    expect(normalizeName("D5")).toBe("d 5");
  });
});

describe("officialPlotId", () => {
  it("is deterministic, ASCII and insensitive to the square's spelling", () => {
    const id = officialPlotId(4797, "الامتداد الجنوبى بالقرب من ديستركت 5", "10");
    expect(id).toBe(officialPlotId(4797, "الامتداد الجنوبي بالقرب من ديستركت 5", "10"));
    expect(id).toBe(officialPlotId(4797, "الامتداد الجنوبى بالقرب من ديستركت٥", "١٠"));
    expect(id).toMatch(/^o4797-[0-9a-f]{8}-10$/);
    expect(officialPlotId(4797, "مربع آخر", "10")).not.toBe(id);
    expect(officialPlotId(4797, "مربع", "12 A")).toMatch(/^o4797-[0-9a-f]{8}-12A$/);
    expect(officialPlotId(1, "x", "7")).not.toBe(officialPlotId(2, "x", "7"));
  });
});

describe("buildOfficialIndex", () => {
  const zones: OfficialZoneEntry[] = [
    { zid: 3624, pid: 1262, cityId: 1, city: "القاهرة الجديدة", name: "الحى الرابع - منطقة (N)", squares: { [normalizeName("بيت الوطن N")]: { sector: "الحي الرابع", zone: "بيت الوطن - N" } } },
    { zid: 4797, pid: 2284, cityId: 1, city: "القاهرة الجديدة", name: "الامتداد الجنوبى", squares: { [normalizeName("الامتداد الجنوبى بالقرب من ديستركت 5")]: { sector: null, zone: "ديستركت 5" } } },
    { zid: 9, pid: 9, cityId: 24, city: "أكتوبر الجديدة", name: "الحي الأول", squares: {} },
  ];
  const index = buildOfficialIndex(zones, { 1: "القاهرة الجديدة", 24: "اكتوبر الجديدة" });

  it("finds zones by the entry name or any square's zone, with normalized spelling", () => {
    expect(index.zidOf("القاهرة الجديدة", "الحي الرابع - منطقة (N)")).toBe(3624);
    expect(index.zidOf("القاهره الجديده", "بيت الوطن N")).toBe(3624);
    expect(index.zidOf("القاهرة الجديدة", "ديستركت٥")).toBe(4797);
    expect(index.zidOf("القاهرة الجديدة", "ديستركت 6")).toBeNull();
    expect(index.zidOf("مدينة أخرى", "ديستركت 5")).toBeNull();
  });

  it("matches a city with a single zone when the plot has no zone name", () => {
    expect(index.zidOf("اكتوبر الجديدة", null)).toBe(9);
    expect(index.zidOf("أكتوبر الجديدة", null)).toBe(9);
    expect(index.zidOf("القاهرة الجديدة", null)).toBeNull();
  });

  it("looks squares and cities up", () => {
    expect(index.squareOf(4797, "الامتداد الجنوبي بالقرب من ديستركت 5")).toEqual({ sector: null, zone: "ديستركت 5" });
    expect(index.squareOf(4797, "مربع مجهول")).toBeNull();
    expect(index.squareOf(1, "x")).toBeNull();
    expect(index.cityOf(1)).toBe("القاهرة الجديدة");
    expect(index.cityOf(99)).toBeNull();
    expect(index.byZid.get(3624)?.pid).toBe(1262);
  });
});
