import type { Request, Response } from "express";
import { getWatchlist } from "../store/db";
import { fetchQuoteForSymbol, sectorForSymbol, loadDetailedStocks } from "./market.controller";

// ─── Portfolio analysis ─────────────────────────────────────────────────────
// Treats the user's watchlist (those with a buyPrice) as a portfolio of one
// share each — a lightweight, no-extra-data P&L + diversification view.

type Holding = {
  ticker: string; name: string; buyPrice: number; price: number;
  changePercent: number; pnl: number; pnlPercent: number; sector: string;
};

function pct(n: number): number { return +n.toFixed(2); }

export async function getPortfolioInsightsController(req: Request, res: Response) {
  const userId = req.authUser!.id;
  const record = await getWatchlist(userId);
  const tracked = (record?.items ?? []).filter((i) => i.buyPrice != null && i.buyPrice > 0);

  if (tracked.length === 0) {
    return res.status(200).json({
      hasPositions: false,
      message: "Add buy prices to your watchlist items to see portfolio analysis.",
    });
  }

  const quotes = await Promise.all(tracked.map((i) => fetchQuoteForSymbol(i.ticker)));
  const holdings: Holding[] = [];
  tracked.forEach((item, idx) => {
    const q = quotes[idx];
    if (!q || q.price <= 0) return;
    const buyPrice = item.buyPrice as number;
    const pnl = q.price - buyPrice;
    holdings.push({
      ticker: item.ticker,
      name: item.name || q.name,
      buyPrice,
      price: q.price,
      changePercent: pct(q.changePercent),
      pnl: pct(pnl),
      pnlPercent: pct((pnl / buyPrice) * 100),
      sector: sectorForSymbol(item.ticker),
    });
  });

  if (holdings.length === 0) {
    return res.status(502).json({ hasPositions: true, error: "Live prices are unavailable right now." });
  }

  const totalCost = holdings.reduce((s, h) => s + h.buyPrice, 0);
  const totalValue = holdings.reduce((s, h) => s + h.price, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPercent = pct((totalPnl / totalCost) * 100);

  // Diversification by sector (share of value)
  const bySector = new Map<string, number>();
  for (const h of holdings) bySector.set(h.sector, (bySector.get(h.sector) ?? 0) + h.price);
  const allocation = Array.from(bySector.entries())
    .map(([sector, value]) => ({ sector, weightPercent: pct((value / totalValue) * 100) }))
    .sort((a, b) => b.weightPercent - a.weightPercent);

  const topWeight = allocation[0]?.weightPercent ?? 0;
  const concentration =
    topWeight >= 60 ? "high" : topWeight >= 35 ? "moderate" : "low";
  const winners = holdings.filter((h) => h.pnl >= 0).length;

  const sorted = [...holdings].sort((a, b) => b.pnlPercent - a.pnlPercent);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  // Deterministic narrative (no external AI dependency)
  const narrative: string[] = [];
  narrative.push(
    `Your ${holdings.length}-position portfolio is ${totalPnl >= 0 ? "up" : "down"} ${Math.abs(totalPnlPercent)}% versus cost basis (${totalPnl >= 0 ? "+" : ""}${pct(totalPnl)} per share aggregate).`
  );
  narrative.push(
    `${winners} of ${holdings.length} positions are in profit. ${best.ticker} leads at ${best.pnlPercent >= 0 ? "+" : ""}${best.pnlPercent}%, while ${worst.ticker} lags at ${worst.pnlPercent >= 0 ? "+" : ""}${worst.pnlPercent}%.`
  );
  narrative.push(
    concentration === "high"
      ? `Concentration risk is high — ${allocation[0].weightPercent}% sits in ${allocation[0].sector}. Consider diversifying across sectors.`
      : concentration === "moderate"
        ? `Sector concentration is moderate, led by ${allocation[0].sector} at ${allocation[0].weightPercent}%.`
        : `The book is well diversified across ${allocation.length} sectors — no single sector dominates.`
  );

  return res.status(200).json({
    hasPositions: true,
    totals: {
      positions: holdings.length,
      totalCost: pct(totalCost),
      totalValue: pct(totalValue),
      totalPnl: pct(totalPnl),
      totalPnlPercent,
      winners,
    },
    holdings: sorted,
    allocation,
    concentration,
    narrative,
  });
}

// ─── Market regime ───────────────────────────────────────────────────────────
// Classifies risk-on / risk-off / neutral from breadth across a large-cap basket.

const REGIME_BASKET = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "V", "WMT",
  "XOM", "UNH", "HD", "PG", "MA", "BAC", "KO", "AVGO", "COST", "CRM",
];

export async function getMarketRegimeController(_req: Request, res: Response) {
  // Reuse the cached US stock list (cache-first, shared with /stocks + /research)
  // so regime never fires its own 20 Finnhub calls and stays within the free tier.
  let quotes = (await loadDetailedStocks("US"))
    .filter((q) => !q.isIndex && q.price > 0 && Number.isFinite(q.changePercent));

  // Fallback: only if the shared list is empty, fetch the small basket directly.
  if (quotes.length < 5) {
    quotes = (await Promise.all(REGIME_BASKET.map((s) => fetchQuoteForSymbol(s))))
      .filter((q): q is NonNullable<typeof q> => q != null && q.price > 0);
  }

  if (quotes.length < 5) {
    return res.status(502).json({ error: "Market regime data is unavailable right now." });
  }

  const advancing = quotes.filter((q) => q.changePercent > 0).length;
  const breadthPercent = pct((advancing / quotes.length) * 100);
  const avgMove = pct(quotes.reduce((s, q) => s + q.changePercent, 0) / quotes.length);

  // Composite score: breadth (centered at 50) + average move scaled.
  const score = (breadthPercent - 50) / 50 + avgMove / 2;
  let regime: "risk-on" | "risk-off" | "neutral";
  let label: string;
  if (score > 0.25) { regime = "risk-on"; label = "Risk-on — broad participation, buyers in control"; }
  else if (score < -0.25) { regime = "risk-off"; label = "Risk-off — broad selling, defensive posture warranted"; }
  else { regime = "neutral"; label = "Neutral — mixed breadth, no clear directional bias"; }

  const leaders = [...quotes].sort((a, b) => b.changePercent - a.changePercent).slice(0, 3)
    .map((q) => ({ symbol: q.symbol, changePercent: pct(q.changePercent) }));
  const laggards = [...quotes].sort((a, b) => a.changePercent - b.changePercent).slice(0, 3)
    .map((q) => ({ symbol: q.symbol, changePercent: pct(q.changePercent) }));

  return res.status(200).json({
    regime, label,
    breadthPercent, advancing, total: quotes.length,
    avgMovePercent: avgMove,
    score: pct(score),
    leaders, laggards,
    asOf: new Date().toISOString(),
  });
}
