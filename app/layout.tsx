import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, IBM_Plex_Sans } from "next/font/google";
import Script from "next/script";
import { SITE_URL } from "@/lib/brand";
import { BASE_PATH } from "@/lib/paths";
import { SIDEBAR_BOOT } from "@/lib/sidebar";
import "./globals.css";

// The UnBusy site's faces (DESIGN.md §3): Bricolage for display, Plex Sans for text.
const display = Bricolage_Grotesque({ subsets: ["latin"], weight: "variable", axes: ["opsz", "wdth"], variable: "--font-display", display: "swap" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body", display: "swap" });

const SHARE_IMAGE = `${BASE_PATH}/share-image`;

export const metadata: Metadata = {
  // Shared links (status pages, referrals) resolve their preview image here.
  metadataBase: new URL(SITE_URL),
  title: { default: "UnBusy Client Portal", template: "%s · UnBusy" },
  description: "Your UnBusy work, in one place.",
  openGraph: {
    siteName: "UnBusy",
    type: "website",
    title: "UnBusy Client Portal",
    description: "Your UnBusy work, in one place.",
    images: [{ url: SHARE_IMAGE, width: 1200, height: 630, alt: "UnBusy Client Portal: your work, in one place." }],
  },
  twitter: { card: "summary_large_image", images: [SHARE_IMAGE] },
  // Added to a home screen, it opens full screen like an app.
  appleWebApp: { capable: true, title: "UnBusy", statusBarStyle: "default" },
  // Private by design: nothing here should ever be indexed.
  robots: { index: false, follow: false },
};

// viewportFit "cover" lets the tab bar sit under the iPhone home indicator (padded by safe-area insets).
export const viewport: Viewport = { themeColor: "#fafaf8", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The sidebar script may mark <html> before React hydrates.
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <body>
        <Script id="admin-sidebar-pref" strategy="beforeInteractive">
          {SIDEBAR_BOOT}
        </Script>
        {children}
      </body>
    </html>
  );
}
