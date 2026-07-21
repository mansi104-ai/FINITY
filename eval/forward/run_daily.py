"""Daily forward-test job: predict, seal, and score matured predictions.

Run once per trading day after the US close. Two phases, in this order:

1. **Score** every prediction whose horizon has now elapsed, by joining the
   realised close onto the sealed prediction row.
2. **Predict** for today's completed bar, and seal.

Scoring runs first so a prediction made today can never be scored today.

The lookahead discipline is concrete rather than aspirational:

* ``as_of`` is the last *completed* daily bar. Nothing newer reaches a model.
* The reference close is the close on ``as_of``, recorded in the sealed row,
  so scoring cannot later re-baseline against a different starting price.
* An outcome is only written once ``horizon_days`` *trading* bars have
  actually appeared after ``as_of`` -- never on a calendar estimate, which
  would silently shift with holidays.
* ``store.verify()`` re-checks all of this and fails the run loudly.

Arms
----
``A`` -- numerical only. The existing ``MarketForecaster`` with sentiment
pinned neutral. No language model touches it, so it is the control for
whether the agentic layer adds anything.

``B`` -- full agentic pipeline: Planner -> Router -> Optimizer -> dynamic
fusion, with FinBERT sentiment and a state-conditioned weighting.

Both arms run on the same tickers on the same dates and share a store, so the
comparison is paired within period rather than one arm followed by the other.
That matters more than it sounds: a sequential design confounds any
arm-vs-arm difference with whatever the market did in between.
"""

from __future__ import annotations

import argparse
import random
import sys
import time
import traceback
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parents[1] / "python_agents"))
sys.path.insert(0, str(_HERE))

import pandas as pd  # noqa: E402

from prices import Bars, PriceFetcher  # noqa: E402
from store import Outcome, Prediction, PredictionStore, make_decision_id  # noqa: E402
import universe as U  # noqa: E402

HORIZON_TRADING_DAYS = 5
MIN_BARS = 120          # MarketForecaster needs >=90; keep headroom


# --------------------------------------------------------------------------
# Arm A -- numerical only
# --------------------------------------------------------------------------

def predict_arm_a(bars: Bars, market: Optional[Bars],
                  horizon: int) -> Optional[Dict]:
    """Directional call from the numerical plane. None if it cannot run."""
    from models.market_forecaster import MarketForecaster

    hist = pd.DataFrame({
        "Date": bars.dates,
        "Close": bars.close,
        "Volume": bars.volume if bars.volume else [float("nan")] * len(bars),
    })
    mkt = None
    if market is not None:
        mkt = pd.DataFrame({"Date": market.dates, "Close": market.close})

    t0 = time.perf_counter()
    try:
        out = MarketForecaster().predict(
            hist,
            ticker=bars.symbol,
            # Neutral, fixed query: arm A must not vary with phrasing, or it
            # stops being a clean control for the agentic arm.
            query=f"{horizon} day outlook",
            sentiment_score=0.0,
            sentiment_level="neutral",
            data_source="yahoo-v8",
            market_history=mkt,
        )
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}

    pct = _first_num(out, ("predictedReturnPct", "predicted_return_pct",
                           "expectedReturnPct", "returnPct"))
    conf = _first_num(out, ("confidence", "calibratedConfidence"))
    if pct is None:
        return {"error": f"no return field in forecaster output: {sorted(out)[:8]}"}

    if pct > 0.05:
        direction = "up"
    elif pct < -0.05:
        direction = "down"
    else:
        direction = "flat"

    # Same volatility bucket arm B uses, computed from the same bars, so a
    # per-agent track record is comparable across arms rather than each arm
    # being scored against its own idea of the regime.
    import math
    from orchestrator.fusion import volatility_regime
    cl = bars.close[-61:]
    rets = [(cl[i] - cl[i - 1]) / cl[i - 1] for i in range(1, len(cl))]
    regime = "unknown"
    if len(rets) > 5:
        mu = sum(rets) / len(rets)
        sd = math.sqrt(sum((r - mu) ** 2 for r in rets) / (len(rets) - 1))
        regime = volatility_regime(sd * math.sqrt(252) * 100)

    return {
        "direction": direction,
        "confidence": float(conf) / 100.0 if conf and conf > 1.0 else float(conf or 0.5),
        "predicted_return_pct": float(pct),
        "regime": regime,
        "duration_ms": int((time.perf_counter() - t0) * 1000),
    }


def _first_num(d: Dict, keys) -> Optional[float]:
    for k in keys:
        v = d.get(k)
        if isinstance(v, (int, float)):
            return float(v)
    return None


# --------------------------------------------------------------------------
# Arm B -- full agentic pipeline
# --------------------------------------------------------------------------

# One question, asked of every ticker. Deliberately ticker-free: the forward
# test poses an identical task for all 40 names, so it warrants exactly one
# plan, reused with the symbol injected per dispatch. Templating the ticker
# into the text instead would mint 40 distinct cache keys and burn 40 planner
# calls a day against a 45-call budget, to obtain 40 identical plans.
#
# The wording states the evidence the user cares about. An earlier, terser
# version ("should I add, hold or reduce?") was planned down to analyst+risk
# only, which made arm B degenerate: with a single directional voter the
# renormalised score is +/-1.00 by construction, the position pins to maximum,
# and with no market agent the volatility regime is never resolved. Arm B then
# measured less than arm A rather than more.
#
# Caveat to carry into the write-up: because this query is fixed and names the
# evidence it wants, arm B exercises the Planner's *decomposition* and
# parameter resolution but not much of its *routing discretion*. Routing
# quality is measured separately, on free-form queries.
ARM_B_QUERY = (
    "I hold a position in this stock and need to decide what to do over the "
    "next {h} trading days: add to it, hold it, or reduce it. Tell me what "
    "recent news and sentiment suggest, how the price has been behaving and "
    "how volatile it is, where it is likely headed over that window, and how "
    "much I could lose. I have a moderate tolerance for risk."
)


class ArmB:
    """Planner -> Router -> Optimizer -> dynamic fusion, per ticker."""

    def __init__(self, fetcher, horizon: int) -> None:
        from agents.planner_v2 import PlannerAgent
        from agents.optimizer import OptimizerAgent
        from orchestrator.adapters import build_default_adapters
        from orchestrator.router import Router

        self.horizon = horizon
        self.router = Router(build_default_adapters(fetcher))
        from agents.auditor import MemoryStore
        # Memory is read here and written by the Auditor at the end of the
        # run, so lessons only ever reach the *next* day's decisions.
        self.optimizer = OptimizerAgent(max_iterations=2,
                                        memory=MemoryStore())
        # Planned once, at construction. Cached across days by query text, so
        # this costs one LLM call on the first run and zero thereafter.
        self.template = PlannerAgent().plan(ARM_B_QUERY.format(h=horizon))

    def plan_for(self, ticker: str):
        """Clone the template plan, bound to one ticker.

        Intent and horizon are pinned rather than taken from the plan. We
        authored this query, so both are known facts about the experiment,
        not inferences to be re-derived per run. Pinning them removes two
        failure modes seen in testing:

        * the deterministic fallback classified the query `assess`, which is
          not capital-at-risk, so no risk subtask was added, so fusion
          declined to size any position;
        * the fallback returned a 90-day horizon while the store scores at
          ``--horizon`` trading days, meaning agents reasoned over one window
          and were graded on another.

        The Planner still does the work being measured here: decomposition,
        subtask phrasing, and posture. Only the two facts we already know are
        held fixed.
        """
        import copy
        from contracts import Intent, TaskGraph

        g = TaskGraph(
            intent=Intent.ADVICE,
            tickers=[ticker],
            horizon_days=self.horizon,
            risk_posture=self.template.risk_posture,
            subtasks=copy.deepcopy(self.template.subtasks),
            raw_query=self.template.raw_query,
            planned_by=self.template.planned_by,
            prompt_version=self.template.prompt_version,
            cached=True, rationale=self.template.rationale,
        )
        # ADVICE is capital-at-risk, so this re-attaches the mandatory risk
        # subtask if the template lacked one.
        from agents.planner_v2 import enforce_invariants
        g = enforce_invariants(g)

        for st in g.subtasks:
            st.params["ticker"] = ticker
            st.params["query"] = ticker
            st.params["horizon_days"] = self.horizon
        return g

    def predict(self, ticker: str, as_of: str) -> Dict:
        from contracts import AgentName
        from orchestrator.fusion import fuse, volatility_regime

        t0 = time.perf_counter()
        graph = self.plan_for(ticker)
        results = self.router.dispatch(graph, as_of=as_of)
        results, verdict = self.optimizer.run(graph, results,
                                              router=self.router, as_of=as_of)

        mkt = next((r for r in results
                    if r.agent is AgentName.MARKET and r.usable), None)
        regime = volatility_regime(
            (mkt.payload or {}).get("volatility_annual_pct") if mkt else None)

        decision, fw = fuse(results, regime=regime,
                            risk_posture=graph.risk_posture.value)

        return {
            "direction": decision["direction"],
            "confidence": decision["confidence"],
            "position_pct": decision["position_pct"],
            "action": decision["action"],
            "regime": regime,
            "fusion_weights": fw.weights,
            "agents_used": [r.agent.value for r in results if r.usable],
            # The figures the rationale refers to, so the trace can be checked.
            "agent_evidence": {
                r.agent.value: {k: (round(v, 4) if isinstance(v, float) else v)
                                for k, v in (r.payload or {}).items()
                                if k not in ("ticker",)}
                for r in results if r.usable
            },
            "optimizer_iterations": verdict.iterations,
            "llm_calls": verdict.llm_calls,
            "rationale": (f"{decision['action']} score={decision['score']:+.2f} "
                          f"in {regime}; {verdict.screen_reason}"),
            "duration_ms": int((time.perf_counter() - t0) * 1000),
            # A run where no agent returned evidence is recorded as degraded
            # rather than dropped, so gaps stay visible in the series.
            # Degraded if no agent produced evidence, or if the shared plan
            # itself came from the regex fallback rather than the model.
            # Both are recorded so such days can be excluded from
            # control-plane metrics instead of quietly averaged in.
            "degraded": (not any(r.usable for r in results)
                         or self.template.planned_by == "deterministic-fallback"),
        }


# --------------------------------------------------------------------------
# Scoring
# --------------------------------------------------------------------------

def score_matured(store: PredictionStore, fetcher: PriceFetcher,
                  fetch_date: str, verbose: bool = True) -> int:
    """Write outcomes for predictions whose horizon has elapsed."""
    pending = store.unscored()
    if not pending:
        return 0

    needed = sorted({p["ticker"] for p in pending})
    bars = fetcher.get_many(needed, rng="1y", fetch_date=fetch_date)
    written = 0

    for p in pending:
        b = bars.get(p["ticker"])
        if b is None:
            continue
        i = b.index_of(p["as_of"])
        if i is None:
            continue
        j = i + int(p["horizon_days"])
        # Not enough *trading* bars yet. Calendar arithmetic would mis-fire
        # around holidays, so this waits on real bars.
        if j >= len(b):
            continue

        ref = p.get("ref_close") or b.close[i]
        exit_close = b.close[j]
        ret = (exit_close - ref) / ref
        realized = "up" if ret > 0.0005 else ("down" if ret < -0.0005 else "flat")

        store.append_outcome(Outcome(
            decision_id=p["decision_id"],
            evaluated_at=datetime.now(timezone.utc).isoformat(),
            eval_date=b.dates[j],
            exit_close=float(exit_close),
            realized_return=float(ret),
            realized_direction=realized,
            correct=bool(realized == p["direction"]),
            trading_days_elapsed=int(p["horizon_days"]),
        ))
        written += 1
        if verbose:
            mark = "OK " if realized == p["direction"] else "XX "
            print(f"  {mark} {p['ticker']:6s} {p['as_of']} -> {b.dates[j]} "
                  f"pred={p['direction']:5s} real={realized:5s} {ret:+.2%}")
    return written


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--arms", default="A", help="comma-separated: A,B")
    ap.add_argument("--horizon", type=int, default=HORIZON_TRADING_DAYS)
    ap.add_argument("--root", default=None)
    ap.add_argument("--limit", type=int, default=0, help="cap tickers (smoke test)")
    ap.add_argument("--skip-score", action="store_true")
    ap.add_argument("--skip-audit", action="store_true",
                    help="skip memory curation and post-hoc audit")
    a = ap.parse_args()

    arms = [x.strip().upper() for x in a.arms.split(",") if x.strip()]
    store = PredictionStore(Path(a.root)) if a.root else PredictionStore()
    fetcher = PriceFetcher()
    today = date.today().isoformat()

    man = U.load_manifest()
    syms = U.tickers()[: a.limit] if a.limit else U.tickers()

    # Rotate the order each day, seeded on the date.
    #
    # The Optimizer's LLM allowance can run out partway through a 40-ticker
    # universe, and whatever is processed after that point is adjudicated
    # deterministically instead. Iterating alphabetically would hand the
    # richer treatment to AAPL every single day and never to XOM, making
    # arm B's quality a function of ticker name -- a confound that would
    # survive into the results. A date-seeded shuffle spreads the shortfall
    # evenly across the universe while staying exactly reproducible.
    random.Random(today).shuffle(syms)
    print(f"forward-test {today} | universe {man['hash']} "
          f"({len(syms)}/{man['n_tickers']} tickers) | arms={arms} | h={a.horizon}d")

    if not a.skip_score:
        print("\n-- scoring matured predictions --")
        n = score_matured(store, fetcher, today)
        print(f"   {n} outcome(s) written")

        if n:
            # Recompute per-agent reliability from the full outcome history
            # rather than incrementally from today's batch. The store keeps
            # running counts, so incrementing per run would double-count
            # every outcome on any re-run -- and the daily job is designed
            # to be re-runnable.
            import agent_scores
            from services.reliability import get_reliability_store
            rel = get_reliability_store()
            rel._data = {}          # rebuild from scratch; see above
            res, scored = agent_scores.score(store, record_to_reliability=True)
            print(f"   reliability rebuilt from {scored} outcome(s)")
            for name, regimes in sorted(res["agents"].items()):
                for regime, v in sorted(regimes.items()):
                    if v["accuracy"] is not None:
                        print(f"     {name:<12}{regime:<11}"
                              f"n={v['n']:<4} acc={v['accuracy']:.3f}")

    print("\n-- fetching prices --")
    market = fetcher.get(U.BENCHMARK, rng="2y", fetch_date=today)
    bars = fetcher.get_many(syms, rng="2y", fetch_date=today)
    print(f"   {len(bars)}/{len(syms)} symbols; benchmark "
          f"{'ok' if market else 'MISSING'}")
    if fetcher.errors:
        for s, e in list(fetcher.errors.items())[:8]:
            print(f"   ! {s}: {e}")

    arm_b: Optional["ArmB"] = None
    if "B" in arms:
        print("\n-- building arm B (one shared plan for all tickers) --")
        try:
            arm_b = ArmB(fetcher, a.horizon)
            t = arm_b.template
            print(f"   plan: intent={t.intent.value} h={t.horizon_days}d "
                  f"posture={t.risk_posture.value} "
                  f"agents={[x.value for x in t.agents_used()]} "
                  f"by={t.planned_by.split('/')[-1]} cached={t.cached}")
            if t.planned_by == "deterministic-fallback":
                print("   ! WARNING: planner fell back; arm B is degraded today")
        except Exception as e:
            print(f"   ! arm B unavailable: {type(e).__name__}: {e}")
            arms = [x for x in arms if x != "B"]

    print("\n-- predicting --")
    written = skipped = failed = 0
    for sym in syms:
        b = bars.get(sym)
        if b is None or len(b) < MIN_BARS:
            skipped += 1
            continue
        as_of = b.last_date
        ref = b.last_close

        for arm in arms:
            if arm == "A":
                r = predict_arm_a(b, market, a.horizon)
                meta = dict(pipeline_version="v2-armA-numerical",
                            agents_used=["analyst"], position_pct=0.0,
                            fusion_weights={}, llm_calls=0, degraded=False,
                            regime=(r.get("regime", "unknown")
                                    if r and "error" not in r else "unknown"),
                            agent_evidence=({"analyst": {
                                "predicted_return_pct":
                                    round(r["predicted_return_pct"], 4)}}
                                if r and "error" not in r else {}),
                            rationale=(f"predicted return "
                                       f"{r['predicted_return_pct']:+.2f}%")
                            if r and "error" not in r else "")
            elif arm == "B" and arm_b is not None:
                try:
                    r = arm_b.predict(sym, as_of)
                    meta = dict(pipeline_version="v2-armB-agentic",
                                agents_used=r["agents_used"],
                                position_pct=r["position_pct"],
                                fusion_weights=r["fusion_weights"],
                                llm_calls=r["llm_calls"],
                                degraded=r["degraded"],
                                agent_evidence=r["agent_evidence"],
                                regime=r["regime"],
                                rationale=r["rationale"])
                except Exception as e:
                    r = {"error": f"{type(e).__name__}: {e}"}
                    meta = {}
            else:
                continue

            if r is None or "error" in r:
                failed += 1
                if r and failed <= 5:
                    print(f"   ! {sym} arm{arm}: {r['error'][:90]}")
                continue

            ok = store.append(Prediction(
                decision_id=make_decision_id(as_of, sym, arm, a.horizon),
                created_at=datetime.now(timezone.utc).isoformat(),
                as_of=as_of,
                arm=arm,
                ticker=sym,
                horizon_days=a.horizon,
                direction=r["direction"],
                confidence=r["confidence"],
                ref_close=float(ref),
                intent="advice",
                planner_model=(arm_b.template.planned_by if arm == "B" and arm_b else ""),
                position_pct=meta.get("position_pct", 0.0),
                pipeline_version=meta.get("pipeline_version", "v2"),
                agents_used=meta.get("agents_used", []),
                fusion_weights=meta.get("fusion_weights", {}),
                llm_calls=meta.get("llm_calls", 0),
                degraded=meta.get("degraded", False),
                agent_evidence=meta.get("agent_evidence", {}),
                regime=meta.get("regime", "unknown"),
                rationale=meta.get("rationale", ""),
                duration_ms=r["duration_ms"],
            ))
            written += 1 if ok else 0
            skipped += 0 if ok else 1

    print(f"   wrote {written}, skipped {skipped} (already logged or "
          f"insufficient history), failed {failed}")

    # --- memory maintenance and self-review ---------------------------
    # Curate before auditing: retire what has gone stale first, so today's
    # lessons land in a cleaned store rather than on top of expired ones.
    if not a.skip_audit:
        print("\n-- memory curation --")
        try:
            from agents.auditor import AuditorAgent, CuratorAgent
            cur = CuratorAgent().curate(today)
            print(f"   retired {cur['retired_stale']} stale, "
                  f"{cur['retired_over_cap']} over cap; "
                  f"{cur['active']} active lessons")

            print("\n-- audit --")
            # Review the newest as_of present in the store rather than a
            # particular symbol's last bar: symbols can differ on halts, and
            # indexing off one of them would silently review nothing.
            all_preds = store.predictions()
            latest = max((p.get("as_of") or "" for p in all_preds), default="")
            todays = [p for p in all_preds if p.get("as_of") == latest]
            aud = AuditorAgent().review(todays, on_date=today)
            if aud.get("error"):
                print(f"   skipped: {aud['error']}")
            else:
                print(f"   reviewed {aud['reviewed']} traces, "
                      f"{aud.get('unsound', 0)} judged unsound, "
                      f"{aud['lessons_added']} lesson(s) stored")
                if aud.get("unsound_ids"):
                    print(f"   unsound: {aud['unsound_ids'][:5]}")
        except Exception as e:
            print(f"   ! audit phase failed: {type(e).__name__}: {e}")

    print("\n-- integrity --")
    v = store.verify()
    for k, val in v.items():
        if k != "ok":
            print(f"   {k}: {val}")
    print(f"   OK: {v['ok']}")

    print("\n-- summary --")
    s = store.summary()
    for k, val in s.items():
        print(f"   {k}: {val}")

    return 0 if v["ok"] else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(2)
