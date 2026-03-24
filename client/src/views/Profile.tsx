"use client";

import { useEffect, useState } from "react";
import type { RiskProfile } from "../types";

const LOCAL_SETTINGS_KEY = "findec-local-settings";

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function Profile() {
  const [budget, setBudget] = useState(10000);
  const [riskProfile, setRiskProfile] = useState<RiskProfile>("medium");
  const [message, setMessage] = useState("");

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

  const onSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify({ budget, riskProfile }));
    }
    setMessage("Local preferences saved for direct query mode.");
  };

  return (
    <section className="grid page-shell">
      <article className="hero-panel">
        <div>
          <p className="eyebrow">Workspace Preferences</p>
          <h1 className="hero-title">Capital and risk settings for your public workspace.</h1>
          <p className="hero-copy">
            These settings are stored in your browser and reused by the public query flow so you can run briefs without authentication.
          </p>
        </div>
        <div className="hero-strip">
          <div className="metric-card">
            <span className="metric-label">Saved budget</span>
            <strong>{currency(budget)}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Risk mode</span>
            <strong>{riskProfile}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Profile state</span>
            <strong>{message ? "Saved" : "Ready"}</strong>
          </div>
        </div>
      </article>

      <div className="grid dashboard-grid">
        <article className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Settings</p>
              <h3>Local portfolio profile</h3>
            </div>
          </div>
          <form onSubmit={onSave}>
            <div className="form-row">
              <label className="label" htmlFor="budget">
                Budget (USD)
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
              <label className="label" htmlFor="riskProfile">
                Risk Profile
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

            <button className="button button-primary" type="submit">
              Save Preferences
            </button>
          </form>
          {message && <p style={{ color: "#207f4b" }}>{message}</p>}
        </article>

        <article className="card panel-dark">
          <p className="eyebrow">What changes</p>
          <h3>Allocator impact</h3>
          <div className="brief-list">
            <div className="brief-item">
              <span className="brief-index">01</span>
              <div>
                <strong>Budget</strong>
                <p className="text-muted">Controls the base capital available for recommendation sizing and risk output.</p>
              </div>
            </div>
            <div className="brief-item">
              <span className="brief-index">02</span>
              <div>
                <strong>Risk profile</strong>
                <p className="text-muted">Changes how aggressively the allocator turns validated signals into position sizes.</p>
              </div>
            </div>
            <div className="brief-item">
              <span className="brief-index">03</span>
              <div>
                <strong>Public mode</strong>
                <p className="text-muted">Preferences stay in your browser so you can query immediately without an account.</p>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
