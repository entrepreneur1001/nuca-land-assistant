import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Integrity of the committed compounds layer (public/compounds, built by scripts/compounds/build_compounds.py).
 * Only checked master plans are published: each must say how it was checked, have its image, and clip inside it.
 */
const dir = path.join(process.cwd(), "public", "compounds");
interface Compound {
  id: number;
  name: string;
  bounds: [[number, number], [number, number]];
  ring: [number, number][];
  img: boolean;
  plan: {
    kind: string;
    status: "verified" | "reviewed";
    w: number;
    h: number;
    corners: { tl: [number, number]; tr: [number, number]; bl: [number, number] };
    clip: [number, number][];
  } | null;
  devId: number | null;
  devLogo: string | null;
}
const { compounds } = JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8")) as { compounds: Compound[] };

describe("public/compounds", () => {
  it("lists compounds with unique ids and outlines", () => {
    expect(compounds.length).toBeGreaterThan(100);
    expect(new Set(compounds.map((c) => c.id)).size).toBe(compounds.length);
    for (const c of compounds) expect(c.ring.length, `${c.id} ring`).toBeGreaterThanOrEqual(3);
  });

  it("publishes only checked plans, each with its image and a clip inside the image", () => {
    for (const c of compounds) {
      if (!c.plan) {
        expect(c.img, `${c.id} has an image but no plan`).toBe(false);
        continue;
      }
      const p = c.plan;
      expect(["verified", "reviewed"], `${c.id} status`).toContain(p.status);
      expect(c.img, `${c.id} img`).toBe(true);
      expect(existsSync(path.join(dir, "img", `${c.id}.webp`)), `${c.id}.webp`).toBe(true);
      expect(p.w, `${c.id} w`).toBeGreaterThan(0);
      expect(p.h, `${c.id} h`).toBeGreaterThan(0);
      expect(p.clip.length, `${c.id} clip`).toBeGreaterThanOrEqual(3);
      for (const [x, y] of p.clip) {
        expect(x, `${c.id} clip x`).toBeGreaterThanOrEqual(0);
        expect(x, `${c.id} clip x`).toBeLessThanOrEqual(p.w);
        expect(y, `${c.id} clip y`).toBeGreaterThanOrEqual(0);
        expect(y, `${c.id} clip y`).toBeLessThanOrEqual(p.h);
      }
      for (const k of ["tl", "tr", "bl"] as const) {
        const [lat, lng] = p.corners[k];
        expect(lat, `${c.id} ${k} lat`).toBeGreaterThan(22);
        expect(lat, `${c.id} ${k} lat`).toBeLessThan(32);
        expect(lng, `${c.id} ${k} lng`).toBeGreaterThan(24);
        expect(lng, `${c.id} ${k} lng`).toBeLessThan(37);
      }
    }
  });

  it("references only developer logos that exist", () => {
    for (const c of compounds) {
      if (c.devLogo == null) continue;
      expect(c.devLogo, `${c.id} devLogo`).toMatch(/^\d+\.webp$/);
      expect(existsSync(path.join(dir, "logo", c.devLogo)), `${c.id} logo ${c.devLogo}`).toBe(true);
    }
  });
});
