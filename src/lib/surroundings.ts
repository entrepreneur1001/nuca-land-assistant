/**
 * What each plot faces (public/surroundings.json, produced offline by scripts/surroundings/build.mts): a main
 * road, a compound, existing buildings, services near it. Optional like the compounds: a missing or broken file
 * means "not measured", which scores neutral.
 */
import type { Faces } from "@/engine/surroundings";

type Row = [
  number | null,
  number,
  number | null,
  number | null,
  [string, string, string, number][],
  (number | null)?,
  number?,
  (number | null)?,
];
interface File {
  v: number;
  compounds: Record<string, [string, 0 | 1]>;
  plots: Record<string, Row>;
  /** 12-character id prefixes of the measured plots that face nothing, concatenated. */
  plain: string;
}

const PREFIX = 12;

export interface SurroundingsIndex {
  get(id: string): Faces | undefined;
  readonly size: number;
}

const NONE: Faces = { road: null, compound: null, built: null, services: [] };

export function parseSurroundings(
  f: File | null | undefined,
): SurroundingsIndex {
  const out = new Map<string, Faces>();
  const plain = new Set<string>();
  if (f && f.v === 2 && f.plots && typeof f.plain === "string") {
    for (let i = 0; i + PREFIX <= f.plain.length; i += PREFIX)
      plain.add(f.plain.slice(i, i + PREFIX));
    for (const [id, r] of Object.entries(f.plots)) out.set(id, decode(f, r));
  }
  return {
    get: (id) =>
      out.get(id) ?? (plain.has(id.slice(0, PREFIX)) ? NONE : undefined),
    size: out.size + plain.size,
  };
}

function decode(f: File, r: Row): Faces {
  const [road, cid, cm, built, svc, land, nid, nm] = r;
  const c = cid ? f.compounds[cid] : undefined;
  const n = nid ? f.compounds[nid] : undefined;
  return {
    road,
    compound:
      c && cm != null
        ? { id: cid, name: c[0], premium: c[1] === 1, m: cm }
        : null,
    built,
    servicesLand: land ?? null,
    nearCompound: n && nm != null ? { id: nid!, name: n[0], premium: n[1] === 1, m: nm } : null,
    services: (svc ?? []).map(([cat, sub, name, m]) => ({ cat, sub, name, m })),
  };
}

let promise: Promise<SurroundingsIndex> | null = null;

/** Plot id → what it faces; fetched once per session, empty on any failure. */
export function loadSurroundings(): Promise<SurroundingsIndex> {
  promise ??= fetch("/surroundings.json")
    .then((r) => (r.ok ? (r.json() as Promise<File>) : null))
    .then(parseSurroundings)
    .catch(() => parseSurroundings(null));
  return promise;
}
