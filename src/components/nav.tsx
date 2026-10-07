import Link from "next/link";

export function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 text-sm">
        <Link href="/" className="font-semibold tracking-wide">
          NUCA LAND ASSISTANT
        </Link>
        <div className="ml-auto flex gap-4 text-muted">
          <Link href="/" className="hover:text-text">Dashboard</Link>
          <Link href="/analytics" className="hover:text-text">Analytics</Link>
          <Link href="/settings" className="hover:text-text">Settings</Link>
        </div>
      </nav>
    </header>
  );
}
