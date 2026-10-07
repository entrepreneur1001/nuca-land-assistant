import "server-only";
import { GoogleGenAI } from "@google/genai";
import { aiResponseJsonSchema } from "./schema";

const SYSTEM = `You are a decision-support analyst for a buyer in Egypt's NUCA "Bayt El Watan" land offering (prices in USD).
Rules:
- Reason ONLY over the JSON data supplied. Never invent plots, prices, areas, locations or facts.
- Every land_id you output MUST be copied exactly from the supplied "lands" array.
- If information is missing or unknown, say it is unknown; do not guess.
- The deterministic scores and survival probabilities are computed by our backend; treat them as the numeric ground truth.
  Your job is to compare similar options, explain trade-offs, identify attractive combinations and give a clear strategy.
- The user prioritises garden-view (حديقة) and corner (ناصية) plots.
- Probabilities are estimates; mention uncertainty where relevant.
- Return JSON only, matching the response schema. Write reasons concisely (1-3 sentences), in English, keeping Arabic place names as given.`;

export async function callGemini(payload: unknown, model: string): Promise<string | undefined> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
    config: {
      systemInstruction: SYSTEM,
      responseMimeType: "application/json",
      responseJsonSchema: aiResponseJsonSchema,
      temperature: 0.2,
      abortSignal: AbortSignal.timeout(90_000),
    },
  });
  return res.text;
}
