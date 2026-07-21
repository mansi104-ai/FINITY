"""Large-universe backtest: N tickers x 10 years, corrected execution lag.

Built to the structure that survives interruption:
  * price data downloaded once and cached to CSV;
  * one ticker held in memory at a time;
  * each ticker's result checkpointed to JSON immediately, so a crash or a
    Ctrl-C costs one ticker rather than the whole run;
  * tickers evaluated in parallel across processes;
  * forecaster predictions disk-cached by eval_recommendation.

**What this experiment can and cannot establish.** At 200 tickers over 10
years the effective sample is ~7,100 observations, because contemporaneous
equity returns are correlated (~0.35) and 200 names therefore supply roughly
2.83 independent cross-sectional units, not 200. That resolves a Sharpe
difference of about +0.50. FINDEC's measured difference against buy-and-hold
is -0.162 -- it loses -- so this run cannot demonstrate outperformance at any
universe size. It can establish a well-powered null.

Survivorship bias is present and material: the universe is drawn from names
listed in 2026, so every constituent survived the decade. This flatters both
the strategy and the benchmark and must be stated wherever the numbers are
used. Removing it needs point-in-time constituents (CRSP/WRDS), which this
script does not have.

No language model is involved anywhere in this file.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
import urllib.request
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122 Safari/537.36"}
DATA = _HERE / "data" / "_universe"
CKPT = _HERE / "results" / "_universe_ckpt"

# Large-cap US equities across GICS sectors. Listed in 2026, so survivorship
# bias is baked in by construction -- see module docstring.
UNIVERSE = """
AAPL MSFT NVDA AVGO ORCL CRM AMD ADBE ACN CSCO INTC QCOM TXN INTU IBM NOW AMAT
MU ADI LRCX KLAC SNPS CDNS PANW ANET FTNT MSI ROP GLW HPQ
GOOGL META NFLX DIS CMCSA TMUS VZ T CHTR EA TTWO OMC
AMZN TSLA HD MCD LOW NKE SBUX TJX BKNG CMG ORLY AZO ROST YUM MAR HLT GM F APTV
LULU DHI LEN
PG KO PEP COST WMT PM MO MDLZ CL KMB GIS SYY KR STZ HSY K CHD MKC gis
JPM BAC GS BRK-B WFC MS C AXP SPGI BLK SCHW CB PGR MMC AON ICE CME COF USB PNC
TFC BK TROW
UNH JNJ LLY ABBV MRK PFE TMO ABT DHR BMY AMGN GILD CVS CI ELV ISRG SYK BSX MDT
ZTS REGN VRTX BIIB HCA
CAT BA HON UNP GE LMT RTX DE UPS FDX NSC CSX ETN EMR ITW PH GD NOC MMM WM CMI
ROK PCAR
XOM CVX COP SLB EOG PSX MPC VLO OXY WMB KMI OKE HAL DVN HES
NEE DUK SO D AEP EXC SRE XEL ED PEG WEC ES AEE DTE PPL
PLD AMT CCI EQIX PSA SPG O WELL DLR AVB EQR VTR ARE
LIN SHW APD ECL FCX NEM DOW DD PPG NUE VMC MLM ALB IFF
"""


def universe(n: int) -> list[str]:
    seen, out = set(), []
    for t in UNIVERSE.split():
        t = t.strip().upper()
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out[:n]


def fetch(sym: str, years: float) -> pd.DataFrame | None:
    DATA.mkdir(parents=True, exist_ok=True)
    cp = DATA / f"{sym}_{int(years)}y.csv"
    if cp.exists():
        try:
            df = pd.read_csv(cp)
            if len(df) > 100:
                return df
        except Exception:
            pass

    end = int(time.time())
    start = end - int(365.25 * years * 86400)
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
           f"?period1={start}&period2={end}&interval=1d")
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=45) as r:
                payload = json.load(r)
            res = payload["chart"]["result"][0]
            ts, q = res["timestamp"], res["indicators"]["quote"][0]
            rows = []
            for i, t in enumerate(ts):
                c = q["close"][i]
                if c is None:
                    continue
                rows.append({"Date": datetime.fromtimestamp(t, timezone.utc).date().isoformat(),
                             "Close": float(c), "Volume": float(q["volume"][i] or 0)})
            df = pd.DataFrame(rows)
            if len(df) < 100:
                return None
            df.to_csv(cp, index=False)
            return df
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return None


def _stats(r: np.ndarray, rf: float) -> dict:
    r = np.asarray(r, dtype=float)
    if r.size == 0:
        return {"sharpe": 0.0, "ann": 0.0, "dd": 0.0}
    eq = np.cumprod(1.0 + r)
    peak = np.maximum.accumulate(eq)
    yrs = r.size / 252.0
    ex = r - rf / 252.0
    sd = ex.std()
    return {"sharpe": float(np.sqrt(252) * ex.mean() / sd) if sd > 1e-12 else 0.0,
            "ann": float((eq[-1] ** (1 / yrs) - 1) * 100) if yrs > 0 else 0.0,
            "dd": float(((eq - peak) / peak).min() * 100)}


def run_one(args) -> dict:
    """Evaluate one ticker. Runs in a worker process; must not raise."""
    sym, years, profile, rf, tune_frac = args
    ck = CKPT / f"{sym}.json"
    if ck.exists():
        try:
            return json.loads(ck.read_text())
        except Exception:
            pass

    out = {"ticker": sym, "ok": False, "error": ""}
    try:
        import eval_recommendation as er
        from models.market_forecaster import MarketForecaster

        df = fetch(sym, years)
        if df is None or len(df) < 400:
            out["error"] = "insufficient data"
        else:
            closes = df["Close"].astype(float).to_numpy()
            n = len(closes)
            params = er.StrategyParams(execution_lag_days=1, risk_free_annual=rf)
            min_start = min(260, max(120, n // 3))
            idxs = list(range(min_start, n, params.rebalance_days))
            preds = er.precompute_predictions(
                df, sym, MarketForecaster(), idxs,
                cache_key=f"{sym}_{int(years)}y_r{params.rebalance_days}_s{min_start}")
            agents = {"risk_manager": er.RiskManagerAgent(),
                      "risk_reasoner": er.RiskReasoningAgent(),
                      "verifier": er.VerificationAgent(),
                      "crew": er.FinanceCrew()}
            rec = er.run_strategy(df, sym, preds, profile, params, min_start, agents, False)

            # Use evaluate_segments rather than aligning the benchmark by hand.
            # Strategy day k is the return closes[min_start+k-1] -> closes[
            # min_start+k], and getting that offset wrong by one is precisely
            # the defect that inflated mean Sharpe from 0.192 to 0.724. This
            # function already does the alignment and is covered by the
            # lookahead regression tests.
            segs = er.evaluate_segments(rec, closes, tune_frac, risk_free_annual=rf)
            hold = segs.get("holdout") or {}
            ser = hold.get("series") or {}
            sr = [float(x) for x in np.asarray(ser.get("strategy", []))]
            br = [float(x) for x in np.asarray(ser.get("buyhold", []))]
            if sr and br:
                m = min(len(sr), len(br))
                sr, br = sr[:m], br[:m]
                s, b = _stats(np.array(sr), rf), _stats(np.array(br), rf)
                out.update({"ok": True, "n": m, "s": s, "b": b,
                            "strategy_returns": sr, "benchmark_returns": br,
                            "start": str(df.Date.iloc[0]), "end": str(df.Date.iloc[-1])})
            else:
                out["error"] = f"empty holdout series (strat={len(sr)}, bh={len(br)})"
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {e}"
        out["trace"] = traceback.format_exc(limit=3)

    try:
        CKPT.mkdir(parents=True, exist_ok=True)
        ck.write_text(json.dumps(out))
    except Exception:
        pass
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--years", type=float, default=10.0)
    ap.add_argument("--profile", default="high")
    ap.add_argument("--rf", type=float, default=0.04)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 1))
    ap.add_argument("--tune-frac", type=float, default=0.5,
                    help="fraction of the run used as the tune segment; "
                         "metrics are reported on the later holdout only")
    ap.add_argument("--fetch-only", action="store_true")
    a = ap.parse_args()

    syms = universe(a.n)
    CKPT.mkdir(parents=True, exist_ok=True)
    done = {p.stem for p in CKPT.glob("*.json")}
    todo = [s for s in syms if s not in done]

    print(f"FINDEC universe backtest | {len(syms)} tickers | {a.years:.0f}y | "
          f"lag=1 | rf={a.rf:.0%} | {a.workers} workers")
    print(f"already checkpointed: {len(done)}   to run: {len(todo)}")
    print("No language model is used in this experiment.\n")

    # Fetch serially: parallel downloads trip Yahoo's rate limiter, and the
    # cache means this is paid once ever.
    print("-- fetching prices (cached) --")
    have = 0
    for i, s in enumerate(syms, 1):
        if fetch(s, a.years) is not None:
            have += 1
        if i % 25 == 0:
            print(f"   {i}/{len(syms)} ... {have} usable")
    print(f"   {have}/{len(syms)} usable series\n")
    if a.fetch_only:
        return 0

    print("-- evaluating --")
    t0 = time.time()
    results = [json.loads((CKPT / f"{s}.json").read_text())
               for s in syms if (CKPT / f"{s}.json").exists()]
    if todo:
        with ProcessPoolExecutor(max_workers=a.workers) as pool:
            futs = {pool.submit(run_one, (s, a.years, a.profile, a.rf, a.tune_frac)): s for s in todo}
            for k, f in enumerate(as_completed(futs), 1):
                r = f.result()
                results.append(r)
                flag = "" if r.get("ok") else f"  ! {r.get('error','')[:40]}"
                if k % 10 == 0 or not r.get("ok"):
                    el = time.time() - t0
                    print(f"   {k}/{len(todo)}  {r['ticker']:<6} "
                          f"[{el/60:.1f}m elapsed]{flag}")

    ok = [r for r in results if r.get("ok")]
    print(f"\n{len(ok)}/{len(syms)} tickers evaluated "
          f"({(time.time()-t0)/60:.1f} min)")
    if not ok:
        print("nothing to aggregate")
        return 1

    wins = sum(1 for r in ok if r["s"]["sharpe"] > r["b"]["sharpe"])
    ms = float(np.mean([r["s"]["sharpe"] for r in ok]))
    mb = float(np.mean([r["b"]["sharpe"] for r in ok]))
    mds = float(np.median([r["s"]["sharpe"] for r in ok]))
    mdb = float(np.median([r["b"]["sharpe"] for r in ok]))

    print("\n" + "=" * 68)
    print(f"{'':<22}{'strategy':>12}{'buy & hold':>14}")
    print("-" * 68)
    print(f"{'mean Sharpe':<22}{ms:>12.3f}{mb:>14.3f}")
    print(f"{'median Sharpe':<22}{mds:>12.3f}{mdb:>14.3f}")
    print(f"{'mean ann. return %':<22}"
          f"{np.mean([r['s']['ann'] for r in ok]):>12.2f}"
          f"{np.mean([r['b']['ann'] for r in ok]):>14.2f}")
    print(f"{'mean max drawdown %':<22}"
          f"{np.mean([r['s']['dd'] for r in ok]):>12.2f}"
          f"{np.mean([r['b']['dd'] for r in ok]):>14.2f}")
    print("-" * 68)
    print(f"beats buy & hold on Sharpe: {wins}/{len(ok)} ({wins/len(ok):.1%})")

    # Binomial check on the win rate -- is beating B&H on more than half the
    # names distinguishable from a coin flip?
    import math
    k, n = wins, len(ok)
    z = 1.96
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    print(f"  win-rate 95% CI [{max(0,c-h):.3f}, {min(1,c+h):.3f}]"
          f"  -> {'excludes' if (c-h) > 0.5 or (c+h) < 0.5 else 'includes'} 0.50")

    try:
        import significance as sig
        alls = np.concatenate([np.array(r["strategy_returns"]) for r in ok])
        allb = np.concatenate([np.array(r["benchmark_returns"]) for r in ok])
        m = min(alls.size, allb.size)
        res = sig.bootstrap_metric_diff(alls[:m], allb[:m], metric="sharpe", rf_annual=a.rf)
        print(f"\npooled Sharpe difference {res.difference:+.3f}  "
              f"95% CI [{res.ci_low:+.3f}, {res.ci_high:+.3f}]  p={res.p_value:.3f}")
        print(f"  -> {'SIGNIFICANT' if res.ci_low > 0 else 'not significant'}")
    except Exception as e:
        print(f"(pooled test unavailable: {type(e).__name__}: {e})")

    print("\nCaveat that must accompany these numbers: the universe is drawn from")
    print("names listed in 2026, so every constituent survived the decade.")
    print("Survivorship bias is present and flatters both columns.")

    out = _HERE / "results" / f"universe_{len(ok)}x{int(a.years)}y.json"
    out.write_text(json.dumps(
        {"n_tickers": len(ok), "years": a.years, "profile": a.profile, "rf": a.rf,
         "mean_sharpe_strategy": ms, "mean_sharpe_bh": mb,
         "wins": wins, "per_ticker": [
             {"ticker": r["ticker"], "n": r["n"],
              "s_sharpe": r["s"]["sharpe"], "b_sharpe": r["b"]["sharpe"],
              "s_ann": r["s"]["ann"], "b_ann": r["b"]["ann"],
              "s_dd": r["s"]["dd"], "b_dd": r["b"]["dd"]} for r in ok]},
        indent=2), encoding="utf-8")
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
