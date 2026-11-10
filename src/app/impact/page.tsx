import type { Metadata } from "next";
import { Impact } from "@/components/impact";
import { t } from "@/i18n/ar";

/** Unlisted team page: alerts sent and opened, people with alerts on, what they save and follow. */
export const metadata: Metadata = { title: t.impact.title, robots: { index: false, follow: false } };

export default function Page() {
  return <Impact />;
}
