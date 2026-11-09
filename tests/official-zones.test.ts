import { describe, expect, it } from "vitest";
import { OFFICIAL_CITIES, OFFICIAL_ZONES } from "@/data/official-zones";
import { buildOfficialIndex, normalizeName } from "@/ingest/official-map";

describe("official zone mapping table", () => {
  it("has unique zone ids, cities known to the table, and squares keyed by their normalized name", () => {
    const zids = OFFICIAL_ZONES.map((z) => z.zid);
    expect(new Set(zids).size).toBe(zids.length);
    for (const z of OFFICIAL_ZONES) {
      expect(OFFICIAL_CITIES[z.cityId]).toBe(z.city);
      for (const k of Object.keys(z.squares)) expect(normalizeName(k)).toBe(k);
    }
  });

  it("keeps each snapshot (city, zone) inside one official zone (several squares may share it)", () => {
    const seen = new Map<string, number>();
    for (const z of OFFICIAL_ZONES)
      for (const m of Object.values(z.squares)) {
        if (!m.sector) continue;
        const key = `${z.city}|${m.zone}`;
        expect(seen.get(key) ?? z.zid).toBe(z.zid);
        seen.set(key, z.zid);
      }
    expect(seen.size).toBeGreaterThan(100);
  });

  it("resolves a snapshot zone back to its official zone", () => {
    const index = buildOfficialIndex(OFFICIAL_ZONES, OFFICIAL_CITIES);
    for (const z of OFFICIAL_ZONES) for (const m of Object.values(z.squares)) if (m.sector) expect(index.zidOf(z.city, m.zone)).toBe(z.zid);
  });
});
