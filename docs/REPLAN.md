# FINDEC — replan for acceptance and for a product

Follows `docs/STRATEGIC_ASSESSMENT.md`, which found that the evaluation-protocol
and "LLM agents don't beat the market" contributions are already published
(FINSABER; arXiv 2505.07078 at KDD 2026; arXiv 2603.27539).

This document proposes a different question to ask. It is a proposal, not a
decision, and §6 lists what would falsify it.

---

## 1. The diagnosis

Three facts we have established, which have not been put together:

1. **Users rarely ask for recommendations.** Of 29,242 real retail-investor
   questions, explain/interpret is 47.5% and screening 27.8% — together
   **75.3%**. Advice-seeking was excluded by platform policy at ≈7.4% of the
   raw draw, and that is a floor.
2. **The recommendation task cannot be won at achievable sample sizes.**
   Detecting a +0.30 Sharpe improvement needs ~19,692 trading days. Our
   holdout had 5.9% power. Breadth does not fix it: 500 stocks give ~2.85
   effective independent units against 2.08 for five.
3. **Nobody wins it.** KDD 2026 evaluated LLM investing strategies over a
   large universe and long horizons; most fail to beat buy-and-hold.

Put together: **the field is competing on a task that users seldom request,
that no one has won, and that cannot be measured to a conclusion within a
publication cycle.**

FINDEC has been competing on that task too. That is the actual problem — not
sample size, not architecture.

---

## 2. The proposed reframe

> Evaluate financial agents on the tasks users actually ask, and choose the
> ones where ground truth exists.

The pivot: **screening and explanation are verifiable; return prediction is
not.**

### Screening has exact ground truth

"Show me stocks at 52-week highs" has a computable answer. So does "what
stocks have a negative beta", "which names are down more than 20% from their
high", "show me low-volatility dividend payers". Given a price database, the
correct set is *deterministic*.

That means precision, recall and F1 against exact ground truth — no waiting
years for returns, no bootstrap, no power problem. A benchmark of a few
hundred such queries is buildable in days and is **fully reproducible**.

This is the single biggest change in what is measurable. It converts the
project from "we cannot demonstrate anything for 78 years" to "we can
demonstrate correctness this week."

### Explanation is checkable by attribution

"Why is ASML up today?" cannot be graded on truth of causation, but it can be
graded on **faithfulness**: does every factual claim in the answer appear in
the retrieved evidence, and is the evidence real and correctly dated? That is
measurable, and it is exactly what the sealed trace already records.

### Where the existing work is reused, not discarded

| Asset | New role |
|---|---|
| Power analysis | The argument for *why* the recommendation task is the wrong benchmark. Becomes motivation rather than a null result. |
| Lookahead defect + measurement | Evidence that even the measurable part of the old task was being measured wrongly. |
| Sealed forward test | Still runs; supplies the recommendation-task result as a secondary, honestly-underpowered section. |
| Planner + taxonomy | Becomes central: routing a query to the right verifiable task is the system's job. |
| Router, Optimizer, fusion | Unchanged; now evaluated on screen precision/recall rather than Sharpe. |
| Blankespoor grounding | Becomes the paper's opening argument rather than a limitation. |

Nothing built today is wasted. The claims move; the code does not.

---

## 3. Why this is plausibly novel

The cited 2026 work all evaluates **investing performance**: FINSABER
mitigates bias in strategy backtests; the KDD paper measures returns;
arXiv 2603.27539 evaluates multi-agent coordination and cost.

None of them, on the evidence available, asks whether return prediction is
the right task to evaluate at all, or proposes verifiable substitutes drawn
from observed user demand.

**This is unverified.** §6 says how to check it before committing.

---

## 4. What to build

Ordered by value per unit of effort.

**B1 — Screening benchmark (highest value, ~2–3 days).**
Take the screen-type queries from the taxonomy, express each as a
deterministic predicate over the bundled price data, and generate ground-truth
answer sets. Measure the pipeline's precision/recall/F1. Include adversarial
cases (empty results, ambiguous thresholds, "roughly", "about 20%").
Fully reproducible, no API dependence, no waiting.

**B2 — Explanation faithfulness (~3–4 days).**
For explain-type queries, check every factual claim in the answer against the
retrieved evidence. Report attribution precision, unsupported-claim rate, and
evidence-date validity. The trace already stores what is needed.

**B3 — Held-out intent set (hours).**
Still required — the current 0.923 is tuning-set performance. Now more
important, because routing is central to the reframe rather than incidental.

**B4 — Calibration on the forward test (~1 day, once outcomes exist).**
ECE, Brier, reliability diagram. Converges far faster than Sharpe and is a
current metric.

**B5 — Abstention / selective prediction (~1 day).**
Already implemented behaviourally: fusion returns `hold` on mixed evidence and
refuses to size without a risk estimate. Measure accuracy-versus-coverage.

Deliberately **not** on this list: the 200-stock × 60-year study. It is weeks
of work, needs CRSP/WRDS for survivorship, and its most likely outcome is
confirming a null that KDD 2026 already published.

---

## 5. Why this is also the better product

The market case follows the same logic as the research case.

- **"Our AI picks stocks" is a bad product**: it is regulated advice, it does
  not work, and the user cannot tell whether it worked for months.
- **"Our AI explains and finds things" is a good product**: it is what 75% of
  users ask for, it is verifiable immediately, and correctness is visible in
  seconds rather than quarters.

It also fits what is already built: the chat surface, the trace with cited
evidence, the links into existing screener/market pages. The Researcher and
Market agents matter more; the Analyst's directional forecast becomes one
input among several rather than the point.

And it reframes the honest weakness. "We do not claim to predict returns"
stops being an apology and becomes a positioning statement — with the power
analysis as the reason.

---

## 6. What would falsify this plan

Check these before committing. In order:

1. **Read FINSABER and arXiv 2505.07078 in full.** If either already argues
   for verifiable substitute tasks, this reframe is also crowded.
2. **Search specifically** for financial screening benchmarks and explanation
   faithfulness in finance. If a screening benchmark already exists, B1 becomes
   "we evaluate on X" rather than a contribution.
3. **Check arXiv 2603.27539's taxonomy** against ours. Overlap in the
   query-type taxonomy would weaken the opening argument.
4. **Sanity-check B1's difficulty.** If the pipeline scores ~0.99 F1 on
   screening, the task is too easy to be interesting and the contribution
   collapses to an engineering report. Run a pilot on ~20 queries first.

Item 4 matters as much as the novelty checks: a benchmark nobody can fail is
not a benchmark.

---

## 7. Suggested sequence

| Step | Output | Gate |
|---|---|---|
| 0 | Read the two papers; run the two searches | Stop if the reframe is occupied |
| 1 | B1 pilot, ~20 screening queries | Stop if F1 > 0.95 — too easy |
| 2 | B1 full benchmark + B3 held-out intent | First real, reproducible result |
| 3 | B2 explanation faithfulness | Second result |
| 4 | B4/B5 once forward-test outcomes land (27 Jul onward) | Third, secondary |
| 5 | Write, with the recommendation task as a secondary section | — |

The forward test keeps running throughout at no marginal cost; it supplies
step 4 whenever it is ready and does not gate anything before it.

---

## 8. Honest summary

The current paper is a weaker version of work already published. The proposed
paper asks a question that the published work does not, and it is measurable
in days rather than decades.

Neither the novelty of the reframe nor the difficulty of the screening task
has been verified. Both checks are cheap, and both come before any writing.
