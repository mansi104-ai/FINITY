"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getReports } from "../services/api";
import { useAuth } from "../context/AuthContext";
import type { AgentReport } from "../types";

export default function History() {
  const { token } = useAuth();
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
        setError(err instanceof Error ? err.message : "Failed to load history");
      }
    };

    void run();
  }, [token]);

  const buyCount = useMemo(() => reports.filter((report) => report.recommendation.action === "buy").length, [reports]);

  if (!token) {
    return (
      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>History</h2>
        <p>Please login from Query page to view report history.</p>
      </section>
    );
  }

  return (
    <section className="grid page-shell">
      <article className="hero-panel">
        <div>
          <p className="eyebrow">Report Archive</p>
          <h1 className="hero-title">Historical market briefs and trader notes.</h1>
          <p className="hero-copy">
            Review every generated report, reopen the full workspace, and compare how the system has changed over time.
          </p>
        </div>
        <div className="hero-strip">
          <div className="metric-card">
            <span className="metric-label">Total reports</span>
            <strong>{reports.length}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Buy calls</span>
            <strong>{buyCount}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Archive state</span>
            <strong>{reports.length > 0 ? "Active" : "Empty"}</strong>
          </div>
        </div>
      </article>

      <article className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">History Board</p>
            <h3>Past reports</h3>
          </div>
        </div>
        {error && <p style={{ color: "#ff9f9f" }}>{error}</p>}
        {reports.length === 0 && <p className="text-muted">No report generated yet.</p>}
        <div className="grid grid-2">
          {reports.map((report) => (
            <article key={report.id} className="mini-panel">
              <p style={{ marginTop: 0 }}>
                <strong>{report.ticker}</strong> | {report.recommendation.action.toUpperCase()} | V{report.version}
              </p>
              <p className="text-muted">{new Date(report.createdAt).toLocaleString()}</p>
              <p className="text-muted" style={{ marginBottom: "0.8rem" }}>
                {report.query}
              </p>
              <Link className="button button-secondary" href={`/report/${report.id}`}>
                Open Workspace
              </Link>
            </article>
          ))}
        </div>
      </article>
    </section>
  );
}
