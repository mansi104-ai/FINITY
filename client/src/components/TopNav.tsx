"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const LINKS: Array<{ href: string; label: string; cta?: boolean }> = [
  { href: "/markets", label: "Markets" },
  { href: "/screener", label: "Screener" },
  { href: "/earnings", label: "Earnings" },
  { href: "/research", label: "Research" },
  { href: "/insights", label: "Insights" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/alerts", label: "Alerts" },
  { href: "/paper", label: "Paper" },
  { href: "/brief", label: "AI Brief", cta: true },
  { href: "/history", label: "History" },
];

export default function TopNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile menu whenever the route changes.
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <>
      <button
        className="findec-nav-toggle"
        aria-label="Toggle navigation"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span /><span /><span />
      </button>
      <nav className={`findec-topnav${open ? " findec-topnav-open" : ""}`} aria-label="Primary">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            className={`findec-topnav-link${l.cta ? " findec-topnav-cta" : ""}`}
            href={l.href}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
