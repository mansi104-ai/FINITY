"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getReports } from "../services/api";
import { useAuth } from "../context/AuthContext";
import type { AgentReport } from "../types";
import ReportCard from "../components/ReportCard";

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

  return (
    <section className="grid" style={{ paddingBlock: "1rem" }}>
      <article className="card">
        <h2>Dashboard</h2>
        <p className="text-muted">Monitor your AI-assisted financial decisions across all agent versions.</p>
        {loading && <p>Checking session...</p>}
        {!loading && !token && (
          <p>
            Login from the <Link href="/query">Query page</Link> to start running agent workflows.
          </p>
        )}
        {user && (
          <p>
            Signed in as <strong>{user.email}</strong> | Budget: ${user.budget.toFixed(2)} | Risk: {user.riskProfile}
          </p>
        )}
        {error && <p style={{ color: "#c92a2a" }}>{error}</p>}
      </article>

      <div className="grid grid-2">
        <article className="card">
          <h3>Total Reports</h3>
          <p style={{ fontSize: "2rem", margin: "0.4rem 0" }}>{reports.length}</p>
          <p className="text-muted">Generated recommendations saved in history.</p>
        </article>
        <article className="card">
          <h3>Quick Action</h3>
          <p>Run new multi-agent query:</p>
          <Link className="button" href="/query">
            Open Query Console
          </Link>
        </article>
      </div>

      {latest && <ReportCard report={latest} />}
    </section>
  );
}
