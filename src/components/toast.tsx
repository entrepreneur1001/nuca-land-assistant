"use client";

import { useSyncExternalStore } from "react";

/** One short message at a time, at the bottom of the screen, gone after a few seconds (instead of a blocking alert()). */
let message: { text: string; id: number } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(text: string, ms = 4000) {
  message = { text, id: (message?.id ?? 0) + 1 };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    message = null;
    timer = null;
    emit();
  }, ms);
  emit();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function Toaster() {
  const m = useSyncExternalStore(subscribe, () => message, () => null);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      {m ? (
        <div key={m.id} role="status" className="pointer-events-auto max-w-md rounded-xl bg-text px-4 py-2.5 text-center text-sm text-surface shadow-lg">
          {m.text}
        </div>
      ) : null}
    </div>
  );
}
