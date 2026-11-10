"use client";

import { deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { useSyncExternalStore } from "react";
import { MAX_FAVORITES, getFavorites } from "./favorites";
import { MAX_FOLLOWS, getFollows } from "./follows";
import { ensureAnonymousAuth, firebaseApp, firestore, track, whenAppCheckReady } from "./firebase";

/**
 * «نبهني لما تتحجز»: web push through Firebase Cloud Messaging. The browser's FCM token and the saved plot ids go to
 * `watchers/{anonymous uid}` with the followed areas; the sync job (scripts/ingest.mts) pushes to it when one of those
 * plots, or any plot in a followed city / district, gets booked.
 */
const ON_KEY = "nuca.push";
const SW_URL = "/firebase-messaging-sw.js";
// FCM's own default scope: the worker never controls the site's pages.
const SW_SCOPE = "/firebase-cloud-messaging-push-scope";
const VAPID_KEY = process.env.NEXT_PUBLIC_FCM_VAPID_KEY ?? "";

export type PushSupport = "ok" | "on" | "ios-install" | "denied" | "unsupported";

function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function stored(): boolean {
  try {
    return localStorage.getItem(ON_KEY) === "1";
  } catch {
    return false;
  }
}

function setStored(on: boolean) {
  try {
    if (on) localStorage.setItem(ON_KEY, "1");
    else localStorage.removeItem(ON_KEY);
  } catch {}
  for (const l of listeners) l();
}

/** What the browser allows right now. */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const hasApi = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  // iOS only offers web push to sites added to the home screen.
  if (!hasApi) return isIos() && !isStandalone() ? "ios-install" : "unsupported";
  if (!VAPID_KEY) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return stored() && Notification.permission === "granted" ? "on" : "ok";
}

const listeners = new Set<() => void>();
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePushSupport(): PushSupport {
  return useSyncExternalStore(subscribe, pushSupport, () => "unsupported");
}

async function token(): Promise<string> {
  const { getMessaging, getToken } = await import("firebase/messaging");
  const reg = (await navigator.serviceWorker.getRegistration(SW_SCOPE)) ?? (await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE }));
  return getToken(getMessaging(firebaseApp()), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
}

async function writeWatcher() {
  const plots = Object.keys(getFavorites()).slice(0, MAX_FAVORITES);
  const areas = Object.keys(getFollows()).slice(0, MAX_FOLLOWS);
  await whenAppCheckReady();
  const user = await ensureAnonymousAuth();
  const ref = doc(firestore(), "watchers", user.uid);
  if (!plots.length && !areas.length) return deleteDoc(ref);
  await setDoc(ref, { token: await token(), plots, areas, updatedAt: serverTimestamp() });
}

/** Asks for permission and registers this browser for the saved plots and followed areas. Resolves to the resulting state. */
export async function enablePush(): Promise<PushSupport> {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    setStored(false);
    void track("push_denied");
    return pushSupport();
  }
  try {
    await writeWatcher();
    setStored(true);
    void track("push_enabled", { plots: Object.keys(getFavorites()).length, areas: Object.keys(getFollows()).length });
  } catch (e) {
    console.warn("push: enable failed", e);
    setStored(false);
    throw e;
  }
  return pushSupport();
}

/** Keeps the Firestore copy in step with the saved plots and followed areas (and the token fresh). Does nothing unless push is on. */
export async function syncWatcher() {
  if (pushSupport() !== "on") return;
  try {
    await writeWatcher();
  } catch (e) {
    console.warn("push: sync failed", e);
  }
}
