"""
significance.py -- inferential statistics for FINDEC's backtest claims.

Every performance claim in this repo used to be a point estimate with no error
bar, on n=5 correlated tickers, selected as the max over a 24-point parameter
grid (docs/RESEARCH_PLAN.md, defects D6 and D7). This module supplies the three
tests a quantitative-finance reviewer will demand before believing any of it.

WHY EACH TEST
-------------
1. STATIONARY BOOTSTRAP (Politis & Romano 1994) -- confidence intervals on the
   Sharpe *difference* between strategy and benchmark. A plain i.i.d. bootstrap
   is invalid on daily returns: volatility clusters, so resampling single days
   destroys the dependence structure and produces intervals that are far too
   narrow. The stationary bootstrap resamples geometrically-distributed BLOCKS,
   preserving short-range dependence, and (unlike a fixed block bootstrap) keeps
   the resampled series stationary.

2. DIEBOLD-MARIANO (1995) -- is the forecaster's directional accuracy really
   above a coin flip / above a rival model? Comparing two accuracy percentages
   directly ignores that the two models' errors are correlated on the same days.
   DM tests the mean of the LOSS DIFFERENTIAL with a HAC (Newey-West) variance,
   which is what the serial correlation in overlapping h-day-ahead forecasts
   requires. We use the Harvey-Leybourne-Newbold small-sample correction.

3. HANSEN'S SPA (2005) -- the honest p-value for "the best configuration beats
   the benchmark" AFTER searching a grid. Reporting the max over 24 configs and
   testing it as if it were the only one tried is the classic data-snooping
   error; the max of 24 noisy statistics is large even when every config is
   worthless. SPA tests the composite null "no configuration is better than the
   benchmark", using a studentized statistic and a recentring that stops poor
   configurations from inflating the critical value (its improvement over
   White's Reality Check).

All tests take per-day series and are agnostic to what produced them, so they
apply equally to the strategy overlay, the ablation cells, and the forecaster.

    python significance.py                 # run against the bundled tickers
    pytest test_significance.py            # known-answer tests
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

TRADING_DAYS = 252
DEFAULT_B = 10_000        # bootstrap resamples
DEFAULT_BLOCK = 10.0      # mean block length in days (~2 trading weeks)


# --------------------------------------------------------------------------
# 1. Stationary bootstrap
# --------------------------------------------------------------------------

def stationary_bootstrap_indices(n: int, block_mean: float, rng: np.random.Generator) -> np.ndarray:
    """One stationary-bootstrap index sample of length n (Politis-Romano 1994).

    Each step either continues the current block (prob 1 - p) or jumps to a new
    uniformly-random start (prob p), with p = 1/block_mean. Block lengths are
    therefore Geometric(p) with mean `block_mean`, and indices wrap modulo n so
    the resampled series is stationary.
    """
    if n <= 0:
        return np.empty(0, dtype=int)
    p = 1.0 / max(block_mean, 1.0)
    idx = np.empty(n, dtype=int)
    idx[0] = rng.integers(0, n)
    jump = rng.random(n) < p
    steps = rng.integers(0, n, size=n)
    for t in range(1, n):
        idx[t] = steps[t] if jump[t] else (idx[t - 1] + 1) % n
    return idx


def _sharpe(x: np.ndarray, rf_annual: float = 0.0) -> float:
    if x.size == 0:
        return 0.0
    ex = x - rf_annual / TRADING_DAYS
    s = ex.std()
    if s < 1e-12:
        return 0.0
    return float(np.sqrt(TRADING_DAYS) * ex.mean() / s)


@dataclass
class BootstrapResult:
    """Point estimate, CI and p-value for a difference between two return series."""
    statistic: str
    observed_a: float
    observed_b: float
    difference: float
    ci_low: float
    ci_high: float
    p_value: float          # two-sided, H0: difference == 0
    n_days: int
    n_boot: int
    block_mean: float

    @property
    def significant(self) -> bool:
        return self.ci_low > 0.0 or self.ci_high < 0.0

    def one_line(self) -> str:
        star = "*" if self.significant else " "
        return (f"{self.statistic:>8s}  A={self.observed_a:6.3f}  B={self.observed_b:6.3f}  "
                f"diff={self.difference:+6.3f}  95% CI [{self.ci_low:+6.3f}, {self.ci_high:+6.3f}]  "
                f"p={self.p_value:.3f} {star}")


def bootstrap_metric_diff(
    returns_a: np.ndarray,
    returns_b: np.ndarray,
    metric: str = "sharpe",
    rf_annual: float = 0.0,
    n_boot: int = DEFAULT_B,
    block_mean: float = DEFAULT_BLOCK,
    seed: int = 12345,
    alpha: float = 0.05,
) -> BootstrapResult:
    """Stationary-bootstrap CI and p-value for metric(A) - metric(B).

    A and B must be aligned day-by-day (same length, same trading days) and are
    resampled with the SAME index draw each replication, which preserves their
    contemporaneous correlation -- essential, since a strategy and its benchmark
    are driven by the same underlying price series.
    """
    a = np.asarray(returns_a, dtype=float)
    b = np.asarray(returns_b, dtype=float)
    if a.size != b.size:
        raise ValueError(f"series must be aligned; got {a.size} vs {b.size}")
    n = a.size
    rng = np.random.default_rng(seed)

    fn = {"sharpe": lambda x: _sharpe(x, rf_annual),
          "mean": lambda x: float(x.mean()) * TRADING_DAYS}[metric]

    obs_a, obs_b = fn(a), fn(b)
    obs_diff = obs_a - obs_b

    diffs = np.empty(n_boot)
    for i in range(n_boot):
        idx = stationary_bootstrap_indices(n, block_mean, rng)
        diffs[i] = fn(a[idx]) - fn(b[idx])

    lo, hi = np.percentile(diffs, [100 * alpha / 2, 100 * (1 - alpha / 2)])
    # Two-sided p: proportion of the null distribution (bootstrap distribution
    # recentred at zero) at least as extreme as the observed difference.
    centred = diffs - diffs.mean()
    p = float(np.mean(np.abs(centred) >= abs(obs_diff)))

    return BootstrapResult("sharpe" if metric == "sharpe" else "annret",
                           obs_a, obs_b, obs_diff, float(lo), float(hi), p,
                           n, n_boot, block_mean)


# --------------------------------------------------------------------------
# 2. Diebold-Mariano
# --------------------------------------------------------------------------

@dataclass
class DMResult:
    mean_loss_a: float
    mean_loss_b: float
    dm_stat: float
    p_value: float
    n: int
    horizon: int

    def one_line(self) -> str:
        star = "*" if self.p_value < 0.05 else " "
        return (f"  lossA={self.mean_loss_a:.4f} lossB={self.mean_loss_b:.4f}  "
                f"DM={self.dm_stat:+.3f}  p={self.p_value:.4f} {star}  (n={self.n})")


def _newey_west_var(d: np.ndarray, lag: int) -> float:
    """HAC long-run variance of the loss differential."""
    n = d.size
    dm = d - d.mean()
    gamma0 = float(dm @ dm) / n
    total = gamma0
    for k in range(1, lag + 1):
        gk = float(dm[k:] @ dm[:-k]) / n
        total += 2.0 * (1.0 - k / (lag + 1.0)) * gk   # Bartlett kernel
    return max(total, 1e-18)


def diebold_mariano(loss_a: np.ndarray, loss_b: np.ndarray, horizon: int = 1) -> DMResult:
    """DM test on two aligned per-observation loss series. H0: equal expected loss.

    Negative DM => model A has lower loss (A is better). Uses Bartlett-kernel HAC
    with lag = horizon - 1 (the MA order induced by overlapping h-step forecasts)
    and the Harvey-Leybourne-Newbold (1997) small-sample correction, then refers
    to a t distribution with n-1 df rather than the normal.
    """
    from scipy import stats  # local import: only significance testing needs scipy

    a = np.asarray(loss_a, dtype=float)
    b = np.asarray(loss_b, dtype=float)
    if a.size != b.size:
        raise ValueError(f"loss series must be aligned; got {a.size} vs {b.size}")
    n = a.size
    d = a - b
    if n < 3:
        return DMResult(float(a.mean()), float(b.mean()), 0.0, 1.0, n, horizon)

    lag = max(0, horizon - 1)
    var_d = _newey_west_var(d, lag)
    dm = d.mean() / np.sqrt(var_d / n)

    # Harvey-Leybourne-Newbold small-sample correction
    h = horizon
    corr = (n + 1 - 2 * h + h * (h - 1) / n) / n
    dm_corrected = dm * np.sqrt(max(corr, 1e-12))
    p = float(2 * (1 - stats.t.cdf(abs(dm_corrected), df=n - 1)))

    return DMResult(float(a.mean()), float(b.mean()), float(dm_corrected), p, n, horizon)


def directional_accuracy_dm(pred_signs: np.ndarray, actual_signs: np.ndarray,
                            horizon: int = 1) -> DMResult:
    """DM test of a directional forecaster against an always-up baseline.

    Loss = 0/1 misclassification. The always-up benchmark matters because equity
    series drift upward: a model at 56% accuracy in a window where 55% of days
    are up has essentially no skill, and only a paired test against that
    benchmark reveals it.
    """
    pred = np.sign(np.asarray(pred_signs, dtype=float))
    act = np.sign(np.asarray(actual_signs, dtype=float))
    loss_model = (pred != act).astype(float)
    loss_always_up = (np.ones_like(act) != act).astype(float)
    return diebold_mariano(loss_model, loss_always_up, horizon=horizon)


# --------------------------------------------------------------------------
# 3. Hansen's SPA
# --------------------------------------------------------------------------

@dataclass
class SPAResult:
    best_model: int
    best_mean_outperformance: float
    spa_p_value: float          # Hansen (2005), consistent p-value
    reality_check_p_value: float  # White (2000), for comparison
    naive_p_value: float        # ignoring the search -- shows the snooping bias
    n_models: int
    n_days: int

    def summary(self) -> str:
        return (
            f"  models searched      : {self.n_models}\n"
            f"  best model index     : {self.best_model}\n"
            f"  best mean outperf.   : {self.best_mean_outperformance:+.6f}/day\n"
            f"  naive p (WRONG)      : {self.naive_p_value:.4f}   <- ignores the search\n"
            f"  White Reality Check p: {self.reality_check_p_value:.4f}\n"
            f"  Hansen SPA p         : {self.spa_p_value:.4f}   <- report this one\n"
        )


def hansen_spa(
    outperformance: np.ndarray,
    n_boot: int = DEFAULT_B,
    block_mean: float = DEFAULT_BLOCK,
    seed: int = 999,
) -> SPAResult:
    """Hansen's Superior Predictive Ability test.

    `outperformance` is (n_days, n_models): column k is the per-day performance
    of configuration k MINUS the benchmark's (so positive = beat the benchmark).
    H0: max_k E[d_k] <= 0, i.e. no configuration in the searched set genuinely
    beats the benchmark.

    Returns the SPA p-value alongside White's Reality Check and the naive
    single-model p-value, so the size of the data-snooping correction is visible.
    """
    d = np.asarray(outperformance, dtype=float)
    if d.ndim != 2:
        raise ValueError("outperformance must be 2-D (n_days, n_models)")
    n, m = d.shape
    rng = np.random.default_rng(seed)

    d_bar = d.mean(axis=0)
    # HAC standard error per model, matched to the bootstrap's dependence length.
    lag = max(1, int(round(block_mean)) - 1)
    omega = np.array([_newey_west_var(d[:, k], lag) for k in range(m)])
    se = np.sqrt(omega / n)
    se = np.maximum(se, 1e-18)

    studentized = np.sqrt(n) * d_bar / np.sqrt(omega)
    t_spa = max(0.0, float(np.max(studentized)))
    t_rc = max(0.0, float(np.sqrt(n) * np.max(d_bar)))
    best = int(np.argmax(d_bar))

    # Hansen's recentring: models too far below zero to be plausible contributors
    # to the null are recentred at 0 rather than at their own (very negative)
    # mean. This is what makes SPA more powerful than the Reality Check, which
    # lets a single hopeless model inflate the critical value.
    threshold = -np.sqrt(omega / n) * np.sqrt(2.0 * np.log(np.log(max(n, 3))))
    g = np.where(d_bar >= threshold, d_bar, 0.0)

    boot_spa = np.empty(n_boot)
    boot_rc = np.empty(n_boot)
    for i in range(n_boot):
        idx = stationary_bootstrap_indices(n, block_mean, rng)
        db = d[idx].mean(axis=0)
        boot_spa[i] = max(0.0, float(np.max(np.sqrt(n) * (db - g) / np.sqrt(omega))))
        boot_rc[i] = max(0.0, float(np.sqrt(n) * np.max(db - d_bar)))

    p_spa = float(np.mean(boot_spa >= t_spa))
    p_rc = float(np.mean(boot_rc >= t_rc))

    # Naive: test only the winning column, pretending it was the sole candidate.
    boot_naive = np.empty(n_boot)
    rng2 = np.random.default_rng(seed + 1)
    col = d[:, best]
    for i in range(n_boot):
        idx = stationary_bootstrap_indices(n, block_mean, rng2)
        boot_naive[i] = col[idx].mean() - col.mean()
    p_naive = float(np.mean(boot_naive >= col.mean()))

    return SPAResult(best, float(d_bar[best]), p_spa, p_rc, p_naive, m, n)


# --------------------------------------------------------------------------
# Reporting helper
# --------------------------------------------------------------------------

def report_strategy_vs_benchmarks(
    strat: np.ndarray, buyhold: np.ndarray, sma: np.ndarray,
    label: str = "", rf_annual: float = 0.0, n_boot: int = DEFAULT_B,
) -> dict[str, BootstrapResult]:
    """Bootstrap Sharpe-difference CIs vs each benchmark, printed."""
    out = {}
    if label:
        print(f"\n--- {label} ---")
    for name, bench in (("vs Buy&Hold", buyhold), ("vs SMA(20/50)", sma)):
        res = bootstrap_metric_diff(strat, bench, "sharpe", rf_annual, n_boot=n_boot)
        out[name] = res
        print(f"  {name:14s} {res.one_line()}")
    return out


if __name__ == "__main__":
    import argparse

    import backtest_lib as bt
    import eval_recommendation as er

    ap = argparse.ArgumentParser(description="Significance tests for FINDEC backtest claims.")
    ap.add_argument("--tickers", nargs="+", default=["AAPL", "MSFT", "AMZN", "TSLA", "NVDA"])
    ap.add_argument("--period", default="3y")
    ap.add_argument("--profile", default="high")
    ap.add_argument("--tune-frac", type=float, default=0.6)
    ap.add_argument("--risk-free", type=float, default=0.04)
    ap.add_argument("--n-boot", type=int, default=2000)
    args = ap.parse_args()

    params = er.StrategyParams(risk_free_annual=args.risk_free)
    print("=" * 78)
    print("FINDEC significance tests -- holdout segment, execution_lag_days="
          f"{params.execution_lag_days}, rf={args.risk_free:.1%}")
    print("=" * 78)

    n_sig_bh = n_sig_sma = 0
    pooled = {"strategy": [], "buyhold": [], "sma": []}

    for t in args.tickers:
        rep = er.run_ticker(t, args.period, [args.profile], params, args.tune_frac, False)
        seg = rep["results"][args.profile]["holdout"]
        s = seg["series"]
        n = min(len(s["strategy"]), len(s["buyhold"]), len(s["sma"]))
        strat, bh, sma = s["strategy"][:n], s["buyhold"][:n], s["sma"][:n]
        for k, v in (("strategy", strat), ("buyhold", bh), ("sma", sma)):
            pooled[k].append(v)

        res = report_strategy_vs_benchmarks(
            strat, bh, sma, label=f"{t} (holdout, n={n}d)",
            rf_annual=args.risk_free, n_boot=args.n_boot)
        if res["vs Buy&Hold"].significant:
            n_sig_bh += 1
        if res["vs SMA(20/50)"].significant:
            n_sig_sma += 1

    # Pooled across tickers: concatenating per-ticker holdout series treats them
    # as one longer sample. These names are highly correlated, so this OVERSTATES
    # the effective sample size -- reported as an upper bound on power, not as an
    # independent-sample test.
    cat = {k: np.concatenate(v) for k, v in pooled.items()}
    print("\n" + "=" * 78)
    report_strategy_vs_benchmarks(
        cat["strategy"], cat["buyhold"], cat["sma"],
        label=f"POOLED across {len(args.tickers)} tickers (n={cat['strategy'].size}d)",
        rf_annual=args.risk_free, n_boot=args.n_boot)

    print("\n--- Hansen SPA over the risk-profile choice ---")
    print("  (placeholder set: profiles low/medium/high. Extend to the full")
    print("   tune_strategy.py grid to price the real search -- see RESEARCH_PLAN item 2.)")
    spa_params = er.StrategyParams(risk_free_annual=args.risk_free)
    cols, names = [], []
    for prof in ("low", "medium", "high"):
        per_t = []
        for t in args.tickers:
            rep = er.run_ticker(t, args.period, [prof], spa_params, args.tune_frac, False)
            sg = rep["results"][prof]["holdout"]["series"]
            k = min(len(sg["strategy"]), len(sg["buyhold"]))
            per_t.append(sg["strategy"][:k] - sg["buyhold"][:k])
        cols.append(np.concatenate(per_t))
        names.append(prof)
    width = min(c.size for c in cols)
    spa = hansen_spa(np.column_stack([c[:width] for c in cols]), n_boot=args.n_boot)
    print(spa.summary())
    print(f"  best configuration   : profile={names[spa.best_model]}")

    print("\n" + "=" * 78)
    print("VERDICT")
    print(f"  Sharpe beats Buy&Hold with 95% CI excluding 0 : {n_sig_bh}/{len(args.tickers)} tickers")
    print(f"  Sharpe beats SMA(20/50) with 95% CI excluding 0: {n_sig_sma}/{len(args.tickers)} tickers")
    print("  Any claim not backed by a CI excluding zero must not appear in the paper.")
