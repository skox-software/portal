import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import Script from "next/script";
import { BASE_PATH } from "@/lib/paths";
import { SIDEBAR_BOOT } from "@/lib/sidebar";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const serif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

const SHARE_IMAGE = `${BASE_PATH}/share-image`;

export const metadata: Metadata = {
  // Shared links (status pages, referrals) resolve their preview image here.
  metadataBase: new URL("https://www.skoxsoftware.com"),
  title: { default: "SKOX Client Portal", template: "%s · SKOX Client Portal" },
  description: "Your SKOX project, in one place.",
  openGraph: {
    siteName: "SKOX",
    type: "website",
    title: "SKOX Client Portal",
    description: "Your SKOX project, in one place.",
    images: [{ url: SHARE_IMAGE, width: 1200, height: 630, alt: "SKOX Client Portal — your project, in one place." }],
  },
  twitter: { card: "summary_large_image", images: [SHARE_IMAGE] },
  // Added to a home screen, it opens full screen like an app.
  appleWebApp: { capable: true, title: "SKOX", statusBarStyle: "default" },
  // Private by design: nothing here should ever be indexed.
  robots: { index: false, follow: false },
};

// viewportFit "cover" lets the tab bar sit under the iPhone home indicator (padded by safe-area insets).
export const viewport: Viewport = { themeColor: "#faf9f6", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The sidebar script may mark <html> before React hydrates.
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`} suppressHydrationWarning>
      <body>
        <Script id="admin-sidebar-pref" strategy="beforeInteractive">
          {SIDEBAR_BOOT}
        </Script>
        {children}
      </body>
    </html>
  );
}
