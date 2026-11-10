/**
 * Push service worker, bundled by esbuild to public/firebase-messaging-sw.js (npm run build:sw).
 * FCM shows the message's `webpush.notification` itself and opens `webpush.fcmOptions.link` on click,
 * so the worker only has to start Messaging. It registers under FCM's own scope and never touches page requests.
 */
import { initializeApp } from "firebase/app";
import { getMessaging } from "firebase/messaging/sw";
import { firebaseConfig } from "./firebase-config";

getMessaging(initializeApp(firebaseConfig));
