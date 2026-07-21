"""Step 1 of the Analyst redesign: forecast volatility, against real baselines.

Everything else in the redesign derives from sigma-hat -- P(up),
P(drawdown > x), expected maximum drawdown, the information ratio, position
sizing. So the whole design stands or falls on whether this forecast beats
the naive alternatives. Nothing downstream is worth building until it does.

Models
------
  rw       random walk: tomorrow's variance equals today's realised variance.
           The hardest naive baseline to beat in volatility forecasting.
  ewma     RiskMetrics exponentially weighted, lambda = 0.94.
  har      HAR-RV (Corsi 2009): regress future log realised variance on
           daily, weekly and monthly components. The standard benchmark.
  garch    GARCH(1,1), fitted by maximum likelihood on the training window.
  mean     historical mean variance -- the unconditional forecast.

Metrics
-------
QLIKE is primary. Patton (2011) shows that when the target is observed only
through a noisy proxy -- as realised variance always is -- most loss
functions rank forecasts incorrectly, and that MSE and QLIKE are among the
few robust to that noise. MAE is NOT robust and is deliberately not reported
as primary.

    QLIKE = log(sigma_hat^2) + RV / sigma_hat^2       (lower is better)

Also reported: MSE on variance, Spearman IC between forecast and realised,
and a Mincer-Zarnowitz regression of realised on forecast, whose slope should
be 1 and intercept 0 for an unbiased forecast.

Protocol
--------
Strict walk-forward. At each evaluation date the model is fitted only on data
strictly before it, and evaluated on the realised variance of the following
`horizon` days. No parameter is fitted on data that includes the target.

No language model is involved.
"""

from __future__ import annotations

import argparse
import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

_HERE = Path(__file__).resolve().parent
DATA = _HERE / "data" / "_universe"
TRADING_DAYS = 252


# --------------------------------------------------------------------------
# Forecasters. Each takes returns strictly before the decision point and
# returns a variance forecast for the next `h` days (daily variance units).
# --------------------------------------------------------------------------

def f_rw(r: np.ndarray, h: int) -> float:
    return float(np.var(r[-h:], ddof=0)) if r.size >= h else float(np.var(r, ddof=0))


def f_mean(r: np.ndarray, h: int) -> float:
    return float(np.var(r, ddof=0))


def f_ewma(r: np.ndarray, h: int, lam: float = 0.94) -> float:
    """RiskMetrics EWMA. Recursive, so it needs no fitting."""
    v = float(np.var(r[:22], ddof=0)) if r.size > 22 else float(np.var(r, ddof=0))
    for x in r[22:]:
        v = lam * v + (1.0 - lam) * x * x
    return float(v)


def f_har(r: np.ndarray, h: int) -> float:
    """HAR-RV on log variance.

    Log target because realised variance is right-skewed and bounded below;
    OLS residuals on the raw scale are badly non-Gaussian and the fit is
    dominated by a handful of turbulent windows.
    """
    if r.size < 260:
        return f_rw(r, h)
    rv_d = pd.Series(r).rolling(1).apply(lambda x: x.iloc[0] ** 2, raw=False).to_numpy()
    rv_d = r ** 2
    # Daily / weekly / monthly realised variance, all backward-looking.
    d = pd.Series(rv_d).rolling(1).mean().to_numpy()
    w = pd.Series(rv_d).rolling(5).mean().to_numpy()
    m = pd.Series(rv_d).rolling(22).mean().to_numpy()
    # Target: mean realised variance over the NEXT h days.
    tgt = pd.Series(rv_d).shift(-h).rolling(h).mean().to_numpy()

    lo = 22
    hi = r.size - h
    if hi - lo < 100:
        return f_rw(r, h)
    X = np.column_stack([np.log(np.maximum(d[lo:hi], 1e-12)),
                         np.log(np.maximum(w[lo:hi], 1e-12)),
                         np.log(np.maximum(m[lo:hi], 1e-12)),
                         np.ones(hi - lo)])
    y = np.log(np.maximum(tgt[lo:hi], 1e-12))
    ok = np.isfinite(y) & np.isfinite(X).all(axis=1)
    if ok.sum() < 100:
        return f_rw(r, h)
    beta, *_ = np.linalg.lstsq(X[ok], y[ok], rcond=None)

    x_now = np.array([np.log(max(rv_d[-1], 1e-12)),
                      np.log(max(rv_d[-5:].mean(), 1e-12)),
                      np.log(max(rv_d[-22:].mean(), 1e-12)), 1.0])
    return float(np.exp(np.clip(x_now @ beta, -30, 5)))


def f_garch(r: np.ndarray, h: int) -> float:
    """GARCH(1,1), maximum likelihood on the training window."""
    try:
        from arch import arch_model
        # arch expects percentage returns for numerical conditioning.
        am = arch_model(r * 100.0, vol="Garch", p=1, q=1, mean="Zero",
                        rescale=False)
        res = am.fit(disp="off", show_warning=False)
        f = res.forecast(horizon=h, reindex=False)
        v = float(np.mean(f.variance.values[-1, :])) / 10000.0
        return v if np.isfinite(v) and v > 0 else f_rw(r, h)
    except Exception:
        return f_rw(r, h)


MODELS = {"rw": f_rw, "mean": f_mean, "ewma": f_ewma, "har": f_har, "garch": f_garch}


# --------------------------------------------------------------------------

def qlike(rv: np.ndarray, fc: np.ndarray) -> float:
    """Patton's QLIKE. Robust to noise in the volatility proxy."""
    fc = np.maximum(fc, 1e-12)
    rv = np.maximum(rv, 1e-12)
    return float(np.mean(np.log(fc) + rv / fc))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", type=int, default=21)
    ap.add_argument("--limit", type=int, default=60,
                    help="tickers to use; GARCH refits make this the cost driver")
    ap.add_argument("--step", type=int, default=21,
                    help="trading days between evaluation dates")
    ap.add_argument("--models", default="rw,mean,ewma,har,garch")
    a = ap.parse_args()

    files = sorted(DATA.glob("*_10y.csv"))[: a.limit]
    use = [m.strip() for m in a.models.split(",") if m.strip() in MODELS]
    h = a.horizon

    print(f"Volatility forecasting | {len(files)} tickers | horizon {h}d | "
          f"walk-forward every {a.step}d")
    print(f"models: {', '.join(use)}\nprimary metric: QLIKE (lower is better)\n")

    preds = {m: [] for m in use}
    truth = []

    for fi, f in enumerate(files, 1):
        c = pd.read_csv(f)["Close"].astype(float).to_numpy()
        if c.size < 800:
            continue
        r = np.diff(c) / c[:-1]
        # Start after a full training window; stop h days before the end so
        # the realisation exists.
        for i in range(500, r.size - h, a.step):
            past = r[:i]                    # strictly before the decision
            future = r[i:i + h]             # the realisation
            rv = float(np.var(future, ddof=0))
            if not np.isfinite(rv) or rv <= 0:
                continue
            truth.append(rv)
            for m in use:
                preds[m].append(MODELS[m](past, h))
        if fi % 10 == 0:
            print(f"  {fi}/{len(files)} tickers, {len(truth):,} evaluation points")

    if len(truth) < 100:
        print("not enough evaluation points")
        return 1

    rv = np.array(truth)
    n = rv.size
    from scipy import stats as ss

    print(f"\n{n:,} out-of-sample forecasts\n")
    print(f"{'model':<8}{'QLIKE':>10}{'MSE(1e-8)':>12}{'Spearman IC':>13}"
          f"{'MZ slope':>10}{'MZ R2':>8}")
    print("-" * 62)
    rows = {}
    for m in use:
        fc = np.maximum(np.array(preds[m]), 1e-12)
        ok = np.isfinite(fc) & np.isfinite(rv)
        f_, t_ = fc[ok], rv[ok]
        q = qlike(t_, f_)
        mse = float(np.mean((t_ - f_) ** 2))
        ic, _ = ss.spearmanr(f_, t_)
        # Mincer-Zarnowitz: realised = a + b*forecast. Unbiased => b = 1.
        X = np.column_stack([f_, np.ones(f_.size)])
        b, *_ = np.linalg.lstsq(X, t_, rcond=None)
        r2 = float(np.corrcoef(f_, t_)[0, 1] ** 2)
        rows[m] = {"qlike": q, "mse": mse, "ic": float(ic),
                   "mz_slope": float(b[0]), "mz_r2": r2, "n": int(f_.size)}
        print(f"{m:<8}{q:>10.4f}{mse*1e8:>12.3f}{ic:>13.4f}"
              f"{b[0]:>10.3f}{r2:>8.3f}")
    print("-" * 62)

    best = min(rows, key=lambda k: rows[k]["qlike"])
    rw_q = rows.get("rw", {}).get("qlike")
    print(f"\nbest by QLIKE: {best}")
    if rw_q is not None and best != "rw":
        print(f"  improvement over random walk: {rw_q - rows[best]['qlike']:+.4f} QLIKE")

    if "har" in rows and "rw" in rows:
        d = rows["rw"]["qlike"] - rows["har"]["qlike"]
        print(f"\nHAR-RV vs random walk: {d:+.4f} QLIKE "
              f"({'HAR better' if d > 0 else 'random walk better'})")
        print("  Anything that cannot beat the random walk is not a forecast.")

    out = _HERE / "results" / f"vol_forecast_h{h}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"horizon": h, "n": n, "tickers": len(files),
                               "models": rows, "best": best}, indent=2))
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
