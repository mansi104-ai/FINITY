"""The single evaluation of the redesigned Analyst.

Six metrics, fixed in advance, no others:

  1. QLIKE                 volatility forecast quality
  2. Calibration curve     predicted vs realised, per bin
  3. Brier score           probability forecast quality, vs the base rate
  4. Reliability diagram   the calibration curve, printed
  5. Coverage vs abstention accuracy as a function of how often we answer
  6. Rank IC               cross-sectional, per date then averaged

Decision rule set BEFORE running: the redesign is worth keeping if QLIKE
beats the random walk, Brier beats the base rate, and Rank IC is positive.
Anything else is a negative result and is reported as one.

Rank IC is computed per date and then averaged, never pooled across dates.
Pooling conflates cross-sectional with time-series predictability and inflates
the figure.

No language model is involved.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

from vol_forecast import f_har, f_rw, f_ewma, qlike           # noqa: E402
from derived_risk import p_drawdown, breached, ece            # noqa: E402

DATA = _HERE / "data" / "_universe"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--horizon", type=int, default=21)
    ap.add_argument("--limit", type=int, default=60)
    ap.add_argument("--step", type=int, default=21)
    ap.add_argument("--threshold", type=float, default=0.10)
    a = ap.parse_args()

    h, thr = a.horizon, a.threshold
    files = sorted(DATA.glob("*_10y.csv"))[: a.limit]

    print(f"REDESIGNED ANALYST -- single evaluation")
    print(f"{len(files)} tickers | horizon {h}d | drawdown threshold {thr:.0%}\n")

    # Per date, so the cross-sectional rank can be computed correctly.
    by_date = defaultdict(list)
    vol_fc = {"har": [], "rw": [], "ewma": []}
    vol_true = []
    p_dd, y_dd = [], []
    conf, correct = [], []

    for fi, f in enumerate(files, 1):
        sym = f.stem.split("_")[0]
        df = pd.read_csv(f)
        c = df["Close"].astype(float).to_numpy()
        dates = df["Date"].to_numpy()
        if c.size < 800:
            continue
        r = np.diff(c) / c[:-1]

        for i in range(500, r.size - h, a.step):
            past, future = r[:i], r[i:i + h]
            v_har = f_har(past, h)
            if not np.isfinite(v_har) or v_har <= 0:
                continue
            rv = float(np.var(future, ddof=0))
            if not np.isfinite(rv) or rv <= 0:
                continue

            vol_true.append(rv)
            vol_fc["har"].append(v_har)
            vol_fc["rw"].append(f_rw(past, h))
            vol_fc["ewma"].append(f_ewma(past, h))

            s = math.sqrt(v_har)
            p_dd.append(p_drawdown(s, h, thr))
            y_dd.append(breached(future, thr))

            # mu shrunk hard, per the redesign: sizing keys on mu/sigma.
            mu = float(np.clip(0.15 * past[-252:].mean() * h, -0.25 * s * math.sqrt(h),
                               0.25 * s * math.sqrt(h)))
            ir = mu / (s * math.sqrt(h)) if s > 0 else 0.0
            fwd = float(np.prod(1 + future) - 1)

            # confidence = |IR| mapped to [0.5, 1]; correctness = direction hit
            conf.append(float(min(1.0, 0.5 + abs(ir))))
            correct.append(bool(np.sign(ir) == np.sign(fwd)) if ir != 0 else False)

            by_date[str(dates[i])].append((sym, ir, fwd))
        if fi % 20 == 0:
            print(f"  {fi}/{len(files)} tickers")

    n = len(vol_true)
    if n < 200:
        print("not enough observations")
        return 1
    rv = np.array(vol_true)
    print(f"\n{n:,} out-of-sample observations\n")

    from scipy import stats as ss
    res = {}

    # ---- 1. QLIKE ------------------------------------------------------
    print("1. QLIKE (lower is better)")
    print(f"   {'model':<8}{'QLIKE':>10}")
    q = {}
    for m, v in vol_fc.items():
        q[m] = qlike(rv, np.maximum(np.array(v), 1e-12))
        print(f"   {m:<8}{q[m]:>10.4f}")
    beat_rw = q["har"] < q["rw"]
    print(f"   HAR vs random walk: {q['rw']-q['har']:+.4f}  "
          f"-> {'HAR better' if beat_rw else 'RW better'}")
    res["qlike"] = q

    # ---- 2/3/4. Brier, calibration, reliability ------------------------
    p = np.array(p_dd, dtype=float)
    y = np.array(y_dd, dtype=float)
    base = float(y.mean())
    brier = float(np.mean((p - y) ** 2))
    brier_base = float(np.mean((base - y) ** 2))
    e = ece(p, y)
    beat_base = brier < brier_base
    print(f"\n2-4. P(drawdown > {thr:.0%}): Brier {brier:.4f} vs base rate "
          f"{brier_base:.4f} -> {'better' if beat_base else 'WORSE'}")
    print(f"     ECE {e:.4f}   predicted mean {p.mean():.3f}   realised {base:.3f}")
    print(f"\n     reliability diagram")
    print(f"     {'bin':<12}{'n':>7}{'pred':>8}{'actual':>9}{'gap':>8}")
    edges = np.linspace(0, 1, 11)
    gaps = []
    for b in range(10):
        m = (p >= edges[b]) & (p < edges[b + 1] + (1e-9 if b == 9 else 0))
        if m.sum() < 10:
            continue
        g = y[m].mean() - p[m].mean()
        gaps.append(g)
        bar = "#" * int(abs(g) * 60)
        print(f"     {f'{edges[b]:.1f}-{edges[b+1]:.1f}':<12}{int(m.sum()):>7}"
              f"{p[m].mean():>8.3f}{y[m].mean():>9.3f}{g:>+8.3f} {bar}")
    worst = max((abs(g) for g in gaps), default=0.0)
    slope = float(np.polyfit(range(len(gaps)), gaps, 1)[0]) if len(gaps) > 2 else 0.0
    print(f"     worst bin gap {worst:.3f}, slope {slope:+.3f}/bin")
    res["brier"] = {"brier": brier, "base": brier_base, "ece": e,
                    "worst_gap": worst, "slope": slope, "beats_base": beat_base}

    # ---- 5. Coverage vs abstention -------------------------------------
    cf = np.array(conf, dtype=float)
    ok = np.array(correct, dtype=float)
    print(f"\n5. Coverage vs abstention (abstain on lowest confidence)")
    print(f"   {'coverage':>9}{'n':>8}{'accuracy':>10}")
    cov_rows = []
    for cov in (1.0, 0.75, 0.50, 0.25, 0.10):
        k = max(10, int(len(cf) * cov))
        idx = np.argsort(-cf)[:k]
        acc = float(ok[idx].mean())
        cov_rows.append({"coverage": cov, "n": k, "accuracy": acc})
        print(f"   {cov:>9.0%}{k:>8}{acc:>10.4f}")
    monotone = cov_rows[-1]["accuracy"] > cov_rows[0]["accuracy"]
    print(f"   accuracy rises as coverage falls: {'YES' if monotone else 'NO'}"
          f"  -> {'abstention is informative' if monotone else 'abstention adds nothing'}")
    res["coverage"] = cov_rows

    # ---- 6. Rank IC ----------------------------------------------------
    daily = []
    for d, rows in by_date.items():
        if len(rows) < 10:
            continue
        ir = np.array([x[1] for x in rows])
        fwd = np.array([x[2] for x in rows])
        if np.std(ir) < 1e-12:
            continue
        ic, _ = ss.spearmanr(ir, fwd)
        if np.isfinite(ic):
            daily.append(ic)
    if daily:
        d = np.array(daily)
        icir = float(d.mean() / d.std()) if d.std() > 0 else 0.0
        t, pv = ss.ttest_1samp(d, 0.0)
        print(f"\n6. Rank IC (per date, then averaged over {len(d)} dates)")
        print(f"   mean Rank IC {d.mean():+.4f}   ICIR {icir:+.3f}   "
              f"t={t:+.2f}  p={pv:.4f}")
        print(f"   dates with positive IC: {int((d>0).sum())}/{len(d)}")
        res["rank_ic"] = {"mean": float(d.mean()), "icir": icir,
                          "t": float(t), "p": float(pv), "dates": len(d)}
    else:
        print("\n6. Rank IC: not computable (too few names per date)")
        res["rank_ic"] = None

    # ---- verdict --------------------------------------------------------
    print("\n" + "=" * 62)
    print("VERDICT against the rule fixed before running")
    print("=" * 62)
    ric = res.get("rank_ic") or {}
    checks = [
        ("QLIKE beats random walk", beat_rw),
        ("Brier beats base rate", beat_base),
        ("Rank IC positive", (ric.get("mean") or 0) > 0),
        ("Abstention informative", monotone),
    ]
    for name, okc in checks:
        print(f"  [{'PASS' if okc else 'FAIL'}] {name}")
    n_pass = sum(1 for _, c in checks if c)
    print(f"\n  {n_pass}/4 criteria met.")
    if n_pass == 4:
        print("  The redesign is supported. Stop here and write it up.")
    else:
        print("  The redesign is NOT fully supported. Report the failures as")
        print("  results rather than tuning until they pass -- tuning against")
        print("  this evaluation is the data-snooping the paper criticises.")

    out = _HERE / "results" / "redesign_eval.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res, indent=2))
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
