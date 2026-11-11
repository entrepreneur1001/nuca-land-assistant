"use client";

import { ago } from "@/i18n/ar";
import { useNow } from "@/lib/use-now";

/** «من ٣ دقيقة», ticking every second. Its own component so the clock re-renders this label, not the whole page. */
export function Ago({ iso }: { iso: string | null | undefined }) {
  return <>{ago(iso, useNow())}</>;
}
