import { describe, expect, it } from "vitest";
import { GridIndex, computeBuiltDistances, distanceKm, nearBuiltFactor, neighbourBookedShare } from "@/engine/nearbuilt";

const P = (id: string, lat: number | null, lng: number | null, o: Record<string, unknown> = {}) => ({
  id,
  projectId: "s1",
  zoneName: "z",
  cityName: "c",
  latitude: lat,
  longitude: lng,
  status: "available",
  ...o,
});

describe("near-built factor", () => {
  it("is bounded and decreases with distance", () => {
    expect(nearBuiltFactor(0.2, 1)).toBeCloseTo(1, 5);
    expect(nearBuiltFactor(10, 0)).toBeCloseTo(0, 5);
    expect(nearBuiltFactor(1, 0.5)).toBeGreaterThan(nearBuiltFactor(3, 0.5));
    const unknown = nearBuiltFactor(null, null);
    expect(unknown).toBeCloseTo(0.3, 5);
  });

  it("grid nearest matches brute force", () => {
    const pts: [number, number][] = Array.from({ length: 300 }, (_, i) => [30 + ((i * 37) % 100) / 1000, 31 + ((i * 53) % 100) / 1000]);
    const g = new GridIndex<null>(0.01);
    for (const p of pts) g.add(p, null);
    const q: [number, number] = [30.05, 31.12];
    const brute = Math.min(...pts.map((p) => distanceKm(q, p)));
    expect(g.nearest(q)).toBeCloseTo(brute, 6);
  });

  it("uses the sector centre for plots without coordinates, and unknown without map data", () => {
    const plots = [P("a", 30.0, 31.0), P("b", 30.002, 31.002), P("c", null, null), P("d", null, null, { projectId: "other" })];
    const g = new GridIndex<null>(0.01);
    g.add([30.001, 31.001], null);
    const d = computeBuiltDistances(plots, g);
    expect(d.get("a")!.src).toBe(0);
    expect(d.get("c")!.src).toBe(1);
    expect(d.get("c")!.km).toBeLessThan(0.1);
    expect(d.get("d")).toEqual({ km: null, src: 2 });
    const empty = computeBuiltDistances(plots, new GridIndex<null>());
    expect(empty.get("a")).toEqual({ km: null, src: 2 });
  });

  it("neighbour share counts booked plots within 400 m (excluding the plot itself)", () => {
    const plots = [
      P("x", 30, 31),
      P("n1", 30.001, 31, { status: "booked" }),
      P("n2", 30, 31.001, { status: "booked" }),
      P("n3", 30.001, 31.001),
      P("far", 30.05, 31.05, { status: "booked" }),
    ];
    const s = neighbourBookedShare(plots);
    expect(s.get("x")).toBeCloseTo(2 / 3, 5);
  });
});
