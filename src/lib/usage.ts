"use client";

import { doc, increment, setDoc } from "firebase/firestore";
import { ensureAnonymousAuth, firestore, track, whenAppCheckReady } from "./firebase";

/**
 * Usage analytics beyond page views (GA4 via track()):
 * - every click on a button / link and every choice in a select or checkbox, site-wide, as `ui_click` / `ui_change`
 *   (never the text typed into inputs), plus `outbound_click` for links leaving the site;
 * - `push_open` when a visitor arrives from a notification (links carry `from=push`), also counted per day in
 *   Firestore `opens/{YYYY-MM-DD}` so /impact can show it next to the sync job's own counters.
 */

const clean = (s: string | null | undefined, n = 60) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

function labelOf(el: Element): string {
  return clean(el.getAttribute("data-track") ?? el.getAttribute("aria-label") ?? el.getAttribute("title") ?? (el as HTMLElement).innerText ?? el.textContent);
}

function onClick(e: MouseEvent) {
  const el = (e.target as Element | null)?.closest?.("a, button, [role=button], summary");
  if (!el) return;
  const page = location.pathname;
  if (el instanceof HTMLAnchorElement && el.href) {
    const url = new URL(el.href, location.href);
    if (url.origin !== location.origin) return void track("outbound_click", { url: url.href.slice(0, 100), label: labelOf(el), page });
    return void track("ui_click", { kind: "link", label: labelOf(el), to: url.pathname.slice(0, 100), page });
  }
  void track("ui_click", { kind: "button", label: labelOf(el), page });
}

function onChange(e: Event) {
  const el = e.target;
  const page = location.pathname;
  if (el instanceof HTMLSelectElement) {
    const opt = el.selectedOptions[0];
    void track("ui_change", { kind: "select", label: clean(el.getAttribute("aria-label") ?? el.closest("label")?.textContent), value: clean(opt?.text ?? el.value, 40), page });
  } else if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    void track("ui_change", { kind: el.type, label: clean(el.closest("label")?.textContent ?? el.name), value: el.checked ? "on" : "off", page });
  }
}

let started = false;
/** Starts the site-wide click / choice tracking once. */
export function startUsageTracking() {
  if (started || typeof window === "undefined") return;
  started = true;
  document.addEventListener("click", onClick, { capture: true, passive: true });
  document.addEventListener("change", onChange, { capture: true, passive: true });
}

const cairoDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());

/** Logs a visit that came from a notification (`?from=push&k=plot|area`) and drops the marker from the URL. */
export function trackPushOpen() {
  const url = new URL(location.href);
  if (url.searchParams.get("from") !== "push") return;
  const kind = url.searchParams.get("k") ?? "plot";
  void track("push_open", { kind, page: url.pathname, id: url.searchParams.get("id") ?? "" });
  url.searchParams.delete("from");
  url.searchParams.delete("k");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  void (async () => {
    try {
      await whenAppCheckReady();
      await ensureAnonymousAuth();
      await setDoc(doc(firestore(), "opens", cairoDay()), { n: increment(1) }, { merge: true });
    } catch {
      /* counting is best-effort */
    }
  })();
}
