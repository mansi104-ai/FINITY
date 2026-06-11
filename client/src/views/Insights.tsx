"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getMarketRegime,
  getPortfolioInsights,
  getSessionUser,
  subscribeToAuthChanges,
  type MarketRegime,
  type PortfolioInsights,
} from "../services/api";

function Signed({ v, suffix = "%" }: { v: number; suffix?: string }) {
  const cls = v > 0 ? "findec-subline-up" : v < 0 ? "findec-subline-down" : "";
  return <span className={cls}>{v >= 0 ? "+" : ""}{v.toFixed(2)}{suffix}</span>;
}

function regimeClass(r: MarketRegime["regime"]): string {
  return r === "risk-on" ? "ins-regime-on" : r === "risk-off" ? "ins-regime-off" : "ins-regime-neutral";
}

export default function Insights() {
  const [regime, setRegime] = useState<MarketRegime | null>(null);
  const [regimeErr, setRegimeErr] = useState("");
  const [portfolio, setPortfolio] = useState<PortfolioInsights | null>(null);
  const [portfolioErr, setPortfolioErr] = useState("");
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    getMarketRegime()
      .then(setRegime)
      .catch((e: unknown) => setRegimeErr(e instanceof Error ? e.message : "Regime unavailable."));
  }, []);

  useEffect(() => {
    const sync = () => {
      const isIn = getSessionUser() !== null;
      setSignedIn(isIn);
      if (isIn) {
        getPortfolioInsights()
          .then(setPortfolio)
          .catch((e: unknown) => setPortfolioErr(e instanceof Error ? e.message : "Portfolio unavailable."));
      } else {
        setPortfolio(null);
      }
    };
    sync();
    return subscribeToAuthChanges(sync);
  }, []);

  return (
    <section className="findec-minimal-page">
      <div className="findec-minimal-shell earn-shell">
        <div className="earn-header">
          <div>
            <p className="findec-kicker">AI Insights</p>
            <h1 className="earn-title">Portfolio &amp; Market Regime</h1>
          </div>
          <div className="earn-header-actions">
            <Link href="/research" className="earn-nav-btn">Research →</Link>
            <Link href="/watchlist" className="earn-nav-btn">Watchlist →</Link>
          </div>
        </div>

        {/* ── Market Regime ── */}
        <article className="findec-panel ins-panel">
          <p className="findec-kicker">Market Regime</p>
          {regimeErr && <p className="text-muted">{regimeErr}</p>}
          {!regime && !regimeErr && <p className="findec-kicker">Reading the tape…</p>}
          {regime && (
            <>
              {regime.fearGreed != null && (
                <div className="ins-fg">
                  <div className="ins-fg-head">
                    <span className="findec-kicker">Fear &amp; Greed Index</span>
                    <strong className="ins-fg-val">{regime.fearGreed} · {regime.fearGreedLabel}</strong>
                  </div>
                  <div className="ins-fg-track">
                    <div className="ins-fg-marker" style={{ left: `${regime.fearGreed}%` }} />
                  </div>
                  <div className="ins-fg-scale"><span>Extreme Fear</span><span>Neutral</span><span>Extreme Greed</span></div>
                </div>
              )}
              <div className={`ins-regime-badge ${regimeClass(regime.regime)}`}>
                {regime.regime.toUpperCase()}
              </div>
              <p className="ins-regime-label">{regime.label}</p>
              <div className="ins-regime-stats">
                <div><span>Breadth</span><strong>{regime.advancing}/{regime.total} up ({regime.breadthPercent}%)</strong></div>
                <div><span>Avg move</span><strong><Signed v={regime.avgMovePercent} /></strong></div>
                <div><span>Composite</span><strong>{regime.score >= 0 ? "+" : ""}{regime.score}</strong></div>
              </div>
              <div className="ins-regime-movers">
                <div>
                  <span className="findec-kicker">Leaders</span>
                  {regime.leaders.map((l) => (
                    <Link key={l.symbol} href={`/stock/${encodeURIComponent(l.symbol)}`} className="ins-mover">
                      {l.symbol} <Signed v={l.changePercent} />
                    </Link>
                  ))}
                </div>
                <div>
                  <span className="findec-kicker">Laggards</span>
                  {regime.laggards.map((l) => (
                    <Link key={l.symbol} href={`/stock/${encodeURIComponent(l.symbol)}`} className="ins-mover">
                      {l.symbol} <Signed v={l.changePercent} />
                    </Link>
                  ))}
                </div>
              </div>
            </>
          )}
        </article>

        {/* ── Portfolio Analysis ── */}
        <article className="findec-panel ins-panel">
          <p className="findec-kicker">Portfolio Analysis</p>
          {!signedIn && (
            <p className="text-muted">
              <Link href="/login" className="earn-symbol">Sign in</Link> and add buy prices to your watchlist to see portfolio P&amp;L, diversification, and an AI summary.
            </p>
          )}
          {signedIn && portfolioErr && <p className="text-muted">{portfolioErr}</p>}
          {signedIn && portfolio && !portfolio.hasPositions && (
            <p className="text-muted">{portfolio.message ?? "Add buy prices to your watchlist to enable analysis."}</p>
          )}
          {signedIn && portfolio?.error && <p className="text-muted">{portfolio.error}</p>}
          {signedIn && portfolio?.hasPositions && portfolio.totals && (
            <>
              <div className="ins-totals">
                <div className="ins-total-card">
                  <span>Total P&amp;L</span>
                  <strong><Signed v={portfolio.totals.totalPnlPercent} /></strong>
                  <em><Signed v={portfolio.totals.totalPnl} suffix="" /> /sh</em>
                </div>
                <div className="ins-total-card">
                  <span>Value</span>
                  <strong>{portfolio.totals.totalValue.toFixed(2)}</strong>
                  <em>cost {portfolio.totals.totalCost.toFixed(2)}</em>
                </div>
                <div className="ins-total-card">
                  <span>Winners</span>
                  <strong>{portfolio.totals.winners}/{portfolio.totals.positions}</strong>
                  <em>{portfolio.concentration} concentration</em>
                </div>
              </div>

              {portfolio.narrative && (
                <div className="ins-narrative">
                  {portfolio.narrative.map((n, i) => <p key={i}>{n}</p>)}
                </div>
              )}

              {portfolio.allocation && portfolio.allocation.length > 0 && (
                <div className="ins-alloc">
                  <span className="findec-kicker">Sector allocation</span>
                  <div className="ins-alloc-bar">
                    {portfolio.allocation.map((a, i) => (
                      <div
                        key={a.sector}
                        className={`ins-alloc-seg ins-alloc-${i % 6}`}
                        style={{ width: `${a.weightPercent}%` }}
                        title={`${a.sector}: ${a.weightPercent}%`}
                      />
                    ))}
                  </div>
                  <div className="ins-alloc-legend">
                    {portfolio.allocation.map((a, i) => (
                      <span key={a.sector}><i className={`adv-swatch ins-alloc-${i % 6}`} /> {a.sector} {a.weightPercent}%</span>
                    ))}
                  </div>
                </div>
              )}

              {portfolio.holdings && (
                <table className="earn-table ins-holdings">
                  <thead>
                    <tr>
                      <th className="earn-th">Ticker</th>
                      <th className="earn-th earn-th-r">Buy</th>
                      <th className="earn-th earn-th-r">Now</th>
                      <th className="earn-th earn-th-r">P&amp;L</th>
                      <th className="earn-th earn-hide-sm">Sector</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.holdings.map((h) => (
                      <tr key={h.ticker} className="earn-row">
                        <td className="earn-td">
                          <Link href={`/stock/${encodeURIComponent(h.ticker)}`} className="earn-symbol">{h.ticker}</Link>
                        </td>
                        <td className="earn-td earn-td-r">{h.buyPrice.toFixed(2)}</td>
                        <td className="earn-td earn-td-r">{h.price.toFixed(2)}</td>
                        <td className="earn-td earn-td-r"><Signed v={h.pnlPercent} /></td>
                        <td className="earn-td earn-hide-sm">{h.sector}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </article>

        <p className="rsrch-note">Insights are computed from live market data and are decision support only — not financial advice.</p>
      </div>
    </section>
  );
}
