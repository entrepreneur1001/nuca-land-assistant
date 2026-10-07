import { z } from "zod";

export const AI_RECOMMENDATIONS = ["STRONG_BUY", "GOOD", "WATCH", "AVOID"] as const;

export const aiRecommendationSchema = z.object({
  land_id: z.string().min(1),
  rank: z.number().int().positive(),
  score: z.number().min(0).max(100),
  recommendation: z.enum(AI_RECOMMENDATIONS),
  reason: z.string().max(2000),
  risks: z.array(z.string().max(500)).max(10).default([]),
  confidence: z.number().min(0).max(1),
});

export const aiResponseSchema = z.object({
  recommendations: z.array(aiRecommendationSchema).max(20),
  market_summary: z.string().max(4000),
  strategy: z.string().max(4000),
  warnings: z.array(z.string().max(1000)).max(20).default([]),
});
export type AiResponse = z.infer<typeof aiResponseSchema>;

/** JSON schema sent to Gemini as `responseJsonSchema`. */
export const aiResponseJsonSchema = {
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          land_id: { type: "string", description: "Must be one of the land ids supplied in the input." },
          rank: { type: "integer" },
          score: { type: "number", minimum: 0, maximum: 100 },
          recommendation: { type: "string", enum: [...AI_RECOMMENDATIONS] },
          reason: { type: "string" },
          risks: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["land_id", "rank", "score", "recommendation", "reason", "risks", "confidence"],
      },
    },
    market_summary: { type: "string" },
    strategy: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["recommendations", "market_summary", "strategy", "warnings"],
};

/**
 * Parse + validate model output. Never throws. Recommendations for land ids that
 * were not in the supplied candidate set are dropped (the model may not invent lands).
 */
export function parseAiResponse(
  text: string | undefined | null,
  allowedIds: Set<string>,
): { ok: true; data: AiResponse; dropped: string[] } | { ok: false; error: string } {
  if (!text) return { ok: false, error: "empty response" };
  let raw: unknown;
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
    raw = JSON.parse(cleaned);
  } catch {
    return { ok: false, error: "response was not valid JSON" };
  }
  const r = aiResponseSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: `schema validation failed: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  const dropped: string[] = [];
  const seen = new Set<string>();
  const recommendations = r.data.recommendations.filter((x) => {
    if (!allowedIds.has(x.land_id) || seen.has(x.land_id)) {
      dropped.push(x.land_id);
      return false;
    }
    seen.add(x.land_id);
    return true;
  });
  recommendations.sort((a, b) => a.rank - b.rank);
  recommendations.forEach((x, i) => (x.rank = i + 1));
  const warnings = [...r.data.warnings];
  if (dropped.length) warnings.push(`Ignored ${dropped.length} AI recommendation(s) referencing unknown land ids.`);
  return { ok: true, data: { ...r.data, recommendations, warnings }, dropped };
}
