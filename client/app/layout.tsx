"use client";

import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/react";
import MarketTickerStrip from "../src/components/MarketTickerStrip";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html data-theme="dark" lang="en">
      <body>
        <div className="container global-market-strip">
          <MarketTickerStrip />
        </div>
        <main className="container app-main">{children}</main>
        <Analytics />
      </body>
    </html>
  );
}
