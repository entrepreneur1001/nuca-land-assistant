"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { initAnalytics, track } from "@/lib/firebase";

/**
 * GA4 page views for a static, client-navigated site. Initialising Analytics logs the landing page view;
 * every later route change is logged here. Started when the browser is idle so it never competes with the first paint.
 */
export function Analytics() {
  const path = usePathname();
  const started = useRef(false);

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      const start = () => void initAnalytics();
      if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 4000 });
      else setTimeout(start, 1500);
      return;
    }
    void track("page_view", { page_location: location.href, page_path: path, page_title: document.title });
  }, [path]);

  return null;
}
