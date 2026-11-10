import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pastZoneInView, pastZonesOfCity, type PastPlanIndex } from "@/lib/past-plans";

const DIR = path.join(process.cwd(), "public", "plans", "past");
const index: PastPlanIndex = existsSync(path.join(DIR, "index.json")) ? JSON.parse(readFileSync(path.join(DIR, "index.json"), "utf8")) : { zones: {} };
const zones = Object.entries(index.zones);

/** Ground metres between two [lat, lng] points (equirectangular; fine at plan size). */
const metres = (a: [number, number], b: [number, number]) => {
  const k = Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * 111_320, (a[1] - b[1]) * 111_320 * k);
};

describe("committed earlier-stage plans (public/plans/past)", () => {
  it("has an image for every index entry and no stray images", () => {
    const images = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".webp")).map((f) => f.slice(0, -5)).sort() : [];
    expect(images).toEqual(zones.map(([zid]) => zid).sort());
  });

  it("places every plan inside Egypt at a believable size, with its stage and project", () => {
    for (const [zid, z] of zones) {
      const where = `zone ${zid}`;
      expect(z.city, where).toBeTruthy();
      expect(z.stage, where).toMatch(/^\d+c?$/);
      expect(z.pid, where).toBeGreaterThan(0);
      expect(z.w, where).toBeGreaterThan(100);
      expect(z.h, where).toBeGreaterThan(100);
      for (const c of [z.corners.tl, z.corners.tr, z.corners.bl]) {
        expect(c[0] > 22 && c[0] < 32 && c[1] > 25 && c[1] < 37, where).toBe(true);
        expect(c[0] >= z.bounds[0][0] - 1e-6 && c[0] <= z.bounds[1][0] + 1e-6 && c[1] >= z.bounds[0][1] - 1e-6 && c[1] <= z.bounds[1][1] + 1e-6, where).toBe(true);
      }
      const width = metres(z.corners.tl, z.corners.tr);
      const height = metres(z.corners.tl, z.corners.bl);
      expect(width > 100 && width < 6000, `${where}: ${Math.round(width)} m wide`).toBe(true);
      // The image is not stretched: ground metres per pixel agree along both edges.
      expect(Math.abs(width / z.w / (height / z.h) - 1), where).toBeLessThan(0.05);
      for (const [x, y] of z.clip ?? []) expect(x >= 0 && x <= z.w && y >= 0 && y <= z.h, where).toBe(true);
    }
  });
});

describe("earlier-stage plan lookup", () => {
  const idx: PastPlanIndex = {
    zones: {
      a: { city: "X", name: "A", stage: "10", pid: 1, w: 100, h: 100, corners: { tl: [30.01, 31], tr: [30.01, 31.01], bl: [30, 31] }, bounds: [[30, 31], [30.01, 31.01]] },
      b: { city: "Y", name: "B", stage: "9", pid: 2, w: 100, h: 100, corners: { tl: [30.01, 31], tr: [30.01, 31.01], bl: [30, 31] }, bounds: [[30, 31], [30.01, 31.01]] },
    },
  };

  it("lists a city's zones and none without an index", () => {
    expect(pastZonesOfCity(idx, "X").map(([zid]) => zid)).toEqual(["a"]);
    expect(pastZonesOfCity(null, "X")).toEqual([]);
  });

  it("keeps only zones touching the view", () => {
    const z = idx.zones.a;
    expect(pastZoneInView(z, [[30.005, 31.005], [30.02, 31.02]])).toBe(true);
    expect(pastZoneInView(z, [[30.02, 31], [30.03, 31.01]])).toBe(false);
    expect(pastZoneInView(z, [[30, 31.02], [30.01, 31.03]])).toBe(false);
  });
});
