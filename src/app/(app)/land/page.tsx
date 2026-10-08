import type { Metadata } from "next";
import { Suspense } from "react";
import { LandDetail } from "@/components/land-detail";
import { t } from "@/i18n/ar";

/** One client-rendered shell for every plot (/land?id=…): keep it out of the index, follow its links. */
export const metadata: Metadata = { title: t.seo.landTitle, robots: { index: false, follow: true } };

export default function Page() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-muted">{t.loading}</div>}>
      <LandDetail />
    </Suspense>
  );
}
