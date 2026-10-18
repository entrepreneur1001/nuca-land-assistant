import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { tupleToPlot, unpackTuples, type MetaDoc, type Snapshot } from "@/data/snapshot";
import { citiesOf, dataDateOf, statsOf, type CityInfo } from "./area-stats";

export type { AreaStats, CityInfo, DistrictInfo } from "./area-stats";

/**
 * Build-time data for the static SEO pages (city / district / sitemap). The site is a static export, so these
 * numbers are frozen at `next build` and serve as the pre-rendered HTML (SEO, first paint); in the browser the
 * same stats are recomputed from the live Firestore snapshot (components/live-blocks.tsx).
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

let cities: Promise<CityInfo[]> | null = null;

/** Every city that has plots, with its districts; cities and districts are sorted by available plots. */
export function getCities(): Promise<CityInfo[]> {
  cities ??= getBuildSnapshot().then(citiesOf);
  return cities;
}

export async function getCity(slug: string) {
  return (await getCities()).find((c) => c.slug === slug) ?? null;
}

/** When the plot data behind the static pages was last refreshed by the sync job. */
export async function getDataDate() {
  return dataDateOf((await getBuildSnapshot()).meta);
}

/** Phase-wide totals over the plots in the dataset. */
export async function getTotals() {
  return statsOf((await getBuildSnapshot()).plots);
}
