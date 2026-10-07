import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/components/app-state";
import { Footer } from "@/components/footer";
import { Nav } from "@/components/nav";
import { t } from "@/i18n/ar";

const plex = IBM_Plex_Sans_Arabic({
  variable: "--font-plex",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: t.appName,
  description: t.tagline,
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2f5bd8" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ar" dir="rtl" className={`${plex.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <AppProvider>
          <Nav />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-4">{children}</main>
          <Footer />
        </AppProvider>
      </body>
    </html>
  );
}
