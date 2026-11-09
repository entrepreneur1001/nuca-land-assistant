import { describe, expect, it } from "vitest";
import { imagePointToLatLng, planCentroids, polygonCentroid, type PlanZoneFile } from "@/ingest/plan-places";

// A 1000×500 px plan rotated 90° clockwise on the map: the image's x axis points south, its y axis points east.
const FILE: PlanZoneFile = {
  zid: 1,
  w: 1000,
  h: 500,
  corners: { tl: [30.1, 31.0], tr: [30.09, 31.0], bl: [30.1, 31.005] },
  plots: {
    square: [
      [100, 100],
      [200, 100],
      [200, 200],
      [100, 200],
    ],
    sliver: [[1, 1]],
  },
};

describe("imagePointToLatLng", () => {
  it("maps the corners to themselves and the far corner by vector addition", () => {
    const tl = imagePointToLatLng(FILE, 0, 0);
    expect(tl[0]).toBeCloseTo(30.1, 9);
    expect(tl[1]).toBeCloseTo(31.0, 9);
    const tr = imagePointToLatLng(FILE, 1000, 0);
    expect(tr[0]).toBeCloseTo(30.09, 9);
    expect(tr[1]).toBeCloseTo(31.0, 9);
    const br = imagePointToLatLng(FILE, 1000, 500);
    expect(br[0]).toBeCloseTo(30.09, 6);
    expect(br[1]).toBeCloseTo(31.005, 6);
  });
  it("interpolates inside the image", () => {
    const mid = imagePointToLatLng(FILE, 500, 250);
    expect(mid[0]).toBeCloseTo(30.095, 6);
    expect(mid[1]).toBeCloseTo(31.0025, 6);
  });
});

describe("polygonCentroid", () => {
  it("is the centre of a square and the vertex mean of a degenerate polygon", () => {
    expect(polygonCentroid(FILE.plots.square)).toEqual([150, 150]);
    expect(polygonCentroid([[3, 4]])).toEqual([3, 4]);
  });
});

describe("planCentroids", () => {
  it("places every polygon with at least three vertices", () => {
    const m = planCentroids([FILE]);
    expect(m.size).toBe(1);
    const [lat, lng] = m.get("square")!;
    // 150 px along x = 15% of the way south, 150 px along y = 30% of the way east.
    expect(lat).toBeCloseTo(30.1 - 0.0015, 6);
    expect(lng).toBeCloseTo(31.0 + 0.0015, 6);
  });
});
