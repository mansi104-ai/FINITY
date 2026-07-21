# FINDEC — paper blueprint

Content, not LaTeX. Write from this. `?` marks a number or section that does
not exist yet — leave the placeholder rather than guessing.

Every number below without a `?` is measured and traceable to
`eval/results/`. Quote from there, never from prose.

---

## Title

> Forecast Risk, Not Return: Predictability Asymmetry and Evaluation Design
> in Agentic Financial Systems

Alternative if the redesign results land well:
> What Should a Financial Agent Predict? Evidence from 196 Equities

---

## Abstract (points)

- Agentic financial systems almost universally forecast price direction.
- On 196 US equities over 10 years (43,512 out-of-sample observations) we
  measure how predictable different targets actually are from the same
  information set.
- Direction is **anti-predictive**: Spearman IC −0.074; directional accuracy
  0.4875 at h=1 with the 95% interval excluding 0.50 **from below**.
- Realised volatility is strongly predictable: IC **+0.554**, R² 0.286.
  Forward maximum drawdown: IC −0.320.
- **Volatility is 7.4× more predictable than direction, and direction is
  predictable in the wrong sign.**
- We show the consequences in a deployed multi-agent system: sizing that
  conditions on the direction forecast is beaten by a constant-exposure
  portfolio at the same average exposure (Sharpe 0.539 vs 0.381).
- We redesign the Analyst around estimable quantities and report per-output
  evaluation with proper metrics.
- Contribution: a predictability asymmetry, its downstream consequences, and
  an evaluation protocol that would have detected the failure.

---

## I. Introduction

Points to make, in order:

1. Agentic financial systems (TradingAgents, FinRobot, FinMem, FinAgent) are
   evaluated on returns and almost all forecast direction.
2. Recent rigorous evaluation (FINSABER; KDD 2026) finds they do not beat
   buy-and-hold. **Nobody explains the mechanism.**
3. We ask a prior question: *is the quantity these systems predict
   predictable at all?*
4. Answer: no — and a different quantity, available from the same data, is.
5. Contributions:
   - **C1** Predictability asymmetry, measured at scale (§IV).
   - **C2** Its downstream consequences in a working system: every
     conditioning rule tested loses to a constant (§V).
   - **C3** A redesigned Analyst around estimable quantities, with per-output
     evaluation (§VI).
   - **C4** An evaluation protocol that detects this class of failure —
     matched-exposure controls, and sample-size bounds (§VII).

---

## II. Related work

- **Agentic finance:** TradingAgents, FinRobot, FinMem, FinAgent.
- **Rigorous evaluation:** FINSABER (20 years, 63–91 symbols, delisted
  constituents included; B&H Sharpe 0.703 vs FinAgent 0.241, p<0.001).
  arXiv 2603.27539 (evaluation taxonomy, coordination, cost awareness).
  KDD 2026 (arXiv 2505.07078) long-run underperformance.
- **Position honestly:** FINSABER mitigates three biases that live in the
  *data* — survivorship, look-ahead, data-snooping. We address a different
  question (what to predict) and a fourth bias they name but do not close:
  pretraining contamination lives in model *weights* and has no retrospective
  fix.
- **Volatility forecasting:** Corsi (2009) HAR-RV; Bollerslev (1986) GARCH;
  RiskMetrics EWMA; Andersen & Bollerslev (1998) realised volatility;
  Patton (2011) robust loss functions.
- **Statistics:** Politis & Romano (1994) stationary bootstrap; Hansen (2005)
  SPA; White (2000) Reality Check; Diebold & Mariano (1995);
  Jobson & Korkie (1981)/Memmel (2003); Sullivan, Timmermann & White (1999).
- **Baselines:** Brock, Lakonishok & LeBaron (1992); Moskowitz, Ooi &
  Pedersen (2012); Moreira & Muir (2017).

---

## III. System and experimental setup

- Two planes: control (LLM: planner, optimizer, auditor) and decision
  (numerical: market, analyst, researcher, risk, fundamentals). Say why —
  a model that has read the test period recalls rather than forecasts.
- Universe: 196 US large caps, ≥2 per GICS sector, 10 years (2016–2026),
  daily bars.
- Walk-forward, execution lag 1 day, risk-free accrual on uninvested capital,
  transaction costs.
- **State survivorship prominently**: universe selected in 2026, all
  constituents survived. Flatters every column.

---

## IV. What is actually predictable  ← **the core result**

**Table 1.** 43,512 out-of-sample observations, 21-day horizon, 196 tickers.

| Target | Spearman IC | R² |
|---|---:|---:|
| Direction (sign of return) | −0.0744 | 0.014 |
| Magnitude \|return\| | +0.2489 | 0.108 |
| **Realised volatility** | **+0.5543** | **0.286** |
| Forward max drawdown | −0.3199 | 0.084 |

Supporting, from the deployed Analyst (39 tickers, 8,814 decisions):

| Horizon | Accuracy | 95% CI | IC |
|---|---:|---|---:|
| 1 day | 0.4875 | [0.4771, 0.4980] | −0.0257 |
| 5 days | 0.5021 | [0.4916, 0.5126] | −0.0195 |
| 21 days | 0.5073 | [0.4968, 0.5178] | −0.0128 |

Sentences that carry the section:
- "At one day the interval excludes 0.50 from below: the forecast is
  significantly worse than a coin flip."
- "Volatility is 7.4× more predictable than direction, and direction is
  predictable in the wrong sign."
- Exclude volume (IC 0.97) as near-tautological — mention in a footnote only.

---

## V. Consequences in a deployed system

**Table 2 — lookahead correction.** Why the original result was wrong.

| Configuration | Sharpe | B&H | Beats |
|---|---:|---:|---:|
| lag=0 (defective) | 0.724 | 0.422 | 4/5 |
| lag=1 | 0.282 | 0.422 | 2/5 |
| lag=1, rf=4% | **0.192** | 0.312 | 2/5 |

A one-day rebalance offset inflated Sharpe from 0.192 to 0.724 and flipped
the headline 2/5 → 4/5. It read as skill because the baseline *was* correctly
lagged. Nine regression tests now fail if it returns.

**Table 3 — the matched-exposure control.** The key methodological result.

| Arm | Avg exposure | Sharpe | AnnRet % | MaxDD % |
|---|---:|---:|---:|---:|
| Shipped system | 0.42 | 0.381 | 9.97 | −38.0 |
| No position sizing | 0.53 | 0.361 | 10.30 | −51.7 |
| Fixed 10% | 0.05 | 0.361 | 4.96 | −3.8 |
| No vol targeting | 0.44 | 0.387 | 10.65 | −51.7 |
| Always invested | 1.00 | 0.497 | 16.52 | −71.7 |
| Buy & hold | 1.00 | 0.497 | 16.52 | −71.7 |
| **Constant 42%, no timing** | 0.42 | **0.539** | **11.52** | **−33.8** |

Points:
- Always-invested reproduces B&H exactly → the harness is validated.
- The constant control beats the shipped system on **all three** metrics.
- The strategy's drawdown is **4.2pp deeper** than pure delevering.
- **Sharpe is invariant to constant exposure scaling** (constant = B&H,
  0.337 = 0.337 in the 196-ticker run). So risk profiles are a leverage dial,
  not a strategy.
- The apparent drawdown advantage over B&H was delevering, and the timing
  made it worse than delevering alone.

**Volatility targeting** (196 tickers): significantly *worse* than a
constant — t = −8.80, p < 0.0001, winning on 47/196, and the result holds at
leverage caps 1.0/1.5/2.0/3.0. It buys 3.6pp of drawdown reduction at that
cost. Note this appears to contradict Moreira & Muir (2017); the likely
reconciliation is market portfolio vs individual equity. **Verify before
claiming.**

**Table 4 — ablation** (from `paper_numbers.md`): full 0.166, trend_only
0.228, prediction_only **−0.191**, B&H 0.329, SMA 0.156, TSMOM 0.275.
**0 of 6 pairwise comparisons significant.** Removing the ML analyst
*improves* Sharpe.

---

## VI. Redesigning the Analyst  ← **partly `?`**

Principle: **forecast the second moment, be honest about the first, derive
the rest.** P(up), P(DD>x), E[MDD] and IR all follow from one σ̂, which keeps
them mutually consistent and concentrates estimation risk where it can be
measured.

**Table 5 — volatility forecasting.** 20 tickers, 1,900 out-of-sample
forecasts, 21-day horizon. **Rerun at full universe before submission.**

| Model | QLIKE | MSE (1e-8) | Spearman IC | MZ slope | MZ R² |
|---|---:|---:|---:|---:|---:|
| Random walk | −6.5951 | 44.858 | 0.6087 | 0.461 | 0.209 |
| Unconditional mean | **−6.7456** | 36.427 | 0.5751 | 0.872 | 0.139 |
| EWMA (λ=0.94) | −6.7365 | 39.035 | 0.6345 | 0.536 | 0.256 |
| **HAR-RV** | −6.7107 | **35.927** | **0.6546** | **1.138** | 0.190 |
| GARCH(1,1) | ? | ? | ? | ? | ? |

Read this honestly — the models disagree by metric:
- **Unconditional mean wins QLIKE.** Conditional models over-react.
- **HAR-RV wins IC (0.655), MSE, and MZ slope (1.138, nearest unbiased).**
- Random walk is badly biased (MZ slope 0.461) despite decent IC.
- All conditional models beat the random walk on QLIKE.

Sentence: *"HAR-RV is the better forecast by ranking and bias; the
unconditional mean is better by QLIKE. That disagreement is itself a result:
volatility level is hard to pin down, volatility ordering is not."*

Note QLIKE is primary because Patton (2011) shows MAE is not robust to a
noisy volatility proxy.

**Still `?` — not yet run:**
- GARCH(1,1) row
- Range-based estimators (Parkinson / Garman–Klass / Rogers–Satchell) —
  needs an OHLC refetch; current cache has close only
- Derived P(DD > x) calibration
- Confidence calibration / ECE
- Cross-sectional Rank IC
- Abstention risk–coverage curve
- Whether the redesign improves Risk Manager decisions

---

## VII. How much data would settle this?

**Table 6 — required sample.** ρ = 0.552, benchmark Sharpe 0.314, n = 398.

| True Sharpe diff | Days | Years |
|---|---:|---:|
| +0.10 | 177,158 | 703 |
| +0.20 | 44,297 | 176 |
| **+0.30** | **19,692** | **78** |
| +0.50 | 7,093 | 28 |
| +1.00 | 1,778 | 7.1 |

Power at n=398 for +0.30: **5.9% analytic / 1.7% Monte Carlo**.

Breadth does not rescue it: at ρ_cross ≈ 0.35, 500 stocks give ≈2.85
effective independent units against 2.08 for five. 200 × 10y resolves only
≈+0.50.

Sentences:
- "The experiment could not have succeeded whatever the strategy did."
- "Any study reporting one to two years on a handful of correlated tickers is
  underpowered by an order of magnitude."
- **This motivates §IV**: if return claims are unfalsifiable at feasible
  sample sizes, evaluate quantities that converge — volatility forecasts and
  calibration converge in weeks.

Significance for completeness: pooled Sharpe diff −0.162, 95% CI
[−0.752, +0.428], p = 0.599; **0/5** tickers with CI excluding zero; Hansen
SPA **p = 1.0000**.

---

## VIII. Discussion

- Direction is the wrong target; risk is the right one.
- Delevering masquerades as risk management. Always report a matched-exposure
  control.
- Sharpe invariance means risk profiles are leverage settings.
- **Volatility predictability is not profitability.** A good σ̂ improves
  sizing and risk control; it does not generate return. Do not slide.

---

## IX. Limitations

- Survivorship: 2026-listed universe, all survived.
- No historical news or fundamentals → the Researcher cannot participate in
  any backtest; live-only.
- Vol-targeting result conflicts with Moreira & Muir — unresolved.
- The redesign is evaluated only at step 1 (σ̂). Steps 2–4 are `?`.
- Forward test: 80 sealed predictions, **0 scored** as of writing;
  first outcomes 2026-07-27.
- Intent classification 0.692 vs a 0.75 published baseline — below, and
  reported as a component measurement, not a contribution.

---

## X. Conclusion

Two sentences. Direction is not predictable from this information set and
volatility is; systems and evaluations built on the first should be rebuilt
on the second.

---

## Figures

- **Fig 1** — two-plane architecture with the sealing step.
- **Fig 2** — predictability by target (IC bar chart, Table 1). *Most
  important figure in the paper.*
- **Fig 3** — required sample size vs detectable Sharpe, n=398 marked.
- **Fig 4** `?` — reliability diagram for calibrated confidence.

---

## Do not write these

1. "FINDEC outperforms buy-and-hold" — contradicted.
2. "Better than B&H on drawdown **and** return" — return is 3.3× worse.
3. Any Sharpe superiority claim.
4. "Adaptive weighting improves performance" (+0.017, p=0.137).
5. "Sub-second end-to-end" — 786ms cached, 68.5s cold.
6. "FinBERT sentiment in production" — absent on serverless.
7. "Only 7% of investors want advice" — platform-policy artefact.
8. Intent accuracy as a contribution — 0.692 is below baseline.
9. Explainability as an evaluated property — no human study.
10. Any per-agent reliability number from the historical replay —
    Researcher/Market score ≈0.03 because they had no data, not because they
    are unreliable.
