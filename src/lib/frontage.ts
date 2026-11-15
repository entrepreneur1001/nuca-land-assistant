/**
 * Which way each plot's street side faces (public/frontage.json, produced offline by scripts/frontage/build.mts).
 * Optional like the surroundings: a missing or broken file means "not determined", which scores neutral.
 */
import type { Confidence, Frontage } from "@/engine/frontage";

/** [confidence, [[bearingDeg, fromVertex, toVertex, streetWidthM], …]] */
type Row = [Confidence, [number, number, number, number][]];
interface File {
  v: number;
  generated: string;
  plots: Record<string, Row>;
}

export interface FrontageIndex {
  get(id: string): Frontage | undefined;
  readonly size: number;
}

export function parseFrontage(f: File | null | undefined): FrontageIndex {
  const out = new Map<string, Frontage>();
  if (f && f.v === 1 && f.plots)
    for (const [id, r] of Object.entries(f.plots)) {
      if (!Array.isArray(r) || !Array.isArray(r[1])) continue;
      const sides = r[1].filter((s) => Array.isArray(s) && s.length >= 3).map(([bearing, from, to, widthM]) => ({ bearing, from, to, widthM: widthM ?? 0 }));
      const conf: Confidence = r[0] === 2 ? 2 : r[0] === 1 ? 1 : 0;
      out.set(id, sides.length && conf ? { conf, sides } : { conf: 0, sides: [] });
    }
  return { get: (id) => out.get(id), size: out.size };
}

let promise: Promise<FrontageIndex> | null = null;

/** Plot id → its frontage direction; fetched once per session, empty on any failure. */
export function loadFrontage(): Promise<FrontageIndex> {
  promise ??= fetch("/frontage.json")
    .then((r) => (r.ok ? (r.json() as Promise<File>) : null))
    .then(parseFrontage)
    .catch(() => parseFrontage(null));
  return promise;
}
