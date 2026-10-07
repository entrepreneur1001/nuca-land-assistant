"use client";

import { useSyncExternalStore } from "react";

let current = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** A 1-second ticking clock that is 0 during server prerender (keeps rendering deterministic). */
export function useNow() {
  return useSyncExternalStore(subscribe, () => current || Date.now(), () => 0);
}
