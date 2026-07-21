"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Brand from "./Brand";
import NotificationBell from "./NotificationBell";
import AccountLink from "./AccountLink";
import MarketTickerStrip from "./MarketTickerStrip";
import GlobalSearch from "./GlobalSearch";
import RegionMenu from "./RegionMenu";
import AppFooter from "./AppFooter";
import { getSessionUser, subscribeToAuthChanges } from "../services/api";

const COLLAPSE_KEY = "findec-sidebar-collapsed";

type NavItem = { href: string; label: string; icon: IconKey };
type IconKey =
  | "markets" | "screener" | "calendar" | "research" | "insights"
  | "star" | "bell" | "paper" | "clock" | "brief" | "home" | "menu";

// Compact set for the mobile bottom bar (the 4 most-used destinations + More).
const BOTTOM_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/markets", label: "Markets", icon: "markets" },
  { href: "/ask", label: "Ask", icon: "brief" },
  { href: "/screener", label: "Screener", icon: "screener" },
];

const PRIMARY: NavItem = { href: "/ask", label: "Ask", icon: "brief" };
const GROUPS: Array<{ title: string; authOnly?: boolean; items: NavItem[] }> = [
  {
    title: "Market",
    items: [
      { href: "/markets", label: "Markets", icon: "markets" },
      { href: "/screener", label: "Screener", icon: "screener" },
      { href: "/earnings", label: "Earnings", icon: "calendar" },
      { href: "/research", label: "Research", icon: "research" },
      { href: "/method", label: "Method", icon: "research" },
      { href: "/insights", label: "Insights", icon: "insights" },
    ],
  },
  {
    title: "You",
    authOnly: true,
    items: [
      { href: "/watchlist", label: "Watchlist", icon: "star" },
      { href: "/alerts", label: "Alerts", icon: "bell" },
      { href: "/paper", label: "Paper", icon: "paper" },
      { href: "/calendar", label: "Calendar", icon: "calendar" },
      { href: "/history", label: "History", icon: "clock" },
    ],
  },
];

function Icon({ k }: { k: IconKey }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (k) {
    case "markets": return <svg width="18" height="18" viewBox="0 0 24 24" {...p}><path d="M4 19V5M4 19h16M8 16v-5M13 16V8M18 16v-9" /></svg>;
    case "screener": return <svg width="18" height="18" viewBox="0 0 24 24" {...p}><path d="M3 5h18l-7 8v6l-4 2v-8z" /></svg>;
    case "calendar": return <svg width="18" height="18" viewBox="0 0 24 24" {...p}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 3v3M16 3v3" /></svg>;
    case "research": return <svg width="18" height="18" viewBox="0 0 24 24" {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>;
    case "insights": return <svg width="18" height="18" viewBox="0 0 24 24" {...p}><path d="M4 15l5-5 4 4 7-8M16 5h4v4" /></svg>;
    case "star": return <svg width="18" height="18" viewBox="0 0 24 24" {...p}><path d="M12 4l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17.8 6.8 20.2l1-5.8L3.5 10.2l5.9-.9z" /></svg>;
    case "bell": return <svg width="18" height="18" viewBox="0 0 24 24" {...p}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></svg>;
    case "paper": return <svg width="18" height="18" viewBox="0 0 24 24" {...p}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;
    case "clock": return <svg width="18" height="18" viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "brief": return <svg width="18" height="18" viewBox="0 0 24 24" {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>;
    case "home": return <svg width="18" height="18" viewBox="0 0 24 24" {...p}><path d="M3 11l9-8 9 8M5 10v10h14V10" /></svg>;
    case "menu": return <svg width="18" height="18" viewBox="0 0 24 24" {...p}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
  }
}

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const sync = () => setSignedIn(getSessionUser() !== null);
    sync();
    return subscribeToAuthChanges(sync);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const toggleCollapse = () => {
    setCollapsed((c) => {
      const next = !c;
      if (typeof window !== "undefined") window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  };

  const isActive = (href: string) => pathname === href || (href !== "/" && pathname?.startsWith(href + "/"));

  const renderLink = (it: NavItem, highlight = false) => (
    <Link
      key={it.href}
      href={it.href}
      className={`ash-nav-link${isActive(it.href) ? " ash-nav-link-active" : ""}${highlight ? " ash-nav-link-cta" : ""}`}
      title={it.label}
    >
      <span className="ash-nav-ico"><Icon k={it.icon} /></span>
      <span className="ash-nav-label">{it.label}</span>
    </Link>
  );

  return (
    <div className={`ash-root${collapsed ? " ash-collapsed" : ""}${mobileOpen ? " ash-mobile-open" : ""}`}>
      <aside className="ash-sidebar">
        <div className="ash-side-top">
          <Link href="/" className="ash-side-brand"><Brand size={26} showWordmark={!collapsed} /></Link>
        </div>
        <nav className="ash-nav">
          {renderLink(PRIMARY, true)}
          {GROUPS.filter((g) => !g.authOnly || signedIn).map((g) => (
            <div key={g.title} className="ash-nav-group">
              <span className="ash-nav-group-title">{g.title}</span>
              {g.items.map((it) => renderLink(it))}
            </div>
          ))}
        </nav>
        <Link href="/pricing" className="ash-pro-cta" title="Upgrade to Pro">
          <span className="ash-nav-ico" aria-hidden="true">★</span>
          <span className="ash-nav-label">Upgrade to Pro</span>
        </Link>
        <button className="ash-collapse-btn" onClick={toggleCollapse} title={collapsed ? "Expand" : "Collapse"}>
          <span className="ash-nav-ico">{collapsed ? "»" : "«"}</span>
          <span className="ash-nav-label">Collapse</span>
        </button>
      </aside>

      <div className="ash-main-col">
        <header className="ash-topbar">
          <button className="ash-hamburger" aria-label="Menu" onClick={() => setMobileOpen((v) => !v)}>
            <span /><span /><span />
          </button>
          <Link href="/" className="ash-topbar-brand"><Brand size={24} /></Link>
          <GlobalSearch />
          <div className="ash-topbar-spacer" />
          <div className="ash-topbar-actions">
            <RegionMenu />
            <NotificationBell />
            <AccountLink />
          </div>
        </header>

        <div className="ash-strip"><MarketTickerStrip /></div>

        <main className="ash-content">
          <div className="ash-content-inner">{children}</div>
        </main>

        <AppFooter />
      </div>

      {/* Mobile bottom navigation (≤860px) */}
      <nav className="ash-bottombar" aria-label="Primary">
        {BOTTOM_NAV.map((it) => (
          <Link key={it.href} href={it.href} className={`ash-bn-item${isActive(it.href) ? " ash-bn-active" : ""}`}>
            <span className="ash-bn-ico"><Icon k={it.icon} /></span>
            <span className="ash-bn-label">{it.label}</span>
          </Link>
        ))}
        <button className={`ash-bn-item${mobileOpen ? " ash-bn-active" : ""}`} onClick={() => setMobileOpen((v) => !v)} aria-label="More">
          <span className="ash-bn-ico"><Icon k="menu" /></span>
          <span className="ash-bn-label">More</span>
        </button>
      </nav>

      <button className="ash-scrim" aria-label="Close menu" onClick={() => setMobileOpen(false)} />
    </div>
  );
}
