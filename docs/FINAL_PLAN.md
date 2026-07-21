# FINDEC — final writing plan

No new experiments. No FINSABER integration. Everything below is already
measured and in `eval/results/paper_numbers.md`.

Write in the order given. If you run out of time, stopping after §IV still
leaves a coherent paper.

---

## Locked framing

**Title**

> Retrospective Bias Mitigation Is Not Enough: Parametric Contamination and
> Sample-Size Limits in LLM Financial Agents

**The one-sentence thesis** (put it in the abstract and the intro, near-verbatim)

> Existing frameworks remove bias from the *data*; the remaining bias lives in
> the model's *weights*, cannot be removed retrospectively, and the task on
> which these systems are judged cannot be settled at the sample sizes the
> field uses.

**Three contributions. No more.**

1. **C1 — Parametric contamination.** Survivorship, look-ahead and
   data-snooping have retrospective fixes. Pretraining contamination does not:
   you cannot un-teach a model an outcome by aligning data windows. We
   describe a prospective protocol — predictions sealed before outcomes exist
   — that removes it by construction, and report its design and integrity
   guarantees.
2. **C2 — Sample-size limits.** Detecting a +0.30 Sharpe difference needs
   ~19,692 trading days. Our holdout had 5.9% power. Breadth does not rescue
   it: 500 stocks give ~2.85 effective independent units against 2.08 for five.
3. **C3 — A measured lookahead defect, self-retracted.** A one-day rebalance
   offset moved mean Sharpe from 0.192 to 0.724 and flipped the headline from
   2/5 to 4/5, presenting as skill because the baseline was correctly lagged.

**Dropped — do not write these.**

- Intent-classification accuracy (0.692, below the 0.75 baseline).
- Cost efficiency as a contribution (arXiv 2603.27539 covers it). One prose
  sentence only.
- Adaptive weighting as performance (+0.017, p = 0.137). Transparency only.
- Any claim FINDEC forecasts well.
- "Under 1.3 seconds end-to-end." Dead.

---

## Section plan

### §I Introduction — 0.75 p
Open with the field's position: LLM agents are evaluated on return
prediction, and recent work finds they do not beat buy-and-hold. Note the
best current framework mitigates three data biases but states plainly that no
adjustment was applied for pretraining exposure. That is the gap. State C1–C3.

### §II Related work — 0.6 p
FINSABER as state of the art in retrospective mitigation — say so generously,
it strengthens the gap argument. Then arXiv 2603.27539 (multi-agent evaluation
taxonomy, cost), the KDD long-run result, and the lookahead-detection papers.
Position as **complementary, not competing**: they clean the data, we address
what remains in the weights.

Then the statistical lineage in one sentence: Sullivan–Timmermann–White for
data snooping, Politis–Romano for the bootstrap, Hansen for SPA,
Jobson–Korkie/Memmel for Sharpe-difference variance. These are methods
citations; they signal rigour.

### §III The contamination argument — 0.7 p  ← the paper's spine
Four biases, three fixable retrospectively, one not. Use the table (T1 below).
Give the mechanism: a model that has seen the test period recalls rather than
forecasts. Conclude that only a prospective protocol closes it, and define
prospective precisely — the prediction is committed before the outcome exists.

### §IV Architecture and protocol — 1.1 p + Fig 1
Control plane vs decision plane, and why the split exists (the LLM is confined
to deciding *what work to do*, never *what the market will do*). Then the
protocol: SHA-256 sealing before outcomes exist, append-only, idempotent on
(as_of, ticker, arm, horizon), outcomes as separate rows joined by
decision_id, hash-frozen universe, paired arms on identical days, and every
tripwire tested by deliberate provocation.

**Stop here if time runs out.** §I–§IV is a coherent position paper.

### §V Sample-size limits — 0.8 p + Fig 2
Required-n table, power at n=398, and the effective-independent-units result.
The sentence to land: *the experiment could not have succeeded whatever the
strategy did.* Then generalise: any study reporting one to two years on a
handful of correlated tickers is underpowered by an order of magnitude.

### §VI Results — 1.0 p + T2, T3
Lookahead correction, then significance, then ablation. Every point estimate
carries "none significant" in the same sentence. Report the forward test as
*deployed and accruing*, with n sealed and 0 scored — state it, do not hide it.

### §VII Limitations — 0.4 p
Five tickers, 1.6 years. Forward test has no outcomes yet. Intent accuracy
below baseline. Reliability weighting not a performance result. Sentiment
unavailable on the serverless deployment.

### §VIII Conclusion — 0.15 p
Two sentences. Retrospective mitigation is necessary and insufficient; the
prospective protocol and the sample-size bound are what remain.

---

## Tables and figures — 3 tables, 2 figures

**T1 — the four biases** *(build this one; it is the argument)*

| Bias | Lives in | Retrospective fix |
|---|---|---|
| Survivorship | dataset composition | yes — point-in-time constituents |
| Look-ahead | data alignment | yes — window alignment |
| Data-snooping | search procedure | yes — SPA, rolling windows |
| **Parametric contamination** | **model weights** | **none** |

**T2 — lookahead correction and significance** (merge; saves half a page)

| Configuration | Sharpe | B&H | Beats |
|---|---:|---:|---:|
| lag=0, rf=0 (defective) | 0.724 | 0.422 | 4/5 |
| lag=1, rf=0 | 0.282 | 0.422 | 2/5 |
| lag=1, rf=4% (corrected) | **0.192** | 0.312 | 2/5 |

Pooled diff vs B&H **−0.162**, 95% CI [−0.752, +0.428], p = 0.599.
Hansen SPA **p = 1.0000**. **0/5** with CI excluding zero.

**T3 — ablation** (7 rows, from paper_numbers.md). Caption must carry
"0 of 6 pairwise comparisons significant."

**Fig 1** — two-plane architecture with the sealing step.
**Fig 2** — required sample size vs detectable Sharpe difference, n = 398
marked. Most persuasive image in the paper; make it if you make only one.

---

## Six sentences that must be exactly right

1. "A one-day rebalance offset inflated mean Sharpe from 0.192 to 0.724 and
   flipped the reported outcome from 2/5 to 4/5; it presented as skill because
   the baseline was correctly lagged."
2. "Detecting a +0.30 Sharpe improvement at 80% power requires approximately
   19,692 trading days; our holdout of 398 days had 5.9% power."
3. "Cross-sectional breadth does not resolve this: at an average pairwise
   correlation of 0.35, 500 stocks provide roughly 2.85 effective independent
   units against 2.08 for five."
4. "Zero of five tickers beat buy-and-hold with a confidence interval
   excluding zero, and Hansen's SPA returns p = 1.0000 once the search is
   priced in."
5. "Survivorship, look-ahead and data-snooping bias reside in the dataset and
   admit retrospective correction; pretraining contamination resides in the
   model's parameters and does not."
6. "Predictions are committed and hashed before the corresponding outcome
   exists, so contamination is excluded by construction rather than by
   assumption."

---

## Order of work

| # | Task | Minutes |
|---|---|---:|
| 1 | Title + abstract + contribution list | 10 |
| 2 | §III contamination argument + T1 | 15 |
| 3 | §IV architecture + protocol | 15 |
| 4 | §V sample-size + Fig 2 | 15 |
| 5 | §VI results, paste T2/T3 from paper_numbers.md | 15 |
| 6 | §I, §II, §VII, §VIII | 20 |

Steps 1–3 give a submittable position paper on their own. Everything after is
strengthening.

---

## Before you submit

- Quote only from `eval/results/paper_numbers.md`, never from prose docs —
  bootstrap values differ slightly between them.
- The reproducibility statement dies when the repo goes private. Either soften
  it or mint a Zenodo DOI.
- Verify FINSABER does not already quantify required sample size. If it does,
  C2 weakens to a corroboration and C1 carries the paper alone.
