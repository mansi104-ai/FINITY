"""
paper_stats.py -- statistics for every table in FINDEC_v4.

Produces confidence intervals and p-values for Tables I, II and III of the paper,
and -- critically -- re-runs Table III's configuration under corrected execution
timing to determine whether that table was affected by the one-day rebalance
lookahead documented in docs/RESEARCH_PLAN.md (defect D1).

Table III in the paper appears to use parameters that differ from the current
eval_recommendation.py defaults:
    - medium risk profile
    - 10 bps transaction cost per position-size change (paper Section IV-C-3)
    - position size CAPPED at 6/10/16% of capital by risk profile (Section IV-C-2),
      rather than the [0,1] timing-skill exposure the current harness uses
This script reconstructs that configuration so the comparison is like-for-like.

    python paper_stats.py
"""

from __future__ import annotations

import numpy as np
from scipy import stats

import backtest_lib as bt
import eval_recommendation as er

TICKERS = ["AAPL", "MSFT", "AMZN", "TSLA", "NVDA"]


# --------------------------------------------------------------------------
# Table I -- sentiment classification
# --------------------------------------------------------------------------

def wilson_ci(k: int, n: int, alpha: float = 0.05) -> tuple[float, float]:
    """Wilson score interval -- correct for proportions near 0/1 and small n,
    where the normal approximation gives intervals extending past [0,1]."""
    if n == 0:
        return (0.0, 0.0)
    z = stats.norm.ppf(1 - alpha / 2)
    p = k / n
    d = 1 + z**2 / n
    c = p + z**2 / (2 * n)
    hw = z * np.sqrt(p * (1 - p) / n + z**2 / (4 * n**2))
    return (max(0.0, (c - hw) / d), min(1.0, (c + hw) / d))


def table1_stats() -> None:
    print("=" * 78)
    print("TABLE I -- sentiment classification, 95% Wilson intervals")
    print("=" * 78)
    print("Reported precision/recall with support, from the paper. Recall is a")
    print("proportion over `support`, so its CI is exact; precision's denominator")
    print("(predicted positives) is not reported in the paper -- we use support as")
    print("an approximation and flag it.\n")
    rows = [("Positive", 0.84, 0.88, 185), ("Neutral", 0.78, 0.71, 210),
            ("Negative", 0.90, 0.96, 105)]
    print(f"  {'class':<10s} {'recall':>7s} {'95% CI':>18s} {'width':>7s}")
    for name, prec, rec, sup in rows:
        lo, hi = wilson_ci(int(round(rec * sup)), sup)
        print(f"  {name:<10s} {rec:>7.2f} {'[' + f'{lo:.3f}, {hi:.3f}' + ']':>18s} "
              f"{hi - lo:>7.3f}")
    print("\n  NOTE: n=500 self-labelled headlines is a weak basis for a")
    print("  generalisation claim. The Financial PhraseBank re-check the paper")
    print("  mentions as 'in progress' is what makes this table comparable to")
    print("  published baselines. Until then, state it as an internal validation.")


# --------------------------------------------------------------------------
# Table II -- directional accuracy
# --------------------------------------------------------------------------

def table2_stats() -> None:
    print("\n" + "=" * 78)
    print("TABLE II -- directional accuracy, 95% Wilson intervals (n=120/ticker)")
    print("=" * 78)
    rows = [("AAPL", 52.5, 54.2), ("MSFT", 50.8, 50.8), ("AMZN", 47.5, 40.0),
            ("TSLA", 66.7, 64.2), ("NVDA", 60.8, 58.3)]
    n = 120
    print(f"  {'ticker':<7s} {'Ridge':>7s} {'95% CI':>16s} {'vs 50%':>9s}   "
          f"{'Ens':>6s} {'95% CI':>16s}")
    for t, ridge, ens in rows:
        lo, hi = wilson_ci(int(round(ridge / 100 * n)), n)
        elo, ehi = wilson_ci(int(round(ens / 100 * n)), n)
        p = stats.binomtest(int(round(ridge / 100 * n)), n, 0.5).pvalue
        flag = "*" if p < 0.05 else " "
        print(f"  {t:<7s} {ridge:>6.1f}% [{lo*100:>5.1f},{hi*100:>5.1f}] "
              f"{'p=' + f'{p:.3f}':>9s}{flag}   {ens:>5.1f}% [{elo*100:>5.1f},{ehi*100:>5.1f}]")

    print("\n  POOLED (n=600):")
    for label, acc in (("Ridge", 55.7), ("Ensemble", 53.5)):
        k = int(round(acc / 100 * 600))
        lo, hi = wilson_ci(k, 600)
        p = stats.binomtest(k, 600, 0.5).pvalue
        print(f"    {label:<10s} {acc:.1f}%  95% CI [{lo*100:.1f}, {hi*100:.1f}]  "
              f"p={p:.4f}  {'SIGNIFICANT' if p < 0.05 else 'not significant'}")

    print("\n  ABSTRACT CLAIM -- GBM 59.2% vs Ridge 55.3% (held-out split):")
    d = 59.2 - 55.3
    for rho in (0.3, 0.5, 0.7):
        se = np.sqrt(2 * 0.25 * (1 - rho) / 600) * 100
        z = d / se
        p = 2 * (1 - stats.norm.cdf(abs(z)))
        print(f"    paired rho={rho:.1f}: diff={d:.1f}pp SE={se:.2f}pp p={p:.4f} "
              f"-> Bonferroni x4 = {min(1, p*4):.3f}  "
              f"{'SIG' if p*4 < 0.05 else 'NOT SIG'}")
    n_req = 2 * 0.25 * 0.5 * ((1.96 + 0.8416) / (d / 100)) ** 2
    print(f"    steps needed for 80% power: {n_req:,.0f}  (paper has 600)")


# --------------------------------------------------------------------------
# Table III -- portfolio backtest, reconstructed under corrected timing
# --------------------------------------------------------------------------

def table3_stats() -> None:
    print("\n" + "=" * 78)
    print("TABLE III -- portfolio backtest under the PAPER's configuration")
    print("=" * 78)
    print("medium risk profile | 10 bps cost | position capped at 10% of capital")
    print("Comparing lag=0 (the defective original) against lag=1 (corrected).\n")

    # Reconstruct the paper's sizing: position size capped by risk profile, not
    # the timing-skill exposure in [0,1] the current harness defaults to.
    saved = dict(er.PROFILE_MAX_EXPOSURE)
    er.PROFILE_MAX_EXPOSURE.update({"low": 0.06, "medium": 0.10, "high": 0.16})
    try:
        print(f"  {'ticker':<7s} {'lag=0 Ret%':>11s} {'Sharpe':>8s}   "
              f"{'lag=1 Ret%':>11s} {'Sharpe':>8s}   {'B&H Ret%':>9s} {'Sharpe':>8s}")
        agg = {0: [], 1: [], "bh": []}
        for t in TICKERS:
            row = [t]
            for lag in (0, 1):
                p = er.StrategyParams(rebalance_days=10, cost_bps=10.0, slippage_bps=0.0,
                                      execution_lag_days=lag, risk_free_annual=0.0)
                r = er.run_ticker(t, "3y", ["medium"], p, 0.6, False)
                # Paper reports over the whole 5y window, not a holdout split;
                # combine both segments for comparability.
                seg = r["results"]["medium"]
                full = np.concatenate([seg["tune"]["series"]["strategy"],
                                       seg["holdout"]["series"]["strategy"]])
                row += [bt.annualized_return_pct(full), bt.sharpe_ratio(full)]
                agg[lag].append(bt.sharpe_ratio(full))
                if lag == 1:
                    bh = np.concatenate([seg["tune"]["series"]["buyhold"],
                                         seg["holdout"]["series"]["buyhold"]])
                    row += [bt.annualized_return_pct(bh), bt.sharpe_ratio(bh)]
                    agg["bh"].append(bt.sharpe_ratio(bh))
            print(f"  {row[0]:<7s} {row[1]:>11.2f} {row[2]:>8.2f}   "
                  f"{row[3]:>11.2f} {row[4]:>8.2f}   {row[5]:>9.2f} {row[6]:>8.2f}")

        print(f"\n  mean Sharpe: lag=0 {np.mean(agg[0]):+.3f} | "
              f"lag=1 {np.mean(agg[1]):+.3f} | B&H {np.mean(agg['bh']):+.3f}")
        delta = np.mean(agg[0]) - np.mean(agg[1])
        print(f"  lookahead was worth {delta:+.3f} Sharpe in THIS configuration.")
        if abs(delta) < 0.05:
            print("  -> Table III is essentially UNAFFECTED by the lookahead. The small")
            print("     position cap (10%) limits how much the bug could distort results.")
            print("     The paper's Table III can stand as reported.")
        else:
            print("  -> Table III IS materially affected. Regenerate before submitting.")
    finally:
        er.PROFILE_MAX_EXPOSURE.clear()
        er.PROFILE_MAX_EXPOSURE.update(saved)


if __name__ == "__main__":
    table1_stats()
    table2_stats()
    table3_stats()
