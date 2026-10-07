"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

// Firebase web config is public by design (security comes from Firestore rules / App Check).
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyCA5rnGkRwRz_N6myVnTlIW-733NL0K5vk",
  authDomain: "nuca-lands-assistant.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "nuca-lands-assistant",
  storageBucket: "nuca-lands-assistant.firebasestorage.app",
  messagingSenderId: "447017281313",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:447017281313:web:669dd454da8b30d30ac060",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? "G-GBV8B6PJ55",
};

let app: FirebaseApp | null = null;
let appCheckReady: Promise<void> = Promise.resolve();
let db: Firestore | null = null;

export function firebaseApp(): FirebaseApp {
  if (!app) {
    app = getApps().length ? getApp() : initializeApp(config);
    initAppCheck(app);
  }
  return app;
}

/** Resolves once App Check is set up (AI Logic calls need its token). */
export function whenAppCheckReady() {
  firebaseApp();
  return appCheckReady;
}

/**
 * App Check protects Firebase AI Logic from abuse (enforced in the console).
 * Production uses reCAPTCHA v3 (NEXT_PUBLIC_RECAPTCHA_SITE_KEY); local dev can use a registered debug token.
 */
function initAppCheck(a: FirebaseApp) {
  if (typeof window === "undefined") return;
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  if (process.env.NODE_ENV === "development") {
    const debug = process.env.NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN;
    if (debug) (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = debug;
  }
  if (!siteKey && process.env.NODE_ENV !== "development") return;
  appCheckReady = import("firebase/app-check").then(({ initializeAppCheck, ReCaptchaV3Provider }) => {
    try {
      initializeAppCheck(a, { provider: new ReCaptchaV3Provider(siteKey ?? "debug-only"), isTokenAutoRefreshEnabled: true });
    } catch {
      /* already initialised */
    }
  });
}

/** In-memory Firestore cache only: IndexedDB persistence can corrupt and crash the SDK. Plot chunks are cached by us (lib/data.ts). */
export function firestore(): Firestore {
  db ??= getFirestore(firebaseApp());
  return db;
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
