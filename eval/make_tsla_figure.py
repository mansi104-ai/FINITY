"""
make_tsla_figure.py -- publication figure for TSLA under CORRECTED execution timing.

The existing eval/results/TSLA_equity.png was produced before the one-day
rebalance lookahead was fixed (docs/RESEARCH_PLAN.md, D1) and must not be used in
the paper. This regenerates it with execution_lag_days=1 and the paper's stated
Risk Manager configuration (medium profile, 10 bps cost, 10% position cap), so the
figure is consistent with a defensible backtest.

Output: eval/results/tsla_equity_corrected.pdf (vector, for LaTeX) + .png
"""

from __future__ import annotations

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

import backtest_lib as bt
import eval_recommendation as er

TICKER = "TSLA"


def main() -> None:
    saved = dict(er.PROFILE_MAX_EXPOSURE)
    er.PROFILE_MAX_EXPOSURE.update({"low": 0.06, "medium": 0.10, "high": 0.16})
    try:
        params = er.StrategyParams(rebalance_days=10, cost_bps=10.0, slippage_bps=0.0,
                                   execution_lag_days=1, risk_free_annual=0.0)
        rep = er.run_ticker(TICKER, "3y", ["medium"], params, 0.6, False)
        seg = rep["results"]["medium"]
        strat = np.concatenate([seg["tune"]["series"]["strategy"],
                                seg["holdout"]["series"]["strategy"]])
        bh = np.concatenate([seg["tune"]["series"]["buyhold"],
                             seg["holdout"]["series"]["buyhold"]])
        sma = np.concatenate([seg["tune"]["series"]["sma"],
                              seg["holdout"]["series"]["sma"]])
        n = min(strat.size, bh.size, sma.size)
        strat, bh, sma = strat[:n], bh[:n], sma[:n]
        cut = seg["tune"]["strategy"].n_days  # holdout begins here

        eq_s = np.concatenate([[1.0], np.cumprod(1.0 + strat)])
        eq_b = np.concatenate([[1.0], np.cumprod(1.0 + bh)])
        eq_m = np.concatenate([[1.0], np.cumprod(1.0 + sma)])
        days = np.arange(eq_s.size)

        def dd(eq):
            return (eq - np.maximum.accumulate(eq)) / np.maximum.accumulate(eq) * 100

        fig, (ax1, ax2) = plt.subplots(
            2, 1, figsize=(3.5, 3.4), sharex=True,
            gridspec_kw={"height_ratios": [2.0, 1.0], "hspace": 0.12})

        ax1.plot(days, eq_b, lw=1.1, color="#888888", label="Buy and Hold")
        ax1.plot(days, eq_m, lw=1.0, color="#4C9F70", ls="--", label="SMA(20/50)")
        ax1.plot(days, eq_s, lw=1.3, color="#1F4E9C", label="FINDEC (medium)")
        ax1.axvline(cut, color="#C0392B", lw=0.8, ls=":")
        ax1.text(cut + 6, ax1.get_ylim()[1] * 0.97, "holdout", fontsize=6,
                 color="#C0392B", va="top")
        ax1.set_ylabel("Growth of $1", fontsize=7)
        ax1.legend(fontsize=5.5, loc="upper left", frameon=False)
        ax1.tick_params(labelsize=6)
        ax1.grid(alpha=0.25, lw=0.4)

        ax2.fill_between(days, dd(eq_b), 0, color="#888888", alpha=0.35, lw=0)
        ax2.fill_between(days, dd(eq_s), 0, color="#1F4E9C", alpha=0.55, lw=0)
        ax2.axvline(cut, color="#C0392B", lw=0.8, ls=":")
        ax2.set_ylabel("Drawdown (%)", fontsize=7)
        ax2.set_xlabel("Trading day", fontsize=7)
        ax2.tick_params(labelsize=6)
        ax2.grid(alpha=0.25, lw=0.4)

        for ax in (ax1, ax2):
            for s in ax.spines.values():
                s.set_linewidth(0.6)

        fig.subplots_adjust(left=0.17, right=0.98, top=0.97, bottom=0.13)
        out = er.Path(__file__).resolve().parent / "results"
        out.mkdir(exist_ok=True)
        for ext in ("pdf", "png"):
            fig.savefig(out / f"tsla_equity_corrected.{ext}", dpi=400,
                        bbox_inches="tight")
        print(f"wrote {out / 'tsla_equity_corrected.pdf'}")

        print(f"\nTSLA, corrected (lag=1), medium profile, 10bps, 10% cap:")
        print(f"  FINDEC    ann={bt.annualized_return_pct(strat):+7.2f}%  "
              f"Sharpe={bt.sharpe_ratio(strat):+.2f}  MaxDD={bt.max_drawdown_pct(eq_s):+7.2f}%")
        print(f"  Buy&Hold  ann={bt.annualized_return_pct(bh):+7.2f}%  "
              f"Sharpe={bt.sharpe_ratio(bh):+.2f}  MaxDD={bt.max_drawdown_pct(eq_b):+7.2f}%")
        print(f"  SMA       ann={bt.annualized_return_pct(sma):+7.2f}%  "
              f"Sharpe={bt.sharpe_ratio(sma):+.2f}  MaxDD={bt.max_drawdown_pct(eq_m):+7.2f}%")
    finally:
        er.PROFILE_MAX_EXPOSURE.clear()
        er.PROFILE_MAX_EXPOSURE.update(saved)


if __name__ == "__main__":
    main()
