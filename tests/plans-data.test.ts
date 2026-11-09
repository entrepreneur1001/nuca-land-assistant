import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Integrity of the committed zone plans (public/plans). The sync takes every plot's position from these files, so a
 * broken or badly scaled file moves real plots: these checks catch that before it is pushed.
 */
const dir = path.join(process.cwd(), "public", "plans");
interface ZoneFile {
  zid: number;
  w: number;
  h: number;
  corners: { tl: [number, number]; tr: [number, number]; bl: [number, number] };
  plots: Record<string, [number, number][]>;
  unassigned: [number, number][][];
}
interface Index {
  zones: Record<string, { city: string; name: string; sector: string | null; bounds: [[number, number], [number, number]]; plots: number }>;
}

const index = JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8")) as Index;
const files = new Map<string, ZoneFile>();
for (const n of readdirSync(dir)) if (/^\d+\.json$/.test(n)) files.set(n.replace(".json", ""), JSON.parse(readFileSync(path.join(dir, n), "utf8")) as ZoneFile);

const R = 6378137;
const merc = ([lat, lng]: [number, number]): [number, number] => [(lng * Math.PI * R) / 180, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R];
const shoelace = (p: [number, number][]) => Math.abs(p.reduce((s, [x, y], i) => s + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0)) / 2;
/** Ground m² per image px², and the image's ground width in metres. */
function scale(f: ZoneFile) {
  const [tl, tr, bl] = [merc(f.corners.tl), merc(f.corners.tr), merc(f.corners.bl)];
  const k = Math.cos((f.corners.tl[0] * Math.PI) / 180);
  const det = Math.abs((tr[0] - tl[0]) * (bl[1] - tl[1]) - (tr[1] - tl[1]) * (bl[0] - tl[0])) / (f.w * f.h);
  return { m2PerPx2: det * k * k, widthM: Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) * k };
}

describe("public/plans", () => {
  it("has one json and one webp per indexed zone, and the index counts the plots in each file", () => {
    expect([...files.keys()].sort()).toEqual(Object.keys(index.zones).sort());
    for (const [zid, f] of files) {
      expect(f.zid, zid).toBe(Number(zid));
      expect(existsSync(path.join(dir, `${zid}.webp`)), `${zid}.webp`).toBe(true);
      expect(index.zones[zid].plots, `index plots of ${zid}`).toBe(Object.keys(f.plots).length);
    }
  });

  it("places every plan inside Egypt at a believable size, with bounds that contain its corners", () => {
    for (const [zid, f] of files) {
      for (const c of [f.corners.tl, f.corners.tr, f.corners.bl]) {
        expect(c[0], `${zid} lat`).toBeGreaterThan(22);
        expect(c[0], `${zid} lat`).toBeLessThan(32);
        expect(c[1], `${zid} lng`).toBeGreaterThan(25);
        expect(c[1], `${zid} lng`).toBeLessThan(37);
      }
      const { widthM } = scale(f);
      expect(widthM, `${zid} ground width`).toBeGreaterThan(150);
      expect(widthM, `${zid} ground width`).toBeLessThan(8000);
      const [[s, w], [n, e]] = index.zones[zid].bounds;
      for (const c of [f.corners.tl, f.corners.tr, f.corners.bl]) {
        expect(c[0] >= s - 1e-5 && c[0] <= n + 1e-5 && c[1] >= w - 1e-5 && c[1] <= e + 1e-5, `${zid} corner inside bounds`).toBe(true);
      }
    }
  });

  it("draws every plot once, as a real polygon inside its image", () => {
    const owner = new Map<string, string>();
    for (const [zid, f] of files) {
      for (const [id, poly] of [...Object.entries(f.plots), ...f.unassigned.map((p, i) => [`unassigned ${i}`, p] as const)]) {
        expect(poly.length, `${zid} ${id} vertices`).toBeGreaterThanOrEqual(3);
        expect(shoelace(poly as [number, number][]), `${zid} ${id} area`).toBeGreaterThan(0);
        for (const [x, y] of poly) expect(x >= -1 && y >= -1 && x <= f.w + 1 && y <= f.h + 1, `${zid} ${id} vertex inside image`).toBe(true);
      }
      for (const id of Object.keys(f.plots)) {
        expect(owner.get(id), `plot ${id} is in ${zid} and ${owner.get(id)}`).toBeUndefined();
        owner.set(id, zid);
      }
    }
  });

  it("keeps plots at a believable ground size (a wrong plan scale shows up here)", () => {
    for (const [zid, f] of files) {
      const { m2PerPx2 } = scale(f);
      const areas = [...Object.values(f.plots), ...f.unassigned].map((p) => shoelace(p) * m2PerPx2).sort((a, b) => a - b);
      if (!areas.length) continue;
      const median = areas[areas.length >> 1];
      expect(median, `${zid} median plot m²`).toBeGreaterThan(100);
      expect(median, `${zid} median plot m²`).toBeLessThan(2500);
    }
  });
});
