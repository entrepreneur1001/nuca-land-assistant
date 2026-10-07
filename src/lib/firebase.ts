"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getFirestore,
  type Firestore,
} from "firebase/firestore";

// Firebase web config is public by design (security comes from Firestore rules / App Check).
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyCA5rnGkRwRz_N6myVnTlIW-733NL0K5vk",
  authDomain: "nuca-lands-assistant.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "nuca-lands-assistant",
  storageBucket: "nuca-lands-assistant.firebasestorage.app",
  messagingSenderId: "447017281313",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:447017281313:web:669dd454da8b30d30ac060",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

export function firebaseApp(): FirebaseApp {
  if (!app) app = getApps().length ? getApp() : initializeApp(config);
  return app;
}

export function firestore(): Firestore {
  if (db) return db;
  try {
    db = initializeFirestore(firebaseApp(), {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    db = getFirestore(firebaseApp());
  }
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

export async function ensureAnonymousAuth() {
  const { getAuth, signInAnonymously } = await import("firebase/auth");
  const auth = getAuth(firebaseApp());
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser!;
}
