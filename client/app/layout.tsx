"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="container topbar-inner">
            <div className="brand-lockup">
              <span className="brand-mark">F</span>
              <div className="brand-block">
                <Link className="brand" href="/">
                  FINITY
                </Link>
                <p className="brand-copy">Direct search, cleaner mobile layout, and the market pulse right at the top.</p>
              </div>
            </div>
            <div className="topbar-actions">
              <span className="badge badge-ghost">Direct Search</span>
              <span className="badge badge-ghost">Mobile Ready</span>
            </div>
          </div>
        </header>
        <main className="container">{children}</main>
        <Analytics />
      </body>
    </html>
  );
}
