"""Does the Analyst have predictive ability at 1, 5 or 21 trading days?

This is the most basic question the project has not yet answered directly.
Everything downstream -- conviction scaling, position sizing, the risk
profiles -- conditions on the Analyst's forecast. If that forecast carries no
information about forward returns, none of those mechanisms can add value and
the correct engineering response is to stop conditioning on it.

Method
------
Predictions are read from the walk-forward cache produced by
`precompute_predictions`, which invokes the forecaster on a slice truncated
to each rebalance index. A prediction at index i therefore saw only
closes[:i+1] and is genuinely out of sample with respect to the forward
return measured from i.

For horizon h, the realised return is (closes[i+h] - closes[i]) / closes[i].
Three quantities are reported per horizon:

  * **Directional accuracy** -- does sign(prediction) match sign(outcome)?
    Reported with a Wilson interval, which is honest at these sample sizes,
    and tested against 0.50.
  * **Information coefficient** -- Spearman rank correlation between predicted
    and realised return. This is the standard measure of forecast value in
    quantitative finance and does not assume the mapping is linear.
  * **Pearson r** -- reported alongside, since a strong rank relationship with
    a weak linear one changes how sizing should be fitted.

Two statistical hazards, handled rather than ignored
----------------------------------------------------
**Overlapping windows.** Rebalances are every 10 trading days. At h=1 and h=5
successive observations do not overlap. At h=21 they do, which inflates
apparent significance because the observations are not independent. For that
horizon a non-overlapping subsample (every third rebalance) is reported
alongside the full one; where they disagree, the subsample is the honest one.

**Cross-sectional correlation.** Pooling across tickers does not multiply
independent observations: contemporaneous equity returns are correlated, so
the effective sample is far smaller than the raw count. Per-ticker results are
therefore reported alongside the pooled figure, and the pooled p-value should
be read as optimistic.

No language model is involved.
"""

from __future__ import annotations

import argparse
import json
import math
import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

DATA = _HERE / "data" / "_universe"
PRED = _HERE / ".pred_cache"
HORIZONS = (1, 5, 21)
REBALANCE = 10


def wilson(k: int, n: int, z: float = 1.96):
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def load_pairs(sym: str):
    """(index, predicted_pct) for one ticker, plus its close series."""
    cp = DATA / f"{sym}_10y.csv"
    pk = PRED / f"{sym}_10y_r{REBALANCE}_s260.pkl"
    if not cp.exists() or not pk.exists():
        return None, None
    closes = pd.read_csv(cp)["Close"].astype(float).to_numpy()
    with open(pk, "rb") as f:
        preds = pickle.load(f)
    rows = []
    for idx, p in preds.items():
        v = p.get("predictedReturnPct")
        if v is None:
            continue
        rows.append((int(idx), float(v)))
    rows.sort()
    return closes, rows


def evaluate(closes, rows, h: int, stride: int = 1):
    """Directional hits and (pred, realised) pairs at horizon h."""
    P, R = [], []
    for j, (i, pred) in enumerate(rows):
        if j % stride:
            continue
        if i + h >= len(closes):
            continue
        realised = (closes[i + h] - closes[i]) / closes[i]
        P.append(pred / 100.0)
        R.append(realised)
    return np.array(P), np.array(R)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(_HERE / "results" / "analyst_skill.json"))
    a = ap.parse_args()

    syms = sorted({p.stem.split("_")[0] for p in PRED.glob("*_10y_r10_s260.pkl")})
    if not syms:
        print("no cached predictions found")
        return 1
    print(f"Analyst predictive skill | {len(syms)} tickers | 10y | out-of-sample\n")

    report = {}
    for h in HORIZONS:
        allP, allR, per = [], [], []
        for s in syms:
            closes, rows = load_pairs(s)
            if closes is None or not rows:
                continue
            P, R = evaluate(closes, rows, h)
            if P.size < 20:
                continue
            allP.append(P)
            allR.append(R)
            hits = int(np.sum(np.sign(P) == np.sign(R)))
            per.append({"ticker": s, "n": int(P.size), "hits": hits,
                        "acc": hits / P.size})

        if not allP:
            continue
        P, R = np.concatenate(allP), np.concatenate(allR)
        n = P.size
        hits = int(np.sum(np.sign(P) == np.sign(R)))
        acc = hits / n
        lo, hi = wilson(hits, n)

        from scipy import stats as ss
        ic, icp = ss.spearmanr(P, R)
        pr, prp = ss.pearsonr(P, R)
        # Exact binomial against a fair coin.
        bp = ss.binomtest(hits, n, 0.5).pvalue

        beats = sum(1 for x in per if x["acc"] > 0.5)
        print(f"=== horizon {h} trading day{'s' if h > 1 else ''} ===")
        print(f"  n decisions            : {n:,} across {len(per)} tickers")
        print(f"  directional accuracy   : {acc:.4f}   95% CI [{lo:.4f}, {hi:.4f}]")
        print(f"  vs coin flip           : p={bp:.4g}   "
              f"{'SIGNIFICANT' if lo > 0.5 or hi < 0.5 else 'not significant'}")
        print(f"  information coefficient: {ic:+.4f}  (Spearman, p={icp:.4g})")
        print(f"  Pearson r              : {pr:+.4f}  (p={prp:.4g})")
        print(f"  tickers above 50%      : {beats}/{len(per)}")

        entry = {"n": n, "accuracy": acc, "ci95": [lo, hi], "binom_p": bp,
                 "spearman_ic": float(ic), "spearman_p": float(icp),
                 "pearson_r": float(pr), "pearson_p": float(prp),
                 "tickers_above_half": beats, "tickers": len(per)}

        # Overlap correction where the horizon exceeds the rebalance spacing.
        if h > REBALANCE:
            stride = math.ceil(h / REBALANCE)
            sP, sR = [], []
            for s in syms:
                closes, rows = load_pairs(s)
                if closes is None or not rows:
                    continue
                p2, r2 = evaluate(closes, rows, h, stride=stride)
                if p2.size:
                    sP.append(p2)
                    sR.append(r2)
            if sP:
                P2, R2 = np.concatenate(sP), np.concatenate(sR)
                n2 = P2.size
                h2 = int(np.sum(np.sign(P2) == np.sign(R2)))
                lo2, hi2 = wilson(h2, n2)
                ic2, icp2 = ss.spearmanr(P2, R2)
                bp2 = ss.binomtest(h2, n2, 0.5).pvalue
                print(f"  -- non-overlapping subsample (every {stride}rd rebalance) --")
                print(f"     n={n2:,}  acc={h2/n2:.4f}  CI [{lo2:.4f}, {hi2:.4f}]  "
                      f"p={bp2:.4g}  IC={ic2:+.4f}")
                entry["nonoverlap"] = {"n": n2, "accuracy": h2 / n2,
                                       "ci95": [lo2, hi2], "binom_p": bp2,
                                       "spearman_ic": float(ic2)}
        print()
        report[f"h{h}"] = entry

    print("--- VERDICT ---")
    any_sig = False
    for h in HORIZONS:
        e = report.get(f"h{h}")
        if not e:
            continue
        use = e.get("nonoverlap", e)
        # Significance alone is not skill: an accuracy CI can exclude 0.50
        # from BELOW, and an information coefficient can be significantly
        # NEGATIVE. Both mean the forecast is anti-predictive, which is the
        # opposite of the claim a naive "is it significant?" check would
        # support. Direction is therefore checked explicitly.
        better = use["ci95"][0] > 0.5
        worse = use["ci95"][1] < 0.5
        ic_pos = e["spearman_p"] < 0.05 and e["spearman_ic"] > 0
        ic_neg = e["spearman_p"] < 0.05 and e["spearman_ic"] < 0
        if better or ic_pos:
            any_sig = True
            print(f"  h={h}: SKILL -- significantly better than chance.")
        elif worse or ic_neg:
            print(f"  h={h}: ANTI-PREDICTIVE -- significantly WORSE than chance "
                  f"(acc {use['accuracy']:.4f}, IC {e['spearman_ic']:+.4f}).")
        else:
            print(f"  h={h}: no predictive ability detected.")
    if not any_sig:
        print("\n  The Analyst shows no statistically supported predictive ability at")
        print("  any horizon tested. Every downstream mechanism that conditions")
        print("  exposure on this forecast is therefore acting on noise.")
    else:
        print("\n  Note: pooled p-values are optimistic because contemporaneous")
        print("  equity returns are correlated, so the effective sample is well")
        print("  below the raw count. Check the per-ticker column before claiming.")

    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nwrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
