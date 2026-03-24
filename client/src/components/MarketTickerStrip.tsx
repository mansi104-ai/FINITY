"use client";

import { useEffect, useState } from "react";
import { getMarketSnapshot } from "../services/api";
import type { MarketSnapshot } from "../types";

function price(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1000 ? 0 : 2,
    minimumFractionDigits: value >= 1000 ? 0 : 2
  }).format(value);
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function MarketTickerStrip() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);

  useEffect(() => {
    const loadSnapshot = async () => {
      try {
        const response = await getMarketSnapshot();
        setSnapshot(response);
      } catch {
        setSnapshot(null);
      }
    };

    void loadSnapshot();
  }, []);

  if (!snapshot) {
    return null;
  }

  const doubledTickers = [...snapshot.tickers, ...snapshot.tickers];

  return (
    <section className="market-strip-shell" aria-label="Market status and last close ticker tape">
      <div className="market-strip-header">
        <div className="market-status-card">
          <span className={`market-dot market-dot-${snapshot.market.phase}`} aria-hidden="true" />
          <div>
            <strong>{snapshot.market.label}</strong>
            <p>
              {snapshot.lastTradingDayLabel} close | {snapshot.market.sessionHours}
            </p>
            <p style={{ fontSize: "0.75rem", color: "#687089", marginTop: "0.25rem" }}>
              📍 {snapshot.geoLocation.country} ({snapshot.geoLocation.countryCode})
            </p>
          </div>
        </div>
      </div>

      <div className="ticker-marquee">
        <div className="ticker-track">
          {doubledTickers.map((ticker, index) => (
            <article className="ticker-chip" key={`${ticker.symbol}-${index}`}>
              <strong>{ticker.symbol.replace("^", "")}</strong>
              <span>{price(ticker.lastClose)}</span>
              <span className={ticker.changePercent >= 0 ? "ticker-up" : "ticker-down"}>{pct(ticker.changePercent)}</span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
