import { describe, expect, it } from "vitest";
import { parseAiResponse } from "@/ai/schema";

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
