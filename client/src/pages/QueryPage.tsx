"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { sendQuery } from "../services/api";
import { useAuth } from "../context/AuthContext";
import type { QueryResponse } from "../types";
import AgentStatusCard from "../components/AgentStatusCard";
import ReportCard from "../components/ReportCard";

function extractTicker(query: string): string {
  const match = query.toUpperCase().match(/\b[A-Z]{1,5}\b/);
  return match?.[0] ?? "AAPL";
}

export default function QueryPage() {
  const { token, user, loading, login, register, logout } = useAuth();
  const [email, setEmail] = useState("demo@finity.ai");
  const [password, setPassword] = useState("Passw0rd!");

  const [query, setQuery] = useState("Should I buy NVDA this week?");
  const [ticker, setTicker] = useState("NVDA");
  const [version, setVersion] = useState(1);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<QueryResponse | null>(null);

  const placeholderTicker = useMemo(() => extractTicker(query), [query]);

  const handleRegister = async () => {
    setError("");
    try {
      await register(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    }
  };

  const handleLogin = async () => {
    setError("");
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  };

  const handleRun = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRunning(true);
    setError("");

    try {
      const response = await sendQuery({
        query,
        ticker: ticker || placeholderTicker,
        version
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Query execution failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="grid" style={{ marginTop: "1rem" }}>
      <article className="card">
        <h2>Query Console</h2>
        <p className="text-muted">Version 1: Frontend + Agent 1, Version 2: Agent 2 added, Version 3: Backend workflow, Version 4: Full orchestration.</p>
      </article>

      {!token && (
        <article className="card">
          <h3>Authentication</h3>
          <p className="text-muted">Create account or login to run and store reports.</p>
          <div className="grid grid-2">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input className="input" id="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                className="input"
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.8rem" }}>
            <button className="button" onClick={handleLogin} type="button" disabled={loading}>
              Login
            </button>
            <button className="button" onClick={handleRegister} type="button" disabled={loading}>
              Register
            </button>
          </div>
        </article>
      )}

      {token && (
        <article className="card">
          <p style={{ marginTop: 0 }}>
            Logged in as <strong>{user?.email}</strong>
          </p>
          <button className="button" onClick={logout} type="button">
            Logout
          </button>
        </article>
      )}

      <article className="card">
        <form onSubmit={handleRun}>
          <div className="form-row">
            <label className="label" htmlFor="query">
              Query
            </label>
            <textarea
              className="textarea"
              id="query"
              rows={3}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="grid grid-2">
            <div className="form-row">
              <label className="label" htmlFor="ticker">
                Ticker
              </label>
              <input
                className="input"
                id="ticker"
                value={ticker}
                placeholder={placeholderTicker}
                onChange={(event) => setTicker(event.target.value.toUpperCase())}
              />
            </div>
            <div className="form-row">
              <label className="label" htmlFor="version">
                Version
              </label>
              <select
                className="select"
                id="version"
                value={version}
                onChange={(event) => setVersion(Number(event.target.value))}
              >
                <option value={1}>Version 1 - Agent 1 + Frontend</option>
                <option value={2}>Version 2 - Add Analyst Agent</option>
                <option value={3}>Version 3 - Backend Added</option>
                <option value={4}>Version 4 - Full Multi-Agent</option>
              </select>
            </div>
          </div>

          <button className="button" disabled={!token || running} type="submit">
            {running ? "Running..." : "Run Query"}
          </button>
          {!token && <p className="text-muted">Please login first.</p>}
        </form>
      </article>

      {error && (
        <article className="card" style={{ borderColor: "#ffd8d8" }}>
          <p style={{ margin: 0, color: "#c92a2a" }}>{error}</p>
        </article>
      )}

      {result && (
        <>
          <ReportCard report={result.report} />
          <AgentStatusCard statuses={result.report.agentLogs} />
          <article className="card">
            <Link className="button" href={`/report/${result.reportId}`}>
              Open Detailed Report
            </Link>
          </article>
        </>
      )}
    </section>
  );
}
