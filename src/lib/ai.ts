"use client";

import { doc, getDoc, setDoc } from "firebase/firestore";
import { AI_SYSTEM, aiCacheKey, buildPayload } from "@/ai/payload";
import { aiResponseJsonSchema, parseAiResponse, type AiResponse } from "@/ai/schema";
import type { Dashboard, RankedLand } from "@/engine/compute";
import type { Profile } from "@/engine/scoring";
import { ensureAnonymousAuth, firebaseApp, firestore, track, whenAppCheckReady } from "./firebase";

/** Tried in order; the lighter model is a fallback when the main one is slow or unavailable. */
export const AI_MODELS = (process.env.NEXT_PUBLIC_GEMINI_MODELS ?? "gemini-3.5-flash,gemini-3.5-flash-lite").split(",").map((m) => m.trim()).filter(Boolean);
export const AI_MODEL = AI_MODELS[0];
const COOLDOWN_MS = 30_000;
const CD_KEY = "nuca-ai-last";

export function cooldownLeft(): number {
  try {
    return Math.max(0, COOLDOWN_MS - (Date.now() - Number(localStorage.getItem(CD_KEY) ?? 0)));
  } catch {
    return 0;
  }
}

export type AiOutcome = { ok: true; data: AiResponse; cached: boolean } | { ok: false; error: string };

/**
 * Gemini through Firebase AI Logic (no API key in the site; quota & per-user limits are set in the
 * Firebase console). Results are shared through Firestore `ai_cache/{hash(profile+data+model)}`.
 */
export async function analyze(d: Dashboard, ranked: RankedLand[], profile: Profile): Promise<AiOutcome> {
  const key = aiCacheKey(profile, d.dataVersion, AI_MODEL);
  const { candidates, payload } = buildPayload(d, ranked, profile);
  const allowed = new Set(candidates.map((c) => c.id));
  if (!allowed.size) return { ok: false, error: "no-candidates" };

  try {
    const cached = await getDoc(doc(firestore(), "ai_cache", key));
    if (cached.exists()) {
      const parsed = parseAiResponse(JSON.stringify(cached.data().response), allowed);
      if (parsed.ok) {
        void track("ai_analyze", { cached: true, ok: true });
        return { ok: true, data: parsed.data, cached: true };
      }
    }
  } catch {
    /* cache miss / offline */
  }

  if (cooldownLeft() > 0) return { ok: false, error: "cooldown" };
  try {
    localStorage.setItem(CD_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }

  try {
    await whenAppCheckReady();
    const { getAI, getGenerativeModel, GoogleAIBackend, ThinkingLevel } = await import("firebase/ai");
    const ai = getAI(firebaseApp(), { backend: new GoogleAIBackend() });
    let text: string | undefined;
    let lastErr: unknown;
    for (const name of AI_MODELS) {
      try {
        const model = getGenerativeModel(
          ai,
          {
            model: name,
            systemInstruction: AI_SYSTEM,
            generationConfig: {
              responseMimeType: "application/json",
              responseJsonSchema: aiResponseJsonSchema,
              temperature: 0.2,
              // The numbers are already computed; the model only compares and explains, so keep thinking short.
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          },
          { timeout: 60_000 },
        );
        text = (await model.generateContent(JSON.stringify(payload))).response.text();
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (text === undefined) throw lastErr ?? new Error("ai-failed");
    const parsed = parseAiResponse(text, allowed);
    void track("ai_analyze", { cached: false, ok: parsed.ok });
    if (!parsed.ok) return { ok: false, error: parsed.error };
    try {
      await ensureAnonymousAuth();
      await setDoc(doc(firestore(), "ai_cache", key), {
        response: parsed.data,
        model: AI_MODEL,
        dataVersion: d.dataVersion,
        createdAt: new Date().toISOString(),
      });
    } catch {
      /* caching is best-effort */
    }
    return { ok: true, data: parsed.data, cached: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: /quota|429|resource.exhausted/i.test(msg) ? "daily-cap" : msg };
  }
}
