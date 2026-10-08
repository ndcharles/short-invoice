import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/**
 * Social previews need absolute addresses, so the site's own address is fixed at build time.
 * Set NEXT_PUBLIC_APP_URL when building for a different host. Icons and the preview image live in
 * public/ and are built from assets/brand/4e-logo.png by `npm run brand`.
 */
const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.4th-entity.com";
const TAGLINE = "May the 4th be with you!";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Multi-Tool Workspace · 4th.link",
  description: TAGLINE,
  applicationName: "4th Entity",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    type: "website",
    siteName: "4th Entity",
    title: "4th Entity",
    description: TAGLINE,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "The 4e logo and the tagline “May the 4th be with you!”" }],
  },
  twitter: { card: "summary_large_image", title: "4th Entity", description: TAGLINE, images: ["/og.png"] },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} antialiased`}>
      <body>{children}</body>
    </html>
  );
}
