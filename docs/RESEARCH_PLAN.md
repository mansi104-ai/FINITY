# FINDEC — Path to a Submittable IEEE Paper

Status: **not submittable today.** One P0 defect invalidates every headline
number in the current README. This document is the strict reviewer-perspective
defect list plus the ordered plan to fix it.

Reviewer persona assumed throughout: a quantitative-finance-literate reviewer
for IEEE CIFEr / ICDMW / Big Data, who *will* read the backtest loop.

---

## 0. The defect list (found by audit, ordered by lethality)

### D1 — One-day rebalance lookahead. **FATAL. Invalidates all reported results.**

`eval/eval_recommendation.py::run_strategy` accrues the day's P&L using the
exposure decided *on that same day's close*:

```python
daily_return = (closes[idx] - closes[idx-1]) / closes[idx-1]   # return INTO day idx
if idx >= next_rebalance:
    closes_so_far = closes[: idx + 1]                          # INCLUDES closes[idx]
    exposure = _target_exposure(recommendation, ..., closes_so_far, ...)
day_pnl = daily_return * exposure - cost                       # <-- applied to the SAME day
```

The trend sub-score is `price / mean(last 30 closes)` evaluated at `closes[idx]`,
so on every rebalance day the strategy sizes up *because* the stock rose that
day, and then books that day's rise. This is textbook lookahead on 1 day in 10.

Worse: the SMA baseline in `backtest_lib.py::sma_crossover_curve` is implemented
**correctly** (`exposures[i]` applied to the return from `i` to `i+1`). So the
comparison is systematically rigged in the strategy's favour.

**Measured impact** (holdout, profile=high, 5 tickers):

| variant | mean Sharpe | beats B&H on Sharpe |
|---|---|---|
| as-reported (lookahead) | 0.724 | 4/5 |
| lookahead removed | **0.282** | **2/5** |
| buy & hold | 0.430 | — |

The claim "beats buy&hold on Sharpe for 4 of 5 tickers" **is the bug**. With
correct execution timing the overlay underperforms buy&hold on average.

### D2 — Strategy and baseline are measured over windows offset by one day
Strategy day *k* books the return `closes[min_start+k-1] → closes[min_start+k]`;
`buy_and_hold_segment` books `closes[min_start+lo+j] → closes[min_start+lo+j+1]`.
Off-by-one between the thing and its benchmark.

### D3 — Sharpe computed at risk-free = 0
`backtest_lib.sharpe_ratio` defaults `risk_free_annual=0.0`. The strategy sits
flat ~50–70% of the time (`Exp≈0.3–0.5`) and earns nothing while flat, over a
2022–2026 window where cash paid ~4–5%. Both directions of bias are present and
unquantified. A reviewer will demand rf-adjusted Sharpe and cash accrual on the
unallocated fraction.

### D4 — The headline contribution is never evaluated
`eval_recommendation.py` sets `NEUTRAL_RELIABILITY = {}`, giving every agent a
1.0× multiplier. Adaptive agent-reliability weighting — the stated novelty —
contributes **exactly zero** to every reported number.

### D5 — The winning signal is 1990s momentum, not the contribution
`TREND_WEIGHT_POINTS = 80.0` vs `PREDICTION_WEIGHT_POINTS = 22.0`, and sentiment
is absent in backtest ⇒ the score is **~78 % a price-vs-30-day-mean overlay**.
That is Brock–Lakonishok–LeBaron (1992) / Moskowitz–Ooi–Pedersen (2012). No
ablation separates the multi-agent machinery from the moving average.

### D6 — No significance testing anywhere, and the repo admits it
`phase_c_lab.py:33-40` says *"treat directional differences under a few points as
noise; see step 21 in Phase D for the actual significance test."* Phase D does not
exist. `grep` finds no bootstrap, no p-value, no Diebold–Mariano, no reality check.
Claims resting on 56.0 % vs 55.7 % directional accuracy (n≈600, SE≈2 pp) are
unsupported.

### D7 — Data snooping is uncorrected
`tune_strategy.py` grid = 3×2×2×2 = 24 combos, plus hand-tuned
`PREDICTION_REFERENCE_PCT`, `REGIME_LOOKBACK`, `SIZE_SCORE_LO/HI`,
`BUY_THRESHOLD`, `RISK_SCORE_DAMPEN`, `PROFILE_MAX_EXPOSURE`. Selecting the max
over a grid and reporting it needs Hansen's SPA or White's Reality Check.

### D8 — Sample has no statistical power and is selection-biased
5 tickers, mutually correlated US mega-cap tech, chosen ex-post as survivors,
over one bull-dominated window (2021-07 → 2026-07). Holdout ≈ 375 days each.
`SPY.csv` is bundled but never evaluated.

### D9 — In-sample tuning leaks into the reported ensemble number
README quotes ensemble directional accuracy **56.0 % "across the five bundled
tickers"** — full sample, not holdout. The tie-breaker rule was designed after
observing full-sample results.

### D10 — Zero related-work grounding
One citation in the entire repo (Financial PhraseBank). Planner → Researcher →
Analyst → Risk → Verification → Explanation is the exact topology of published
2024–2026 systems (TradingAgents, FinAgent, FinMem, FinCon, FinRobot). No
positioning, no baseline comparison.

### D11 — The LLM layer is entirely unevaluated
No hallucination rate, no explanation faithfulness, no precision/recall for the
Verification Agent's conflict detection, no human study, no ablation vs the
deterministic fallback. The explainability claim has no measurement behind it.

### D12 — Reliability may never leave its prior in production
`services/reliability.py` persists to `/tmp` JSON; serverless wipes it on cold
start. With `PRIOR_WEIGHT = 4.0`, a store that resets every few requests sits at
the 0.75 prior ⇒ 1.0× multiplier forever ⇒ the adaptive mechanism is inert.

### D13 — No tests, no seeds, no reproducibility artifact
No unit tests for any agent or metric. No RNG seeding. No pinned environment.
No single command that regenerates every number in the paper.

---

## 1. The plan

Ten items, ordered. Items 1–4 are the difference between "desk reject" and
"reviewable". Items 5–7 are the difference between "reviewable" and "accept".

| # | Item | Fixes | Effort |
|---|---|---|---|
| 1 | Correct execution timing + benchmark alignment + rf | D1 D2 D3 | 1 d |
| 2 | Significance & data-snooping testing | D6 D7 | 2 d |
| 3 | Ablation harness — isolate what actually works | D5 D9 | 2 d |
| 4 | Make reliability weighting evaluable | D4 D12 | 3 d |
| 5 | Expand universe & regimes | D8 | 3 d |
| 6 | Evaluate the LLM layer | D11 | 4 d |
| 7 | Related work + one published baseline | D10 | 4 d |
| 8 | Reproducibility artifact | D13 | 2 d |
| 9 | Reframe the paper around honest evaluation | — | 3 d |
| 10 | Write, internal-review, submit | — | 5 d |

### 1. Correct execution timing, benchmark alignment, risk-free rate
Add `execution_lag_days` to `StrategyParams` (default **1**). Restructure
`run_strategy` so P&L accrues *before* the rebalance block. Keep `lag=0` runnable
so the paper can **report the delta as a finding**. Align `buy_and_hold_segment`
to the identical day window. Add `risk_free_annual` and accrue cash on the
unallocated fraction. **Every number in README/CHANGELOG is regenerated after
this. Nothing is quoted until then.**

### 2. Significance & data-snooping testing → new `eval/significance.py`
- Stationary bootstrap (Politis–Romano) CIs on Sharpe differences vs each baseline
- Diebold–Mariano on directional accuracy vs a random-walk sign forecast
- Hansen's SPA over the full `tune_strategy` grid — the honest p-value for
  "beats the baseline" after 24+ configurations
- Report *n*, SE and CI beside every accuracy number; delete any claim whose CI
  crosses zero

### 3. Ablation harness → new `eval/ablation.py`
Cells: trend-only · prediction-only · trend+prediction · +risk · +verification ·
full · reliability-on/off · sentiment-on/off. Plus SMA(20/50) and time-series-
momentum as reference. **If trend-only ≈ full pipeline, report it.** That negative
result is more publishable than a fabricated positive one. Also recompute the
ensemble-vs-Ridge number on holdout only, with a CI (D9).

### 4. Make reliability evaluable
Sequential replay: run the backtest chronologically with a live `ReliabilityStore`
so scores accumulate exactly as in production, then ablate on/off. Add a
`ReliabilityStore` backend that survives restarts (Postgres — the app already has
Neon) so D12 stops being real. If reliability-on does not beat reliability-off
with a CI excluding zero, **cut the claim from the paper** and keep the mechanism
as an engineering/transparency contribution only.

### 5. Expand universe & regimes
≥50 names across GICS sectors, plus SPY/QQQ, plus the NSE names the product
already supports. Add 2018-Q4, 2020-Q1 and 2022 drawdown regimes. Report
per-regime, and report cross-sectional dispersion, not just a 5-name mean.
Address survivorship explicitly (point-in-time index membership, or state it as
a limitation with the bias direction).

### 6. Evaluate the LLM layer
- 200+ hand-labelled cases for Verification conflict detection → precision/recall,
  two annotators, Cohen's κ
- Explanation faithfulness: does every claim in the narrative trace to a value in
  `decisionTrace`? Automated entailment check + human spot-check
- Ablate LLM vs deterministic fallback on decision quality
- Report latency and $/query

### 7. Related work + one published baseline
Positioning table vs TradingAgents / FinAgent / FinMem / FinCon / FinRobot on:
data honesty, lookahead discipline, significance testing, auditability,
reliability weighting. Run **one** of them (TradingAgents is open source) on the
identical universe and split.

### 8. Reproducibility artifact
`pytest` for metrics (known-answer tests on `sharpe_ratio`, `max_drawdown_pct`,
`sma_crossover_curve`, `_historical_var`) and a **regression test that fails if
lookahead is reintroduced** (synthetic series where any lookahead is detectable).
Seed everything. Pin the environment. `make paper` regenerates every table/figure.

### 9. Reframe the paper
Drop *"a multi-agent system that beats buy&hold"* — post-fix, that claim is false.
Adopt:

> **Honest evaluation of LLM multi-agent financial decision systems: how much
> reported performance survives removing lookahead, synthetic fallbacks and
> in-sample tuning.**

Contributions: (i) the honest-evaluation harness; (ii) a quantified case study
showing a 1-day rebalance lookahead alone moves mean Sharpe 0.72 → 0.28 and flips
"beats buy&hold" from 4/5 to 2/5; (iii) the no-synthetic-data / `dataAvailable`
degradation contract; (iv) auditable decision traces; (v) honest negative results
on reliability weighting and on the multi-agent stack vs a plain momentum overlay.
This is a real gap — the agentic-trading literature is full of papers with
exactly the defect we quantify — and we already own the artifact.

### 10. Write and submit
Target: IEEE CIFEr (main) or ICDMW / Big Data workshop. Fall back to a demo track
only if items 4 and 6 slip.

---

## 1b. Results so far

### Item 1 complete — corrected execution timing (2026-07-21)

Holdout, profile=high, 5 tickers, mean Sharpe:

| configuration | strategy | buy&hold | beats B&H |
|---|---|---|---|
| `lag=0`, rf=0 — original, defective | 0.724 | 0.422 | 4/5 |
| `lag=1`, rf=0 — lookahead removed | 0.282 | 0.422 | 2/5 |
| `lag=1`, rf=4% — fully corrected | **0.192** | **0.312** | **2/5** |

Shipped: `execution_lag_days` (default 1) with `lag=0` retained to reproduce the
defect; benchmark windows aligned; risk-free accrual on unallocated capital for
strategy and SMA baseline alike; `eval/test_no_lookahead.py` (9 tests) fails if
the bug returns. Also fixed a latent divide-by-~0 in `sharpe_ratio` — the
zero-variance guard tested `std() == 0`, unreachable in floating point, so a
permanently-flat strategy earning constant rf returned a Sharpe of 7.3e16.

### Item 2 complete — significance testing (2026-07-21)

`eval/significance.py` + `eval/test_significance.py` (17 known-answer/calibration
tests, all passing — including a 30-worthless-configuration grid that SPA
correctly declines to call significant).

**Result: nothing is significant. Not one claim survives.**

| ticker | Sharpe diff vs B&H | 95% CI | p |
|---|---|---|---|
| AAPL | −0.042 | [−1.411, +1.137] | 0.945 |
| MSFT | **+0.978** | [−0.787, +2.584] | 0.258 |
| AMZN | −1.322 | [−2.711, +0.089] | 0.068 |
| TSLA | +0.035 | [−1.176, +1.397] | 0.955 |
| NVDA | −0.267 | [−1.459, +0.834] | 0.636 |
| **pooled** | **−0.162** | [−0.752, +0.428] | 0.599 |

- **0/5 tickers** beat buy&hold with a CI excluding zero. Same vs SMA.
- Hansen **SPA p = 1.0000** over the risk-profile search: no configuration beats
  the benchmark once the search is priced in.
- Even MSFT — the apparent star, +0.98 Sharpe — is indistinguishable from noise.

**The governing constraint is statistical power, and it is the paper's central
point.** With n = 398 holdout days a 95% CI on a Sharpe difference is roughly
±1.3 *Sharpe units*. Detecting a true difference of 0.3 at 80% power needs on
the order of 10–15 years of daily data per name. **Every published result in this
literature reporting ~1–2 years of holdout on a handful of tickers is reporting
noise**, whether or not it also has a lookahead bug. That, not FINDEC's
architecture, is the finding worth publishing.

Consequence for items 3–5: the goal is no longer "find a configuration that
wins". It is to characterise how much data a claim of this kind actually
requires, and to report the negative result cleanly.

### Item 1b complete — power analysis (`eval/power_analysis.py`)

Calibrated to the real holdout: strategy/benchmark correlation **ρ = 0.552**,
benchmark Sharpe +0.314, daily vol 0.0245, n = 398 days. Two independent methods
(Jobson–Korkie/Memmel analytic; Monte Carlo through the actual bootstrap test)
agree closely.

**Required holdout to detect a true Sharpe difference at 80% power:**

| true Sharpe diff | required days | = years |
|---|---|---|
| +0.10 | 177,158 | 703 |
| +0.20 | 44,297 | 176 |
| **+0.30** | **19,692** | **78** |
| +0.50 | 7,093 | 28 |
| +1.00 | 1,778 | 7.1 |

**Power at FINDEC's actual n = 398:**

| true diff | MC power | analytic power |
|---|---|---|
| +0.20 | 1.7% | 4.5% |
| +0.30 | 1.7% | 5.9% |
| +0.50 | 10.0% | 9.7% |
| +1.00 | 25.0% | 26.3% |

**The decisive sentence for the paper: FINDEC's power to detect a +0.30 Sharpe
improvement was 5.9%, against a 5% false-positive rate. The experiment was
incapable of succeeding regardless of what the strategy did.**

### Item 3 complete — ablation (`eval/ablation.py`)

Pooled holdout, lag=1, rf=4%:

| cell | Sharpe | AnnRet% | MaxDD% |
|---|---|---|---|
| full (trend 80 + prediction 22) | 0.166 | 5.47 | −33.04 |
| **trend_only (moving average, no ML)** | **0.228** | 6.78 | −31.64 |
| prediction_only (ML Analyst alone) | **−0.191** | −4.15 | −58.57 |
| equal_weight | 0.007 | 2.61 | −35.00 |
| buy & hold | **0.329** | 9.56 | −53.77 |
| SMA(20/50) | 0.156 | 5.06 | −32.78 |
| TSMOM 12-1 (Moskowitz et al.) | 0.275 | 7.38 | −53.77 |

**0 of 6 pairwise comparisons significant.** Point estimates nonetheless tell a
clear story: removing the ML Analyst *improves* the Sharpe (0.166 → 0.228), and
the Analyst alone is the worst cell in the study (−0.191). Buy & hold beats every
configuration. The trend rule is doing all the work, and it does not beat a
textbook SMA crossover (diff +0.072, p = 0.753) or published TSMOM.

### Item 4 complete — reliability weighting (`eval/reliability_replay.py`)

Chronological replay with a live `ReliabilityStore`; scores genuinely accumulate
(Analyst → 0.553, RiskManager → 0.510 after the run), so the mechanism is active.

| cell | Sharpe | AnnRet% |
|---|---|---|
| reliability OFF | 0.166 | 5.47 |
| reliability ON | 0.183 | 5.83 |

Difference **+0.017**, 95% CI [−0.0035, +0.0437], **p = 0.137 — not significant.**

**Verdict: the "adaptive rather than statically weighted" claim must be removed
from the contribution list.** Reliability weighting stays in the paper as a
transparency/auditability feature (it exposes per-agent trust in the decision
trace, which is real and useful), never as a performance result.

### Item 5 — BLOCKED

Universe expansion to 50+ names cannot proceed: `data_fetch.fetch_history` is
rate-limited by yfinance and the Stooq fallback also fails for new symbols. All
results remain on the 5 bundled tickers. **This is the single biggest remaining
weakness and the first thing a reviewer will attack.** Remedy: bulk-download
point-in-time constituents once (or use a licensed source such as CRSP/WRDS,
which also fixes survivorship bias), cache to `eval/data/`, then re-run
`run_paper.py`. Until then the paper must state n = 5 names prominently in the
abstract and limitations, not bury it.

### Item 8 complete — reproducibility (`eval/run_paper.py`)

One command regenerates every table. Runs the test suite FIRST as a correctness
gate and aborts if the lookahead tests fail — no performance number produced
after a failed lookahead test is trustworthy. Writes
`eval/results/paper_numbers.md`. Verified end-to-end, exit 0.

### Item 7 — see `docs/RELATED_WORK.md`

Positioning table, the classical baselines that must be cited (Brock–Lakonishok–
LeBaron, Moskowitz et al., **Sullivan–Timmermann–White** — the closest
methodological ancestor), the statistics citations, and **two very recent
concurrent papers on look-ahead bias in agentic pipelines (arXiv 2607.04958 and
2601.13770) that must be read before submission.**

### Item 6 — NOT DONE, needs resources I do not have

LLM-layer evaluation (Verification precision/recall, explanation faithfulness)
requires an Anthropic API key and ~200 human-labelled cases with two annotators
for Cohen's κ. The protocol is specified in item 6 of the plan below. **Do not
fabricate these numbers.** If the paper ships without them, the explainability
claim must be stated as a design property, not an evaluated result.

1. No number from before item 1 is ever quoted again.
2. Every comparative claim carries *n*, CI and a p-value corrected for the search.
3. Negative results ship. The lookahead finding is an asset, not an embarrassment.
4. Any component that cannot be evaluated is described as engineering, not
   claimed as a result.
