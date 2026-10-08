import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { tupleToPlot, unpackTuples, type BuildingRules, type MetaDoc, type Plot, type Snapshot } from "@/data/snapshot";
import { citySlug } from "./slugs";

/**
 * Build-time data for the static SEO pages (city / district / sitemap). The site is a static export, so these
 * numbers are frozen at `next build`; the live app keeps reading Firestore in the browser (lib/data.ts).
 * Reads go through the public Firestore REST API (rules allow reads), or the local snapshot with NEXT_PUBLIC_DATA=local.
 */

const PROJECT = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "nuca-lands-assistant";
const REST = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const LOCAL = process.env.NEXT_PUBLIC_DATA === "local";

type FsValue = Record<string, unknown>;

/** Firestore REST typed value → plain JSON. */
function fromFs(v: FsValue): unknown {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return ((v.arrayValue as { values?: FsValue[] }).values ?? []).map(fromFs);
  if ("mapValue" in v) return fromFsFields((v.mapValue as { fields?: Record<string, FsValue> }).fields ?? {});
  return null;
}

function fromFsFields(fields: Record<string, FsValue>) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fromFs(v)]));
}

async function readDoc<T>(docPath: string): Promise<T> {
  if (LOCAL) {
    const name = docPath === "meta/current" ? "meta" : docPath.split("/").pop();
    return JSON.parse(await readFile(path.join(process.cwd(), "public/dev-snapshot", `${name}.json`), "utf8")) as T;
  }
  const r = await fetch(`${REST}/${docPath}`);
  if (!r.ok) throw new Error(`Firestore ${docPath}: HTTP ${r.status}`);
  const body = (await r.json()) as { fields: Record<string, FsValue> };
  return fromFsFields(body.fields) as T;
}

let snapshot: Promise<Snapshot> | null = null;

export function getBuildSnapshot(): Promise<Snapshot> {
  snapshot ??= (async () => {
    const meta = await readDoc<MetaDoc>("meta/current");
    const parts = await Promise.all(
      meta.chunks.map(async (c) => unpackTuples((await readDoc<{ data: string }>(`plots/${c.id}`)).data)),
    );
    return { meta, plots: parts.flat().map((t) => tupleToPlot(t, meta)) };
  })();
  return snapshot;
}

export interface AreaStats {
  total: number;
  available: number;
  booked: number;
  /** Price per metre (USD) over available plots, or all plots when none are left. */
  ppmMin: number | null;
  ppmMedian: number | null;
  ppmMax: number | null;
  areaMin: number | null;
  areaMax: number | null;
  totalMin: number | null;
  dpMin: number | null;
  garden: number;
  corner: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const min = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);

function stats(plots: Plot[]): AreaStats {
  const avail = plots.filter((p) => p.status === "available");
  const base = avail.length ? avail : plots;
  const pos = (f: (p: Plot) => number) => base.map(f).filter((x) => x > 0);
  return {
    total: plots.length,
    available: avail.length,
    booked: plots.length - avail.length,
    ppmMin: min(pos((p) => p.pricePerMeter)),
    ppmMedian: median(pos((p) => p.pricePerMeter)),
    ppmMax: max(pos((p) => p.pricePerMeter)),
    areaMin: min(pos((p) => p.area)),
    areaMax: max(pos((p) => p.area)),
    totalMin: min(pos((p) => p.totalPrice)),
    dpMin: min(pos((p) => p.downPayment)),
    garden: avail.filter((p) => p.gardenPct > 0).length,
    corner: avail.filter((p) => p.cornerPct > 0).length,
  };
}

function center(plots: Plot[]) {
  const pts = plots.filter((p) => p.latitude != null && p.longitude != null);
  const lat = median(pts.map((p) => p.latitude!));
  const lng = median(pts.map((p) => p.longitude!));
  return lat != null && lng != null ? { lat, lng } : null;
}

export interface DistrictInfo {
  id: string;
  name: string;
  city: string;
  citySlug: string;
  hot: boolean;
  rules: BuildingRules | null;
  stats: AreaStats;
  /** Median plot coordinates, for a map link; null when the source has none. */
  center: { lat: number; lng: number } | null;
}

export interface CityInfo {
  name: string;
  /** URL segment under the phase, e.g. "obour" → /phase-11/obour. */
  slug: string;
  stats: AreaStats;
  districts: DistrictInfo[];
}

let cities: Promise<CityInfo[]> | null = null;

/** Every city that has plots, with its districts; cities and districts are sorted by available plots. */
export function getCities(): Promise<CityInfo[]> {
  cities ??= getBuildSnapshot().then(({ meta, plots }) => {
    const byCity = Map.groupBy(plots, (p) => p.cityName);
    const bySector = Map.groupBy(plots, (p) => p.projectId ?? "");
    return meta.cities
      .filter((name) => byCity.has(name))
      .map((name) => {
        const slug = citySlug(name);
        const districts = meta.sectors
          .filter((s) => meta.cities[s.city] === name && bySector.has(s.id))
          .map((s) => ({
            id: s.id,
            name: s.name,
            city: name,
            citySlug: slug,
            hot: s.hot,
            rules: s.rules ?? null,
            stats: stats(bySector.get(s.id)!),
            center: center(bySector.get(s.id)!),
          }))
          .sort((a, b) => b.stats.available - a.stats.available);
        return { name, slug, stats: stats(byCity.get(name)!), districts };
      })
      .sort((a, b) => b.stats.available - a.stats.available);
  });
  return cities;
}

export async function getCity(slug: string) {
  return (await getCities()).find((c) => c.slug === slug) ?? null;
}

/** When the plot data behind the static pages was last refreshed by the sync job. */
export async function getDataDate() {
  const { meta } = await getBuildSnapshot();
  return meta.statsAt ?? meta.fullSyncAt;
}

/** Phase-wide totals over the plots in the dataset. */
export async function getTotals() {
  const { plots } = await getBuildSnapshot();
  return stats(plots);
}
