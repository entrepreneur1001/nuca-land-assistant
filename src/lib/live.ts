"use client";

import { useSyncExternalStore } from "react";
import type { Snapshot } from "@/data/snapshot";
import { subscribeSnapshot } from "./data";

/**
 * One shared live subscription to the Firestore snapshot for every screen (the app and the static SEO pages).
 * The subscription stays open briefly after the last screen unmounts so client-side navigation doesn't reconnect.
 */

export type LiveError = "quota" | "no-data" | "load";
export interface LiveState {
  snapshot: Snapshot | null;
  error: LiveError | null;
}

const SERVER: LiveState = { snapshot: null, error: null };
const LINGER_MS = 30_000;

let state: LiveState = SERVER;
const listeners = new Set<() => void>();
let unsub: (() => void) | null = null;
let linger: ReturnType<typeof setTimeout> | null = null;

function set(next: LiveState) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (linger) {
    clearTimeout(linger);
    linger = null;
  }
  unsub ??= subscribeSnapshot(
    (snapshot) => set({ snapshot, error: null }),
    (e) => set({ ...state, error: /quota|resource-exhausted/i.test(e.message) ? "quota" : e.message === "no-data" ? "no-data" : "load" }),
  );
  return () => {
    listeners.delete(cb);
    if (listeners.size) return;
    linger = setTimeout(() => {
      linger = null;
      unsub?.();
      unsub = null;
    }, LINGER_MS);
  };
}

/** The latest live snapshot (null until loaded, and during server prerender). */
export function useLive(): LiveState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}
