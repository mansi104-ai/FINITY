import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import AppShell from "../src/components/AppShell";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://findec.app";
const TITLE = "Findec — AI stock briefs, live India & global markets";
const DESCRIPTION =
  "Findec is a free AI-powered stock decision app: live India & global market data, instant AI briefs, screener, watchlist, price alerts, and paper trading. Decision support, not advice.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · Findec" },
  description: DESCRIPTION,
  applicationName: "Findec",
  keywords: [
    "stock screener India", "AI stock analysis", "NSE live prices", "price alerts",
    "paper trading", "stock market app", "Nifty Sensex", "investing", "Findec",
  ],
  authors: [{ name: "Findec" }],
  openGraph: {
    type: "website",
    siteName: "Findec",
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html data-theme="dark" lang="en">
      <body className="findec-app-body">
        <AppShell>{children}</AppShell>
        <Analytics />
      </body>
    </html>
  );
}
