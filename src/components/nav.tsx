import Link from "next/link";
import { t } from "@/i18n/ar";
import { CURRENT_PHASE, phasePath } from "@/lib/phases";
import { FeedbackButton } from "./feedback";

export function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 text-sm">
        <Link href="/" className="whitespace-nowrap font-bold">
          🏡 <span className="hidden sm:inline">{t.appName}</span>
          <span className="sm:hidden">{t.appShort}</span>
        </Link>
        <div className="ms-auto flex gap-3 whitespace-nowrap text-muted sm:gap-4">
          <Link href="/" className="hidden hover:text-text sm:inline">{t.nav.home}</Link>
          <Link href="/market" className="hover:text-text">{t.nav.market}</Link>
          <Link href={phasePath.available(CURRENT_PHASE)} className="hover:text-text">{t.nav.available}</Link>
          <Link href={phasePath.guide(CURRENT_PHASE)} className="hidden hover:text-text sm:inline">{t.nav.guide}</Link>
          <FeedbackButton variant="link" />
        </div>
      </nav>
    </header>
  );
}
