"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSessionUser, joinWaitlist, getWaitlistCount } from "../services/api";

type Tier = {
  id: string;
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  cta: string;
  highlight?: boolean;
  features: Array<{ label: string; on: boolean }>;
};

const TIERS: Tier[] = [
  {
    id: "free",
    name: "Free",
    price: "₹0",
    cadence: "forever",
    tagline: "Everything you need to research and decide.",
    cta: "current",
    features: [
      { label: "Live India + global market data", on: true },
      { label: "AI Brief — 10 / day", on: true },
      { label: "Screener & sector heatmap", on: true },
      { label: "Watchlist + price alerts (5)", on: true },
      { label: "Paper trading", on: true },
      { label: "AI Track Record (history)", on: true },
      { label: "Unlimited AI briefs", on: false },
      { label: "Real-time intraday alerts", on: false },
      { label: "Portfolio & tax-ready exports", on: false },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "₹299",
    cadence: "/ month",
    tagline: "For active investors who want the edge — and no limits.",
    cta: "Join the waitlist",
    highlight: true,
    features: [
      { label: "Everything in Free", on: true },
      { label: "Unlimited AI briefs", on: true },
      { label: "Real-time intraday price alerts", on: true },
      { label: "Unlimited watchlists & alerts", on: true },
      { label: "Advanced screener (200+ filters, saved screens)", on: true },
      { label: "Portfolio analytics + India tax-ready P&L export", on: true },
      { label: "Deeper AI: multi-stock compare briefs", on: true },
      { label: "Ad-free + priority data refresh", on: true },
      { label: "Early access to new features", on: true },
    ],
  },
];

function Check({ on }: { on: boolean }) {
  return on
    ? <span className="pr-check pr-check-on" aria-label="included">✓</span>
    : <span className="pr-check pr-check-off" aria-label="not included">—</span>;
}

export default function Pricing() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const u = getSessionUser();
    if (u?.email) setEmail(u.email);
    void getWaitlistCount().then((r) => setCount(r.count)).catch(() => setCount(null));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setStatus("error"); setMessage("Enter a valid email."); return;
    }
    setStatus("loading"); setMessage("");
    try {
      const r = await joinWaitlist(email.trim(), "pro");
      setStatus("done");
      setMessage(r.alreadyOn ? "You're already on the list — we'll be in touch." : "You're on the list! We'll email you when Pro opens.");
      setCount((c) => (c == null ? c : c + (r.alreadyOn ? 0 : 1)));
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  };

  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell pr-shell">
        <div className="pr-hero">
          <p className="findec-kicker">Pricing</p>
          <h1 className="pr-title">Start free. Upgrade when you&apos;re ready.</h1>
          <p className="pr-sub">
            Findec is free to use today. Pro is coming soon — join the waitlist to lock in launch pricing
            {count != null && count > 0 ? ` (${count} already waiting).` : "."}
          </p>
        </div>

        <div className="pr-grid">
          {TIERS.map((t) => (
            <article key={t.id} className={`findec-panel pr-card${t.highlight ? " pr-card-hi" : ""}`}>
              {t.highlight && <span className="pr-badge">Coming soon</span>}
              <p className="findec-kicker">{t.name}</p>
              <div className="pr-price"><strong>{t.price}</strong><span>{t.cadence}</span></div>
              <p className="pr-tagline">{t.tagline}</p>
              <ul className="pr-features">
                {t.features.map((f) => (
                  <li key={f.label} className={f.on ? "" : "pr-feat-off"}><Check on={f.on} /> {f.label}</li>
                ))}
              </ul>
              {t.id === "free" ? (
                <Link href="/brief" className="pr-cta pr-cta-ghost">Use it now →</Link>
              ) : (
                <a href="#waitlist" className="pr-cta pr-cta-primary">{t.cta}</a>
              )}
            </article>
          ))}
        </div>

        <article className="findec-panel pr-waitlist" id="waitlist">
          <div>
            <p className="findec-kicker">Pro waitlist</p>
            <h2 className="pr-wl-title">Be first in line for Findec Pro</h2>
            <p className="pr-wl-sub">No spam. One email when Pro launches, with early-bird pricing.</p>
          </div>
          {status === "done" ? (
            <p className="pr-wl-done">✓ {message}</p>
          ) : (
            <form className="pr-wl-form" onSubmit={submit}>
              <input
                className="pr-wl-input"
                type="email"
                placeholder="you@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === "loading"}
              />
              <button className="pr-wl-btn" type="submit" disabled={status === "loading"}>
                {status === "loading" ? "Joining…" : "Notify me"}
              </button>
            </form>
          )}
          {status === "error" && <p className="pr-wl-err">{message}</p>}
        </article>

        <p className="pr-disclaimer">
          Findec is decision-support only and not investment advice. See our{" "}
          <Link href="/disclaimer" className="legal-inline-link">Disclaimer</Link>.
        </p>
      </div>
    </section>
  );
}
