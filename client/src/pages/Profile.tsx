"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import type { RiskProfile } from "../types";

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function Profile() {
  const { user, token, refreshProfile, saveProfile } = useAuth();
  const [budget, setBudget] = useState(10000);
  const [riskProfile, setRiskProfile] = useState<RiskProfile>("medium");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) {
      setBudget(user.budget);
      setRiskProfile(user.riskProfile);
    }
  }, [user]);

  useEffect(() => {
    if (!token) {
      return;
    }

    void refreshProfile();
  }, [refreshProfile, token]);

  const onSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      await saveProfile(Number(budget), riskProfile);
      setMessage("Profile updated successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
    }
  };

  if (!token) {
    return (
      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Profile</h2>
        <p>Please login first from Query page.</p>
      </section>
    );
  }

  return (
    <section className="grid page-shell">
      <article className="hero-panel">
        <div>
          <p className="eyebrow">Trader Profile</p>
          <h1 className="hero-title">Capital and risk settings for your workspace.</h1>
          <p className="hero-copy">
            These settings define the base capital profile the allocator uses when converting signals into position sizes.
          </p>
        </div>
        <div className="hero-strip">
          <div className="metric-card">
            <span className="metric-label">Saved budget</span>
            <strong>{currency(user?.budget ?? budget)}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Risk mode</span>
            <strong>{user?.riskProfile ?? riskProfile}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">Profile state</span>
            <strong>{message ? "Updated" : "Ready"}</strong>
          </div>
        </div>
      </article>

      <div className="grid dashboard-grid">
        <article className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Settings</p>
              <h3>Portfolio profile</h3>
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
              Save Profile
            </button>
          </form>
          {message && <p style={{ color: "#7dff9b" }}>{message}</p>}
          {error && <p style={{ color: "#ff9f9f" }}>{error}</p>}
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
                <strong>Per-query override</strong>
                <p className="text-muted">You can still override budget inside the query workflow for one-off trade ideas.</p>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
