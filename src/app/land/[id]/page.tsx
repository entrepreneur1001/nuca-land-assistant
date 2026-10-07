import { Suspense } from "react";
import { LandDetail } from "@/components/land-detail";

export default function Page() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-muted">Loading…</div>}>
      <LandDetail />
    </Suspense>
  );
}
