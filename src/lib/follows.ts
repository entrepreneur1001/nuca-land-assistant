"use client";

import { useSyncExternalStore } from "react";

/**
 * «تابع الحي / المدينة»: areas the visitor follows, on this device only. Any plot booked inside one triggers a push
 * (lib/push.ts mirrors the keys to Firestore; the sync job matches them). Keys: `c:<city name>` or `d:<district id>`.
 */
const KEY = "nuca.follows";
export const MAX_FOLLOWS = 20;

export interface Follow {
  at: number;
  city: string;
  /** Set when following one district of the city. */
  district?: { id: string; name: string };
}
export type Follows = Record<string, Follow>;

export const cityKey = (city: string) => `c:${city}`;
export const districtKey = (id: string) => `d:${id}`;
export const followKey = (city: string, districtId?: string | null) => (districtId ? districtKey(districtId) : cityKey(city));
/** The follow keys a plot belongs to (what the sync job matches against). */
export const plotKeys = (city: string, districtId: string | null) => (districtId ? [cityKey(city), districtKey(districtId)] : [cityKey(city)]);

const EMPTY: Follows = {};
let value: Follows | null = null;
const listeners = new Set<() => void>();
const changeHooks = new Set<() => void>();

export function parseFollows(raw: string | null): Follows {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return EMPTY;
    const out: Follows = {};
    for (const [k, e] of Object.entries(v as Record<string, Follow>)) {
      if (!/^[cd]:/.test(k) || k.length > 120 || !e || typeof e.city !== "string") continue;
      const d = e.district && typeof e.district.id === "string" && typeof e.district.name === "string" ? { id: e.district.id, name: e.district.name } : undefined;
      out[k] = { at: Number.isFinite(Number(e.at)) ? Number(e.at) : 0, city: e.city, ...(d ? { district: d } : {}) };
    }
    return out;
  } catch {
    return EMPTY;
  }
}

function read(): Follows {
  if (value == null) {
    try {
      value = parseFollows(localStorage.getItem(KEY));
    } catch {
      value = EMPTY;
    }
  }
  return value;
}

function write(next: Follows) {
  value = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  for (const l of listeners) l();
  for (const h of changeHooks) h();
}

function subscribe(l: () => void) {
  listeners.add(l);
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

export function useFollows(): Follows {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function getFollows(): Follows {
  return read();
}

/** Follows or unfollows a city (no district) or one district; returns true when now followed, false when removed or full. */
export function toggleFollow(city: string, district?: { id: string; name: string } | null): boolean {
  const cur = read();
  const k = followKey(city, district?.id);
  if (cur[k]) {
    const next = { ...cur };
    delete next[k];
    write(next);
    return false;
  }
  if (Object.keys(cur).length >= MAX_FOLLOWS) return false;
  write({ ...cur, [k]: { at: Date.now(), city, ...(district ? { district } : {}) } });
  return true;
}

export function onFollowsChange(h: () => void): () => void {
  changeHooks.add(h);
  return () => changeHooks.delete(h);
}

export const followName = (f: Follow) => (f.district ? `${f.district.name} · ${f.city}` : f.city);
