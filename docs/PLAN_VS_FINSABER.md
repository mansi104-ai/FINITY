# FINDEC positioning against FINSABER and the 2026 evaluation literature

Written after reading FINSABER (arXiv 2505.07078, KDD 2026) and
arXiv 2603.27539. Replaces the speculative positioning in
`STRATEGIC_ASSESSMENT.md` §3 with something grounded in what those papers
actually claim.

---

## 1. What FINSABER actually did

| | |
|---|---|
| Span | 2000–2024; core analysis 2004–2024 |
| Universe | 63–91 symbols per selection strategy, from 7,000+ equities |
| Baselines | Buy-and-Hold, SMA, Bollinger, ARIMA, XGBoost, RL (A2C/PPO/TD3/SAC), LLM (FinMem, FinAgent, FinCon) |
| Survivorship | **Solved properly** — includes delisted S&P 500 constituents via historical constituent lists |
| Look-ahead | Multi-source data aligned to backtest windows |
| Data-snooping | Rolling windows over 20 years, varied selections |
| Licence | Apache-2.0, repo at `github.com/waylonli/FINSABER`, data on HuggingFace |

Headline results: Buy-and-Hold Sharpe **0.703** vs FinAgent **0.241**. Paired
t-tests give **p < 0.001** for LLM underperformance against buy-and-hold, and
neither LLM produces significant alpha (**p > 0.34**). Regime split: FinMem
Sharpe −0.19 bull / −0.97 bear; buy-and-hold +0.61 / −0.28.

**This supersedes essentially all of FINDEC's planned backtest work.** They
have 20 years, real survivorship handling, more baselines, and a
peer-reviewed negative result. Running 200 names × 60 years to reach the same
conclusion would be redundant.

---

## 2. The gap they name themselves

From FINSABER's own limitations:

> "LLM models (GPT-4o) may have encountered training data during pretraining;
> **no adjustment applied**."

This is the opening, and it is not a small one. FINSABER mitigates three
biases that live **in the data**: survivorship, look-ahead, data-snooping. It
does not — and by construction *cannot* — mitigate the bias that lives **in
the model's weights**.

The distinction matters because the two need different remedies:

| Bias | Where it lives | Retrospective fix possible? |
|---|---|---|
| Survivorship | dataset composition | yes — point-in-time constituents |
| Look-ahead | data alignment | yes — window alignment |
| Data-snooping | search procedure | yes — SPA / rolling windows |
| **Parametric contamination** | **model weights** | **no** |

You cannot un-teach a model the 2008 crash by aligning your data windows. The
literature confirms the mechanism: frontier models recall in-window index
closes to within 1% while degrading sharply post-cutoff.

**The only sound remedy is prospective**: make the prediction before the
outcome exists. That is what FINDEC's sealed forward test does, and it is
what no retrospective framework can offer.

---

## 3. FINDEC's defensible claim

> Retrospective bias mitigation is necessary but insufficient for LLM agents.
> Three of the four biases can be removed from the data; the fourth lives in
> the weights and cannot. We give (a) an argument that no retrospective
> protocol can remove it, (b) a prospective protocol that is contamination-free
> by construction, and (c) a quantification of how much data any resulting
> claim would need — which shows the recommendation task is not settleable at
> the sample sizes this literature uses.

Three supporting pieces, all already built:

1. **Sealed prospective forward test** — SHA-256 sealed before outcomes exist,
   tamper-evident, every tripwire tested by provocation, universe hash-frozen,
   paired arms on identical days. 80 predictions logged, 0 scored.
2. **Power quantification** — +0.30 Sharpe needs 19,692 days; our holdout had
   5.9% power; breadth does not rescue it (500 stocks ≈ 2.85 effective
   independent units against 2.08 for five). FINSABER reports p-values but
   does not, on the evidence available, quantify required n.
3. **Our own retracted result** — 0.192 → 0.724 when the one-day lag is
   reintroduced, with regression tests. Credible because it is self-inflicted.

---

## 4. What to do with FINSABER, concretely

**Do not rebuild what they built.** Their harness is Apache-2.0 and their
data is public.

**Adopt, don't compete:**

- Cite FINSABER as the state of the art in retrospective evaluation and adopt
  its baseline set (B&H, SMA, ARIMA, XGBoost, RL) as our comparison set. Their
  numbers become our related-work table.
- Use `FINSABERBt` / `run_iterative_tickers()` as the retrospective arm if a
  backtest is needed at all. Apache-2.0 permits it with attribution.
- **Their future-work list is our contribution list**: they call for
  "cost-efficient model designs" and "incorporate API costs into evaluation".
  We have that measured — 28 LLM calls for 80 decisions, $0 marginal, CPU-only,
  189 ms/article sentiment.

**One caution:** arXiv 2603.27539 already proposes cost metrics (cost per
transaction, token efficiency). Cost is therefore supporting evidence, not the
headline.

---

## 5. Honest scope for tonight

Not achievable before 17:30, and saying so plainly:

- Downloading FINSABER-V2-Data (prices + news + 10-K/10-Q, 2000–2024) —
  multi-GB.
- Integrating FINDEC as a FINSABER strategy and running 20-year backtests.
- Sourcing point-in-time S&P constituents, which their repo does not bundle.

Achievable:

- The positioning above, which is the part that decides whether the paper is
  publishable.
- Planner bug fixed: zero-subtask plans were being rejected into the regex
  fallback on 33% of a labelled set. The intent is the hard part and the model
  got it right; the decomposition is now recovered from the routing prior.

---

## 6. Sequence from here

| Step | Work | Why |
|---|---|---|
| 1 | Verify FINSABER does not already quantify required sample size | If it does, contribution 2 dies |
| 2 | Write §II around FINSABER as SOTA; frame the parametric-contamination gap | The paper's spine |
| 3 | Keep the forward test running; score from 27 Jul | Supplies the prospective result |
| 4 | Report calibration (ECE, Brier) once outcomes exist | Converges far faster than Sharpe |
| 5 | Cite their baseline numbers rather than recomputing | Saves weeks, stronger comparison |

Step 1 is a single careful read of their statistics section and gates
everything else.

---

## 7. The one-line version

FINSABER cleaned the data. Nobody has cleaned the model. That is the paper.
