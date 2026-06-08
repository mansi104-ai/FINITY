"use client";

import { Suspense } from "react";
import Link from "next/link";
import TwoFactorCard from "../../src/components/TwoFactorCard";

export default function SecurityPage() {
  return (
    <Suspense fallback={<p className="findec-kicker" style={{ padding: "2rem" }}>Loading…</p>}>
      <section className="findec-minimal-page">
        <div className="findec-minimal-shell earn-shell">
          <div className="earn-header">
            <div>
              <p className="findec-kicker">Account</p>
              <h1 className="earn-title">Security</h1>
            </div>
            <div className="earn-header-actions">
              <Link href="/watchlist" className="earn-nav-btn">Watchlist →</Link>
            </div>
          </div>
          <TwoFactorCard />
        </div>
      </section>
    </Suspense>
  );
}
