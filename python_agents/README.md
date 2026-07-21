# FINDEC v1 -- Adaptive, Explainable Financial Decision Framework

This is the `python_agents` service: a multi-agent pipeline that turns a
free-text investment query into an evidence-backed, explainable
recommendation. It follows the FINDEC v1 design (Planner -> Research
Agent + Market Agent -> Prediction Engine -> Risk Manager -> Risk
Reasoning -> Verification -> Recommendation Generator -> Explanation).

```
User
  |
  v
Planner Agent            -- structured task + which evidence sources are needed
  |
  +---------------+---------------+
  v                               v
Researcher Agent              Market Agent        <- run in parallel
(news + FinBERT sentiment)    (OHLCV + indicators, data only)
  |                               |
  +---------------+---------------+
                  v
          Analyst Agent (Prediction Engine)
          Ridge + classifier ensemble, walk-forward backtested
                  v
     Risk Manager (VaR, position sizing)  ->  Risk Reasoning Agent
     (quantitative)                            (qualitative: "what could
                                                 invalidate this prediction?")
                  v
          Verification Agent
          (cross-checks agents for conflicts / thin evidence)
                  v
     Recommendation Generator
     (evidence-renormalized, trend-aware, reliability-weighted buy
      score -> action + decision trace)
                  v
          Explanation Agent
          (plain-language reasons, risks, missing evidence)
                  v
                User
```

## What this update changes

This pass brought the implementation in line with the FINDEC v1
replanning discussion, in particular:

1. **No synthetic data anywhere in production, including VaR.**
   `risk/var_calculator.py` used to fall back to a hardcoded array of
   invented returns (`[-0.02, -0.01, 0.0, 0.012, 0.02]`) whenever live
   price history wasn't available. That has been removed: VaR now
   returns `dataAvailable: False` when there isn't enough real history
   (< 30 daily returns), and `agents/risk_manager.py` propagates that
   into a `dataAvailable: False` risk result instead of a VaR computed
   from made-up numbers. Every other data source in the pipeline
   (NewsAPI/Finnhub for news, yfinance/Stooq for prices) already
   followed this "real data or explicit unavailable" contract; VaR was
   the one remaining gap.

2. **Agent Reliability (`services/reliability.py`) -- the "most
   important addition" from the design discussion.** Every agent now
   has a persisted, Bayesian-smoothed reliability score, tracked
   per-context (the market's realized-volatility regime: low / medium /
   high / unknown) as well as overall:

   - **Researcher**: quality = confidence, boosted slightly by how many
     resources backed the sentiment call; 0 if no live news was
     available at all.
   - **Analyst**: quality = this request's own walk-forward backtest
     directional accuracy -- a real, freshly-measured number, not a
     guess.
   - **Risk Manager**: quality = whether VaR was actually computed from
     real historical returns, scaled by how many observations backed it.
   - **Market Agent**: quality = whether live (non-stale) price history
     was retrieved.

   `orchestrator/crew.py` reads each agent's *current* reliability
   score **before** recording this request's outcome (so a request is
   never scored using its own result), then uses it to scale that
   agent's contribution to the buy score -- an agent with a strong
   track record gets up to 1.3x its base weight; one with a poor track
   record gets down to 0.6x. This replaces the previous fixed weights
   with the adaptive weighting the design doc describes. The full
   profile is inspectable at `GET /reliability`, and every request's
   response includes an `agentReliability` block plus a decision-trace
   line showing exactly what multiplier was applied and why.

   Persistence is a small JSON file (`FINDEC_RELIABILITY_PATH`, default
   `/tmp/findec_reliability_store.json`). On a normal long-lived server
   this persists across restarts; on serverless (this repo also ships a
   Vercel `index.py`/Dockerfile) `/tmp` is wiped on cold start, so
   reliability there resets periodically -- this is a documented
   limitation, not a silent failure, and every write is wrapped so a
   read-only filesystem degrades to in-memory-only tracking instead of
   crashing a request. Swapping in the MongoDB-backed `Persistence`
   layer shown in the original architecture diagram only requires
   reimplementing `ReliabilityStore._load`/`_save` against Mongo.

3. **Decision trace and explanation stay honest about all of the
   above.** The Recommendation Generator's `decisionTrace` now states
   each agent's reliability score, sample size, context, and the
   resulting weight multiplier next to its point contribution, so the
   final buy score is fully auditable -- nothing about the weighting is
   a black box.

4. **Evidence-renormalized, trend-aware Recommendation Generator.** The buy
   score used to be additive from a 50 anchor, which meant a strong Analyst
   prediction could not move the score far enough to act whenever Researcher
   sentiment was missing (news APIs down, or a reproducible offline backtest that
   can't replay historical news) -- the score stayed pinned near neutral and the
   system never bought. The generator now computes a **reliability-weighted
   average over only the sub-scores whose evidence is actually available** (each
   in [0,100], 50 = neutral), so a missing signal cedes its weight to the others
   instead of anchoring the result. A **trend/regime sub-score** (price vs its
   own recent mean) participates in that average: it keeps the recommendation
   invested through uptrends and flat through sustained downtrends, where the
   short-horizon prediction alone is too noisy to time reliably. Every sub-score,
   weight, and the trend/risk/verification adjustments are still written to
   `decisionTrace`, so the number stays fully auditable. See the decision-model
   constants at the top of `orchestrator/crew.py`.

5. **Ensemble classifier demoted to a tie-breaker.** Measured out-of-sample, the
   logistic direction-classifier was a weaker learner than Ridge and *dragged
   average directional accuracy below Ridge* when allowed to override it freely
   (e.g. 40% on AMZN). It now flips the call away from Ridge only when Ridge is
   near its own decision boundary (a small-magnitude, low-conviction prediction)
   AND the classifier is genuinely confident. With that change the ensemble's
   walk-forward directional accuracy rose to 56.0% (vs Ridge 55.7%) across
   the five bundled tickers.

   > **Caveat (2026-07-21):** that 56.0% is a **full-sample** number, and the
   > tie-breaker rule was designed after observing full-sample results, so it is
   > contaminated by selection. The gap over Ridge (0.3pp on n≈600, SE≈2pp) is
   > also far inside the noise floor -- `eval/phase_c_lab.py` itself warns to
   > "treat directional differences under a few points as noise". **Do not quote
   > 56.0% as evidence the ensemble beats Ridge.** Holdout-only re-measurement
   > with a confidence interval is item 3 of `docs/RESEARCH_PLAN.md`.

### Honest, out-of-sample evaluation of the decision layer

> **RETRACTION (2026-07-21).** An earlier version of this section claimed the
> overlay "beats buy&hold on **Sharpe for 4 of 5 tickers**". **That claim was an
> artifact of a backtest bug and is withdrawn.** `run_strategy` applied the
> exposure decided from `closes[t]` to the return *into* `closes[t]` -- a one-day
> lookahead on every rebalance day, while the SMA baseline it was compared against
> was correctly lagged. Corrected, the overlay **loses to buy&hold**. See
> `docs/RESEARCH_PLAN.md` (defect D1) and `eval/test_no_lookahead.py`, which now
> fails if the bug is reintroduced.

`eval/eval_recommendation.py` backtests the REAL end-to-end pipeline
(`_build_recommendation` fed by the real forecaster and a no-lookahead VaR) with
a strict **tune/holdout split**: all parameters are chosen on the earlier tune
segment (`eval/tune_strategy.py`) and reported on the untouched later holdout.
The overlay is measured as *timing skill* (exposure in [0,1], sized by
conviction and inverse volatility) against buy&hold and a naive SMA(20/50)
baseline.

Holdout, `--profiles high`, AAPL/MSFT/AMZN/TSLA/NVDA, mean Sharpe:

| configuration | strategy | buy&hold | beats B&H |
|---|---|---|---|
| `execution_lag_days=0`, rf=0 — *original, defective* | 0.724 | 0.422 | 4/5 |
| `execution_lag_days=1`, rf=0 — lookahead removed | 0.282 | 0.422 | 2/5 |
| `execution_lag_days=1`, rf=4% — **fully corrected** | **0.192** | **0.312** | **2/5** |

Reproduce with `python eval_recommendation.py --profiles high`.

What survives correction: the overlay still cuts drawdown roughly in half
(-17.8% vs -38.0% for buy&hold) and still beats buy&hold on MSFT and TSLA, the
two down/choppy names. What does not survive: any claim of superior
risk-adjusted return. On this universe and window the pipeline is a
**drawdown-reduction overlay, not an alpha source**, and it is not yet shown to
beat buy&hold at all. AMZN remains the worst case (negative directional edge in
the holdout window).

**None of the differences above are statistically significant.** `eval/significance.py`
(stationary bootstrap, Diebold-Mariano, Hansen SPA) reports:

- **0 of 5** tickers beat buy&hold with a 95% CI excluding zero — same vs SMA.
- Pooled Sharpe difference **−0.162**, 95% CI [−0.752, +0.428], p = 0.599.
- Even MSFT's apparent +0.98 Sharpe edge: 95% CI [−0.787, +2.584], p = 0.258.
- Hansen **SPA p = 1.0000** — no configuration beats the benchmark once the
  parameter search is priced in.

Reproduce with `python significance.py --n-boot 2000`.

The binding constraint is **statistical power**: at n = 398 holdout days, a 95%
CI on a Sharpe difference spans roughly ±1.3 Sharpe units. This universe and
window cannot resolve the effects being claimed, in either direction. Treat every
performance number in this README as descriptive, never inferential.

Everything else in the pipeline (multi-provider news/price fallback with
no fabrication, FinBERT-then-lexicon sentiment, Ridge+classifier
ensemble forecasting with a walk-forward backtest, qualitative Risk
Reasoning, Verification, template/LLM-hybrid Explanation) was already
implemented to spec and is unchanged in this pass.

## Running locally

```bash
cd python_agents
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

`ANTHROPIC_API_KEY`, `NEWS_API_KEY`/`NEWSAPI_KEY`, and `FINNHUB_API_KEY`
are all optional. Every agent that uses them has a deterministic
fallback (see each agent's module docstring), so the service is usable
without any external API key -- just with less-informed research and
planning.

- `GET /health` -- liveness check.
- `POST /run` -- `{query, ticker, budget, risk_profile, version}` ->
  the full pipeline result described above.
- `GET /reliability` -- current per-agent, per-context reliability
  profile (transparency / debugging).

## Evaluation

`../eval/` contains offline evaluation scripts that run against the historical
CSVs in `../eval/data/` (fetched once via `data_fetch.py`) rather than live APIs.
This is intentional -- see the design discussion: historical-CSV evaluation gives
reproducible, comparable results across runs, while production `/run` always
prefers live data and never silently substitutes a CSV or synthetic data for it.

- **`run_all.py` -- one command that runs all three evaluations below, prints a
  plain-English summary, and writes paper-style charts to `eval/results/`**
  (per-ticker growth-of-$1 + drawdown curves, and a cross-ticker dashboard of
  Sharpe / risk-return / directional accuracy). Start here.
- `eval_researcher.py` -- sentiment-lexicon accuracy (no internet; `--demo` or a
  labeled CSV such as Financial PhraseBank).
- `eval_analyst.py` -- walk-forward directional accuracy / MAE of the forecaster.
- `eval_recommendation.py` -- out-of-sample (tune/holdout) backtest of the REAL
  end-to-end decision pipeline vs buy&hold and an SMA baseline.
- `tune_strategy.py` -- picks the decision/overlay parameters on the tune segment
  only, then reports the untouched holdout (keeps "beats the baselines" honest).
- `backtest_lib.py` -- shared metrics (Sharpe/Sortino/drawdown), baselines, and
  the tune/holdout split used by the above.
- `data_audit.py` -- integrity checks on the bundled price CSVs.

Prediction walk-forwards are disk-cached under `eval/.pred_cache/` (gitignored,
derived) so repeated runs/sweeps don't re-pay the multi-minute forecaster
retrain.

## What's intentionally out of scope for v1

Per the design discussion, v1 deliberately does not include: long-term
memory across sessions, portfolio-level (multi-asset) optimization,
autonomous replanning, reinforcement learning, or self-improving agents.
Agent Reliability tracking (above) is the one piece of "learning from
experience" that made the cut for v1, because it's simple, auditable,
and directly serves the explainability goal rather than adding
autonomy for its own sake.
