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
    <section className="findec-strip-shell" aria-label="Market status and last close ticker tape">
      <div className="findec-strip-topline">
        <p className="findec-market-status">
          <span aria-hidden="true" className={`findec-market-dot findec-market-dot-${snapshot.market.phase}`} />
          {snapshot.market.label.toLowerCase()} · {snapshot.market.market} · {new Intl.DateTimeFormat("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric"
          }).format(new Date(snapshot.asOf))}
        </p>
      </div>

      <div className="findec-ticker-marquee">
        <div className="findec-ticker-track">
          {doubledTickers.map((ticker, index) => (
            <article 
              className="findec-ticker-chip" 
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
              <span className={ticker.changePercent >= 0 ? "findec-subline-up" : "findec-subline-down"}>{pct(ticker.changePercent)}</span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
