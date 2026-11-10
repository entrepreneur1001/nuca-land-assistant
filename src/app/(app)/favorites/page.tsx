import type { Metadata } from "next";
import { FavoritesList } from "@/components/favorites";
import { t } from "@/i18n/ar";

/** The visitor's own saved plots (this device only): nothing to index. */
export const metadata: Metadata = { title: t.fav.title, robots: { index: false, follow: true } };

export default function Page() {
  return <FavoritesList />;
}
