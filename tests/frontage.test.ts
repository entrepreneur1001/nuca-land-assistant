import { describe, expect, it } from "vitest";
import { ORIENTATION_VALUES } from "@/engine/config";
import { compass8, directions, facesNorth, isCornerPlot, orientationFactor, plotFrontage, plotSides, sideVertices, type Frontage, type Ground, type Probe } from "@/engine/frontage";
import { boxOf, type Blocker, type XY } from "@/engine/surroundings";
import { scoreLands, type Profile, type ScorableLand } from "@/engine/scoring";
import { parseFrontage } from "@/lib/frontage";

// Local metres: x = east, y = north.
const rect = (x: number, y: number, w = 20, h = 30): XY[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const blocker = (poly: XY[]): Blocker => ({ poly, box: boxOf(poly) });
type Area = [x0: number, y0: number, x1: number, y1: number];
/** A plan that draws streets (or anything else) in the given boxes. */
const plan =
  (roads: Area[], other: [Area, Ground][] = []): Probe =>
  (x, y) => {
    for (const [a, g] of other) if (x >= a[0] && x <= a[2] && y >= a[1] && y <= a[3]) return g;
    for (const a of roads) if (x >= a[0] && x <= a[2] && y >= a[1] && y <= a[3]) return "road";
    return "other";
  };
const ctx = { trusted: true, roadColour: true };
const rotate = (ring: XY[], deg: number): XY[] => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return ring.map(([x, y]) => [x * c - y * s, x * s + y * c]);
};

// The plot under test is rect(0, 0): x 0–20, y 0–30. Streets are 12 m wide.
const NORTH: Area = [-100, 30, 100, 42];
const SOUTH: Area = [-100, -12, 100, 0];
const EAST: Area = [20, -100, 32, 100];
const WEST: Area = [-12, -100, 0, 100];

describe("compass8", () => {
  it("uses the eight 45° sectors, lower bound included", () => {
    expect(compass8(0)).toBe(0);
    expect(compass8(22.4)).toBe(0);
    expect(compass8(22.5)).toBe(1);
    expect(compass8(90)).toBe(2);
    expect(compass8(135)).toBe(3);
    expect(compass8(180)).toBe(4);
    expect(compass8(225)).toBe(5);
    expect(compass8(270)).toBe(6);
    expect(compass8(315)).toBe(7);
    expect(compass8(337.4)).toBe(7);
    expect(compass8(337.5)).toBe(0);
    expect(compass8(359.9)).toBe(0);
    expect(compass8(-90)).toBe(6);
  });
});

describe("plotSides", () => {
  it("gives a rectangle four sides facing the four directions, whatever the winding", () => {
    for (const ring of [rect(0, 0), [...rect(0, 0)].reverse()]) {
      const b = plotSides(ring).map((s) => Math.round(s.bearing)).sort((x, y) => x - y);
      expect(b).toEqual([0, 90, 180, 270]);
    }
  });

  it("merges the extra vertices of a traced side into one side", () => {
    // The north side is traced with two extra, slightly off-line vertices.
    const ring: XY[] = [[0, 0], [20, 0], [20, 30], [13, 30.4], [6, 29.7], [0, 30]];
    const sides = plotSides(ring);
    expect(sides).toHaveLength(4);
    const north = sides.find((s) => compass8(s.bearing) === 0)!;
    expect(north.edges).toHaveLength(3);
    expect(sideVertices(ring, north)).toEqual([[20, 30], [13, 30.4], [6, 29.7], [0, 30]]);
  });
});

describe("plotFrontage", () => {
  it("1. a rectangle on a street to its north faces بحري, high confidence", () => {
    const f = plotFrontage(rect(0, 0), plan([NORTH]), [blocker(rect(-20, 0)), blocker(rect(20, 0)), blocker(rect(0, -30))], ctx);
    expect(f.conf).toBe(2);
    expect(directions(f)).toEqual([0]);
    expect(f.sides[0].bearing).toBeCloseTo(0, 5);
    expect(f.sides[0].widthM).toBe(12);
  });

  it("2. a rectangle on a street to its south faces قبلي", () => {
    const f = plotFrontage(rect(0, 0), plan([SOUTH]), [blocker(rect(-20, 0)), blocker(rect(20, 0)), blocker(rect(0, 30))], ctx);
    expect(directions(f)).toEqual([4]);
    expect(f.conf).toBe(2);
  });

  it("3. a rotated plot on a street to its north-west faces بحري غربي", () => {
    // Turn the north-facing layout 45° anticlockwise: the street side now faces north-west.
    const turn = (r: XY[]) => rotate(r, 45);
    const street = turn([[-100, 30], [100, 30], [100, 42], [-100, 42]]);
    const inStreet: Probe = (x, y) => {
      // Back to the unrotated frame to test the box.
      const [ux, uy] = rotate([[x, y]], -45)[0];
      return ux >= -100 && ux <= 100 && uy >= 30 && uy <= 42 ? "road" : "other";
    };
    expect(street).toHaveLength(4);
    const f = plotFrontage(turn(rect(0, 0)), inStreet, [blocker(turn(rect(-20, 0))), blocker(turn(rect(20, 0)))], ctx);
    expect(directions(f)).toEqual([7]);
    expect(f.sides[0].bearing).toBeCloseTo(315, 0);
  });

  it("4. a corner plot on streets to its north and west has both frontages", () => {
    const f = plotFrontage(rect(0, 0), plan([NORTH, WEST]), [blocker(rect(20, 0)), blocker(rect(0, -30))], { ...ctx, corner: true });
    expect(directions(f).sort()).toEqual([0, 6]);
    expect(isCornerPlot(f)).toBe(true);
    expect(f.conf).toBe(2);
  });

  it("5. a plot between streets to its east and west has two frontages and is not a corner", () => {
    const f = plotFrontage(rect(0, 0), plan([EAST, WEST]), [blocker(rect(0, 30)), blocker(rect(0, -30))], { ...ctx, corner: false });
    expect(directions(f).sort()).toEqual([2, 6]);
    expect(isCornerPlot(f)).toBe(false);
    expect(f.conf).toBe(2);
  });

  it("6. an irregular plot with a cut corner reports its real sides, not the cut", () => {
    // Seven vertices: a cut corner at the north-west, a bent south side, streets north and west.
    const ring: XY[] = [[0, 0], [10, -0.5], [20, 0], [20, 30], [3, 30], [0, 27], [0, 12]];
    const f = plotFrontage(ring, plan([NORTH, WEST]), [blocker(rect(20, 0))], ctx);
    expect(directions(f).sort()).toEqual([0, 6]);
    expect(isCornerPlot(f)).toBe(true);
  });

  it("7. a plot surrounded by other plots is not determined", () => {
    const around = [rect(-20, 0), rect(20, 0), rect(0, 30), rect(0, -30)].map(blocker);
    expect(plotFrontage(rect(0, 0), plan([]), around, ctx)).toEqual({ conf: 0, sides: [] });
  });

  it("an open side with no street drawn (the zone's edge, a garden) is not a frontage", () => {
    const sides = [blocker(rect(-20, 0)), blocker(rect(20, 0))];
    // Street to the south; nothing but blank paper to the north.
    expect(directions(plotFrontage(rect(0, 0), plan([SOUTH]), sides, ctx))).toEqual([4]);
    // A garden to the north instead of a street.
    const garden = plan([SOUTH], [[[-100, 30, 100, 60], "green"]]);
    expect(directions(plotFrontage(rect(0, 0), garden, sides, ctx))).toEqual([4]);
  });

  it("does not take the street behind the neighbouring plot for its own", () => {
    // The plot to the north stands between this plot and the street beyond it.
    const f = plotFrontage(rect(0, 0), plan([[-100, 60, 100, 72]]), [blocker(rect(0, 30))], ctx);
    expect(f.conf).toBe(0);
  });

  it("is medium when the corner count disagrees with the official corner premium, or the zone is not trusted", () => {
    const sides = [blocker(rect(-20, 0)), blocker(rect(20, 0)), blocker(rect(0, -30))];
    expect(plotFrontage(rect(0, 0), plan([NORTH]), sides, { ...ctx, corner: true }).conf).toBe(1);
    expect(plotFrontage(rect(0, 0), plan([NORTH]), sides, { ...ctx, trusted: false }).conf).toBe(1);
  });

  it("is medium on a faded street drawn outside the zone", () => {
    const faded = plan([], [[NORTH, "pale"]]);
    const f = plotFrontage(rect(0, 0), faded, [blocker(rect(-20, 0)), blocker(rect(20, 0))], ctx);
    expect(directions(f)).toEqual([0]);
    expect(f.conf).toBe(1);
  });

  it("without a road colour, only a gap with plots across counts, at medium", () => {
    const noColour = { trusted: true, roadColour: false };
    const sides = [blocker(rect(-20, 0)), blocker(rect(20, 0)), blocker(rect(0, -30))];
    expect(plotFrontage(rect(0, 0), plan([]), sides, noColour).conf).toBe(0);
    const f = plotFrontage(rect(0, 0), plan([]), [...sides, blocker(rect(0, 42))], noColour);
    expect(directions(f)).toEqual([0]);
    expect(f.conf).toBe(1);
  });
});

describe("orientationFactor", () => {
  const f = (conf: 0 | 1 | 2, ...bearings: number[]): Frontage => ({ conf, sides: bearings.map((bearing) => ({ bearing, from: 0, to: 1, widthM: 10 })) });
  it("ranks بحري above شرقي above قبلي, with unknown neutral", () => {
    const n = orientationFactor(f(2, 0));
    const e = orientationFactor(f(2, 90));
    const s = orientationFactor(f(2, 180));
    expect(n).toBeGreaterThan(e);
    expect(e).toBeGreaterThan(s);
    expect(orientationFactor(null)).toBe(ORIENTATION_VALUES.unknown);
    expect(orientationFactor(f(0))).toBe(ORIENTATION_VALUES.unknown);
    expect(n).toBeGreaterThan(ORIENTATION_VALUES.unknown);
    expect(s).toBeLessThan(ORIENTATION_VALUES.unknown);
  });

  it("takes the best side of a corner plot", () => {
    expect(orientationFactor(f(1, 180, 0))).toBe(orientationFactor(f(2, 0)));
    expect(facesNorth(f(1, 180, 0))).toBe(true);
    expect(facesNorth(f(2, 180))).toBe(false);
  });
});

describe("parseFrontage", () => {
  it("reads the file and ignores unknown versions and broken rows", () => {
    const idx = parseFrontage({ v: 1, generated: "x", plots: { a: [2, [[0, 2, 3, 12]]], b: [0, []], c: [1, [[270, 0, 1, 8], [180.5, 1, 2, 0]]] } });
    expect(idx.get("a")).toEqual({ conf: 2, sides: [{ bearing: 0, from: 2, to: 3, widthM: 12 }] });
    expect(idx.get("b")).toEqual({ conf: 0, sides: [] });
    expect(idx.get("c")!.sides).toHaveLength(2);
    expect(idx.get("zz")).toBeUndefined();
    expect(parseFrontage({ v: 9, generated: "x", plots: { a: [2, []] } } as never).size).toBe(0);
    expect(parseFrontage(null).size).toBe(0);
  });
});

describe("the north preference", () => {
  const land = (id: string, bearing: number | null): ScorableLand => ({
    id,
    cityName: "c",
    projectId: "p",
    projectName: "p",
    plotNumber: id,
    area: 500,
    pricePerMeter: 100,
    totalPrice: 50000,
    downPayment: 10000,
    gardenPct: 0,
    cornerPct: 0,
    seaPct: 0,
    status: "available",
    latitude: 30,
    frontage: bearing == null ? null : { conf: 2, sides: [{ bearing, from: 0, to: 1, widthM: 10 }] },
  });
  const lands = [land("n", 0), land("s", 180), land("u", null)];
  const base: Profile = { bookingRank: 1, moneyPaid: 99999, preferredCities: [], preferredProjects: [], minArea: null, maxArea: null, preferredArea: null, maxPrice: null, preferredPricePerMeter: null };
  const ctx = { survival: new Map(lands.map((l) => [l.id, { low: 1, mid: 1, high: 1 }])), cityPopularity: new Map() };
  const run = (north: "prefer" | "require" | "ignore") => scoreLands(lands, { ...base, preferences: { north } }, ctx);

  it("prefer ranks بحري first and قبلي last", () => {
    const by = new Map(run("prefer").scored.map((x) => [x.id, x.score]));
    expect(by.get("n")!).toBeGreaterThan(by.get("u")!);
    expect(by.get("u")!).toBeGreaterThan(by.get("s")!);
  });

  it("require keeps only plots facing north", () => {
    const r = run("require");
    expect(r.scored.map((x) => x.id)).toEqual(["n"]);
    expect(r.excluded.featureRequired).toBe(2);
  });

  it("ignore scores every direction the same", () => {
    const scores = new Set(run("ignore").scored.map((x) => x.score));
    expect(scores.size).toBe(1);
  });
});
