"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { sendQuery } from "../services/api";
import { useAuth } from "../context/AuthContext";
import type { QueryResponse } from "../types";
import AgentStatusCard from "../components/AgentStatusCard";
import ReportCard from "../components/ReportCard";
import WorkspaceGuide from "../components/WorkspaceGuide";

function extractTicker(query: string): string {
  const dollarMatch = query.toUpperCase().match(/\$([A-Z][A-Z0-9.-]{0,14})\b/);
  if (dollarMatch?.[1]) {
    return dollarMatch[1];
  }

  const symbolMatch = query.toUpperCase().match(/\b[A-Z][A-Z0-9.-]{0,14}\b/);
  return symbolMatch?.[0] ?? "";
}

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function QueryPage() {
  const { token, user, loading, login, register, logout } = useAuth();
  const [email, setEmail] = useState("demo@finity.ai");
  const [password, setPassword] = useState("Passw0rd!");
  const [query, setQuery] = useState("");
  const [ticker, setTicker] = useState("");
  const [budget, setBudget] = useState(10000);
  const [version, setVersion] = useState(2);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<QueryResponse | null>(null);

  const placeholderTicker = useMemo(() => extractTicker(query), [query]);
  const allocationHint = useMemo(() => Math.round(budget * 0.08), [budget]);

  useEffect(() => {
    if (user?.budget) {
      setBudget(user.budget);
    }
  }, [user]);

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
      const normalizedTicker = ticker.trim().toUpperCase();
      const response = await sendQuery({
        query,
        ticker: normalizedTicker || undefined,
        budget,
        version,
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Query execution failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="grid page-shell">
      <article className="hero-panel">
        <div>
          <p className="eyebrow">Trading Console</p>
          <h1 className="hero-title">Build a market thesis, then inspect exactly how the system reached its call.</h1>
          <p className="hero-copy">
            FINITY is organized into a simple flow: enter a thesis, run the agents, inspect the forecast and algorithm graph, then review the evidence.
          </p>
        </div>
        <div className="hero-strip">
          <div className="metric-card">
            <span className="metric-label">Default budget</span>
            <strong>{currency(user?.budget ?? budget)}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Tactical size</span>
            <strong>{currency(allocationHint)}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Trader tooling</span>
            <strong>Graph + algorithms</strong>
          </div>
        </div>
      </article>

      {!token && (
        <article className="card panel-dark">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Authentication</p>
              <h2>Secure multi-user access</h2>
            </div>
            <p className="text-muted">
              Create an account or sign in to save reports, budgets, and position preferences.
            </p>
          </div>
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
          <div className="button-row">
            <button className="button" onClick={handleLogin} type="button" disabled={loading}>
              Login
            </button>
            <button className="button button-secondary" onClick={handleRegister} type="button" disabled={loading}>
              Register
            </button>
          </div>
        </article>
      )}

      {token && (
        <article className="card account-bar">
          <div>
            <p className="eyebrow">Active session</p>
            <h3 style={{ margin: "0.2rem 0" }}>{user?.email}</h3>
            <p className="text-muted" style={{ margin: 0 }}>
              Risk profile: <strong>{user?.riskProfile ?? "medium"}</strong> | Saved budget:{" "}
              <strong>{currency(user?.budget ?? budget)}</strong>
            </p>
          </div>
          <button className="button button-secondary" onClick={logout} type="button">
            Logout
          </button>
        </article>
      )}

      <div className="grid query-layout">
        <article className="card trade-ticket">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Trade Ticket</p>
              <h2>Build a market brief</h2>
            </div>
            <p className="text-muted">
              Enter the thesis, symbol, and capital you want the system to size against for this run.
            </p>
          </div>

          <form onSubmit={handleRun}>
            <div className="form-row">
              <label className="label" htmlFor="query">
                Thesis / query
              </label>
              <textarea
                className="textarea"
                id="query"
                rows={4}
                placeholder="Example: Should I buy NVDA after earnings momentum and AI capex guidance?"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            <div className="grid grid-3">
              <div className="form-row">
                <label className="label" htmlFor="ticker">
                  Ticker
                </label>
                <input
                  className="input"
                  id="ticker"
                  value={ticker}
                  placeholder={placeholderTicker || "AAPL"}
                  onChange={(event) => setTicker(event.target.value.toUpperCase().replace(/[^A-Z0-9.-]/g, ""))}
                />
              </div>

              <div className="form-row">
                <label className="label" htmlFor="budget">
                  Budget for this run
                </label>
                <input
                  className="input"
                  id="budget"
                  min={100}
                  step={100}
                  type="number"
                  value={budget}
                  onChange={(event) => setBudget(Number(event.target.value))}
                />
              </div>

              <div className="form-row">
                <label className="label" htmlFor="version">
                  Engine version
                </label>
                <select
                  className="select"
                  id="version"
                  value={version}
                  onChange={(event) => setVersion(Number(event.target.value))}
                >
                  <option value={1}>V1 | Research only</option>
                  <option value={2}>V2 | Research + analyst</option>
                  <option value={3}>V3 | Policy weighted</option>
                  <option value={4}>V4 | Full orchestration</option>
                </select>
              </div>
            </div>

            <div className="ticket-summary">
              <div className="ticket-kpi">
                <span className="metric-label">Deployment budget</span>
                <strong>{currency(budget)}</strong>
              </div>
              <div className="ticket-kpi">
                <span className="metric-label">Illustrative starter size</span>
                <strong>{currency(allocationHint)}</strong>
              </div>
              <div className="ticket-kpi">
                <span className="metric-label">Detected symbol</span>
                <strong>{ticker || placeholderTicker || "Awaiting input"}</strong>
              </div>
            </div>

            <div className="button-row">
              <button className="button button-primary" disabled={!token || running} type="submit">
                {running ? "Running market brief..." : "Run Analysis"}
              </button>
              {result && (
                <Link className="button button-secondary" href={`/report/${result.reportId}`}>
                  Open Detailed Report
                </Link>
              )}
            </div>

            {!token && <p className="text-muted">Please login first to run analysis.</p>}
          </form>
        </article>

        <article className="card market-brief">
          <p className="eyebrow">Session brief</p>
          <h3 style={{ marginTop: 0 }}>What you get after each run</h3>
          <div className="brief-list">
            <div className="brief-item">
              <span className="brief-index">01</span>
              <div>
                <strong>Forecast workspace</strong>
                <p className="text-muted">Prediction path, scenarios, support/resistance, and confidence-calibrated forecast output.</p>
              </div>
            </div>
            <div className="brief-item">
              <span className="brief-index">02</span>
              <div>
                <strong>Algorithm transparency</strong>
                <p className="text-muted">Backtest quality, model method, signal contributors, and algorithm workbench for traders.</p>
              </div>
            </div>
            <div className="brief-item">
              <span className="brief-index">03</span>
              <div>
                <strong>Evidence graph</strong>
                <p className="text-muted">Zoomable graph connecting the prediction to reviewed articles and their relevance to the call.</p>
              </div>
            </div>
          </div>
        </article>
      </div>

      <WorkspaceGuide />

      {error && (
        <article className="card danger-card">
          <p style={{ margin: 0 }}>{error}</p>
        </article>
      )}

      {result && (
        <>
          <ReportCard report={result.report} />
          <AgentStatusCard statuses={result.report.agentLogs} />
        </>
      )}
    </section>
  );
}
