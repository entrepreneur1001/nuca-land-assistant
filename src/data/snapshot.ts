/**
 * Compact snapshot format shared by the ingest job (Node) and the browser.
 * Firestore holds `meta/current` plus a handful of `plots/{chunkId}` docs, each a
 * gzipped+base64 JSON array of plot tuples. This keeps reads/egress inside the free tier.
 */

export const SCHEMA_VERSION = 1;
export const CHUNK_COUNT = 8;

/** الاشتراطات البنائية per district, as published by the source (free text from NUCA brochures). */
export interface BuildingRules {
  /** نسبة البناء, e.g. "50 %" */
  ratio: string | null;
  /** الارتفاع المسموح, e.g. "بدروم + أرضي + دورين" */
  floors: string | null;
  /** الردود, e.g. "3م امامي - 5م خلفي - 3م جانبي" */
  setbacks: string | null;
  /** Where the values came from: the source's district record, or our table from the NUCA terms booklet. */
  from?: "source" | "booklet";
}

/** One item of the official NUCA news list (lands.nuca.gov.eg/ar/NewsList.aspx), parsed by src/ingest/nuca-news.ts. */
export interface OfficialNewsItem {
  /** NewsItemViewer.aspx?NID=… (stable, monotonic). */
  nid: number;
  /** Publication date "YYYY-MM-DD" (Cairo calendar). */
  day: string;
  title: string;
  /** Brief, tags stripped, entities decoded, ≤ 300 chars; omitted when empty or equal to the title. */
  text?: string;
  /** «تم الانتهاء … حتى مسلسل N»: booking codes issued through serial (rank) N as of `day`. */
  servedThrough?: number;
  /** «بدء من مسلسل A حتى مسلسل B غدا/اليوم …»: the next batch. `to`/`day`/`hour` are null when the text lacks them. */
  next?: { from: number; to: number | null; day: string | null; hour: number | null };
}

/** One zone of the official site (ViewZone.aspx?ID=zid) and when it was last crawled. */
export interface OfficialZoneState {
  zid: number;
  pid: number;
  cityId: number;
  /** City name as in `MetaDoc.cities`. */
  city: string;
  /** Zone name from the project page. */
  name: string;
  /** EGP per m² shown on the zone page; null when missing. */
  egpPerM: number | null;
  /** Plots known in this zone. */
  n?: number;
  /** Last successful crawl of the available view / of both views. */
  lastOkAt: string | null;
  lastFullAt?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
}

export interface MetaDoc {
  schema: number;
  dataVersion: string;
  statsAt: string | null;
  fullSyncAt: string | null;
  osmAt: string | null;
  /** Last successful OpenStreetMap refresh per city (city name → ISO time). */
  osmCities?: Record<string, string>;
  /** Districts ("s:<sector id>") or plots whose building distance is still to be measured; "*" = every plan-placed plot. */
  distancePending?: string[];
  lastError: string | null;
  lastErrorAt: string | null;
  source: { name: string; url: string };
  market: {
    total: number;
    booked: number;
    available: number;
    /** Available plots on which someone filed a preliminary booking («حجز مبدئى»); counted inside `available`. */
    held?: number;
    allocatedCodes: number | null;
    sourceLastUpdate: string | null;
  };
  /** Daily booking-code batches: `d` issue time (ISO), `c` codes, `b` plots booked by those codes (null = unknown). */
  allocations: { id: string; d: string; c: number; b: number | null }[];
  /** Official site crawl state (lands.nuca.gov.eg). */
  official?: {
    zonesAt: string | null;
    zonesError?: string | null;
    /** Plots whose zone has no official counterpart; their status is frozen. */
    unmapped?: number;
    zones: OfficialZoneState[];
  };
  /** Newest official news items (by NID desc, ≤ 30), merged across runs; raw HTML is never stored. */
  officialNews?: OfficialNewsItem[];
  officialAt?: string | null;
  officialError?: string | null;
  officialErrorAt?: string | null;
  /** Plots observed newly booked per Cairo day ("YYYY-MM-DD"), last 45 days. */
  bookingsByDay?: Record<string, number>;
  cities: string[];
  sectors: {
    id: string;
    name: string;
    city: number;
    hot: boolean;
    rules?: BuildingRules | null;
    /** Approximate centre [lat, lng]: mean of located plots, else the source's tile bounds; missing when unknown. */
    c?: [number, number] | null;
  }[];
  zones: string[];
  chunks: { id: string; v: string; n: number }[];
}

/** Plot tuple stored in chunks (positional to keep payload small). */
export type PlotTuple = [
  id: string,
  ext: string | null,
  plotNo: string,
  city: number,
  sector: number,
  zone: number,
  area: number,
  ppm: number,
  total: number,
  dp: number,
  corner: number,
  garden: number,
  sea: number,
  lat: number | null,
  lng: number | null,
  /** 0 free, 1 booked, 2 available but with a preliminary booking request on it («حجز مبدئى»). */
  booked: 0 | 1 | 2,
  bookingTs: number,
  builtKm: number | null,
  builtSrc: 0 | 1 | 2,
  /** Metres to the nearest main road (OpenStreetMap); missing in older chunks. */
  roadM?: number | null,
  /** Official square («المربع», normalised) the plot is bound to, for zones whose squares share one app zone and
   *  repeat plot numbers; missing in older chunks. */
  sq?: string | null,
];

export interface Plot {
  id: string;
  externalPlotId: string | null;
  plotNumber: string;
  cityName: string;
  projectId: string | null;
  projectName: string | null;
  zoneName: string | null;
  area: number;
  pricePerMeter: number;
  totalPrice: number;
  downPayment: number;
  cornerPct: number;
  gardenPct: number;
  seaPct: number;
  latitude: number | null;
  longitude: number | null;
  /** Approximate position (its sector's centre) for plots without coordinates; null when unknown. */
  approxLoc: { lat: number; lng: number } | null;
  status: "available" | "booked";
  /** Someone filed a preliminary booking («حجز مبدئى»): still bookable, the first down-payment transfer wins. */
  held: boolean;
  bookingDate: string | null;
  /** km to the nearest existing building (OpenStreetMap); null = unknown */
  builtKm: number | null;
  /** 0 = measured from the plot, 1 = from its sector's centre, 2 = unknown */
  builtSrc: 0 | 1 | 2;
  /** Metres from the plot to the nearest main road (OpenStreetMap); null = unknown. */
  mainRoadM: number | null;
  /** Building regulations of the plot's district; null when the source doesn't publish them. */
  rules: BuildingRules | null;
}

export interface Snapshot {
  meta: MetaDoc;
  plots: Plot[];
}

export function tupleToPlot(t: PlotTuple, meta: Pick<MetaDoc, "cities" | "sectors" | "zones">): Plot {
  const sector = t[4] >= 0 ? meta.sectors[t[4]] : undefined;
  return {
    id: t[0],
    externalPlotId: t[1],
    plotNumber: t[2],
    cityName: meta.cities[t[3]] ?? "",
    projectId: sector?.id ?? null,
    projectName: sector?.name ?? null,
    zoneName: t[5] >= 0 ? (meta.zones[t[5]] ?? null) : null,
    area: t[6],
    pricePerMeter: t[7],
    totalPrice: t[8],
    downPayment: t[9],
    cornerPct: t[10],
    gardenPct: t[11],
    seaPct: t[12],
    latitude: t[13],
    longitude: t[14],
    approxLoc: sector?.c ? { lat: sector.c[0], lng: sector.c[1] } : null,
    status: t[15] === 1 ? "booked" : "available",
    held: t[15] === 2,
    bookingDate: t[16] ? new Date(t[16]).toISOString() : null,
    builtKm: t[17],
    builtSrc: t[18],
    mainRoadM: t[19] ?? null,
    rules: sector?.rules ?? null,
  };
}

/** Stable chunk assignment: hash of the id → chunk index. */
export function chunkOf(id: string, count = CHUNK_COUNT): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % count;
}

export const round = (n: number | null, d: number) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

/** Small, fast, deterministic content hash (FNV-1a, hex). */
export function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ---- compression helpers (Web Streams: available in browsers and Node ≥18) ----

async function streamBytes(input: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([input as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function packTuples(tuples: PlotTuple[]): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(tuples));
  return toBase64(await streamBytes(json, new CompressionStream("gzip")));
}

export async function unpackTuples(data: string): Promise<PlotTuple[]> {
  const bytes = await streamBytes(fromBase64(data), new DecompressionStream("gzip"));
  return JSON.parse(new TextDecoder().decode(bytes));
}
