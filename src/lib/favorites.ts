"use client";

import { useSyncExternalStore } from "react";

/**
 * «المفضلة»: plots the visitor saved, on this device only (no account). Each entry remembers when it was saved and
 * whether the visitor already dismissed the «اتحجزت» notice for it. Push alerts mirror the ids to Firestore (lib/push.ts).
 */
const KEY = "nuca.favorites";
export const MAX_FAVORITES = 50;

export interface FavEntry {
  /** When it was saved (ms). */
  at: number;
  /** The visitor dismissed the «اتحجزت» notice for this plot. Cleared if the plot becomes available again. */
  ack?: boolean;
}
export type Favorites = Record<string, FavEntry>;

const EMPTY: Favorites = {};
let value: Favorites | null = null;
const listeners = new Set<() => void>();
const changeHooks = new Set<(ids: string[]) => void>();

export function parseFavorites(raw: string | null): Favorites {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return EMPTY;
    const out: Favorites = {};
    for (const [id, e] of Object.entries(v as Record<string, unknown>)) {
      if (typeof id !== "string" || id.length > 64 || !e || typeof e !== "object") continue;
      const at = Number((e as FavEntry).at);
      out[id] = { at: Number.isFinite(at) ? at : 0, ...((e as FavEntry).ack ? { ack: true } : {}) };
    }
    return out;
  } catch {
    return EMPTY;
  }
}

function read(): Favorites {
  if (value == null) {
    try {
      value = parseFavorites(localStorage.getItem(KEY));
    } catch {
      value = EMPTY; // Storage blocked: favourites last for the session only.
    }
  }
  return value;
}

function write(next: Favorites, idsChanged: boolean) {
  value = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  for (const l of listeners) l();
  if (idsChanged) for (const h of changeHooks) h(Object.keys(next));
}

function subscribe(l: () => void) {
  listeners.add(l);
  // Another tab changed the list.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    value = null;
    l();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

/** The saved plots (empty during server prerender). */
export function useFavorites(): Favorites {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function getFavorites(): Favorites {
  return read();
}

/** Adds or removes a plot; returns true when it is now saved, false when removed or the list is full. */
export function toggleFavorite(id: string): boolean {
  const cur = read();
  if (cur[id]) {
    const next = { ...cur };
    delete next[id];
    write(next, true);
    return false;
  }
  if (Object.keys(cur).length >= MAX_FAVORITES) return false;
  write({ ...cur, [id]: { at: Date.now() } }, true);
  return true;
}

export function removeFavorite(id: string) {
  if (read()[id]) toggleFavorite(id);
}

/** The visitor saw the «اتحجزت» notice for these plots. */
export function acknowledge(ids: string[]) {
  const cur = read();
  const todo = ids.filter((id) => cur[id] && !cur[id].ack);
  if (!todo.length) return;
  const next = { ...cur };
  for (const id of todo) next[id] = { ...next[id], ack: true };
  write(next, false);
}

/** A plot that came back on the market loses its «seen» mark, so a second booking is announced again. */
export function reopen(ids: string[]) {
  const cur = read();
  const todo = ids.filter((id) => cur[id]?.ack);
  if (!todo.length) return;
  const next = { ...cur };
  for (const id of todo) next[id] = { at: next[id].at };
  write(next, false);
}

/** Called with the saved ids whenever one is added or removed (push keeps its Firestore copy in step). */
export function onFavoritesChange(h: (ids: string[]) => void): () => void {
  changeHooks.add(h);
  return () => changeHooks.delete(h);
}

/**
 * Saved plots that are booked and not yet acknowledged (`newly`), and acknowledged ones that are available again
 * (`reopened`). Plots missing from the data are ignored.
 */
export function bookedChanges(favs: Favorites, statusOf: (id: string) => "available" | "booked" | undefined) {
  const newly: string[] = [];
  const reopened: string[] = [];
  for (const [id, e] of Object.entries(favs)) {
    const s = statusOf(id);
    if (s === "booked" && !e.ack) newly.push(id);
    else if (s === "available" && e.ack) reopened.push(id);
  }
  newly.sort((a, b) => favs[b].at - favs[a].at);
  return { newly, reopened };
}
