"use client";

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { z } from "zod";
import { ensureAnonymousAuth, firestore, track, whenAppCheckReady } from "./firebase";

export const FEEDBACK_TYPES = ["suggestion", "bug", "data"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const MSG_MIN = 10;
export const MSG_MAX = 1000;
export const CONTACT_MAX = 100;

// Mirrors the `feedback` create rule in firestore.rules.
const schema = z.object({
  type: z.enum(FEEDBACK_TYPES),
  message: z.string().trim().min(MSG_MIN).max(MSG_MAX),
  contact: z.string().trim().max(CONTACT_MAX),
  page: z.string().max(300),
});
export type FeedbackInput = z.input<typeof schema>;

const COOLDOWN_MS = 60_000;
const CD_KEY = "nuca-feedback-last";
const DRAFT_KEY = "nuca-feedback-draft";

export function feedbackCooldownLeft(): number {
  try {
    return Math.max(0, COOLDOWN_MS - (Date.now() - Number(localStorage.getItem(CD_KEY) ?? 0)));
  } catch {
    return 0;
  }
}

export type FeedbackDraft = { type: FeedbackType; message: string; contact: string };

export function loadDraft(): Partial<FeedbackDraft> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function saveDraft(d: FeedbackDraft | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/** Stores one feedback entry (create-only; visitors can't read the collection). */
export async function submitFeedback(input: FeedbackInput) {
  const v = schema.parse(input);
  await whenAppCheckReady();
  await ensureAnonymousAuth();
  await addDoc(collection(firestore(), "feedback"), {
    type: v.type,
    message: v.message,
    ...(v.contact ? { contact: v.contact } : {}),
    page: v.page,
    ua: navigator.userAgent.slice(0, 200),
    createdAt: serverTimestamp(),
  });
  try {
    localStorage.setItem(CD_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  void track("feedback_submit", { type: v.type });
}
