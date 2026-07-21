# Related Work and Positioning

## 1. The systems we are positioned against

| System | Venue / year | Architecture | Holdout reported | Significance testing |
|---|---|---|---|---|
| **TradingAgents** (Xiao et al.) | arXiv 2412.20138 | 7 LLM roles: fundamentals, sentiment, news, technical analysts + bull/bear researchers + trader + risk manager | **2024-01-01 → 2024-03-29 ≈ 62 trading days**, 5 US tech names | None reported |
| **FinMem** (Yu et al. 2023) | — | Layered memory, reflection-driven | Short-horizon, few names | None reported |
| **FinAgent** (Zhang et al. 2024) | — | Multimodal, tool-augmented, memory | Short-horizon, few names | None reported |
| **FinRobot / FinGPT** | — | Open-source LLM finance stack | Varies | None reported |
| **FINDEC (this work)** | — | Planner → Researcher + Market → Analyst → Risk → Risk Reasoning → Verification → Recommendation → Explanation | **398 days × 5 names** | **Bootstrap CI + DM + Hansen SPA** |

### The observation that motivates the paper

TradingAgents — the most-cited system in this class — reports its headline result
over **roughly 62 trading days on 5 correlated US technology stocks**, benchmarked
against Buy&Hold, MACD, KDJ+RSI, ZMR and SMA, with no confidence intervals and no
correction for the choice among those baselines.

Our power analysis (`eval/power_analysis.py`) says that at n = 62, against a
benchmark correlated ~0.55, the power to detect even a **+1.00** Sharpe
improvement is in the low single digits. **The experiment cannot distinguish a
genuinely excellent strategy from a worthless one.** This is not a criticism of
that system's engineering; it is a criticism of the evaluation standard the whole
subfield has converged on, and FINDEC's own prior claims were guilty of exactly
the same thing plus a lookahead bug.

That is the gap this paper addresses. We are not claiming a better trading
system. We are claiming that **the field's current evidentiary standard cannot
support any of the claims being made**, and we supply the artifact, the tests and
the sample-size arithmetic to show it.

## 2. Concurrent work on the same problem — MUST be cited and differentiated

The search surfaced two very recent papers attacking adjacent problems. **Both
post-date this project's design and both must be read before submission**; they
are the strongest threat to novelty and, handled well, the strongest evidence
that the problem is real and timely.

- **"Look-Ahead-Freedom as Temporal Non-Interference: A Verifiable Correctness
  Property for Backtesting and Agentic Trading Pipelines"** — arXiv 2607.04958.
  Formalises look-ahead freedom as a non-interference property. This is the
  *formal-methods* framing of the bug we found empirically.
  **Differentiation:** they define and verify the property; we supply a measured
  case study of what violating it is worth in reported Sharpe (0.72 → 0.19) in a
  real, previously-published-quality agentic system, plus a runnable detector.
  Frame ours as the empirical complement, and cite them as the formal grounding.

- **"A Standardized Benchmark of Look-ahead Bias in Point-in-Time [data]"** —
  arXiv 2601.13770. Notes explicitly that the benchmark "needs to be enriched
  with a broader range of trading agents, such as FinMem, FinGPT, FinRL-DeepSeek,
  TradingAgents, and HedgeAgents."
  **Differentiation:** that is an open invitation. FINDEC is exactly such an
  agent, instrumented. Position this paper as answering that call with a worked
  example, and consider contributing the harness to their benchmark.

- **"The New Quant: A Survey of Large Language Models in Financial Prediction and
  Trading"** — arXiv 2510.05533. Use for the literature framing and to source the
  claim that short-horizon, few-ticker evaluation is the norm rather than the
  exception. **Verify this claim against the survey before asserting it.**

## 3. Classical baselines the paper must beat or acknowledge

The ablation (`eval/ablation.py`) shows FINDEC's decision score is ~78% a
price-vs-30-day-mean rule once sentiment is unavailable. That is not novel and
the paper must say so plainly, citing:

- **Brock, Lakonishok & LeBaron (1992)**, "Simple Technical Trading Rules and the
  Stochastic Properties of Stock Returns", *Journal of Finance* — moving-average
  rules on the Dow.
- **Moskowitz, Ooi & Pedersen (2012)**, "Time Series Momentum", *Journal of
  Financial Economics* — the 12-1 TSMOM baseline implemented in `ablation.py`.
- **Sullivan, Timmermann & White (1999)**, "Data-Snooping, Technical Trading Rule
  Performance, and the Bootstrap", *Journal of Finance* — the canonical
  demonstration that technical-rule performance evaporates under a data-snooping
  correction. **This is the closest methodological ancestor of our paper** and
  the single most important citation: we are doing for LLM agent pipelines what
  Sullivan et al. did for technical trading rules.

## 4. Statistical methodology citations

- **Politis & Romano (1994)**, "The Stationary Bootstrap", *JASA* — block
  resampling under serial dependence.
- **White (2000)**, "A Reality Check for Data Snooping", *Econometrica*.
- **Hansen (2005)**, "A Test for Superior Predictive Ability", *JBES* — the SPA
  test, our primary data-snooping correction.
- **Diebold & Mariano (1995)**, "Comparing Predictive Accuracy", *JBES*.
- **Harvey, Leybourne & Newbold (1997)** — small-sample correction to DM.
- **Jobson & Korkie (1981)** and **Memmel (2003)** — variance of the difference
  of two correlated Sharpe ratios; the basis of our analytic power calculation.
- **Lo (2002)**, "The Statistics of Sharpe Ratios", *FAJ* — Sharpe standard errors.
- **Bailey & López de Prado (2014)**, "The Deflated Sharpe Ratio" — the
  multiple-testing-aware Sharpe; a natural robustness addition if a reviewer asks
  for one beyond SPA.

## 5. Honest statement of what we do NOT claim

1. We do not claim FINDEC beats any baseline. It does not, and we show it cannot
   be shown either way at this sample size.
2. We do not claim other systems' results are *wrong* — only that they are
   **unfalsifiable at the sample sizes reported**, which is a different and
   defensible claim. We have not re-run any other system.
3. We do not claim the lookahead bug we found exists in any other system. We found
   it in ours. We claim only that it is easy to introduce, invisible to ordinary
   review, worth ~0.5 Sharpe when introduced, and that the field lacks routine
   tests for it.

Point 2 is the one a reviewer will push hardest on. Keep the wording disciplined
throughout: **"underpowered", not "false"**.
