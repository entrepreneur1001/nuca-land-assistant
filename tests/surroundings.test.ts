import { describe, expect, it } from "vitest";
import { boxOf, facingDistance, surroundingsFactor, type Blocker, type Faces, type XY } from "@/engine/surroundings";
import { parseSurroundings } from "@/lib/surroundings";
import { scoreLands, type Profile, type ScorableLand } from "@/engine/scoring";

const square = (x: number, y: number, s = 20): XY[] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];
const blocker = (poly: XY[]): Blocker => ({ poly, box: boxOf(poly) });
// A road running west–east along y = 0.
const road: XY[] = [
  [-500, 0],
  [500, 0],
];

describe("facingDistance", () => {
  it("finds the road in front of a plot", () => {
    expect(facingDistance(square(0, 30), [road], [], 100)).toBe(30);
  });

  it("ignores roads beyond the limit", () => {
    expect(facingDistance(square(0, 130), [road], [], 100)).toBeNull();
  });

  it("does not count the second row behind a front plot", () => {
    const front = square(0, 30);
    const back = square(0, 50);
    expect(facingDistance(back, [road], [blocker(front)], 100)).toBeNull();
  });

  it("does not see through the border gap between two front plots", () => {
    // Front row: two plots with a 1 m gap at x = 20..21; the back plot sits right behind the gap.
    const fronts = [blocker(square(0, 30)), blocker(square(21, 30))];
    expect(facingDistance(square(10, 50), [road], fronts, 100)).toBeNull();
  });

  it("sees through a real street between plots", () => {
    // 15 m street between x = 20 and x = 35: a plot behind it, offset into the street line, sees the road.
    const fronts = [blocker(square(0, 30)), blocker(square(35, 30))];
    expect(facingDistance(square(22, 50, 10), [road], fronts, 100)).toBe(50);
  });

  it("a compound across a main road is not faced", () => {
    const compound: XY[] = [...square(0, -80, 60), [0, -80]];
    expect(facingDistance(square(0, 30), [compound], [], 100)).toBe(50);
    expect(facingDistance(square(0, 30), [compound], [], 100, [road])).toBeNull();
  });
});

describe("surroundingsFactor", () => {
  const f = (x: Partial<Faces>): Faces => ({ road: null, compound: null, built: null, services: [], ...x });
  it("ranks premium compound > compound > road > buildings > nothing, with unknown neutral", () => {
    const pc = surroundingsFactor(f({ compound: { id: 1, name: "x", premium: true, m: 20 } }));
    const c = surroundingsFactor(f({ compound: { id: 1, name: "x", premium: false, m: 20 } }));
    const r = surroundingsFactor(f({ road: 30 }));
    const b = surroundingsFactor(f({ built: 30 }));
    const none = surroundingsFactor(f({}));
    expect(pc).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(none);
    expect(surroundingsFactor(f({ servicesLand: 30 }))).toBeGreaterThan(none);
    expect(surroundingsFactor(f({ servicesLand: 30, road: 40 }))).toBeGreaterThan(r);
    // Near a compound (e.g. across a highway) counts, less than facing one directly.
    const nearC = surroundingsFactor(f({ nearCompound: { id: 1, name: "x", premium: false, m: 250 } }));
    expect(nearC).toBeGreaterThan(none);
    expect(nearC).toBeLessThan(c);
    expect(surroundingsFactor(null)).toBe(none);
  });
  it("adds for a road plus a compound and for a nearby university, capped at 1", () => {
    expect(surroundingsFactor(f({ road: 30, compound: { id: 1, name: "x", premium: false, m: 20 } }))).toBeGreaterThan(
      surroundingsFactor(f({ compound: { id: 1, name: "x", premium: false, m: 20 } })),
    );
    const uni = { cat: "education", sub: "university", name: "u", m: 800 };
    expect(surroundingsFactor(f({ road: 30, services: [uni] }))).toBeGreaterThan(surroundingsFactor(f({ road: 30 })));
    expect(surroundingsFactor(f({ road: 30, built: 20, compound: { id: 1, name: "x", premium: true, m: 20 }, services: [uni] }))).toBe(1);
    // Schools are everywhere: no bonus.
    expect(surroundingsFactor(f({ services: [{ cat: "education", sub: "school", name: "s", m: 100 }] }))).toBe(surroundingsFactor(f({})));
  });
});

describe("parseSurroundings", () => {
  it("decodes rows, 0 = measured with nothing, bad files = empty", () => {
    const m = parseSurroundings({
      v: 2,
      compounds: { "7": ["كمبوند", 1] },
      plots: { b: [40, 7, 25, null, [["education", "university", "جامعة", 900]]], d: [null, 0, null, null, [], 35, 7, 240] },
      plain: "aaaaaaaaaaaacccccccccccc",
    });
    expect(m.get("unmeasured")).toBeUndefined();
    expect(m.get("aaaaaaaaaaaa-rest-of-id")).toEqual({ road: null, compound: null, built: null, services: [] });
    expect(m.get("b")).toEqual({
      road: 40,
      compound: { id: 7, name: "كمبوند", premium: true, m: 25 },
      built: null,
      servicesLand: null,
      nearCompound: null,
      services: [{ cat: "education", sub: "university", name: "جامعة", m: 900 }],
    });
    expect(m.get("d")?.servicesLand).toBe(35);
    expect(m.get("d")?.nearCompound).toEqual({ id: 7, name: "كمبوند", premium: true, m: 240 });
    expect(m.get("b")?.nearCompound).toBeNull();
    expect(parseSurroundings(null).size).toBe(0);
    expect(parseSurroundings({ v: 1, compounds: {}, plots: {}, plain: "aaaaaaaaaaaa" }).size).toBe(0);
  });
});

describe("scoring with surroundings", () => {
  const land = (id: string, faces: Faces | null): ScorableLand => ({
    id,
    cityName: "c",
    projectId: "p",
    projectName: "p",
    plotNumber: id,
    area: 500,
    pricePerMeter: 100,
    totalPrice: 50000,
    downPayment: 5000,
    gardenPct: 0,
    cornerPct: 0,
    seaPct: 0,
    status: "available",
    latitude: 30,
    builtKm: null,
    mainRoadM: null,
    faces,
  });
  const profile: Profile = {
    bookingRank: 1,
    moneyPaid: 100000,
    preferredCities: [],
    preferredProjects: [],
    minArea: null,
    maxArea: null,
    preferredArea: null,
    maxPrice: null,
    preferredPricePerMeter: null,
  };
  const none: Faces = { road: null, compound: null, built: null, services: [] };
  const lands = [
    land("plain", none),
    land("road", { ...none, road: 30 }),
    land("compound", { ...none, compound: { id: 1, name: "ميفيدا", premium: true, m: 25 } }),
  ];
  const surv = new Map(lands.map((l) => [l.id, { low: 0.9, mid: 0.9, high: 0.9 }]));
  const ctx = { survival: surv, cityPopularity: new Map([["c", 1]]) };

  it("puts a plot facing a premium compound above one on a road, above an inner plot", () => {
    const { scored } = scoreLands(lands, profile, ctx);
    expect(scored.map((s) => s.id)).toEqual(["compound", "road", "plain"]);
    const c = scored.find((s) => s.id === "compound")!;
    expect(c.reasons.some((r) => r.includes("ميفيدا"))).toBe(true);
    expect(scored.find((s) => s.id === "road")!.hasStreet).toBe(true);
  });

  it("'require' keeps only plots that face something", () => {
    const { scored, excluded } = scoreLands(lands, { ...profile, preferences: { facing: "require" } }, ctx);
    expect(scored.map((s) => s.id).sort()).toEqual(["compound", "road"]);
    expect(excluded.featureRequired).toBe(1);
  });
});
