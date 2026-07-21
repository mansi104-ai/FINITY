# FINDEC v9 — blueprint in the v8 paper format

Same structure as FINDEC_v8 (IEEE conference, 8 sections). Content replaced
with what today's experiments actually support.

`?` = not yet measured; leave the placeholder.

---

## What must be removed from v8

| v8 text | Why it goes |
|---|---|
| "pooled directional accuracy 55.7%, p = 0.006" | 5 tickers / 600 steps. At 39 tickers / 8,814 decisions accuracy is 0.4875 with CI [0.4771, 0.4980] — excluding 0.50 **from below**. Removing TSLA+NVDA already dropped it to 50.3%. |
| "drawdown cut from −66% to −9%… strongest and most consistent result" | It is delevering. A constant-exposure control at the same average exposure beats the system on Sharpe, drawdown *and* return. |
| Table III as evidence of the sizing policy | Model returns are negative on 3/5 tickers. The drawdown column is the delevering artefact. |
| "under 1.3 seconds end to end" | 68.5 s cold; 786 ms only with a cached plan. |
| "Recency-weighted Lexicon" as the sentiment method | FinBERT is wired in the shipped code; the lexicon is the fallback. |
| Contribution list ("risk-aware recommendation framework…") | Reframe: the contribution is the measurement, not the system. |

**Keep from v8:** Section VI-E (data requirements) — it is the best part of
the paper and today's work sharpens it. Also keep the GBM-fallback removal
paragraph in IV-B-3; it is honest and reviewers respect it.

---

## Title

> What Should a Financial Agent Predict? Measured Predictability Asymmetry in
> Multi-Agent Investment Systems

---

## Abstract (points, ~200 words)

- Multi-agent financial systems almost universally forecast price direction.
- We measure, on 196 US equities over 10 years (43,512 out-of-sample
  observations), how predictable different targets are from the same
  information set.
- **Direction is anti-predictive:** Spearman IC −0.074; directional accuracy
  0.4875 at one day, 95% CI [0.4771, 0.4980], excluding chance from below.
- **Realised volatility is strongly predictable:** IC +0.554, R² 0.286.
  Forward maximum drawdown: IC −0.320.
- We trace the consequence through a deployed three-agent system: every
  sizing rule that conditions on the direction forecast is beaten by a
  constant-exposure portfolio at the same average exposure (Sharpe 0.539 vs
  0.381), and volatility targeting is significantly worse than a constant
  (t = −8.80, p < 0.0001, 196 tickers).
- One mechanism does work: **abstention**. Accuracy rises monotonically from
  52.05% to 57.54% as coverage falls from 100% to 10%, every interval
  excluding chance.
- Contribution: a predictability asymmetry, the matched-exposure control that
  exposes delevering disguised as risk management, and sample-size bounds
  showing when such claims are decidable.

---

## I. Introduction

1. Retail investors lack the specialist split (research / quant / risk) that
   institutions have — keep v8's opening, it works.
2. Multi-agent systems (FinRobot, TradingAgents, FinGPT) automate it, and
   nearly all forecast **direction**.
3. Recent rigorous evaluation finds they do not beat buy-and-hold. Nobody
   explains the mechanism.
4. We ask the prior question: *is direction predictable at all from this
   information set?*
5. Contributions:
   - **C1** Predictability asymmetry across five targets, measured at scale.
   - **C2** Downstream consequence: every conditioning rule tested loses to a
     constant-exposure control.
   - **C3** Abstention as the one mechanism that survives.
   - **C4** Evaluation protocol: matched-exposure controls and sample-size
     bounds.

---

## II. Related Work

Keep v8's four subsections; update contents.

- **A. Multi-agent financial systems** — TradingAgents, FinRobot, FinGPT as
  in v8. Add: all forecast direction.
- **B. Evaluation methodology** — *expand this.* FINSABER (20 years, 63–91
  symbols, delisted constituents; B&H Sharpe 0.703 vs FinAgent 0.241,
  p<0.001); KDD 2026 long-run underperformance; evaluation-taxonomy work.
  Keep the Sullivan–Timmermann–White data-snooping point from v8.
- **C. Sentiment** — shorten. It is no longer central.
- **D. Volatility forecasting** — *new subsection.* HAR-RV (Corsi 2009),
  GARCH (Bollerslev 1986), RiskMetrics EWMA, realised volatility (Andersen &
  Bollerslev 1998), robust loss functions (Patton 2011).

---

## III. System Architecture

Keep v8 largely intact — three tiers, ports, Docker. Shorten to ~2/3 length;
the architecture is no longer the contribution. Drop the version-gating
detail (v1–v4), which costs space and adds nothing to the argument.

---

## IV. Agent Design

- **A. Researcher** — shorten heavily. State FinBERT-first with lexicon
  fallback (correct the v8 text). State plainly that no historical news
  archive exists at this tier, so the Researcher **cannot participate in any
  backtest** and is live-only. That is a scoping statement, not an apology.
- **B. Analyst** — keep the feature description. **Keep the GBM-fallback
  removal paragraph verbatim**; it is the strongest writing in v8.
- **C. Risk Manager** — keep the sizing equations, because §VI now tests them
  and finds them dominated. Frame as "the policy under test".

---

## V. Orchestration Pipeline

Compress v8's version into one paragraph. Space is needed in §VI.

---

## VI. Evaluation ← **the paper**

### A. What is predictable  (new; the core table)

**Table I.** 196 tickers, 10 years, 43,512 out-of-sample observations,
21-day horizon.

| Target | Spearman IC | R² |
|---|---:|---:|
| Direction (sign of return) | −0.0744 | 0.014 |
| Magnitude \|return\| | +0.2489 | 0.108 |
| **Realised volatility** | **+0.5543** | **0.286** |
| Forward maximum drawdown | −0.3199 | 0.084 |

**Table II.** Deployed Analyst, 39 tickers, 8,814 decisions.

| Horizon | Accuracy | 95% CI | IC |
|---|---:|---|---:|
| 1 day | 0.4875 | [0.4771, 0.4980] | −0.0257 |
| 5 days | 0.5021 | [0.4916, 0.5126] | −0.0195 |
| 21 days | 0.5073 | [0.4968, 0.5178] | −0.0128 |

Sentence: *"Volatility is 7.4× more predictable than direction, and direction
is predictable in the wrong sign."*

### B. Consequences for position sizing  (replaces v8 VI-C)

**Table III.** Ablation with a matched-exposure control. 10 tickers, 10 years.

| Arm | Avg exp | Sharpe | AnnRet % | MaxDD % |
|---|---:|---:|---:|---:|
| Full system | 0.42 | 0.381 | 9.97 | −38.0 |
| No position sizing | 0.53 | 0.361 | 10.30 | −51.7 |
| Fixed 10% | 0.05 | 0.361 | 4.96 | −3.8 |
| No volatility targeting | 0.44 | 0.387 | 10.65 | −51.7 |
| Always invested | 1.00 | 0.497 | 16.52 | −71.7 |
| Buy & hold | 1.00 | 0.497 | 16.52 | −71.7 |
| **Constant 42%, no timing** | 0.42 | **0.539** | **11.52** | **−33.8** |

Points:
- Always-invested reproduces buy-and-hold exactly → harness validated.
- The control beats the system on **all three** metrics.
- System drawdown is **4.2 pp deeper** than pure delevering.
- Sharpe is **invariant to constant exposure scaling** → risk profiles are a
  leverage dial, not distinct strategies.
- Volatility targeting across 196 tickers: **t = −8.80, p < 0.0001**, winning
  on 47/196, robust to leverage caps 1.0–3.0. Buys 3.6 pp of drawdown at that
  cost.
- **The methodological point:** comparing only against buy-and-hold cannot
  detect this, because delevering presents as risk management.

### C. Abstention  (new; the positive result)

**Table IV.** 5,700 out-of-sample decisions.

| Coverage | n | Accuracy | 95% CI |
|---:|---:|---:|---|
| 100% | 5,700 | 0.5205 | [0.5075, 0.5335] |
| 75% | 4,275 | 0.5273 | [0.5123, 0.5422] |
| 50% | 2,850 | 0.5375 | [0.5192, 0.5558] |
| 25% | 1,425 | 0.5621 | [0.5362, 0.5877] |
| **10%** | **570** | **0.5754** | **[0.5345, 0.6154]** |

Monotone; **every interval excludes 0.50**.

Sentence: *"The Analyst cannot predict direction, but it can rank its own
reliability. An agent that forecasts poorly can still know when to decline."*

### D. Volatility forecasting  (new)

**Table V.** 5,700 forecasts, 21-day horizon, QLIKE primary (Patton 2011 —
MAE is not robust to a noisy volatility proxy).

| Model | QLIKE |
|---|---:|
| Random walk | −6.7245 |
| HAR-RV | −6.7890 |
| **EWMA (λ=0.94)** | **−6.8231** |
| GARCH(1,1) | ? |

Report honestly: HAR beats the random walk but **EWMA beats HAR**. Derived
P(drawdown > 10%) beats the base rate only marginally (Brier 0.1279 vs
0.1288) and is structurally miscalibrated — worst bin gap 0.215, slope
−0.053/bin — overstating risk precisely where it predicts risk to be high.

### E. Data requirements  (keep v8's VI-E, sharpened)

| True Sharpe diff | Days | Years |
|---|---:|---:|
| +0.30 | **19,692** | 78 |
| +0.50 | 7,093 | 28 |
| +1.00 | 1,778 | 7.1 |

Power at n = 398 for +0.30: **5.9%**. Breadth does not rescue it — at
cross-sectional correlation 0.35, 500 stocks give ≈2.85 effective independent
units against 2.08 for five.

Also report: pooled Sharpe difference −0.162, 95% CI [−0.752, +0.428],
p = 0.599; **0/5** tickers with CI excluding zero; Hansen SPA **p = 1.0000**.

And the lookahead correction, as a cautionary result: a one-day rebalance
offset inflated mean Sharpe from **0.192 to 0.724** and flipped the headline
from 2/5 to 4/5, presenting as skill because the baseline *was* correctly
lagged. Nine regression tests now guard it.

---

## VII. Discussion

- Direction is the wrong target; risk is the right one.
- **Delevering masquerades as risk management** — always report a
  matched-exposure control.
- Abstention is the mechanism that survives, and it fits the agentic framing:
  agents that emit calibrated estimates with explicit abstention can be
  audited; agents that emit BUY/SELL cannot.
- Keep v8's auditability argument for keeping LLMs out of the analytical path.
- **Volatility predictability is not profitability.** A good σ̂ improves
  sizing and risk control; it does not generate return.

---

## VIII. Conclusion

Two or three sentences. Direction is not predictable from this information
set and volatility is; systems and evaluations built on the first should be
rebuilt on the second; the one mechanism that survives is knowing when to
abstain.

---

## Figures

- **Fig 1** — three-tier architecture (reuse v8's).
- **Fig 2** — agent signal flow (reuse v8's, update the Analyst box to emit a
  distribution rather than a direction).
- **Fig 3** — **replace the TSLA equity chart.** It illustrates a result that
  is now known to be delevering. Use instead: predictability by target (IC bar
  chart from Table I). This is the most important figure in the paper.
- **Fig 4** — accuracy vs coverage (Table IV).

---

## Limitations to state explicitly

- Survivorship: universe selected in 2026, all constituents survived.
- No historical news or fundamentals → Researcher is live-only.
- Volatility-targeting result appears to conflict with Moreira & Muir (2017);
  likely market-portfolio vs single-stock, **unverified**.
- Forward test: 80 sealed predictions, **0 scored** at time of writing.
- Intent classification 0.692 vs a 0.75 published baseline — reported as a
  component measurement, not a contribution.
