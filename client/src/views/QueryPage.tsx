"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { sendQuery } from "../services/api";
import type { QueryResponse, RiskProfile } from "../types";
import AgentStatusCard from "../components/AgentStatusCard";
import ReportCard from "../components/ReportCard";
import WorkspaceGuide from "../components/WorkspaceGuide";

const LOCAL_SETTINGS_KEY = "finity-local-settings";

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
  const [query, setQuery] = useState("");
  const [ticker, setTicker] = useState("");
  const [budget, setBudget] = useState(10000);
  const [riskProfile, setRiskProfile] = useState<RiskProfile>("medium");
  const [version, setVersion] = useState(2);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<QueryResponse | null>(null);

  const placeholderTicker = useMemo(() => extractTicker(query), [query]);
  const allocationHint = useMemo(() => Math.round(budget * 0.08), [budget]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const saved = window.localStorage.getItem(LOCAL_SETTINGS_KEY);
    if (!saved) {
      return;
    }

    try {
      const parsed = JSON.parse(saved) as { budget?: number; riskProfile?: RiskProfile };
      if (typeof parsed.budget === "number") {
        setBudget(parsed.budget);
      }
      if (parsed.riskProfile) {
        setRiskProfile(parsed.riskProfile);
      }
    } catch {
      window.localStorage.removeItem(LOCAL_SETTINGS_KEY);
    }
  }, []);

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
        riskProfile,
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
            <span className="metric-label">Working budget</span>
            <strong>{currency(budget)}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Tactical size</span>
            <strong>{currency(allocationHint)}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Access mode</span>
            <strong>Direct query</strong>
          </div>
        </div>
      </article>

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

            <div className="form-row">
              <label className="label" htmlFor="riskProfile">
                Risk profile
              </label>
              <select
                className="select"
                id="riskProfile"
                value={riskProfile}
                onChange={(event) => setRiskProfile(event.target.value as RiskProfile)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
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
              <button className="button button-primary" disabled={!query.trim() || running} type="submit">
                {running ? "Running market brief..." : "Run Analysis"}
              </button>
              {result && (
                <Link className="button button-secondary" href={`/report/${result.reportId}`}>
                  Open Detailed Report
                </Link>
              )}
            </div>
          </form>
        </article>

        <article className="card market-brief">
          <p className="eyebrow">Session brief</p>
          <h3 style={{ marginTop: 0 }}>What you get after each run</h3>
          <p className="text-muted">
            This workspace is now public by default, so you can go straight from idea to analysis without registration.
          </p>
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
