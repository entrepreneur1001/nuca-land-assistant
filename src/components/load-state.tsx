"use client";

import { t } from "@/i18n/ar";
import { Card } from "./ui";

/** The «loading» line, or, once loading failed (Firestore offline, quota, first sync), the reason and a retry. */
export function LoadingOrError({ error, className = "py-20" }: { error?: string | null; className?: string }) {
  if (!error) return <div className={`${className} text-center text-muted`}>{t.loading}</div>;
  return (
    <Card className="text-center">
      <p>{error === "quota" ? t.quota : error === "no-data" ? t.firstSync : t.loadError}</p>
      {error === "quota" ? null : (
        <button type="button" onClick={() => location.reload()} className="mt-3 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
          {t.retry}
        </button>
      )}
    </Card>
  );
}
