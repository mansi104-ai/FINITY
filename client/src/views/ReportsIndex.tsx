"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getReports } from "../services/api";
import type { AgentReport } from "../types";

export default function ReportsIndex() {
  const [reports, setReports] = useState<AgentReport[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const result = await getReports();
        setReports(result.reports);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load reports.");
      }
    };

    void load();
  }, []);

  const latest = useMemo(() => reports.slice(0, 6), [reports]);

  return (
    <section className="grid page-shell">
      <article className="hero-panel">
        <div>
          <p className="eyebrow">Reports</p>
          <h1 className="hero-title">Research reports, briefs, and execution context in one archive.</h1>
          <p className="hero-copy">
            Use this as the report home page, then drill into any detailed report from the list below.
          </p>
        </div>
        <div className="hero-strip">
          <div className="metric-card">
            <span className="metric-label">Reports stored</span>
            <strong>{reports.length}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Latest route</span>
            <strong>/report/[id]</strong>
          </div>
        </div>
      </article>

      <article className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Report Library</p>
            <h2>Open a detailed report</h2>
          </div>
          <Link className="button button-secondary" href="/brief">
            Create new brief
          </Link>
        </div>
        {error && <p style={{ color: "#ff9f9f" }}>{error}</p>}
        {latest.length === 0 ? (
          <p className="text-muted">No reports yet. Generate one from the brief page.</p>
        ) : (
          <div className="grid grid-2">
            {latest.map((report) => (
              <article key={report.id} className="mini-panel">
                <p style={{ marginTop: 0 }}>
                  <strong>{report.ticker}</strong> | {report.recommendation.action.toUpperCase()}
                </p>
                <p className="text-muted">{report.query}</p>
                <Link className="button button-secondary" href={`/report/${report.id}`}>
                  Open Report
                </Link>
              </article>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
