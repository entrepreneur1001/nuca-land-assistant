import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { Analytics } from "@/components/analytics";
import { Footer } from "@/components/footer";
import { Nav } from "@/components/nav";
import { t } from "@/i18n/ar";
import { CURRENT_PHASE } from "@/lib/phases";
import { OG_BASE, OG_IMAGE, SITE_URL } from "@/lib/site";

const siteTitle = t.seo.siteTitle(CURRENT_PHASE);
const description = t.seo.description(CURRENT_PHASE);

const plex = IBM_Plex_Sans_Arabic({
  variable: "--font-plex",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: siteTitle, template: `%s | ${t.appName}` },
  description,
  applicationName: t.appName,
  formatDetection: { telephone: false },
  openGraph: { ...OG_BASE, title: siteTitle, description, url: "/" },
  twitter: { card: "summary_large_image", title: siteTitle, description, images: [OG_IMAGE.url] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2f5bd8" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1116" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ar" dir="rtl" className={`${plex.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-4">{children}</main>
        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
