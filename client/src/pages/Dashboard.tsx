"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getReports } from "../services/api";
import { useAuth } from "../context/AuthContext";
import type { AgentReport } from "../types";
import ReportCard from "../components/ReportCard";

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function Dashboard() {
  const { user, token, loading } = useAuth();
  const [reports, setReports] = useState<AgentReport[]>([]);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!token) {
      return;
    }

    const run = async () => {
      try {
        const result = await getReports();
        setReports(result.reports);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch reports");
      }
    };

    void run();
  }, [token]);

  const latest = useMemo(() => reports[0], [reports]);
  const buyCalls = useMemo(() => reports.filter((report) => report.recommendation.action === "buy").length, [reports]);

  return (
    <section className="grid page-shell">
      <article className="hero-panel">
        <div>
          <p className="eyebrow">Financial Intelligence Workspace</p>
          <h1 className="hero-title">A sharper command center for AI-assisted market decisions.</h1>
          <p className="hero-copy">
            Track your latest research, position sizing, and analyst posture in one place with a stronger market-focused presentation.
          </p>
        </div>
        <div className="hero-strip">
          <div className="metric-card">
            <span className="metric-label">Reports stored</span>
            <strong>{reports.length}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Buy signals</span>
            <strong>{buyCalls}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Capital profile</span>
            <strong>{user ? currency(user.budget) : "Connect account"}</strong>
          </div>
        </div>
      </article>

      <div className="grid dashboard-grid">
        <article className="card panel-dark">
          <p className="eyebrow">Account snapshot</p>
          <h2 style={{ marginTop: 0 }}>Control panel</h2>
          {loading && <p>Checking session...</p>}
          {!loading && !token && (
            <p>
              Login from the <Link href="/query">Query page</Link> to start generating market briefs.
            </p>
          )}
          {user && (
            <>
              <p><strong>{user.email}</strong></p>
              <p className="text-muted">Budget: {currency(user.budget)}</p>
              <p className="text-muted">Risk profile: {user.riskProfile}</p>
            </>
          )}
          {error && <p style={{ color: "#ff9f9f" }}>{error}</p>}
          <Link className="button button-primary" href="/query">
            Open Query Console
          </Link>
        </article>

        <article className="card">
          <p className="eyebrow">Flow</p>
          <h3>How the system thinks</h3>
          <div className="brief-list">
            <div className="brief-item">
              <span className="brief-index">01</span>
              <div>
                <strong>Researcher</strong>
                <p className="text-muted">Scans news, checks search quality, and converts evidence into sentiment.</p>
              </div>
            </div>
            <div className="brief-item">
              <span className="brief-index">02</span>
              <div>
                <strong>Analyst</strong>
                <p className="text-muted">Builds a forward path with confidence, key levels, and bull/base/bear scenarios.</p>
              </div>
            </div>
            <div className="brief-item">
              <span className="brief-index">03</span>
              <div>
                <strong>Allocator</strong>
                <p className="text-muted">Translates signal strength into position sizing against your active budget.</p>
              </div>
            </div>
          </div>
        </article>
      </div>

      {latest && <ReportCard report={latest} />}
    </section>
  );
}
