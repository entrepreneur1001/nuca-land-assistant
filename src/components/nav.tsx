import Link from "next/link";
import { t } from "@/i18n/ar";

export function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 text-sm">
        <Link href="/" className="font-bold">
          🏡 {t.appName}
        </Link>
        <div className="ms-auto flex gap-4 text-muted">
          <Link href="/" className="hover:text-text">{t.nav.home}</Link>
          <Link href="/market" className="hover:text-text">{t.nav.market}</Link>
        </div>
      </nav>
    </header>
  );
}
