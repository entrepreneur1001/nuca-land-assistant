import { describe, expect, it } from "vitest";
import { buildRoadIndex, computeRoadDistances, isOnMainRoad, segmentDistanceKm, type Segment } from "@/engine/roads";

describe("main-road distance", () => {
  it("measures point-to-segment distance, clamped to the segment ends", () => {
    // ~111 m north of a west–east road at latitude 30
    expect(segmentDistanceKm([30.001, 31.0005], [30, 31], [30, 31.001]) * 1000).toBeCloseTo(111.3, 0);
    // beyond the east end: distance to the endpoint, not the infinite line
    const d = segmentDistanceKm([30, 31.002], [30, 31], [30, 31.001]) * 1000;
    expect(d).toBeGreaterThan(90);
    expect(d).toBeLessThan(100);
  });

  it("uses the plot outline, so a big plot touching the road counts even if its centre is far", () => {
    // one long segment: the index must still find it from a plot near its middle
    const road: Segment[] = [[[30, 30.9], [30, 31.1]]];
    const plot = (id: string, south: number) => ({
      id,
      latitude: south + 0.0002,
      longitude: 31,
      geometry: { type: "Polygon", coordinates: [[[31, south], [31.0004, south], [31.0004, south + 0.0004], [31, south + 0.0004], [31, south]]] },
    });
    const m = computeRoadDistances([plot("front", 30.0001), plot("back", 30.0015), { id: "nopos", latitude: null, longitude: null }], buildRoadIndex(road));
    expect(m.get("front")).toBe(11);
    expect(isOnMainRoad(m.get("front"))).toBe(true);
    expect(m.get("back")).toBeGreaterThan(150);
    expect(isOnMainRoad(m.get("back"))).toBe(false);
    expect(m.get("nopos")).toBeNull();
  });

  it("no mapped roads at all is unknown, not far", () => {
    const m = computeRoadDistances([{ id: "a", latitude: 30, longitude: 31 }], buildRoadIndex([]));
    expect(m.get("a")).toBeNull();
  });
});
