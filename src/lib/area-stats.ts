import type { BuildingRules, MetaDoc, Plot, Snapshot } from "@/data/snapshot";
import { citySlug } from "./slugs";

/** Area statistics shared by the build-time SEO pages (lib/build-data.ts) and their live browser refresh. */

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

/** Plot counts and price/area ranges over a set of plots. */
export function statsOf(plots: Plot[]): AreaStats {
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
  /** Median plot coordinates (else the sector's approximate centre), for a map link; null when the source has none. */
  center: { lat: number; lng: number } | null;
}

export interface CityInfo {
  name: string;
  /** URL segment under the phase, e.g. "obour" → /phase-11/obour. */
  slug: string;
  stats: AreaStats;
  districts: DistrictInfo[];
}

/** Every city that has plots, with its districts; cities and districts are sorted by available plots. */
export function citiesOf({ meta, plots }: Snapshot): CityInfo[] {
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
          stats: statsOf(bySector.get(s.id)!),
          center: center(bySector.get(s.id)!) ?? (s.c ? { lat: s.c[0], lng: s.c[1] } : null),
        }))
        .sort((a, b) => b.stats.available - a.stats.available);
      return { name, slug, stats: statsOf(byCity.get(name)!), districts };
    })
    .sort((a, b) => b.stats.available - a.stats.available);
}

/** When the plot data was last refreshed by the sync job. */
export const dataDateOf = (meta: MetaDoc) => meta.statsAt ?? meta.fullSyncAt;
