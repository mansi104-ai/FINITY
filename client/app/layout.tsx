"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AuthProvider } from "../src/context/AuthContext";
import "./globals.css";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/query", label: "Query" },
  { href: "/history", label: "History" },
  { href: "/profile", label: "Profile" }
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <header className="topbar">
            <div className="container topbar-inner">
              <Link className="brand" href="/">
                Multi-Agent Finance Orchestrator
              </Link>
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
