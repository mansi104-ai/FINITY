"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/react";
import MarketTickerStrip from "../src/components/MarketTickerStrip";
import NotificationBell from "../src/components/NotificationBell";
import AccountLink from "../src/components/AccountLink";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html data-theme="dark" lang="en">
      <head>
        <title>FINITY — Intelligent Financial Research</title>
        <meta name="description" content="AI-powered financial research platform. Real-time market data, stock screener, portfolio tracker, and analyst-grade insights for serious investors." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta property="og:title" content="FINITY — Intelligent Financial Research" />
        <meta property="og:description" content="Real-time markets, AI briefs, screener, watchlist and earnings calendar — built for serious investors." />
        <meta name="theme-color" content="#0d0d0d" />
      </head>
      <body className="findec-app-body">
        <div className="findec-app-shell">
          <header className="findec-app-header">
            <Link href="/markets" className="findec-brand-link">
              <strong className="findec-brand">FINITY</strong>
            </Link>
            <nav className="findec-topnav" aria-label="Primary">
              <Link className="findec-topnav-link" href="/markets">Markets</Link>
              <Link className="findec-topnav-link" href="/screener">Screener</Link>
              <Link className="findec-topnav-link" href="/earnings">Earnings</Link>
              <Link className="findec-topnav-link" href="/watchlist">Watchlist</Link>
              <Link className="findec-topnav-link findec-topnav-cta" href="/brief">AI Brief</Link>
              <Link className="findec-topnav-link" href="/history">History</Link>
            </nav>
            <div className="findec-topnav-right">
              <NotificationBell />
              <AccountLink />
            </div>
          </header>
          <div className="findec-app-strip">
            <MarketTickerStrip />
          </div>
          <main className="findec-app-main">{children}</main>
        </div>
        <Analytics />
      </body>
    </html>
  );
}
