"""Ten-year backtest of the corrected FINDEC strategy, with equity curves.

Reuses `eval_recommendation.run_strategy` rather than reimplementing the
walk-forward loop. That is deliberate: the one-day rebalance lookahead that
inflated mean Sharpe from 0.192 to 0.724 lived in exactly this loop, and a
fresh implementation is how such a defect gets reintroduced. The engine here
is the corrected one, with `execution_lag_days=1` and risk-free accrual on
unallocated capital, and it is covered by `eval/test_no_lookahead.py`.

Data comes from Yahoo's v8 chart endpoint with explicit period bounds.
`range=10y` silently returns ~500 bars; `period1`/`period2` returns the full
2,513.

**On what this can and cannot show.** The plotted curve is whatever the
strategy did. It is not steered toward any outcome, and every prior result in
this project -- a pooled Sharpe difference of -0.162 against buy-and-hold
(p = 0.599), 0/5 tickers with a confidence interval excluding zero, and an
ablation in which the ML component is the worst cell at -0.191 -- predicts it
will lose to buy-and-hold. A ten-year window also carries a survivorship
problem: these five names were selected in 2026 and all survived, which
flatters both the strategy and its benchmark.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

import eval_recommendation as er  # noqa: E402

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122 Safari/537.36"}
CACHE = _HERE / "data" / "_10y"
TICKERS = ["AAPL", "MSFT", "AMZN", "TSLA", "NVDA"]
BENCH = "SPY"


def fetch(sym: str, years: float = 10.0) -> pd.DataFrame | None:
    """Daily bars via explicit period bounds, cached to disk."""
    CACHE.mkdir(parents=True, exist_ok=True)
    cp = CACHE / f"{sym}_{int(years)}y.csv"
    if cp.exists():
        return pd.read_csv(cp)

    end = int(time.time())
    start = end - int(365.25 * years * 86400)
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
           f"?period1={start}&period2={end}&interval=1d")
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
            payload = json.load(r)
        res = payload["chart"]["result"][0]
        ts = res["timestamp"]
        q = res["indicators"]["quote"][0]
        rows = []
        for i, t in enumerate(ts):
            c = q["close"][i]
            if c is None:
                continue        # holiday/halt padding -- drop, never forward-fill
            rows.append({
                "Date": datetime.fromtimestamp(t, timezone.utc).date().isoformat(),
                "Close": float(c),
                "Volume": float(q["volume"][i] or 0),
            })
        df = pd.DataFrame(rows)
        df.to_csv(cp, index=False)
        time.sleep(0.4)
        return df
    except Exception as e:
        print(f"  ! {sym}: {type(e).__name__}: {e}")
        return None


def equity(daily_returns: np.ndarray) -> np.ndarray:
    return np.cumprod(1.0 + np.asarray(daily_returns, dtype=float))


def stats(rets: np.ndarray, rf: float) -> dict:
    r = np.asarray(rets, dtype=float)
    if r.size == 0:
        return {"sharpe": 0.0, "ann_ret": 0.0, "max_dd": 0.0, "total": 0.0}
    eq = equity(r)
    peak = np.maximum.accumulate(eq)
    years = r.size / 252.0
    excess = r - rf / 252.0
    sd = excess.std()
    return {
        "sharpe": float(np.sqrt(252) * excess.mean() / sd) if sd > 1e-12 else 0.0,
        "ann_ret": float((eq[-1] ** (1 / years) - 1) * 100) if years > 0 else 0.0,
        "max_dd": float(((eq - peak) / peak).min() * 100),
        "total": float((eq[-1] - 1) * 100),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=float, default=10.0)
    ap.add_argument("--profile", default="high")
    ap.add_argument("--rf", type=float, default=0.04)
    ap.add_argument("--out", default=str(_HERE / "results"))
    a = ap.parse_args()

    print(f"FINDEC {a.years:.0f}-year backtest | profile={a.profile} | rf={a.rf:.0%} | lag=1")
    print("Engine: eval_recommendation.run_strategy (corrected). Not steered.\n")

    params = er.StrategyParams(execution_lag_days=1, risk_free_annual=a.rf)
    from models.market_forecaster import MarketForecaster
    forecaster = MarketForecaster()

    curves, rows = {}, []
    for sym in TICKERS:
        df = fetch(sym, a.years)
        if df is None or len(df) < 400:
            print(f"  {sym}: insufficient data, skipped")
            continue
        closes = df["Close"].astype(float).to_numpy()
        print(f"  {sym}: {len(df)} bars {df.Date.iloc[0]} -> {df.Date.iloc[-1]} ... ", end="", flush=True)

        # Match run_ticker's call pattern exactly. min_start is the real
        # training window before the first decision; rebalance_idxs are the
        # only dates the forecaster is invoked on, and every slice it sees is
        # truncated to that index, which is what keeps the walk-forward
        # point-in-time.
        n_bars = len(closes)
        min_start = min(260, max(120, n_bars // 3))
        rebalance_idxs = list(range(min_start, n_bars, params.rebalance_days))
        preds = er.precompute_predictions(
            df, sym, forecaster, rebalance_idxs,
            cache_key=f"{sym}_10y_r{params.rebalance_days}_s{min_start}")

        agents = {
            "risk_manager": er.RiskManagerAgent(),
            "risk_reasoner": er.RiskReasoningAgent(),
            "verifier": er.VerificationAgent(),
            "crew": er.FinanceCrew(),
        }
        rec = er.run_strategy(df, sym, preds, a.profile, params, min_start, agents, False)
        series = rec.get("series") or {}
        sr = np.asarray(series.get("strategy_returns") or [], dtype=float)
        br = np.asarray(series.get("benchmark_returns") or [], dtype=float)
        if sr.size == 0:
            print("no series returned"); continue

        s, b = stats(sr, a.rf), stats(br, a.rf)
        curves[sym] = (sr, br, df.Date.to_numpy())
        rows.append({"ticker": sym, "n": int(sr.size),
                     "s_sharpe": s["sharpe"], "b_sharpe": b["sharpe"],
                     "s_ann": s["ann_ret"], "b_ann": b["ann_ret"],
                     "s_dd": s["max_dd"], "b_dd": b["max_dd"],
                     "s_tot": s["total"], "b_tot": b["total"]})
        print(f"Sharpe {s['sharpe']:+.3f} vs B&H {b['sharpe']:+.3f}")

    if not rows:
        print("\nNo tickers produced a series.")
        return 1

    print(f"\n{'ticker':<8}{'n':>6}{'strat Sh':>10}{'B&H Sh':>9}{'strat %':>10}"
          f"{'B&H %':>9}{'strat DD':>10}{'B&H DD':>9}  beats?")
    print("-" * 82)
    wins = 0
    for r in rows:
        w = r["s_sharpe"] > r["b_sharpe"]
        wins += w
        print(f"{r['ticker']:<8}{r['n']:>6}{r['s_sharpe']:>10.3f}{r['b_sharpe']:>9.3f}"
              f"{r['s_ann']:>10.2f}{r['b_ann']:>9.2f}{r['s_dd']:>10.1f}{r['b_dd']:>9.1f}"
              f"  {'YES' if w else 'no'}")

    ms = float(np.mean([r["s_sharpe"] for r in rows]))
    mb = float(np.mean([r["b_sharpe"] for r in rows]))
    print("-" * 82)
    print(f"{'MEAN':<8}{'':>6}{ms:>10.3f}{mb:>9.3f}")
    print(f"\nBeats buy-and-hold on Sharpe: {wins}/{len(rows)} tickers")

    # Pooled significance, same machinery as the paper tables.
    try:
        import significance as sig
        alls = np.concatenate([c[0] for c in curves.values()])
        allb = np.concatenate([c[1] for c in curves.values()])
        n = min(alls.size, allb.size)
        res = sig.bootstrap_sharpe_difference(alls[:n], allb[:n], risk_free_annual=a.rf)
        print(f"Pooled Sharpe diff {res.difference:+.3f}  "
              f"95% CI [{res.ci_low:+.3f}, {res.ci_high:+.3f}]  p={res.p_value:.3f}")
        print(f"  -> {'SIGNIFICANT' if res.ci_low > 0 else 'not significant'}")
    except Exception as e:
        print(f"(pooled significance unavailable: {type(e).__name__}: {e})")

    _plot(curves, rows, Path(a.out), a.years)
    return 0


def _plot(curves, rows, outdir: Path, years: float) -> None:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception as e:
        print(f"(plot skipped: {e})")
        return

    outdir.mkdir(parents=True, exist_ok=True)
    n = len(curves)
    fig, axes = plt.subplots(1, n, figsize=(3.6 * n, 3.4), sharey=False)
    if n == 1:
        axes = [axes]

    for ax, (sym, (sr, br, dates)) in zip(axes, curves.items()):
        es, eb = equity(sr), equity(br)
        ax.plot(es, label="FINDEC", linewidth=1.5)
        ax.plot(eb, label="Buy & hold", linewidth=1.5, alpha=0.75)
        ax.axhline(1.0, color="0.7", linewidth=0.7)
        ax.set_title(sym, fontsize=10)
        ax.set_xlabel("trading days")
        ax.grid(alpha=0.25)
    axes[0].set_ylabel("growth of 1 unit")
    axes[0].legend(fontsize=8, loc="upper left")

    wins = sum(1 for r in rows if r["s_sharpe"] > r["b_sharpe"])
    fig.suptitle(
        f"FINDEC vs buy-and-hold, {years:.0f} years, execution lag 1 day "
        f"(beats B&H on Sharpe: {wins}/{len(rows)})", fontsize=10)
    fig.tight_layout()
    for ext in ("png", "pdf"):
        p = outdir / f"backtest_{int(years)}y.{ext}"
        fig.savefig(p, dpi=160, bbox_inches="tight")
    print(f"\nWrote {outdir / f'backtest_{int(years)}y.png'}")


if __name__ == "__main__":
    sys.exit(main())
