"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n/ar";
import { track } from "@/lib/firebase";
import {
  CONTACT_MAX,
  FEEDBACK_TYPES,
  MSG_MAX,
  MSG_MIN,
  feedbackCooldownLeft,
  loadDraft,
  saveDraft,
  submitFeedback,
  type FeedbackType,
} from "@/lib/feedback";
import { Segmented } from "./ui";

const OPEN_EVENT = "nuca:feedback-open";

export function FeedbackButton({ variant }: { variant: "primary" | "link" }) {
  const open = () => window.dispatchEvent(new Event(OPEN_EVENT));
  if (variant === "link")
    return (
      <button type="button" onClick={open} className="hover:text-text">
        {t.feedback.openShort}
      </button>
    );
  return (
    <button type="button" onClick={open} className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
      {t.feedback.open}
    </button>
  );
}

type Status = "idle" | "sending" | "sent" | "error";
const input = "mt-1 w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-text placeholder:text-muted/70 focus:border-accent focus:outline-none";

/** Single dialog instance (mounted in the footer), opened by any FeedbackButton. */
export function FeedbackDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const msgRef = useRef<HTMLTextAreaElement>(null);
  const [type, setType] = useState<FeedbackType>("suggestion");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [cooldown, setCooldown] = useState(0);
  const loaded = useRef(false);

  useEffect(() => {
    const onOpen = () => {
      if (!loaded.current) {
        const d = loadDraft();
        if (d.type && FEEDBACK_TYPES.includes(d.type)) setType(d.type);
        if (typeof d.message === "string") setMessage(d.message);
        if (typeof d.contact === "string") setContact(d.contact);
        loaded.current = true;
      }
      setStatus((s) => (s === "sent" ? "idle" : s));
      setCooldown(feedbackCooldownLeft());
      ref.current?.showModal();
      requestAnimationFrame(() => msgRef.current?.focus());
      void track("feedback_open");
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (loaded.current) saveDraft(message || contact ? { type, message, contact } : null);
  }, [type, message, contact]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown(feedbackCooldownLeft()), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const close = () => ref.current?.close();
  const len = message.trim().length;
  const canSend = len >= MSG_MIN && len <= MSG_MAX && status !== "sending" && cooldown <= 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setStatus("sending");
    try {
      await submitFeedback({ type, message, contact, page: (location.pathname + location.search).slice(0, 300) });
      setMessage("");
      setContact("");
      setType("suggestion");
      saveDraft(null);
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="feedback-title"
      onClick={(e) => e.target === ref.current && close()}
      className="feedback-sheet text-text"
    >
      <div className="p-5">
        <div className="flex items-start gap-3">
          <div>
            <h2 id="feedback-title" className="text-lg font-bold">{t.feedback.title}</h2>
            {status !== "sent" && <p className="mt-0.5 text-sm text-muted">{t.feedback.intro}</p>}
          </div>
          <button type="button" onClick={close} aria-label={t.feedback.close} className="ms-auto rounded-lg px-2 py-1 text-muted hover:bg-surface-2 hover:text-text">
            ✕
          </button>
        </div>

        {status === "sent" ? (
          <div className="py-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-good-soft text-2xl text-good">✓</div>
            <p className="mt-4 font-semibold">{t.feedback.successTitle}</p>
            <p className="mt-1 text-sm text-muted">{t.feedback.successSub}</p>
            <div className="mt-6 flex justify-center gap-2">
              <button type="button" onClick={close} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white">
                {t.feedback.close}
              </button>
              <button type="button" onClick={() => { setCooldown(feedbackCooldownLeft()); setStatus("idle"); }} className="rounded-xl border border-border px-4 py-2 text-sm">
                {t.feedback.another}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <div>
              <span className="mb-1 block text-xs font-medium text-muted">{t.feedback.typeLabel}</span>
              <Segmented value={type} onChange={setType} options={FEEDBACK_TYPES.map((v) => ({ value: v, label: t.feedback.types[v] }))} />
            </div>

            <label className="block">
              <span className="text-xs font-medium text-muted">{t.feedback.message}</span>
              <textarea
                ref={msgRef}
                required
                rows={5}
                maxLength={MSG_MAX}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t.feedback.messagePh[type]}
                className={`${input} resize-y leading-relaxed`}
              />
              <span className="mt-1 flex text-xs text-muted">
                {len > 0 && len < MSG_MIN && <span>{t.feedback.tooShort(MSG_MIN - len)}</span>}
                <span className="ms-auto">{t.feedback.counter(message.length, MSG_MAX)}</span>
              </span>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-muted">{t.feedback.contact}</span>
              <input
                type="text"
                dir="auto"
                autoComplete="email"
                maxLength={CONTACT_MAX}
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder={t.feedback.contactPh}
                className={input}
              />
            </label>

            {status === "error" && <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">{t.feedback.error}</p>}
            {cooldown > 0 && <p className="text-xs text-warn">{t.feedback.cooldown(Math.ceil(cooldown / 1000))}</p>}

            <div className="flex items-center gap-2 pt-1">
              <button type="submit" disabled={!canSend} className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {status === "sending" && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                {status === "sending" ? t.feedback.sending : t.feedback.send}
              </button>
              <button type="button" onClick={close} className="rounded-xl px-3 py-2 text-sm text-muted hover:text-text">
                {t.feedback.cancel}
              </button>
            </div>
            <p className="text-[11px] text-muted">{t.feedback.privacy}</p>
          </form>
        )}
      </div>
    </dialog>
  );
}
