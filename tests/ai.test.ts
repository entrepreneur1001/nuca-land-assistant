import { describe, expect, it } from "vitest";
import { parseAiResponse } from "@/ai/schema";
import { refreshReasons } from "@/ai/service";

const valid = (ids: string[]) =>
  JSON.stringify({
    recommendations: ids.map((id, i) => ({
      land_id: id, rank: i + 1, score: 80, recommendation: "GOOD", reason: "r", risks: [], confidence: 0.8,
    })),
    market_summary: "m",
    strategy: "s",
    warnings: [],
  });

describe("Gemini response handling", () => {
  it("invalid JSON is handled safely", () => {
    expect(parseAiResponse("not json {", new Set(["a"]))).toEqual({ ok: false, error: "response was not valid JSON" });
    expect(parseAiResponse(undefined, new Set(["a"])).ok).toBe(false);
    const wrongShape = parseAiResponse(JSON.stringify({ recommendations: "nope" }), new Set(["a"]));
    expect(wrongShape.ok).toBe(false);
    const outOfRange = parseAiResponse(valid(["a"]).replace('"score":80', '"score":800'), new Set(["a"]));
    expect(outOfRange.ok).toBe(false);
  });

  it("recommendations for lands not in the database/candidate set are dropped", () => {
    const r = parseAiResponse(valid(["a", "invented-land", "b"]), new Set(["a", "b"]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.recommendations.map((x) => x.land_id)).toEqual(["a", "b"]);
    expect(r.data.recommendations.map((x) => x.rank)).toEqual([1, 2]);
    expect(r.dropped).toEqual(["invented-land"]);
    expect(r.data.warnings.join(" ")).toMatch(/unknown land ids/);
  });

  it("accepts JSON wrapped in a markdown fence", () => {
    expect(parseAiResponse("```json\n" + valid(["a"]) + "\n```", new Set(["a"])).ok).toBe(true);
  });
});

describe("AI refresh policy", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  const cached = { createdAt: new Date(now - 10 * 60_000), profileHash: "p", candidateIds: ["a", "b", "c"], topIds: ["a"] };
  const base = { currentProfileHash: "p", currentCandidateIds: ["a", "b", "c"], availableIds: new Set(["a", "b", "c"]), now, ttlMs: 3600_000 };

  it("does not refresh when nothing significant changed", () => {
    expect(refreshReasons({ ...base, cached })).toEqual([]);
  });
  it("refreshes when preferences change, a top pick is booked, inventory shifts, or TTL passes", () => {
    expect(refreshReasons({ ...base, cached, currentProfileHash: "q" })).toContain("your preferences changed");
    expect(refreshReasons({ ...base, cached, availableIds: new Set(["b", "c"]) })).toContain("a previously recommended plot is no longer available or eligible");
    expect(refreshReasons({ ...base, cached, currentCandidateIds: ["a", "b", "z"] })).toContain("candidate inventory changed ≥5%");
    expect(refreshReasons({ ...base, cached, now: now + 2 * 3600_000 })).toContain("analysis is older than the refresh interval");
    expect(refreshReasons({ ...base, cached: null })).toEqual(["no analysis yet"]);
  });
});
