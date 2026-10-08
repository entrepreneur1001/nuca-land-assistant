import Link from "next/link";
import { t } from "@/i18n/ar";
import { CURRENT_PHASE as phase, phasePath } from "@/lib/phases";
import { FeedbackButton, FeedbackDialog } from "./feedback";

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-5 text-xs leading-relaxed text-muted">
        <div className="mb-5 flex flex-col gap-3 rounded-2xl bg-accent-soft p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="text-sm font-semibold text-text">{t.prayer.title}</p>
            <p className="mt-0.5 text-xs text-muted">{t.prayer.sub}</p>
          </div>
          <FeedbackButton variant="primary" />
        </div>
        <nav aria-label={t.seo.home.hubH(phase)} className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link className="hover:text-text hover:underline" href={phasePath.available(phase)}>{t.seo.hub.available}</Link>
          <Link className="hover:text-text hover:underline" href={phasePath.rules(phase)}>{t.seo.hub.rules}</Link>
          <Link className="hover:text-text hover:underline" href={phasePath.guide(phase)}>{t.seo.hub.guide}</Link>
          <Link className="hover:text-text hover:underline" href="/market">{t.seo.hub.market}</Link>
        </nav>
        <p>{t.disclaimer.full}</p>
        <p className="mt-2">
          <a className="text-accent hover:underline" href="https://lands.nuca.gov.eg/" target="_blank" rel="noreferrer">
            {t.disclaimer.official} ↗
          </a>
        </p>
      </div>
      <FeedbackDialog />
    </footer>
  );
}
