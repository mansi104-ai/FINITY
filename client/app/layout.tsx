"use client";

import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/react";
import MarketTickerStrip from "../src/components/MarketTickerStrip";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html data-theme="dark" lang="en">
      <body className="finity-app-body">
        <div className="finity-app-shell">
          <header className="finity-app-header">
            <strong className="finity-brand">FINITY</strong>
          </header>
          <div className="finity-app-strip">
            <MarketTickerStrip />
          </div>
          <main className="finity-app-main">{children}</main>
        </div>
        <Analytics />
      </body>
    </html>
  );
}
