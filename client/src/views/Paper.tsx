"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  getPaperAccount,
  tradePaper,
  resetPaper,
  getSessionUser,
  subscribeToAuthChanges,
  type PaperAccount,
} from "../services/api";

function Signed({ v, suffix = "%" }: { v: number; suffix?: string }) {
  const cls = v > 0 ? "findec-subline-up" : v < 0 ? "findec-subline-down" : "";
  return <span className={cls}>{v >= 0 ? "+" : ""}{v.toFixed(2)}{suffix}</span>;
}

export default function Paper() {
  const [account, setAccount] = useState<PaperAccount | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try { setAccount(await getPaperAccount()); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load account."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const sync = () => {
      const isIn = getSessionUser() !== null;
      setSignedIn(isIn);
      if (isIn) void load(); else { setAccount(null); setLoading(false); }
    };
    sync();
    return subscribeToAuthChanges(sync);
  }, [load]);

  const trade = async (side: "buy" | "sell") => {
    const t = ticker.trim().toUpperCase();
    const n = Number(shares);
    if (!t) { setError("Enter a ticker."); return; }
    if (!Number.isInteger(n) || n <= 0) { setError("Enter a whole number of shares."); return; }
    setBusy(true); setError(""); setMsg("");
    try {
      const updated = await tradePaper(t, side, n);
      setAccount(updated);
      setMsg(`${side === "buy" ? "Bought" : "Sold"} ${n} ${t}`);
      setShares("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trade failed.");
    } finally { setBusy(false); }
  };

  const onReset = async () => {
    setBusy(true);
    try { setAccount(await resetPaper()); setMsg("Account reset to $100,000"); }
    catch (e) { setError(e instanceof Error ? e.message : "Reset failed."); }
    finally { setBusy(false); }
  };

  if (!signedIn) {
    return (
      <section className="findec-minimal-page">
        <div className="findec-minimal-shell earn-shell">
          <div className="findec-panel" style={{ textAlign: "center", padding: "2.5rem" }}>
            <p className="findec-kicker">Paper Trading</p>
            <h1 className="earn-title">Sign in to start paper trading</h1>
            <p className="text-muted">Practice with $100,000 of virtual cash at live prices — zero risk.</p>
            <Link href="/login" className="earn-nav-btn" style={{ marginTop: "1rem", display: "inline-block" }}>Login →</Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell earn-shell">
        <div className="earn-header">
          <div>
            <p className="findec-kicker">Virtual Portfolio</p>
            <h1 className="earn-title">Paper Trading</h1>
          </div>
          <div className="earn-header-actions">
            <button className="earn-nav-btn" onClick={() => void load()}>Refresh</button>
            <button className="earn-nav-btn alert-del" onClick={() => void onReset()} disabled={busy}>Reset</button>
          </div>
        </div>

        {account && (
          <div className="ins-totals">
            <div className="ins-total-card">
              <span>Equity</span>
              <strong>${account.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              <em><Signed v={account.totalReturnPercent} /> total</em>
            </div>
            <div className="ins-total-card">
              <span>Cash</span>
              <strong>${account.cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              <em>buying power</em>
            </div>
            <div className="ins-total-card">
              <span>Positions value</span>
              <strong>${account.positionsValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              <em>{account.positions.length} holding(s)</em>
            </div>
          </div>
        )}

        {/* ── Trade ticket ── */}
        <div className="findec-panel alert-create">
          <input className="alert-input alert-ticker" placeholder="Ticker (e.g. AAPL)" value={ticker} onChange={(e) => setTicker(e.target.value)} />
          <input className="alert-input alert-price" type="number" min="1" step="1" placeholder="Shares" value={shares} onChange={(e) => setShares(e.target.value)} />
          <button className="earn-nav-btn" disabled={busy} onClick={() => void trade("buy")}>Buy</button>
          <button className="earn-nav-btn" disabled={busy} onClick={() => void trade("sell")}>Sell</button>
          {msg && <span className="report-share-msg">{msg}</span>}
        </div>

        {error && <div className="findec-panel earn-error">{error}</div>}
        {loading && <p className="findec-kicker earn-loading">Loading account…</p>}

        {/* ── Positions ── */}
        {account && account.positions.length > 0 && (
          <div className="findec-panel earn-table-wrap">
            <p className="findec-kicker" style={{ padding: "0.75rem 1rem 0" }}>Positions</p>
            <table className="earn-table">
              <thead>
                <tr>
                  <th className="earn-th">Ticker</th>
                  <th className="earn-th earn-th-r">Shares</th>
                  <th className="earn-th earn-th-r">Avg cost</th>
                  <th className="earn-th earn-th-r">Price</th>
                  <th className="earn-th earn-th-r">Value</th>
                  <th className="earn-th earn-th-r">P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {account.positions.map((p) => (
                  <tr key={p.ticker} className="earn-row">
                    <td className="earn-td"><Link href={`/stock/${encodeURIComponent(p.ticker)}`} className="earn-symbol">{p.ticker}</Link></td>
                    <td className="earn-td earn-td-r">{p.shares}</td>
                    <td className="earn-td earn-td-r">{p.avgCost.toFixed(2)}</td>
                    <td className="earn-td earn-td-r">{p.price.toFixed(2)}</td>
                    <td className="earn-td earn-td-r">{p.marketValue.toFixed(2)}</td>
                    <td className="earn-td earn-td-r"><Signed v={p.pnlPercent} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Recent trades ── */}
        {account && account.trades.length > 0 && (
          <div className="findec-panel earn-table-wrap">
            <p className="findec-kicker" style={{ padding: "0.75rem 1rem 0" }}>Recent Trades</p>
            <table className="earn-table">
              <thead>
                <tr>
                  <th className="earn-th">When</th>
                  <th className="earn-th">Ticker</th>
                  <th className="earn-th earn-th-c">Side</th>
                  <th className="earn-th earn-th-r">Shares</th>
                  <th className="earn-th earn-th-r">Price</th>
                </tr>
              </thead>
              <tbody>
                {account.trades.map((t) => (
                  <tr key={t.id} className="earn-row">
                    <td className="earn-td earn-td-date">{new Date(t.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                    <td className="earn-td"><span className="earn-symbol">{t.ticker}</span></td>
                    <td className="earn-td earn-td-c">
                      <span className={t.side === "buy" ? "findec-subline-up" : "findec-subline-down"}>{t.side.toUpperCase()}</span>
                    </td>
                    <td className="earn-td earn-td-r">{t.shares}</td>
                    <td className="earn-td earn-td-r">{t.price.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="rsrch-note">Virtual money only. Trades execute at the latest live price. Not financial advice.</p>
      </div>
    </section>
  );
}
