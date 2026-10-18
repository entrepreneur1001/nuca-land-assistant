import { describe, expect, it } from "vitest";
import { sectorDemand, turnNearness } from "@/engine/demand";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const DAY = 86_400_000;

/** `recent` plots booked this week and `left` still available in one district. */
const district = (projectId: string, cityName: string, recent: number, left: number, old = 0) => [
  ...Array.from({ length: recent }, () => ({ projectId, cityName, status: "booked", bookingDate: new Date(NOW - DAY).toISOString() })),
  ...Array.from({ length: old }, () => ({ projectId, cityName, status: "booked", bookingDate: new Date(NOW - 30 * DAY).toISOString() })),
  ...Array.from({ length: left }, () => ({ projectId, cityName, status: "available", bookingDate: null })),
];

describe("district booking speed", () => {
  it("ranks districts by the share of their inventory sold this week", () => {
    const d = sectorDemand([...district("fast", "A", 40, 60), ...district("slow", "B", 10, 190)], NOW);
    expect(d.get("fast")).toBe(1);
    expect(d.get("slow")!).toBeLessThan(0.3);
  });

  it("old bookings don't count as speed", () => {
    const d = sectorDemand([...district("busy", "A", 20, 80), ...district("sold-earlier", "B", 0, 80, 500)], NOW);
    expect(d.get("sold-earlier")).toBe(0);
  });

  it("a single booking in a tiny district isn't a trend", () => {
    // "tiny" sold 1 of 2 plots, but its city is calm overall; "big" sold 40 of 200.
    const d = sectorDemand([...district("tiny", "A", 1, 1), ...district("calm", "A", 2, 198), ...district("big", "B", 40, 160)], NOW);
    expect(d.get("tiny")!).toBeLessThan(d.get("big")!);
  });

  it("counts fully near the user's turn and fades out", () => {
    expect(turnNearness(0)).toBe(1);
    expect(turnNearness(3)).toBe(1);
    expect(turnNearness(12)).toBeCloseTo(0.5, 5);
    expect(turnNearness(21)).toBe(0);
    expect(turnNearness(60)).toBe(0);
  });
});
