"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { firebaseConfig } from "./firebase-config";

const config = firebaseConfig;

let app: FirebaseApp | null = null;
let appCheckReady: Promise<void> = Promise.resolve();
let db: Firestore | null = null;

export function firebaseApp(): FirebaseApp {
  app ??= getApps().length ? getApp() : initializeApp(config);
  return app;
}

let appCheckStarted = false;

/** The app with App Check started. Only Firestore / AI Logic need it, so pages that just log analytics never load reCAPTCHA. */
function checkedApp(): FirebaseApp {
  const a = firebaseApp();
  if (!appCheckStarted) {
    appCheckStarted = true;
    initAppCheck(a);
  }
  return a;
}

/** Resolves once App Check is set up (AI Logic calls need its token). */
export function whenAppCheckReady() {
  checkedApp();
  return appCheckReady;
}

/**
 * App Check protects Firebase AI Logic from abuse (enforced in the console).
 * Production uses Fraud Defense / reCAPTCHA Enterprise (NEXT_PUBLIC_RECAPTCHA_SITE_KEY; classic v3 is deprecated in App Check); local dev can use a registered debug token.
 */
function initAppCheck(a: FirebaseApp) {
  if (typeof window === "undefined") return;
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  if (process.env.NODE_ENV === "development") {
    const debug = process.env.NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN;
    if (debug) (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = debug;
  }
  if (!siteKey && process.env.NODE_ENV !== "development") return;
  appCheckReady = import("firebase/app-check").then(({ initializeAppCheck, ReCaptchaEnterpriseProvider }) => {
    try {
      initializeAppCheck(a, { provider: new ReCaptchaEnterpriseProvider(siteKey ?? "debug-only"), isTokenAutoRefreshEnabled: true });
    } catch {
      /* already initialised */
    }
  });
}

/**
 * In-memory Firestore cache only: IndexedDB persistence can corrupt and crash the SDK. Plot chunks are cached by us (lib/data.ts).
 * Deliberately does NOT start App Check: Firestore is not App Check enforced, but once App Check is initialised the SDK waits for
 * its token (reCAPTCHA round-trip + exchange, 10–30 s when attestation is slow or failing) before opening a stream, and its 10 s
 * offline watchdog then fires empty cached snapshots first. Writers that need the token (AI, feedback) call whenAppCheckReady().
 */
export function firestore(): Firestore {
  db ??= getFirestore(firebaseApp());
  return db;
}

/** Starts Google Analytics (GA4), which logs the landing page_view itself. Later client-side navigations are logged by <Analytics />. */
export async function initAnalytics() {
  try {
    if (!config.measurementId) return;
    const { getAnalytics, isSupported } = await import("firebase/analytics");
    if (await isSupported()) getAnalytics(firebaseApp());
  } catch {
    /* ignore */
  }
}

/** Fire-and-forget analytics event; silently does nothing when unsupported/blocked. */
export async function track(event: string, params?: Record<string, string | number | boolean>) {
  try {
    if (!config.measurementId) return;
    const { getAnalytics, isSupported, logEvent } = await import("firebase/analytics");
    if (!(await isSupported())) return;
    logEvent(getAnalytics(firebaseApp()), event, params);
  } catch {
    /* ignore */
  }
}

/** Anonymous sign-in, used only to write the shared AI cache (allowed by Firestore rules). */
export async function ensureAnonymousAuth() {
  const { getAuth, signInAnonymously } = await import("firebase/auth");
  const auth = getAuth(firebaseApp());
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser!;
}
