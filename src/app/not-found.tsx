import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { t } from "@/i18n/ar";
import { CURRENT_PHASE, phasePath } from "@/lib/phases";

export const metadata: Metadata = { title: t.notFound.title };

/** Any address the site doesn't have: said plainly in Arabic, with the two places most people are looking for. */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-12">
      <Card className="text-center">
        <div className="text-5xl font-bold text-muted">٤٠٤</div>
        <h1 className="mt-3 text-xl font-bold">{t.notFound.title}</h1>
        <p className="mt-2 text-sm leading-7 text-muted">{t.notFound.text}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link href="/" className="rounded-xl bg-accent px-4 py-2 font-semibold text-white hover:opacity-90">{t.notFound.home}</Link>
          <Link href={phasePath.available(CURRENT_PHASE)} className="rounded-xl border border-border px-4 py-2 font-semibold hover:bg-surface-2">{t.notFound.available}</Link>
        </div>
      </Card>
    </div>
  );
}
