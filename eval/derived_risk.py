"""Step 2: derive drawdown probability and confidence from sigma-hat.

The redesign claims that most of what the Risk Manager needs follows from a
single volatility forecast rather than from separately fitted models. That
claim is testable and this file tests it.

For a driftless random walk with per-period volatility sigma over horizon T,
the reflection principle gives the probability that the path ever falls x
below its starting point:

    P(min_{t<=T} R_t < -x) = 2 * Phi( -x / (sigma * sqrt(T)) )

Nothing is fitted here. The probability is *derived* from sigma-hat and a
distributional assumption. So there are two ways it can fail, and they need
different fixes:

  * sigma-hat is wrong  -> improve the forecast (step 1);
  * sigma-hat is fine but the Gaussian assumption is wrong -> returns are
    fat-tailed, and the derived probability will systematically understate
    large drawdowns. The fix is a fatter-tailed law, not a better sigma.

Calibration tells the two apart, which is why it is measured here rather than
assumed.

Metrics
-------
  Brier score        mean squared error of the probability forecast
  ECE                expected calibration error over probability bins
  reliability curve  predicted probability vs realised frequency per bin
  base-rate baseline the unconditional frequency, which any useful forecast
                     must beat on Brier

No language model is involved.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

from vol_forecast import f_har, f_rw, f_ewma, f_mean  # noqa: E402

DATA = _HERE / "data" / "_universe"
FORECASTERS = {"har": f_har, "rw": f_rw, "ewma": f_ewma, "mean": f_mean}


def norm_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def p_drawdown(sigma_daily: float, horizon: int, threshold: float,
               mu_daily: float = 0.0) -> float:
    """P(path falls `threshold` below its start within `horizon` days).

    First-passage probability for arithmetic Brownian motion WITH drift. For
    X_t = mu*t + sigma*W_t and a barrier at -a (a > 0):

        P(min X <= -a) = Phi((-a - mu T)/(sigma sqrt T))
                         + exp(-2 mu a / sigma^2) * Phi((-a + mu T)/(sigma sqrt T))

    At mu = 0 this collapses to the reflection principle 2*Phi(-a/(sigma sqrt T)).

    The drift term matters and omitting it is not a small approximation.
    Equities drift upward, which lowers the chance of breaching a DOWNSIDE
    barrier. With mu forced to zero the derived probability was overstating
    risk by up to 0.19 exactly where it predicted risk to be high -- a
    structurally wrong reliability curve whose errors cancelled in the mean.
    """
    s = sigma_daily * math.sqrt(horizon)
    if s <= 1e-12:
        return 0.0
    a = float(threshold)
    mT = mu_daily * horizon
    var = sigma_daily ** 2
    t1 = norm_cdf((-a - mT) / s)
    # exp(-2*mu*a/sigma^2) overflows for tiny sigma; clip the exponent.
    expo = float(np.clip(-2.0 * mu_daily * a / max(var, 1e-12), -50.0, 50.0))
    t2 = math.exp(expo) * norm_cdf((-a + mT) / s)
    return float(min(1.0, max(0.0, t1 + t2)))


def realised_drawdown(returns: np.ndarray) -> float:
    """Worst peak-to-trough fall of the cumulative path, as a positive number."""
    eq = np.cumprod(1.0 + returns)
    peak = np.maximum.accumulate(eq)
    return float(-((eq - peak) / peak).min())


def breached(returns: np.ndarray, threshold: float) -> bool:
    """Did the path ever fall `threshold` below its STARTING value?

    This matches the reflection-principle event exactly. Peak-to-trough
    drawdown is a different (larger) quantity and would make the derived
    probability look badly under-calibrated for the wrong reason.
    """
    eq = np.cumprod(1.0 + returns)
    return bool(eq.min() < (1.0 - threshold))


def ece(pred: np.ndarray, out: np.ndarray, bins: int = 10) -> float:
    edges = np.linspace(0, 1, bins + 1)
    n = pred.size
    e = 0.0
    for b in range(bins):
        m = (pred >= edges[b]) & (pred < edges[b + 1] + (1e-9 if b == bins - 1 else 0))
        if m.sum() == 0:
            continue
        e += (m.sum() / n) * abs(out[m].mean() - pred[m].mean())
    return float(e)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", type=int, default=21)
    ap.add_argument("--limit", type=int, default=60)
    ap.add_argument("--step", type=int, default=21)
    ap.add_argument("--model", default="har", choices=list(FORECASTERS))
    ap.add_argument("--thresholds", default="0.05,0.10,0.20")
    ap.add_argument("--drift", default="trailing", choices=["zero", "trailing"],
                    help="zero reproduces the reflection principle; trailing "
                         "uses the asset's own mean return up to the decision "
                         "date, which is point-in-time and requires no forecast")
    a = ap.parse_args()

    thresholds = [float(x) for x in a.thresholds.split(",")]
    files = sorted(DATA.glob("*_10y.csv"))[: a.limit]
    h = a.horizon
    fc = FORECASTERS[a.model]

    print(f"Derived risk from sigma-hat | model={a.model} | horizon {h}d | "
          f"{len(files)} tickers")
    print("Probabilities are DERIVED from the volatility forecast, not fitted.\n")

    rows = {t: {"p": [], "y": []} for t in thresholds}
    sig_pred, sig_real = [], []

    for fi, f in enumerate(files, 1):
        c = pd.read_csv(f)["Close"].astype(float).to_numpy()
        if c.size < 800:
            continue
        r = np.diff(c) / c[:-1]
        for i in range(500, r.size - h, a.step):
            past, future = r[:i], r[i:i + h]
            var = fc(past, h)
            if not np.isfinite(var) or var <= 0:
                continue
            s = math.sqrt(var)
            # Drift from the asset's own history up to this date only. This is
            # not a directional forecast -- it is the unconditional upward
            # drift of equities, which is what the barrier formula needs.
            mu = float(past[-500:].mean()) if a.drift == "trailing" else 0.0
            sig_pred.append(s)
            sig_real.append(float(future.std()))
            for t in thresholds:
                rows[t]["p"].append(p_drawdown(s, h, t, mu))
                rows[t]["y"].append(breached(future, t))
        if fi % 20 == 0:
            print(f"  {fi}/{len(files)} tickers")

    n = len(sig_pred)
    if n < 100:
        print("not enough observations")
        return 1
    print(f"\n{n:,} out-of-sample forecasts\n")

    out = {"model": a.model, "horizon": h, "n": n, "thresholds": {}}
    print(f"{'threshold':<11}{'pred mean':>11}{'realised':>10}{'Brier':>9}"
          f"{'Brier(base)':>13}{'ECE':>8}  verdict")
    print("-" * 74)
    for t in thresholds:
        p = np.array(rows[t]["p"], dtype=float)
        y = np.array(rows[t]["y"], dtype=float)
        base = float(y.mean())
        brier = float(np.mean((p - y) ** 2))
        brier_base = float(np.mean((base - y) ** 2))
        e = ece(p, y)
        better = brier < brier_base
        print(f"{t:<11.0%}{p.mean():>11.3f}{base:>10.3f}{brier:>9.4f}"
              f"{brier_base:>13.4f}{e:>8.4f}  "
              f"{'beats base rate' if better else 'WORSE than base rate'}")
        out["thresholds"][str(t)] = {
            "pred_mean": float(p.mean()), "realised_rate": base,
            "brier": brier, "brier_base": brier_base, "ece": e,
            "beats_base": bool(better)}

    print("\n--- reliability, threshold 10% ---")
    p = np.array(rows[0.10]["p"]) if 0.10 in rows else np.array(rows[thresholds[0]]["p"])
    y = np.array(rows[0.10]["y"], dtype=float) if 0.10 in rows else np.array(rows[thresholds[0]]["y"], float)
    print(f"{'predicted bin':<16}{'n':>7}{'mean pred':>11}{'realised':>10}{'gap':>9}")
    print("-" * 55)
    edges = np.linspace(0, 1, 11)
    for b in range(10):
        m = (p >= edges[b]) & (p < edges[b + 1] + (1e-9 if b == 9 else 0))
        if m.sum() < 10:
            continue
        gap = y[m].mean() - p[m].mean()
        print(f"{f'{edges[b]:.1f}-{edges[b+1]:.1f}':<16}{int(m.sum()):>7}"
              f"{p[m].mean():>11.3f}{y[m].mean():>10.3f}{gap:>+9.3f}")

    # Is sigma-hat itself biased? A systematic gap in the derived probability
    # can come from the forecast or from the distributional assumption; this
    # separates them.
    sp, sr = np.array(sig_pred), np.array(sig_real)
    bias = float(np.mean(sp - sr) / np.mean(sr))
    print(f"\nsigma-hat bias vs realised: {bias:+.1%} "
          f"({'over' if bias > 0 else 'under'}-estimates volatility)")

    print("\n--- INTERPRETATION ---")
    # Judge calibration on the reliability CURVE, not the aggregate mean.
    # Opposite-signed errors across bins cancel: a model that understates risk
    # when it predicts low and overstates it when it predicts high can show a
    # near-zero mean gap while being badly miscalibrated everywhere.
    gaps, ws = [], []
    for b in range(10):
        m = (p >= edges[b]) & (p < edges[b + 1] + (1e-9 if b == 9 else 0))
        if m.sum() >= 10:
            gaps.append(y[m].mean() - p[m].mean())
            ws.append(int(m.sum()))
    max_gap = max((abs(g) for g in gaps), default=0.0)
    slope = float(np.polyfit(range(len(gaps)), gaps, 1)[0]) if len(gaps) > 2 else 0.0

    t10 = out["thresholds"].get("0.1")
    if t10:
        gap = t10["realised_rate"] - t10["pred_mean"]
        print(f"  aggregate gap {gap:+.3f}, but worst bin gap {max_gap:.3f}, "
              f"trend across bins {slope:+.3f}/bin")
        out["max_bin_gap"] = max_gap
        out["reliability_slope"] = slope
        if max_gap < 0.05:
            print("  Derived probabilities are well calibrated across the range.")
            print("  The 'derive from sigma-hat rather than fit' design holds.")
        elif slope < -0.02:
            print("  MISCALIBRATED, and structurally so: risk is understated where")
            print("  the model predicts low and overstated where it predicts high.")
            print("  The aggregate mean hides this because the errors cancel.")
            print("  Likely cause: the reflection formula assumes ZERO DRIFT, but")
            print("  equities drift upward, which lowers the true probability of")
            print("  breaching a downside barrier. Add the drift term before")
            print("  concluding anything about the volatility forecast.")
        elif gap > 0:
            print(f"  Derived probabilities UNDERSTATE drawdown risk by {gap:+.1%}.")
            print("  Consistent with fat tails: the Gaussian reflection formula")
            print("  assigns too little mass to large moves. Fix the distribution,")
            print("  not the volatility forecast.")
        else:
            print(f"  Derived probabilities OVERSTATE drawdown risk by {gap:+.1%}.")
            print("  Check sigma-hat bias above before changing the distribution.")

    out["sigma_bias"] = bias
    p_out = _HERE / "results" / f"derived_risk_{a.model}_h{h}.json"
    p_out.parent.mkdir(parents=True, exist_ok=True)
    p_out.write_text(json.dumps(out, indent=2))
    print(f"\nwrote {p_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
