/** Firebase web config, shared by the app and the push service worker. Public by design (security comes from Firestore rules / App Check). */
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyCA5rnGkRwRz_N6myVnTlIW-733NL0K5vk",
  authDomain: "nuca-lands-assistant.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "nuca-lands-assistant",
  storageBucket: "nuca-lands-assistant.firebasestorage.app",
  messagingSenderId: "447017281313",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:447017281313:web:669dd454da8b30d30ac060",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? "G-GBV8B6PJ55",
};
