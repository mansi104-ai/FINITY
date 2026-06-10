"use client";

import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/react";
import MarketTickerStrip from "../src/components/MarketTickerStrip";


import NotificationBell from "../src/components/NotificationBell";
import AccountLink from "../src/components/AccountLink";
import TopNav from "../src/components/TopNav";
import Brand from "../src/components/Brand";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html data-theme="dark" lang="en">
      <body className="findec-app-body">
        <div className="findec-app-shell">
          <header className="findec-app-header">
            <a href="/" className="findec-brand-link"><Brand size={28} /></a>
            <TopNav />
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
