"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AuthProvider } from "../src/context/AuthContext";
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
        <AuthProvider>
          <header className="topbar">
            <div className="container topbar-inner">
              <div className="brand-block">
                <Link className="brand" href="/">
                  FINITY Trader Workspace
                </Link>
                <p className="brand-copy">Research, forecast, algorithms, evidence graph, and allocation in one organized flow.</p>
              </div>
              <nav className="nav-links">
                {navItems.map((item) => (
                  <Link key={item.href} href={item.href}>
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>
          <main className="container">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
