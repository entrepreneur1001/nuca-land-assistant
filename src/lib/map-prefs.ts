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

/** «كمبوندات»: whether the maps draw the private compounds. One choice for every map, remembered on the device; on by default. */
const COMPOUNDS_KEY = "nuca.map.compounds";
let compounds: boolean | null = null;

export function compoundsShown(): boolean {
  if (compounds == null) {
    try {
      compounds = localStorage.getItem(COMPOUNDS_KEY) !== "0";
    } catch {
      compounds = true;
    }
  }
  return compounds;
}

export function setCompoundsShown(on: boolean) {
  compounds = on;
  try {
    localStorage.setItem(COMPOUNDS_KEY, on ? "1" : "0");
  } catch {}
}
