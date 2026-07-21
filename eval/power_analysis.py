"""
power_analysis.py -- how much data does a Sharpe claim actually need?

MOTIVATION
  significance.py found that NOTHING in FINDEC's backtest is statistically
  significant: pooled Sharpe difference -0.162 with a 95% CI of [-0.752, +0.428]
  over n=398 holdout days per ticker. The natural question -- and the one this
  module answers -- is whether that is a statement about FINDEC or a statement
  about the sample size.

  It is the sample size. This script quantifies the minimum holdout length needed
  to detect a given true Sharpe difference at conventional power, and the answer
  (roughly a decade of daily data per name for effects of the size routinely
  claimed in this literature) is the paper's central methodological result.

TWO INDEPENDENT ESTIMATES, because one alone is not convincing:

  1. ANALYTIC (Lo 2002; Jobson-Korkie 1981 / Memmel 2003 for the difference).
     For i.i.d. returns the standard error of an estimated Sharpe S over N
     observations is sqrt((1 + S^2/2)/N). For the DIFFERENCE of two Sharpes
     computed on correlated series, the Jobson-Korkie statistic with Memmel's
     correction gives the variance below. Fast, closed-form, but assumes
     i.i.d. normal returns -- which daily equity returns are not.

  2. MONTE CARLO through the ACTUAL test. Simulate two correlated return series
     with a known true Sharpe difference, run the real stationary-bootstrap test
     from significance.py, and count how often it rejects. This inherits every
     assumption of the test we actually use, including its handling of serial
     dependence, so it is the number to trust where the two disagree.

The correlation term matters enormously and is why naive power calculations in
this literature are far too optimistic: a timing overlay and its buy&hold
benchmark are driven by the same prices and are typically 0.6-0.9 correlated,
which SHRINKS the variance of their difference and therefore HELPS. Ignoring it
overstates the required N. We estimate rho from the real data rather than guess.

    python power_analysis.py
    python power_analysis.py --quick        # fewer sims, for a smoke test
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass

import numpy as np

import significance as sig

TRADING_DAYS = 252


# --------------------------------------------------------------------------
# 1. Analytic power (Jobson-Korkie / Memmel)
# --------------------------------------------------------------------------

def sharpe_diff_var_coeff(s_a: float, s_b: float, rho: float) -> float:
    """Variance coefficient V such that Var(Sharpe_A - Sharpe_B) = V / n, with
    both Sharpes in ANNUALIZED units and n daily observations.

    Memmel (2003) correction to the Jobson-Korkie (1981) statistic. The formula
    is stated for per-period Sharpes, so we convert in, then scale the resulting
    variance back out to annualized units (variance scales by TRADING_DAYS).
    """
    a = s_a / np.sqrt(TRADING_DAYS)
    b = s_b / np.sqrt(TRADING_DAYS)
    v = 2.0 - 2.0 * rho + 0.5 * (a ** 2 + b ** 2 - 2.0 * a * b * rho ** 2)
    return float(max(v, 0.0) * TRADING_DAYS)


def sharpe_diff_se_analytic(s_a: float, s_b: float, rho: float, n: int) -> float:
    """SE of (Sharpe_A - Sharpe_B) in annualized Sharpe units, from n days."""
    if n < 1:
        return float("inf")
    return float(np.sqrt(sharpe_diff_var_coeff(s_a, s_b, rho) / n))


def required_n_analytic(true_diff: float, s_bench: float, rho: float,
                        power: float = 0.80, alpha: float = 0.05) -> int:
    """Smallest n detecting `true_diff` at the given power. Since SE = sqrt(V/n),
    solving (z_a + z_b) * sqrt(V/n) = |diff| gives n = V * ((z_a+z_b)/diff)^2."""
    from scipy import stats
    if true_diff == 0:
        return -1
    z_a = stats.norm.ppf(1 - alpha / 2)
    z_b = stats.norm.ppf(power)
    v = sharpe_diff_var_coeff(s_bench + true_diff, s_bench, rho)
    return int(np.ceil(v * ((z_a + z_b) / abs(true_diff)) ** 2))


def power_at_n_analytic(true_diff: float, s_bench: float, rho: float,
                        n: int, alpha: float = 0.05) -> float:
    """Analytic power of the two-sided test at sample size n."""
    from scipy import stats
    se = sharpe_diff_se_analytic(s_bench + true_diff, s_bench, rho, n)
    if not np.isfinite(se) or se <= 0:
        return float("nan")
    z_a = stats.norm.ppf(1 - alpha / 2)
    return float(stats.norm.cdf(abs(true_diff) / se - z_a))


# --------------------------------------------------------------------------
# 2. Monte Carlo power through the real bootstrap test
# --------------------------------------------------------------------------

@dataclass
class PowerPoint:
    n_days: int
    true_diff: float
    power: float
    mean_ci_width: float
    n_sims: int

    def one_line(self) -> str:
        yrs = self.n_days / TRADING_DAYS
        return (f"  n={self.n_days:6d} ({yrs:5.1f}y)  true diff={self.true_diff:+.2f}  "
                f"power={self.power:5.1%}  mean 95% CI width={self.mean_ci_width:5.2f}")


def simulate_power(
    n_days: int,
    true_diff: float,
    s_bench: float = 0.30,
    rho: float = 0.75,
    daily_vol: float = 0.018,
    n_sims: int = 200,
    n_boot: int = 400,
    block_mean: float = 10.0,
    seed: int = 4242,
) -> PowerPoint:
    """Fraction of simulated experiments in which the bootstrap test's 95% CI
    excludes zero, when the true Sharpe difference is `true_diff`.

    The two series are generated with correlation `rho` and the benchmark's
    Sharpe set to `s_bench`, both estimated from the real holdout data by
    `estimate_dgp_params` so the simulation matches the actual problem.
    """
    rng = np.random.default_rng(seed)
    # Annualized Sharpe S implies a daily mean of S * daily_vol / sqrt(252).
    mu_b = s_bench / np.sqrt(TRADING_DAYS) * daily_vol
    mu_a = (s_bench + true_diff) / np.sqrt(TRADING_DAYS) * daily_vol

    rejects = 0
    widths = []
    for i in range(n_sims):
        z1 = rng.normal(0, 1, n_days)
        z2 = rho * z1 + np.sqrt(max(1 - rho ** 2, 0.0)) * rng.normal(0, 1, n_days)
        a = mu_a + daily_vol * z1
        b = mu_b + daily_vol * z2
        res = sig.bootstrap_metric_diff(a, b, "sharpe", n_boot=n_boot,
                                        block_mean=block_mean, seed=int(rng.integers(1 << 30)))
        widths.append(res.ci_high - res.ci_low)
        if res.significant:
            rejects += 1
    return PowerPoint(n_days, true_diff, rejects / n_sims, float(np.mean(widths)), n_sims)


# --------------------------------------------------------------------------
# 3. Estimate the data-generating parameters from the REAL holdout
# --------------------------------------------------------------------------

def estimate_dgp_params(tickers: list[str], period: str, profile: str,
                        tune_frac: float, risk_free: float) -> dict:
    """Pull the real strategy/benchmark correlation, benchmark Sharpe and daily
    volatility off the actual holdout, so the simulation is calibrated to
    FINDEC's problem rather than to invented numbers."""
    import eval_recommendation as er

    params = er.StrategyParams(risk_free_annual=risk_free)
    rhos, s_benchs, vols, ns = [], [], [], []
    for t in tickers:
        rep = er.run_ticker(t, period, [profile], params, tune_frac, False)
        s = rep["results"][profile]["holdout"]["series"]
        n = min(len(s["strategy"]), len(s["buyhold"]))
        strat, bh = s["strategy"][:n], s["buyhold"][:n]
        if n > 10 and strat.std() > 1e-12 and bh.std() > 1e-12:
            rhos.append(float(np.corrcoef(strat, bh)[0, 1]))
            s_benchs.append(sig._sharpe(bh, risk_free))
            vols.append(float(bh.std()))
            ns.append(n)
    return {
        "rho": float(np.mean(rhos)),
        "s_bench": float(np.mean(s_benchs)),
        "daily_vol": float(np.mean(vols)),
        "n_holdout": int(np.mean(ns)),
        "per_ticker_rho": rhos,
    }


# --------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description="Power analysis for FINDEC Sharpe claims.")
    ap.add_argument("--tickers", nargs="+", default=["AAPL", "MSFT", "AMZN", "TSLA", "NVDA"])
    ap.add_argument("--period", default="3y")
    ap.add_argument("--profile", default="high")
    ap.add_argument("--tune-frac", type=float, default=0.6)
    ap.add_argument("--risk-free", type=float, default=0.04)
    ap.add_argument("--quick", action="store_true", help="fewer sims/resamples")
    args = ap.parse_args()

    n_sims = 60 if args.quick else 200
    n_boot = 200 if args.quick else 400

    print("=" * 78)
    print("FINDEC POWER ANALYSIS -- how much data does a Sharpe claim need?")
    print("=" * 78)

    print("\n[1] Calibrating the simulation to the real holdout data ...")
    dgp = estimate_dgp_params(args.tickers, args.period, args.profile,
                              args.tune_frac, args.risk_free)
    print(f"    strategy/benchmark correlation rho : {dgp['rho']:.3f}")
    print(f"    benchmark Sharpe                   : {dgp['s_bench']:+.3f}")
    print(f"    benchmark daily volatility         : {dgp['daily_vol']:.4f}")
    print(f"    actual holdout length              : {dgp['n_holdout']} days "
          f"({dgp['n_holdout']/TRADING_DAYS:.1f} years)")

    # --- Analytic: required n for a range of true effect sizes ---------------
    print("\n[2] ANALYTIC required sample size (Jobson-Korkie / Memmel, 80% power, alpha=0.05)")
    print(f"    {'true Sharpe diff':>18s}  {'required n (days)':>18s}  {'= years':>10s}")
    analytic_rows = []
    for diff in (0.10, 0.20, 0.30, 0.50, 0.75, 1.00):
        n_req = required_n_analytic(diff, dgp["s_bench"], dgp["rho"])
        analytic_rows.append((diff, n_req))
        print(f"    {diff:>18.2f}  {n_req:>18,d}  {n_req/TRADING_DAYS:>10.1f}")

    # --- Monte Carlo: power at the ACTUAL sample size ------------------------
    print(f"\n[3] MONTE CARLO power at FINDEC's ACTUAL holdout size "
          f"(n={dgp['n_holdout']}, {n_sims} sims x {n_boot} resamples)")
    print("    i.e. if the strategy really were this much better, how often would")
    print("    our test have noticed?")
    print(f"    {'true diff':>10s} {'MC power':>10s} {'analytic':>10s} {'MC 95% CI width':>17s}")
    for diff in (0.20, 0.30, 0.50, 1.00):
        pp = simulate_power(dgp["n_holdout"], diff, dgp["s_bench"], dgp["rho"],
                            dgp["daily_vol"], n_sims=n_sims, n_boot=n_boot)
        an = power_at_n_analytic(diff, dgp["s_bench"], dgp["rho"], dgp["n_holdout"])
        print(f"    {diff:>+10.2f} {pp.power:>10.1%} {an:>10.1%} {pp.mean_ci_width:>17.2f}")

    # --- Monte Carlo: power vs n for a plausible true effect -----------------
    target = 0.30
    print(f"\n[4] Power vs sample size, for a true Sharpe difference of {target:+.2f}")
    print(f"    (MC is noisy at {n_sims} sims -- SE on a power estimate is ~"
          f"{np.sqrt(0.25/n_sims):.1%}; the analytic column is the smooth reference)")
    print(f"    {'n (days)':>10s} {'years':>7s} {'MC power':>10s} {'analytic':>10s} {'CI width':>10s}")
    for n_days in (252, 504, 1260, 2520, 5040, 10080):
        pp = simulate_power(n_days, target, dgp["s_bench"], dgp["rho"],
                            dgp["daily_vol"], n_sims=n_sims, n_boot=n_boot)
        an = power_at_n_analytic(target, dgp["s_bench"], dgp["rho"], n_days)
        print(f"    {n_days:>10,d} {n_days/TRADING_DAYS:>7.1f} {pp.power:>10.1%} "
              f"{an:>10.1%} {pp.mean_ci_width:>10.2f}")

    print("\n" + "=" * 78)
    print("INTERPRETATION")
    print("=" * 78)
    n30 = required_n_analytic(0.30, dgp["s_bench"], dgp["rho"])
    n100 = required_n_analytic(1.00, dgp["s_bench"], dgp["rho"])
    obs_power30 = power_at_n_analytic(0.30, dgp["s_bench"], dgp["rho"], dgp["n_holdout"])
    print(f"  A true Sharpe improvement of +0.30 -- a large, economically meaningful")
    print(f"  effect -- needs ~{n30:,} trading days ({n30/TRADING_DAYS:.0f} years) per name to")
    print(f"  detect at 80% power against a benchmark correlated {dgp['rho']:.2f} with it.")
    print(f"  Even a +1.00 Sharpe improvement needs ~{n100:,} days ({n100/TRADING_DAYS:.0f} years).")
    print()
    print(f"  FINDEC's holdout is {dgp['n_holdout']} days ({dgp['n_holdout']/TRADING_DAYS:.1f} years).")
    print(f"  Its power to detect a +0.30 improvement is {obs_power30:.1%} -- barely above")
    print(f"  the {0.05:.0%} false-positive rate. The experiment could not have")
    print(f"  succeeded, whatever the strategy did.")
    print()
    print("  This is not a FINDEC-specific limitation. Any study in this literature")
    print("  reporting 1-2 years of holdout on a handful of correlated tickers is")
    print("  underpowered by an order of magnitude for the effects it claims, with")
    print("  or without a lookahead bug. Reported 'wins' at that sample size are")
    print("  selection over noise.")


if __name__ == "__main__":
    main()
