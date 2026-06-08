"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getSessionUser, subscribeToAuthChanges } from "../services/api";

// `authOnly` links are hidden for signed-out visitors (per-user data tabs).
const LINKS: Array<{ href: string; label: string; cta?: boolean; authOnly?: boolean }> = [
  { href: "/markets", label: "Markets" },
  { href: "/screener", label: "Screener" },
  { href: "/earnings", label: "Earnings" },
  { href: "/research", label: "Research" },
  { href: "/insights", label: "Insights" },
  { href: "/watchlist", label: "Watchlist", authOnly: true },
  { href: "/alerts", label: "Alerts", authOnly: true },
  { href: "/paper", label: "Paper", authOnly: true },
  { href: "/calendar", label: "Calendar", authOnly: true },
  { href: "/brief", label: "AI Brief", cta: true },
  { href: "/history", label: "History", authOnly: true },
];

export default function TopNav() {
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const sync = () => setSignedIn(getSessionUser() !== null);
    sync();
    return subscribeToAuthChanges(sync);
  }, []);

  // Close the mobile menu whenever the route changes.
  useEffect(() => { setOpen(false); }, [pathname]);

  const links = LINKS.filter((l) => signedIn || !l.authOnly);

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
        {links.map((l) => (
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
