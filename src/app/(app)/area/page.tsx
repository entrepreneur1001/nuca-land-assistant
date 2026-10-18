import type { Metadata } from "next";
import { Suspense } from "react";
import { AreaView } from "@/components/area-view";
import { t } from "@/i18n/ar";

/** One client-rendered shell for every city/district (/area?city=…&d=…): keep it out of the index, follow its links. */
export const metadata: Metadata = { title: t.seo.areaTitle, robots: { index: false, follow: true } };

export default function Page() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-muted">{t.loading}</div>}>
      <AreaView />
    </Suspense>
  );
}
