/**
 * Plot positions read off the official zone plans (public/plans/<zid>.json, produced offline by georeferencing
 * the plan images). Each file places the plan image on the map by three corners and lists one polygon per plot in
 * image pixels; a plot's position is its polygon's centroid. Used by the sync for plots the frozen snapshot never
 * had coordinates for (the official site publishes none).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { LatLng } from "@/engine/nearbuilt";

export interface PlanCorners {
  tl: LatLng;
  tr: LatLng;
  bl: LatLng;
}

export interface PlanZoneFile {
  zid: number;
  w: number;
  h: number;
  corners: PlanCorners;
  /** Plot id → polygon vertices [x, y] in image pixels. */
  plots: Record<string, [number, number][]>;
}

const R = 6378137;
const toMerc = ([lat, lng]: LatLng): [number, number] => [(lng * Math.PI * R) / 180, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R];
const fromMerc = ([x, y]: [number, number]): LatLng => [((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI, (x * 180) / (Math.PI * R)];

/** Image pixel (x, y) → [lat, lng]: the image is an affine rectangle on the Web-Mercator plane spanned by its corners. */
export function imagePointToLatLng(file: Pick<PlanZoneFile, "w" | "h" | "corners">, x: number, y: number): LatLng {
  const tl = toMerc(file.corners.tl);
  const tr = toMerc(file.corners.tr);
  const bl = toMerc(file.corners.bl);
  const u = x / file.w;
  const v = y / file.h;
  return fromMerc([tl[0] + u * (tr[0] - tl[0]) + v * (bl[0] - tl[0]), tl[1] + u * (tr[1] - tl[1]) + v * (bl[1] - tl[1])]);
}

/** Area-weighted centroid of a polygon in image pixels (vertex mean for degenerate ones). */
export function polygonCentroid(poly: [number, number][]): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  return [cx / (3 * a), cy / (3 * a)];
}

/** Plot id → position for every plot drawn on the given plans. */
export function planCentroids(files: PlanZoneFile[]): Map<string, LatLng> {
  const out = new Map<string, LatLng>();
  for (const f of files)
    for (const [id, poly] of Object.entries(f.plots)) {
      if (poly.length < 3) continue;
      const [x, y] = polygonCentroid(poly);
      out.set(id, imagePointToLatLng(f, x, y));
    }
  return out;
}

/** Every zone file in the plans directory (default public/plans). Missing directory → none. */
export function loadPlanFiles(dir = path.join(process.cwd(), "public", "plans")): PlanZoneFile[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: PlanZoneFile[] = [];
  for (const n of names) {
    if (!/^\d+\.json$/.test(n)) continue;
    const f = JSON.parse(readFileSync(path.join(dir, n), "utf8")) as PlanZoneFile;
    if (f && f.corners && f.plots && f.w > 0 && f.h > 0) out.push(f);
  }
  return out;
}
