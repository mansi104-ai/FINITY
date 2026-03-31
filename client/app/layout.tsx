"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html data-theme="dark" lang="en">
      <body>
        <header className="topbar">
          <div className="container topbar-inner">
            <div className="brand-lockup">
              <span className="brand-mark">F</span>
              <div className="brand-block">
                <Link className="brand" href="/">
                  FINDEC
                </Link>
                <p className="brand-copy">Conversational dashboarding for AI-assisted investing decisions.</p>
              </div>
            </div>
            <div className="topbar-actions">
              <Link className="badge badge-ghost" href="/">
                Workspace
              </Link>
              <Link className="badge badge-ghost" href="/radar">
                Radar
              </Link>
              <Link className="badge badge-ghost" href="/brief">
                Brief
              </Link>
              <Link className="badge badge-ghost" href="/report">
                Report
              </Link>
              <Link className="badge badge-ghost" href="/query">
                Legacy Brief
              </Link>
              <Link className="badge badge-ghost" href="/history">
                History
              </Link>
              <span className="badge badge-ghost">v0.0.2</span>
            </div>
          </div>
        </header>
        <main className="container">{children}</main>
        <Analytics />
      </body>
    </html>
  );
}
