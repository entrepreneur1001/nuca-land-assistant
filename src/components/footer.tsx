import { t } from "@/i18n/ar";

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-5 text-xs leading-relaxed text-muted">
        <p>{t.disclaimer.full}</p>
        <p className="mt-2">
          <a className="text-accent hover:underline" href="https://lands.nuca.gov.eg/" target="_blank" rel="noreferrer">
            {t.disclaimer.official} ↗
          </a>
        </p>
      </div>
    </footer>
  );
}
