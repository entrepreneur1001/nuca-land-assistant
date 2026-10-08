import { AppProvider } from "@/components/app-state";

/** The interactive app (/, /market, /land) shares the live data + ranking engine; the static SEO pages don't load it. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppProvider>{children}</AppProvider>;
}
