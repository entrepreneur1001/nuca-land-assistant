import type { Metadata } from "next";
import { Market } from "@/components/market";
import { t } from "@/i18n/ar";
import { CURRENT_PHASE } from "@/lib/phases";

export const metadata: Metadata = {
  title: { absolute: t.seo.marketTitle(CURRENT_PHASE) },
  description: t.seo.marketDescription(CURRENT_PHASE),
  alternates: { canonical: "/market" },
};

export default function Page() {
  return <Market />;
}
