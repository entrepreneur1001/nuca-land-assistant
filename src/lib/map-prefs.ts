"use client";

import { useSyncExternalStore } from "react";

/** «اعرض المتاح بس»: the maps hide booked plots. One choice for every map, remembered on the device. */
const KEY = "nuca.map.availableOnly";

let value: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  if (value == null) {
    try {
      value = localStorage.getItem(KEY) === "1";
    } catch {
      value = false; // Storage blocked: the choice lasts for the session only.
    }
  }
  return value;
}

function write(on: boolean) {
  value = on;
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAvailableOnly(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, read, () => false), write];
}

/**
 * A map layer switch remembered on the device (one choice for every map); `fallback` when nothing is stored or
 * storage is blocked (then the choice lasts for the session).
 */
export interface MapPref {
  get(): boolean;
  set(on: boolean): void;
}

function mapPref(key: string, fallback: boolean): MapPref {
  let v: boolean | null = null;
  return {
    get() {
      if (v == null) {
        try {
          const raw = localStorage.getItem(key);
          v = raw == null ? fallback : raw === "1";
        } catch {
          v = fallback;
        }
      }
      return v;
    },
    set(on) {
      v = on;
      try {
        localStorage.setItem(key, on ? "1" : "0");
      } catch {}
    },
  };
}

/** «كمبوندات»: whether the maps draw the private compounds; on by default. */
export const compoundsPref = mapPref("nuca.map.compounds", true);
/** «المخطط»: whether the maps show the plan images (the plot shapes stay); on by default. */
export const plansPref = mapPref("nuca.map.plans", true);
/** «أماكن»: whether the maps show universities, clubs, hospitals and other places nearby; on by default. */
export const placesPref = mapPref("nuca.map.places", true);
