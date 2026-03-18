"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

const navItems = [
  { href: "/", label: "Control Center" },
  { href: "/query", label: "Build Thesis" },
  { href: "/history", label: "Report Archive" },
  { href: "/profile", label: "Trader Profile" }
];

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
                <p className="brand-copy">Canvas-style market board for research, forecasts, evidence trails, and allocation.</p>
              </div>
            </div>
            <div className="topbar-actions">
              <div className="topbar-badges">
                <span className="badge badge-ghost">Board View</span>
                <span className="badge badge-ghost">Multi-Agent</span>
                <span className="badge badge-ghost">Trader Ready</span>
              </div>
              <nav className="nav-links">
                {navItems.map((item) => (
                  <Link key={item.href} href={item.href}>
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
