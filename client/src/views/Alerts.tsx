"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  getAlerts,
  createAlert,
  deleteAlert,
  checkAlerts,
  getSessionUser,
  subscribeToAuthChanges,
  type PriceAlert,
} from "../services/api";

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function Alerts() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ticker, setTicker] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [threshold, setThreshold] = useState("");
  const [cadence, setCadence] = useState<"once" | "daily">("once");
  const [submitting, setSubmitting] = useState(false);
  const [checkMsg, setCheckMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await getAlerts();
      setAlerts(res.alerts);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load alerts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      const isIn = getSessionUser() !== null;
      setSignedIn(isIn);
      if (isIn) { void load(); } else { setAlerts([]); setLoading(false); }
    };
    sync();
    return subscribeToAuthChanges(sync);
  }, [load]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    const th = Number(threshold);
    if (!t) { setError("Enter a ticker symbol."); return; }
    if (!Number.isFinite(th) || th <= 0) { setError("Enter a valid positive price."); return; }
    setSubmitting(true);
    setError("");
    try {
      await createAlert(t, t, direction, th, cadence);
      setTicker(""); setThreshold("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create alert.");
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (id: string) => {
    try { await deleteAlert(id); await load(); } catch { /* ignore */ }
  };

  const onCheckNow = async () => {
    setCheckMsg("Checking…");
    try {
      const res = await checkAlerts();
      setAlerts(res.alerts);
      setCheckMsg(res.fired > 0 ? `${res.fired} alert(s) triggered — see notifications` : "No alerts triggered right now.");
    } catch (e) {
      setCheckMsg(e instanceof Error ? e.message : "Check failed.");
    }
  };

  if (!signedIn) {
    return (
      <section className="findec-minimal-page">
        <div className="findec-minimal-shell earn-shell">
          <div className="findec-panel" style={{ textAlign: "center", padding: "2.5rem" }}>
            <p className="findec-kicker">Price Alerts</p>
            <h1 className="earn-title">Sign in to set price alerts</h1>
            <p className="text-muted">Get notified when a stock crosses your target price.</p>
            <Link href="/login" className="earn-nav-btn" style={{ marginTop: "1rem", display: "inline-block" }}>Login →</Link>
          </div>
        </div>
      </section>
    );
  }

  const active = alerts.filter((a) => a.active);
  const triggered = alerts.filter((a) => !a.active);

  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell earn-shell">
        <div className="earn-header">
          <div>
            <p className="findec-kicker">Notifications</p>
            <h1 className="earn-title">Price Alerts</h1>
          </div>
          <div className="earn-header-actions">
            <button className="earn-nav-btn" onClick={onCheckNow}>Check now</button>
            <Link href="/watchlist" className="earn-nav-btn">Watchlist →</Link>
          </div>
        </div>

        {checkMsg && <p className="rsrch-note" style={{ marginTop: 0 }}>{checkMsg}</p>}

        {/* ── Create alert ── */}
        <form className="findec-panel alert-create" onSubmit={onCreate}>
          <input
            className="alert-input alert-ticker"
            placeholder="Ticker (e.g. AAPL)"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
          />
          <div className="alert-dir-toggle">
            <button type="button" className={`adv-chip ${direction === "above" ? "adv-chip-on" : ""}`} onClick={() => setDirection("above")}>Above ↑</button>
            <button type="button" className={`adv-chip ${direction === "below" ? "adv-chip-on" : ""}`} onClick={() => setDirection("below")}>Below ↓</button>
          </div>
          <input
            className="alert-input alert-price"
            type="number"
            step="0.01"
            placeholder="Price"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
          <div className="alert-dir-toggle alert-cadence-toggle" title="How often you want to be reminded once the price crosses your target">
            <button type="button" className={`adv-chip ${cadence === "once" ? "adv-chip-on" : ""}`} onClick={() => setCadence("once")}>Once</button>
            <button type="button" className={`adv-chip ${cadence === "daily" ? "adv-chip-on" : ""}`} onClick={() => setCadence("daily")}>Daily</button>
          </div>
          <button type="submit" className="earn-nav-btn alert-submit" disabled={submitting}>
            {submitting ? "Adding…" : "Add alert"}
          </button>
        </form>
        <p className="rsrch-note" style={{ marginTop: "-0.25rem" }}>
          <strong>Once</strong> notifies a single time when the price crosses your target. <strong>Daily</strong> keeps the alert active and reminds you at most once per day while the condition holds. Alerts are checked automatically every minute while you&apos;re signed in, and hourly in the background.
        </p>

        {error && <div className="findec-panel earn-error">{error}</div>}
        {loading && <p className="findec-kicker earn-loading">Loading alerts…</p>}

        {!loading && (
          <>
            <div className="findec-panel earn-table-wrap">
              <p className="findec-kicker" style={{ padding: "0.75rem 1rem 0" }}>Active ({active.length})</p>
              {active.length === 0 ? (
                <p className="earn-empty">No active alerts. Add one above.</p>
              ) : (
                <table className="earn-table">
                  <thead>
                    <tr>
                      <th className="earn-th">Ticker</th>
                      <th className="earn-th earn-th-c">Condition</th>
                      <th className="earn-th earn-th-r">Target</th>
                      <th className="earn-th earn-th-r earn-hide-sm">Created</th>
                      <th className="earn-th"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((a) => (
                      <tr key={a.id} className="earn-row">
                        <td className="earn-td">
                          <Link href={`/stock/${encodeURIComponent(a.ticker)}`} className="earn-symbol">{a.ticker}</Link>
                        </td>
                        <td className="earn-td earn-td-c">
                          <span className={a.direction === "above" ? "findec-subline-up" : "findec-subline-down"}>
                            {a.direction === "above" ? "Crosses above ↑" : "Drops below ↓"}
                          </span>
                          {a.cadence === "daily" && <span className="findec-tag findec-tag-amber" style={{ marginLeft: "0.4rem" }}>Daily</span>}
                        </td>
                        <td className="earn-td earn-td-r"><strong>{a.threshold.toFixed(2)}</strong></td>
                        <td className="earn-td earn-td-r earn-hide-sm">{fmtWhen(a.createdAt)}</td>
                        <td className="earn-td earn-td-actions">
                          <button className="earn-action alert-del" onClick={() => onDelete(a.id)}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {triggered.length > 0 && (
              <div className="findec-panel earn-table-wrap">
                <p className="findec-kicker" style={{ padding: "0.75rem 1rem 0" }}>Triggered ({triggered.length})</p>
                <table className="earn-table">
                  <thead>
                    <tr>
                      <th className="earn-th">Ticker</th>
                      <th className="earn-th earn-th-c">Condition</th>
                      <th className="earn-th earn-th-r">Target</th>
                      <th className="earn-th earn-th-r">Hit at</th>
                      <th className="earn-th earn-th-r earn-hide-sm">When</th>
                      <th className="earn-th"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {triggered.map((a) => (
                      <tr key={a.id} className="earn-row alert-row-done">
                        <td className="earn-td">
                          <Link href={`/stock/${encodeURIComponent(a.ticker)}`} className="earn-symbol">{a.ticker}</Link>
                        </td>
                        <td className="earn-td earn-td-c">{a.direction === "above" ? "above" : "below"} {a.threshold.toFixed(2)}</td>
                        <td className="earn-td earn-td-r">{a.threshold.toFixed(2)}</td>
                        <td className="earn-td earn-td-r">{a.triggeredPrice != null ? a.triggeredPrice.toFixed(2) : "—"}</td>
                        <td className="earn-td earn-td-r earn-hide-sm">{a.triggeredAt ? fmtWhen(a.triggeredAt) : "—"}</td>
                        <td className="earn-td earn-td-actions">
                          <button className="earn-action alert-del" onClick={() => onDelete(a.id)}>Clear</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
