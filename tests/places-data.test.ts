import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Integrity of the committed nearby places (public/places, produced by scripts/places/fetch_osm_places.mts from
 * OpenStreetMap + Wikidata logos). The maps and the plot page read these directly.
 */
const dir = path.join(process.cwd(), "public", "places");
const CATS = ["education", "sport", "health", "shopping", "transport", "landmark"];
type LL = [number, number];
interface Place {
  id: string;
  cat: string;
  sub: string;
  name: string;
  nameAr: string | null;
  lat: number;
  lng: number;
  ring?: LL[];
  wikidata?: string;
  logo?: string;
}
interface CityFile {
  cityId: string;
  generated: string;
  places: Place[];
}
interface Index {
  cities: Record<string, { count: number; bounds: [LL, LL] }>;
}

const has = existsSync(path.join(dir, "index.json"));
const index: Index = has ? JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8")) : { cities: {} };
const files = new Map<string, CityFile>();
if (has) for (const n of readdirSync(dir)) if (/^[a-z0-9-]+\.json$/.test(n) && n !== "index.json") files.set(n.replace(".json", ""), JSON.parse(readFileSync(path.join(dir, n), "utf8")));
const inEgypt = ([lat, lng]: LL) => lat > 22 && lat < 32 && lng > 25 && lng < 37;

describe.runIf(has)("public/places", () => {
  it("has one file per indexed city, each small, with the index counting its places", () => {
    expect([...files.keys()].sort()).toEqual(Object.keys(index.cities).sort());
    for (const [id, f] of files) {
      expect(f.cityId).toBe(id);
      expect(f.generated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(index.cities[id].count, id).toBe(f.places.length);
      expect(statSync(path.join(dir, `${id}.json`)).size, `${id}.json size`).toBeLessThan(400_000);
    }
  });

  it("gives every place a known category, a name and a point inside its city's bounds in Egypt", () => {
    for (const [id, f] of files) {
      const [[s, w], [n, e]] = index.cities[id].bounds;
      expect(inEgypt([s, w]) && inEgypt([n, e]), `${id} bounds`).toBe(true);
      const ids = new Set<string>();
      for (const p of f.places) {
        const tag = `${id}/${p.id}`;
        expect(p.id, tag).toMatch(/^[nwr]\d+$/);
        expect(ids.has(p.id), `${tag} duplicate`).toBe(false);
        ids.add(p.id);
        expect(CATS, tag).toContain(p.cat);
        expect(typeof p.sub, tag).toBe("string");
        expect(p.name.length, tag).toBeGreaterThan(0);
        expect(p.nameAr === null || typeof p.nameAr === "string", tag).toBe(true);
        expect(p.lat >= s && p.lat <= n && p.lng >= w && p.lng <= e, `${tag} inside bounds`).toBe(true);
        if (p.ring) {
          expect(p.id[0], `${tag} ring only on areas`).not.toBe("n");
          expect(p.ring.length, tag).toBeGreaterThanOrEqual(3);
          for (const q of p.ring) expect(inEgypt(q), `${tag} ring point`).toBe(true);
        }
        if (p.wikidata !== undefined) expect(p.wikidata, tag).toMatch(/^Q\d+$/);
      }
    }
  });

  it("points every logo at an existing webp named by the place's wikidata id", () => {
    for (const f of files.values())
      for (const p of f.places) {
        if (!p.logo) continue;
        expect(p.logo).toBe(`logo/${p.wikidata}.webp`);
        expect(existsSync(path.join(dir, p.logo)), p.logo).toBe(true);
      }
  });
});
