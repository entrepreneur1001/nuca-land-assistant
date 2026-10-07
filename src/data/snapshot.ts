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

export interface MetaDoc {
  schema: number;
  dataVersion: string;
  statsAt: string | null;
  fullSyncAt: string | null;
  osmAt: string | null;
  /** Last successful OpenStreetMap refresh per city (city name → ISO time). */
  osmCities?: Record<string, string>;
  lastError: string | null;
  lastErrorAt: string | null;
  source: { name: string; url: string };
  market: { total: number; booked: number; available: number; allocatedCodes: number | null; sourceLastUpdate: string | null };
  allocations: { id: string; d: string; c: number; b: number | null }[];
  cities: string[];
  sectors: { id: string; name: string; city: number; hot: boolean; rules?: BuildingRules | null }[];
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
  booked: 0 | 1,
  bookingTs: number,
  builtKm: number | null,
  builtSrc: 0 | 1 | 2,
  /** Metres to the nearest main road (OpenStreetMap); missing in older chunks. */
  roadM?: number | null,
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
  status: "available" | "booked";
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
    status: t[15] ? "booked" : "available",
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
