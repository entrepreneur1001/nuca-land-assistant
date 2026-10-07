import { describe, expect, it } from "vitest";
import type { Plot, Snapshot } from "@/data/snapshot";
import { buildPayload } from "@/ai/payload";
import { computeDashboard } from "@/engine/compute";
import { DEFAULT_PROFILE } from "@/lib/profile";

const NOW = Date.parse("2026-10-07T12:00:00Z");

function snapshot(): Snapshot {
  const plots: Plot[] = Array.from({ length: 400 }, (_, i) => ({
    id: `p${i}`,
    externalPlotId: null,
    plotNumber: String(i),
    cityName: i % 2 ? "أ" : "ب",
    projectId: `s${i % 5}`,
    projectName: `حي ${i % 5}`,
    zoneName: null,
    area: 500,
    pricePerMeter: 200,
    totalPrice: 100_000 + (i % 7) * 20_000,
    downPayment: 25_000 + (i % 7) * 5_000,
    cornerPct: i % 3 === 0 ? 10 : 0,
    gardenPct: i % 4 === 0 ? 5 : 0,
    seaPct: 0,
    latitude: 30 + i / 1e4,
    longitude: 31,
    status: i < 120 ? "booked" : "available",
    bookingDate: i < 120 ? new Date(NOW - (i % 7) * 86_400_000).toISOString() : null,
    builtKm: (i % 10) / 2,
    builtSrc: 0,
    mainRoadM: i % 5 === 0 ? 10 : 150,
    rules: null,
  }));
  return {
    meta: {
      schema: 1,
      dataVersion: "v1",
      statsAt: new Date(NOW - 60_000).toISOString(),
      fullSyncAt: new Date(NOW - 120_000).toISOString(),
      osmAt: null,
      lastError: null,
      lastErrorAt: null,
      source: { name: "x", url: "x" },
      market: { total: 400, booked: 120, available: 280, allocatedCodes: 180, sourceLastUpdate: null },
      allocations: [
        { id: "a", d: "2026-10-05T00:00:00Z", c: 90, b: 60 },
        { id: "b", d: "2026-10-06T00:00:00Z", c: 90, b: 60 },
      ],
      cities: ["أ", "ب"],
      sectors: [],
      zones: [],
      chunks: [],
    },
    plots,
  };
}

describe("browser engine", () => {
  it("never recommends booked or over-budget plots", () => {
    const { ranked, dashboard } = computeDashboard(snapshot(), { ...DEFAULT_PROFILE, bookingRank: 300, moneyPaid: 35_000 }, NOW);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((r) => r.status === "available" && r.downPayment <= 35_000)).toBe(true);
    expect(dashboard.top.length).toBeLessThanOrEqual(5);
    expect(dashboard.queue.peopleAhead).toBe(300 - 180);
    expect(dashboard.freshness.stale).toBe(false);
  });

  it("flags stale data when the sync stops", () => {
    const { dashboard } = computeDashboard(snapshot(), DEFAULT_PROFILE, NOW + 3 * 3600_000);
    expect(dashboard.freshness.stale).toBe(true);
  });

  it("a later rank sees fewer reachable plots", () => {
    const early = computeDashboard(snapshot(), { ...DEFAULT_PROFILE, bookingRank: 200 }, NOW).dashboard.reachable.expected;
    const late = computeDashboard(snapshot(), { ...DEFAULT_PROFILE, bookingRank: 600 }, NOW).dashboard.reachable.expected;
    expect(late).toBeLessThan(early);
  });
});

describe("AI payload", () => {
  it("omits unknown building rules and sends only the known fields", () => {
    const snap = snapshot();
    snap.plots.forEach((p, i) => {
      if (i % 2) p.rules = { ratio: "50 %", floors: null, setbacks: "3م امامي" };
    });
    const { ranked, dashboard } = computeDashboard(snap, { ...DEFAULT_PROFILE, bookingRank: 200, moneyPaid: 60_000 }, NOW);
    const lands = buildPayload(dashboard, ranked, DEFAULT_PROFILE).payload.lands;
    expect(lands.length).toBeGreaterThan(0);
    for (const l of lands) {
      const p = snap.plots.find((x) => x.id === l.land_id)!;
      if (p.rules) expect(l.building_rules).toEqual({ coverage: "50 %", setbacks: "3م امامي" });
      else expect("building_rules" in l).toBe(false);
      // only sent when confirmed; never "false"/"unknown"
      if (p.mainRoadM! <= 30) expect(l.on_main_road).toBe(true);
      else expect("on_main_road" in l).toBe(false);
    }
    expect(JSON.stringify(lands)).not.toMatch(/"floors":"unknown"/);
  });
});

describe("shared settings links", () => {
  it("missing parameters fall back to defaults instead of zero", async () => {
    const { fromQuery, toQuery, DEFAULT_PROFILE: D } = await import("@/lib/profile");
    const p = fromQuery(new URLSearchParams("r=5000"));
    expect(p.bookingRank).toBe(5000);
    expect(p.moneyPaid).toBe(D.moneyPaid);
    const round = fromQuery(new URLSearchParams(toQuery({ ...D, bookingRank: 9000, moneyPaid: 50000, preferredCities: ["بدر"] })));
    expect(round).toMatchObject({ bookingRank: 9000, moneyPaid: 50000, preferredCities: ["بدر"] });
  });
});
