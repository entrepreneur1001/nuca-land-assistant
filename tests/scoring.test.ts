import { describe, expect, it } from "vitest";
import { scoreLands, type Profile, type ScorableLand } from "@/engine/scoring";

const profile: Profile = {
  bookingRank: 17000,
  moneyPaid: 39500,
  moneyAvailable: null,
  maxAdditional: 0,
  preferredCities: [],
  preferredProjects: [],
  minArea: null,
  maxArea: null,
  preferredArea: null,
  maxPrice: null,
  preferredPricePerMeter: null,
  preferences: { garden: "prefer", corner: "prefer" },
};

const land = (id: string, o: Partial<ScorableLand> = {}): ScorableLand => ({
  id,
  cityName: "City",
  projectId: "p1",
  projectName: "Project",
  plotNumber: id,
  area: 600,
  pricePerMeter: 200,
  totalPrice: 120000,
  downPayment: 30000,
  gardenPct: 0,
  cornerPct: 0,
  seaPct: 0,
  status: "available",
  latitude: 30,
  ...o,
});

const ctx = (ids: string[], s = 0.9) => ({
  survival: new Map(ids.map((id) => [id, { low: s - 0.1, mid: s, high: s + 0.05 }])),
  cityPopularity: new Map([["City", 1]]),
  dataConfidence: 1,
});

describe("budget", () => {
  it("never recommends a plot whose down payment exceeds the budget", () => {
    const lands = [land("ok"), land("pricey", { downPayment: 39501, totalPrice: 158004 })];
    const r = scoreLands(lands, profile, ctx(["ok", "pricey"]));
    expect(r.scored.map((s) => s.id)).toEqual(["ok"]);
    expect(r.excluded.overBudget).toBe(1);
  });

  it("max additional payment widens the budget", () => {
    const lands = [land("pricey", { downPayment: 45000 })];
    const r = scoreLands(lands, { ...profile, maxAdditional: 10000 }, ctx(["pricey"]));
    expect(r.scored).toHaveLength(1);
    expect(r.scored[0].extraNeeded).toBe(5500);
    expect(r.scored[0].factors.budget).toBeLessThan(1);
  });
});

describe("availability", () => {
  it("booked lands never appear in recommendations", () => {
    const lands = [land("a"), land("b", { status: "booked" }), land("c")];
    const r = scoreLands(lands, profile, ctx(["a", "b", "c"]));
    expect(r.scored.find((s) => s.id === "b")).toBeUndefined();
    expect(r.excluded.booked).toBe(1);
  });
});

describe("garden + corner priority", () => {
  it("garden+corner outranks an otherwise identical plain plot", () => {
    const lands = [land("plain"), land("gc", { gardenPct: 5, cornerPct: 10 })];
    const r = scoreLands(lands, profile, ctx(["plain", "gc"]));
    expect(r.scored[0].id).toBe("gc");
    expect(r.scored[0].hasGarden && r.scored[0].hasCorner).toBe(true);
    expect(r.scored[0].reasons[0]).toContain("Garden view + corner");
  });

  it("'require garden' filters out non-garden plots", () => {
    const lands = [land("plain"), land("corner", { cornerPct: 10 }), land("garden", { gardenPct: 5 })];
    const r = scoreLands(lands, { ...profile, preferences: { garden: "require" } }, ctx(["plain", "corner", "garden"]));
    expect(r.scored.map((s) => s.id)).toEqual(["garden"]);
    expect(r.excluded.featureRequired).toBe(2);
  });
});

describe("reachability gate", () => {
  it("an unlikely-to-survive plot cannot be STRONG_BUY/GOOD and ranks below reachable ones", () => {
    const lands = [land("reach"), land("dream", { gardenPct: 5, cornerPct: 10, pricePerMeter: 150 })];
    const c = ctx(["reach", "dream"]);
    c.survival.set("dream", { low: 0.05, mid: 0.1, high: 0.2 });
    c.survival.set("reach", { low: 0.8, mid: 0.9, high: 0.95 });
    const r = scoreLands(lands, profile, c);
    const dream = r.scored.find((s) => s.id === "dream")!;
    expect(["WATCH", "SKIP"]).toContain(dream.recommendation);
    expect(dream.reach).toBe("UNLIKELY");
  });
});
