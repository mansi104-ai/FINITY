"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import type { RiskProfile } from "../types";

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
    <section className="card" style={{ marginTop: "1rem", maxWidth: 540 }}>
      <h2>Profile Settings</h2>
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

        <button className="button" type="submit">
          Save Profile
        </button>
      </form>
      {message && <p style={{ color: "#2b8a3e" }}>{message}</p>}
      {error && <p style={{ color: "#c92a2a" }}>{error}</p>}
    </section>
  );
}
