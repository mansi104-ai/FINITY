"use client";

import Link from "next/link";
import Brand from "./Brand";

const COLS: Array<{ title: string; links: Array<{ href: string; label: string }> }> = [
  {
    title: "Market",
    links: [
      { href: "/markets", label: "Markets" },
      { href: "/screener", label: "Screener" },
      { href: "/earnings", label: "Earnings" },
      { href: "/research", label: "Research" },
      { href: "/insights", label: "Insights" },
    ],
  },
  {
    title: "Tools",
    links: [
      { href: "/brief", label: "AI Brief" },
      { href: "/watchlist", label: "Watchlist" },
      { href: "/alerts", label: "Alerts" },
      { href: "/paper", label: "Paper Trading" },
      { href: "/calendar", label: "Calendar & Ledger" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/login", label: "Sign in" },
      { href: "/register", label: "Create account" },
      { href: "/security", label: "Security & 2FA" },
      { href: "/history", label: "Report history" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/pricing", label: "Pricing" },
      { href: "/disclaimer", label: "Disclaimer" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
];

export default function AppFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="ash-footer no-print">
      <div className="ash-footer-inner">
        <div className="ash-footer-brand">
          <Brand size={26} />
          <p className="ash-footer-tag">Real-time market data, AI briefs, screening, and decision support.</p>
        </div>
        <div className="ash-footer-cols">
          {COLS.map((c) => (
            <div key={c.title} className="ash-footer-col">
              <span className="ash-footer-col-title">{c.title}</span>
              {c.links.map((l) => (
                <Link key={l.href} href={l.href} className="ash-footer-link">{l.label}</Link>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="ash-footer-bottom">
        <span>© {year} Findec · v1.30.0</span>
        <span className="ash-footer-disc">Decision support only — not financial advice.</span>
      </div>
    </footer>
  );
}
