"use client";

import { useEffect, useState } from "react";
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

  if (!token) {
    return (
      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>History</h2>
        <p>Please login from Query page to view report history.</p>
      </section>
    );
  }

  return (
    <section className="card" style={{ marginTop: "1rem" }}>
      <h2>Past Reports</h2>
      {error && <p style={{ color: "#c92a2a" }}>{error}</p>}
      {reports.length === 0 && <p className="text-muted">No report generated yet.</p>}
      <div className="grid" style={{ marginTop: "0.8rem" }}>
        {reports.map((report) => (
          <article key={report.id} style={{ border: "1px solid #e9ecef", borderRadius: 10, padding: "0.8rem" }}>
            <p style={{ margin: 0 }}>
              <strong>{report.ticker}</strong> | {report.recommendation.action.toUpperCase()} | V{report.version}
            </p>
            <p className="text-muted" style={{ margin: "0.4rem 0" }}>
              {new Date(report.createdAt).toLocaleString()}
            </p>
            <Link className="button" href={`/report/${report.id}`}>
              Open Report
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
