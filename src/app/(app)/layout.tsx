import { AppProvider } from "@/components/app-state";
import { FavoritesWatcher } from "@/components/favorites";

/** The interactive app (/, /market, /land, /area, /favorites) shares the live data + ranking engine; the static SEO pages don't load it. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppProvider>
      <FavoritesWatcher />
      {children}
    </AppProvider>
  );
}
