"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
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
    <section className="finity-strip-shell" aria-label="Market status and last close ticker tape">
      <div className="finity-strip-topline">
        <p className="finity-market-status">
          <span aria-hidden="true" className={`finity-market-dot finity-market-dot-${snapshot.market.phase}`} />
          {snapshot.market.label.toLowerCase()} · {snapshot.market.market} · {new Intl.DateTimeFormat("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric"
          }).format(new Date(snapshot.asOf))}
        </p>
      </div>

      <div className="finity-ticker-marquee">
        <div className="finity-ticker-track">
          {doubledTickers.map((ticker, index) => (
            <article 
              className="finity-ticker-chip" 
              key={`${ticker.symbol}-${index}`}
              onClick={() => router.push(`/brief?ticker=${ticker.symbol}`)}
              style={{ cursor: "pointer" }}
              title={`View ${ticker.name} brief`}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  router.push(`/brief?ticker=${ticker.symbol}`);
                }
              }}
            >
              <strong>{ticker.symbol.replace("^", "")}</strong>
              <span>{price(ticker.lastClose)}</span>
              <span className={ticker.changePercent >= 0 ? "finity-subline-up" : "finity-subline-down"}>{pct(ticker.changePercent)}</span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
