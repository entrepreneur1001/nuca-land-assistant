/**
 * In-memory stand-in for lands.nuca.gov.eg: renders zone, city and project pages and the
 * cities JSON with the real markup shapes, validates WebForms postbacks against a fake
 * `__VIEWSTATE`, logs requests and injects faults. Not a test; shared by the crawl and sync tests.
 */
import { FetchError } from "@/ingest/fetcher";
import type { FetchHtml, PlotState, ZoneView } from "@/ingest/nuca-plots";
import { OFFICIAL_SITE } from "@/ingest/official";

export interface FakePlot {
  square: string;
  plotNo: string;
  area: number;
  basePpm: number;
  corner?: number;
  garden?: number;
  sea?: number;
  status: PlotState;
}

export interface FakeZone {
  name: string;
  egpPerM: number | null;
  plots: FakePlot[];
}

export interface FakeProject {
  cityId: number;
  name: string;
  green: boolean;
  zones: number[];
}

export interface FakeSiteData {
  cities: { id: number; name: string }[];
  projects: Record<number, FakeProject>;
  zones: Record<number, FakeZone>;
}

export type FaultKind = "503" | "reset" | "302" | "no-table";

export interface FakeRequest {
  url: string;
  method: "GET" | "POST";
  body: URLSearchParams | null;
  /** `__EVENTTARGET` of a postback. */
  target: string | null;
  /** `__EVENTARGUMENT` of a postback (e.g. `Page$3`). */
  argument: string | null;
  zid: number | null;
  at: number;
}

export interface FakeSite {
  data: FakeSiteData;
  fetchHtml: FetchHtml;
  fetchJsonPost: (url: string, body: unknown) => Promise<unknown>;
  requests: FakeRequest[];
  /** The next request matching the URL (substring) or predicate fails once in the given way. */
  failOnce(match: string | ((req: FakeRequest) => boolean), kind: FaultKind): void;
  readonly inFlight: number;
  readonly maxInFlight: number;
  /** Pages the zone table has in a view, as the crawler should walk them. */
  pageCount(zid: number, view: ZoneView): number;
}

const ERROR_PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>خطأ</title></head><body>
<form method="post" action="./Error.aspx" id="form1"><div id="MainContent_lblMessage">خطأ أثناء تنفيذ الأمر</div></form></body></html>`;

const fmt2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;
const pagerLink = (p: number, label: string) => `<td><a href="javascript:__doPostBack(&#39;ctl00$MainContent$grdPlots&#39;,&#39;Page$${p}&#39;)">${label}</a></td>`;

interface ZoneState {
  zid: number;
  view: ZoneView;
  page: number;
}

const encodeState = (s: ZoneState) => Buffer.from(JSON.stringify(s), "utf8").toString("base64");
const eventValidation = (s: ZoneState) => `ev:${s.zid}:${s.view}:${s.page}`;
function decodeState(viewstate: string | null): ZoneState | null {
  if (!viewstate) return null;
  try {
    const s = JSON.parse(Buffer.from(viewstate, "base64").toString("utf8")) as Partial<ZoneState>;
    return typeof s.zid === "number" && (s.view === "available" || s.view === "booked") && typeof s.page === "number" ? (s as ZoneState) : null;
  } catch {
    return null;
  }
}

/** Page numbers linked from the pager shown on `page` of `total` (the current page is a plain span). */
function pagerLinks(page: number, total: number): number[] {
  if (total <= 1) return [];
  const first = Math.floor((page - 1) / 10) * 10 + 1;
  const last = Math.min(first + 9, total);
  const out: number[] = [];
  if (first > 1) out.push(first - 1);
  for (let p = first; p <= last; p++) if (p !== page) out.push(p);
  if (last < total) out.push(last + 1);
  return out;
}

function hiddenInputs(s: ZoneState): string {
  const h: Record<string, string> = {
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    __VIEWSTATE: encodeState(s),
    __VIEWSTATEGENERATOR: "D2B568B2",
    __VIEWSTATEENCRYPTED: "",
    __EVENTVALIDATION: eventValidation(s),
  };
  return Object.entries(h)
    .map(([k, v]) => `<input type="hidden" name="${k}" id="${k}" value="${v}" />`)
    .join("\n");
}

function page(title: string, body: string, action: string): string {
  return `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" dir="rtl"><head><meta charset="utf-8" /><title>${title}</title></head>
<body><form method="post" action="./${action}" id="form1">
${body}
</form></body></html>`;
}

export function genPlots(n: number, opts: { square?: string | string[]; start?: number; status?: (i: number) => PlotState; area?: number; basePpm?: number } = {}): FakePlot[] {
  const squares = typeof opts.square === "string" ? [opts.square] : (opts.square ?? ["المربع أ"]);
  const start = opts.start ?? 1;
  const status = opts.status ?? ((i: number) => (i % 3 === 0 ? "held" : "free"));
  return Array.from({ length: n }, (_, i) => ({
    square: squares[i % squares.length],
    plotNo: String(start + i),
    area: opts.area ?? 500 + (i % 7) * 10,
    basePpm: opts.basePpm ?? 450,
    corner: i % 11 === 0 ? 10 : 0,
    status: status(i),
  }));
}

export function createFakeSite(data: FakeSiteData, opts: { pageSize?: number; latencyMs?: number } = {}): FakeSite {
  const { pageSize = OFFICIAL_SITE.pageSize, latencyMs = 0 } = opts;
  const base = OFFICIAL_SITE.base;
  const requests: FakeRequest[] = [];
  const faults: { match: (r: FakeRequest) => boolean; kind: FaultKind }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const plotsOf = (zid: number, view: ZoneView) =>
    (data.zones[zid]?.plots ?? [])
      .filter((p) => (view === "booked" ? p.status === "booked" : p.status !== "booked"))
      .sort((a, b) => a.square.localeCompare(b.square) || Number(a.plotNo) - Number(b.plotNo) || a.plotNo.localeCompare(b.plotNo));
  const pageCount = (zid: number, view: ZoneView) => Math.max(1, Math.ceil(plotsOf(zid, view).length / pageSize));

  function renderZone(s: ZoneState): string {
    const zone = data.zones[s.zid];
    const all = plotsOf(s.zid, s.view);
    const total = pageCount(s.zid, s.view);
    const slice = all.slice((s.page - 1) * pageSize, s.page * pageSize);
    const rows = slice
      .map((p, i) => {
        const prem = (p.corner ?? 0) + (p.garden ?? 0) + (p.sea ?? 0);
        const ppm = round2(p.basePpm * (1 + prem / 100));
        const totalPrice = round2(p.area * ppm);
        const label = p.status === "held" ? "حجز مبدئى" : p.status === "booked" ? "غير متاحة" : "";
        const button =
          s.view === "available"
            ? `<input type="image" name="ctl00$MainContent$grdPlots$ctl${String(i + 2).padStart(2, "0")}$btnEditReservation" id="MainContent_grdPlots_btnEditReservation_${i}" src="../Images/home.gif" style="height:16px;width:16px;" />`
            : "";
        return `<tr class="${i % 2 ? "altrow" : "row"}">
				<td align="center" style="width:1.5%;">${p.square}</td><td align="center" style="width:1.5%;">${p.plotNo}</td><td align="center" style="width:2%;">${fmt2(p.area)}</td><td align="center" style="width:8%;">${fmtInt(p.basePpm)}</td><td align="center" style="width:8%;">${p.corner ?? 0}</td><td align="center" style="width:8%;">${p.garden ?? 0}</td><td align="center" style="width:8%;">${p.sea ?? 0}</td><td align="center" style="width:10%;">${fmtInt(ppm)}</td><td align="center" style="width:10%;">${fmt2(totalPrice)}</td><td align="center">${fmt2(totalPrice * 0.25)}</td><td align="center" style="width:12%;">
                            ${button}
                            <span id="MainContent_grdPlots_lblPlotStatus_${i}">${label}</span>
                        </td>
			</tr>`;
      })
      .join("");
    const body = all.length
      ? rows
      : `<tr>
				<td colspan="11">لا يوجد قطع أراضي متاحة</td>
			</tr>`;
    const links = pagerLinks(s.page, total);
    const pager = total > 1
      ? `<tr class="footer" align="center" valign="middle">
				<td colspan="11"><table>
					<tr>
						${links
              .filter((p) => p < s.page && p >= Math.floor((s.page - 1) / 10) * 10 + 1)
              .map((p) => pagerLink(p, String(p)))
              .join("")}${links.some((p) => p < Math.floor((s.page - 1) / 10) * 10 + 1) ? pagerLink(Math.floor((s.page - 1) / 10) * 10, "...") : ""}<td><span>${s.page}</span></td>${links
              .filter((p) => p > s.page && p <= Math.min(Math.floor((s.page - 1) / 10) * 10 + 10, total))
              .map((p) => pagerLink(p, String(p)))
              .join("")}${links.some((p) => p > Math.floor((s.page - 1) / 10) * 10 + 10) ? pagerLink(Math.floor((s.page - 1) / 10) * 10 + 11, "...") : ""}
					</tr>
				</table></td>
			</tr>`
      : "";
    const checked = (v: ZoneView) => (s.view === v ? ' checked="checked"' : "");
    const egp = zone.egpPerM === null ? "" : `<div class="Note">سعر المتر بالجنيه المصري: ${fmtInt(zone.egpPerM)} ج.م</div>`;
    return page(
      zone.name,
      `${hiddenInputs(s)}
<h2><span id="MainContent_lblZoneName">${zone.name}</span></h2>
${egp}
<div>
  <input id="MainContent_rdShowAvailable" type="radio" name="ctl00$MainContent$PlotType" value="rdShowAvailable"${checked("available")} onclick="javascript:setTimeout(&#39;__doPostBack(\\&#39;ctl00$MainContent$rdShowAvailable\\&#39;,\\&#39;\\&#39;)&#39;, 0)" /><label for="MainContent_rdShowAvailable">القطع المتاحة</label>
  <input id="MainContent_rdShowBooked" type="radio" name="ctl00$MainContent$PlotType" value="rdShowBooked"${checked("booked")} onclick="javascript:setTimeout(&#39;__doPostBack(\\&#39;ctl00$MainContent$rdShowBooked\\&#39;,\\&#39;\\&#39;)&#39;, 0)" /><label for="MainContent_rdShowBooked">القطع المحجوزة</label>
</div>
<input name="ctl00$MainContent$txtPlotNumber" type="text" id="MainContent_txtPlotNumber" />
<div class="Note">جميع الأسعار المذكورة بالجدول بالدولار الأمريكى.</div>
<div>
		<table class="yui-grid" cellspacing="0" rules="all" border="1" id="MainContent_grdPlots" style="width:100%;border-collapse:collapse;margin-top: 4px">
			<tr>
				<th scope="col">المربع</th><th scope="col">القطعة</th><th scope="col">المساحة</th><th scope="col">سعر المتر الأساسى</th><th scope="col">تميز ناصية</th><th scope="col">تميز حدائق</th><th scope="col">تميز بحر أو نيل</th><th scope="col">سعر المتر الإجمالي</th><th scope="col">السعر الإجمالي</th><th scope="col">الدفعة المقدمة</th><th scope="col">طلب الحجز</th>
			</tr>${body}${pager}
		</table>
	</div>`,
      `ViewZone.aspx?ID=${s.zid}`,
    );
  }

  function renderCity(cityId: number): string {
    const city = data.cities.find((c) => c.id === cityId);
    if (!city) return ERROR_PAGE;
    const projects = Object.entries(data.projects)
      .filter(([, p]) => p.cityId === cityId)
      .map(([pid, p], i) => {
        const n = i + 1;
        return `<div class="prj"><div><h3>
            <img id="MainContent_Project${n}_imgState" src="../Images/ball_${p.green ? "green" : "red"}.png" /> <span id="MainContent_Project${n}_lblProjectTitle">${p.name}</span></h3>
        <p><img src="../Images/DataImages/projecticon.jpg" id="MainContent_Project${n}_imgProject" width="163" height="89" />
            <span id="MainContent_Project${n}_lblProjectDesc">${p.name}</span><span><a href="ViewProject.aspx?ID=${pid}" id="MainContent_Project${n}_lnkDetails" class="more-details">التفاصيل</a></span></p></div></div>`;
      })
      .join("\n");
    return page(
      city.name,
      `${hiddenInputs({ zid: 0, view: "available", page: 1 })}
<h2>${city.name}</h2>
<ul style="list-style:none;vertical-align:top">
  <li><img id="MainContent_imgAvailable" src="../Images/ball_green.png" />هذه العلامة بجوار المشروع تعنى أن المشروع متاح فى هذه المرحلة</li>
  <li><img id="MainContent_Image1" src="../Images/ball_red.png" />هذه العلامة بجوار المشروع تعنى أن المشروع غير متاح فى هذه المرحلة</li>
</ul>
<table id="MainContent_tblPRojects" style="width:100%;"><tr><td>${projects}</td></tr></table>`,
      `ViewCity.aspx?ID=${cityId}`,
    );
  }

  function renderProject(pid: number): string {
    const project = data.projects[pid];
    if (!project) return ERROR_PAGE;
    const zones = project.zones
      .map((zid, i) => {
        const n = i + 1;
        return `<div id="MainContent_Region${n}_Container" class="zone-cont">
    <h3>
        <span id="MainContent_Region${n}_lblName">${data.zones[zid]?.name ?? `zone ${zid}`}</span></h3>
    <div><img src="../Images/DataImages/icon.jpg" id="MainContent_Region${n}_imgZoneIcon" /></div>
    <a href="ViewZone.aspx?ID=${zid}" id="MainContent_Region${n}_lnkDetails">التفاصيل</a>
</div>`;
      })
      .join("\n");
    return page(project.name, `${hiddenInputs({ zid: 0, view: "available", page: 1 })}\n<h2>${project.name}</h2>\n${zones}`, `ViewProject.aspx?ID=${pid}`);
  }

  function handleZone(zid: number, req: FakeRequest): string {
    if (!data.zones[zid]) return ERROR_PAGE;
    if (req.method === "GET") return renderZone({ zid, view: "available", page: 1 });
    const body = req.body!;
    const state = decodeState(body.get("__VIEWSTATE"));
    if (!state || state.zid !== zid || body.get("__EVENTVALIDATION") !== eventValidation(state)) return ERROR_PAGE;
    const plotType = body.get("ctl00$MainContent$PlotType");
    if (req.target === "ctl00$MainContent$rdShowBooked" && plotType === "rdShowBooked") return renderZone({ zid, view: "booked", page: 1 });
    if (req.target === "ctl00$MainContent$rdShowAvailable" && plotType === "rdShowAvailable") return renderZone({ zid, view: "available", page: 1 });
    const m = /^Page\$(\d+)$/.exec(req.argument ?? "");
    if (req.target === "ctl00$MainContent$grdPlots" && m) {
      const wanted = Number(m[1]);
      const expectedType = state.view === "booked" ? "rdShowBooked" : "rdShowAvailable";
      if (plotType !== expectedType) return ERROR_PAGE;
      if (!pagerLinks(state.page, pageCount(zid, state.view)).includes(wanted)) return ERROR_PAGE;
      return renderZone({ zid, view: state.view, page: wanted });
    }
    return ERROR_PAGE;
  }

  async function handle(req: FakeRequest): Promise<string> {
    requests.push(req);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, latencyMs));
      const fi = faults.findIndex((f) => f.match(req));
      if (fi >= 0) {
        const [fault] = faults.splice(fi, 1);
        switch (fault.kind) {
          case "503":
            throw new FetchError(`HTTP 503 for ${req.url}`, 503);
          case "reset":
            throw new TypeError("fetch failed: ECONNRESET");
          case "302":
            throw new FetchError(`redirected to ~/Error.aspx (HTTP 302) for ${req.url}`, 302);
          case "no-table":
            return ERROR_PAGE;
        }
      }
      const u = new URL(req.url);
      if (u.origin + "" !== new URL(base).origin) return ERROR_PAGE;
      const id = Number(u.searchParams.get("ID"));
      if (u.pathname.endsWith("/ar/ViewZone.aspx")) return handleZone(id, req);
      if (u.pathname.endsWith("/ar/ViewCity.aspx")) return renderCity(id);
      if (u.pathname.endsWith("/ar/ViewProject.aspx")) return renderProject(id);
      return ERROR_PAGE;
    } finally {
      inFlight--;
    }
  }

  const fetchHtml: FetchHtml = (url, init) => {
    const body = init?.body ?? null;
    const zid = /ViewZone\.aspx\?ID=(\d+)/.exec(url);
    return handle({
      url,
      method: init?.method ?? "GET",
      body,
      target: body?.get("__EVENTTARGET") ?? null,
      argument: body?.get("__EVENTARGUMENT") ?? null,
      zid: zid ? Number(zid[1]) : null,
      at: Date.now(),
    });
  };

  const fetchJsonPost = async (url: string): Promise<unknown> => {
    const req: FakeRequest = { url, method: "POST", body: null, target: null, argument: null, zid: null, at: Date.now() };
    requests.push(req);
    const fi = faults.findIndex((f) => f.match(req));
    if (fi >= 0) {
      const [fault] = faults.splice(fi, 1);
      if (fault.kind === "reset") throw new TypeError("fetch failed: ECONNRESET");
      throw new FetchError(`HTTP ${fault.kind === "302" ? 302 : 503} for ${url}`, fault.kind === "302" ? 302 : 503);
    }
    if (!url.endsWith("/ar/Cities.aspx/GetSiteCities")) throw new FetchError(`redirected to ~/Error.aspx (HTTP 302) for ${url}`, 302);
    const cities = data.cities.map((c) => ({ ID: c.id, Name: c.name, Name_en: "", Coords: "0,0,10,10", MeterPrice: 0, NameLocation: "L" }));
    return { d: JSON.stringify(cities) };
  };

  return {
    data,
    fetchHtml,
    fetchJsonPost,
    requests,
    failOnce(match, kind) {
      faults.push({ match: typeof match === "string" ? (r) => r.url.includes(match) : match, kind });
    },
    get inFlight() {
      return inFlight;
    },
    get maxInFlight() {
      return maxInFlight;
    },
    pageCount,
  };
}
