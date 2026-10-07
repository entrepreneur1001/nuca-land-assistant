import { Suspense } from "react";
import { LandDetail } from "@/components/land-detail";
import { t } from "@/i18n/ar";

export default function Page() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-muted">{t.loading}</div>}>
      <LandDetail />
    </Suspense>
  );
}
