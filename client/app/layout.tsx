"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/react";
import MarketTickerStrip from "../src/components/MarketTickerStrip";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html data-theme="dark" lang="en">
      <body className="findec-app-body">
        <div className="findec-app-shell">
          <header className="findec-app-header">
            <strong className="findec-brand">FINDEC</strong>
            <nav className="findec-topnav" aria-label="Primary">
              <Link className="findec-topnav-link" href="/markets">Markets</Link>
              <Link className="findec-topnav-link" href="/screener">Screener</Link>
              <Link className="findec-topnav-link" href="/watchlist">Watchlist</Link>
              <Link className="findec-topnav-link findec-topnav-cta" href="/brief">AI Brief</Link>
              <Link className="findec-topnav-link" href="/history">History</Link>
            </nav>
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
