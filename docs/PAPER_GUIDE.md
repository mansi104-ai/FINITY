# What To Write In The Paper

Everything below is backed by a number this repo can regenerate with
`python eval/run_paper.py`. Nothing here is aspirational. Where a claim is not
yet supported, it says so.

---

## Title

> **Underpowered by Design: An Audit of Evaluation Practice in LLM Multi-Agent
> Financial Decision Systems**

Alternatives:
- *What Survives an Honest Backtest? Lookahead, Data Snooping and Statistical
  Power in Agentic Trading Systems*
- *Your Agent Pipeline Cannot Beat Buy-and-Hold, and Your Backtest Cannot Tell*

Avoid anything implying FINDEC performs well. It does not, and the paper is
stronger for saying so first.

---

## Abstract (drop-in draft)

> LLM multi-agent systems for financial decision-making report strong backtest
> results, typically over a few months to two years of daily data on a handful of
> correlated large-cap equities, without confidence intervals or corrections for
> the configurations searched. We audit one such system end-to-end and show this
> evaluation standard cannot support the claims built on it. First, we identify a
> one-day rebalance lookahead — the exposure chosen from a day's close was applied
> to that same day's return — and quantify it: removing it moves mean holdout
> Sharpe from 0.724 to 0.282, and flips "beats buy-and-hold" from 4 of 5 tickers
> to 2 of 5; adding a risk-free hurdle takes it to 0.192 against a benchmark's
> 0.312. Second, applying stationary-bootstrap confidence intervals,
> Diebold-Mariano tests and Hansen's SPA, we find that **no** result in the
> corrected system is statistically significant: 0 of 5 tickers beat buy-and-hold
> with an interval excluding zero, and SPA p = 1.000 across the parameter search.
> Third, an ablation shows the pipeline's decision score is dominated by a
> 30-day moving average; removing the learned forecaster *improves* the point
> estimate, and no component separates from any other. Fourth, we show why: at
> the sample sizes standard in this literature, the power to detect even a +0.30
> Sharpe improvement is 5.9% against a 5% false-positive rate — such an effect
> requires roughly 78 years of daily data per name to detect at 80% power. We
> release the harness, regression tests that detect the lookahead class of defect,
> and a one-command reproduction. Our conclusion is not that agent pipelines fail,
> but that current practice cannot distinguish success from failure.

Numbers to double-check against `eval/results/paper_numbers.md` before submitting.

---

## Contributions (state exactly these, in this order)

1. **A quantified case study of rebalance lookahead** in a complete agentic
   pipeline: 0.724 → 0.282 mean Sharpe, 4/5 → 2/5 "beats buy&hold". Includes the
   precise defect (three lines of loop ordering) and why it evaded review — the
   baseline it was compared against was correctly lagged, so the bug appeared as
   strategy skill.
2. **An evaluation harness** with stationary bootstrap, Diebold-Mariano and
   Hansen SPA, plus **regression tests that fail if lookahead is reintroduced**
   (`eval/test_no_lookahead.py`), including a guard-on-the-guard verifying the
   detector still works.
3. **A power analysis** giving the minimum holdout length for a Sharpe claim as a
   function of effect size and strategy/benchmark correlation, with two
   independent derivations that agree.
4. **Negative results, cleanly reported**: the multi-agent stack does not separate
   from a moving average; the learned forecaster hurts the point estimate;
   adaptive reliability weighting produces no detectable effect.
5. **A data-honesty contract**: `dataAvailable: false` propagation with no
   synthetic fallback anywhere, including VaR — the pipeline degrades explicitly
   rather than silently substituting invented numbers.

Do **not** claim: superior returns, that reliability weighting works, or that the
architecture is novel.

---

## Section-by-section

### 1. Introduction
Lead with the tension: agentic finance papers report impressive numbers; the
evaluation protocols cannot support them. Land the TradingAgents observation
early — its headline result covers **~62 trading days on 5 correlated tech
stocks** — then state that our own system was guilty of the same thing *plus* a
lookahead bug, which is how we came to write this paper. Self-implication is the
paper's credibility engine. Use it deliberately.

### 2. Related work
Use `docs/RELATED_WORK.md`. Three jobs:
1. Positioning table (systems × holdout length × significance testing).
2. **Cite Sullivan, Timmermann & White (1999)** as the direct ancestor — they did
   this for technical trading rules; we do it for LLM agent pipelines. This single
   citation frames the whole contribution.
3. Differentiate from the two concurrent look-ahead papers (arXiv 2607.04958
   formal non-interference; 2601.13770 benchmark). **Read both before submitting.**
   Ours is the empirical complement: measured cost in a real system.

### 3. System under audit
Brief. One figure of the pipeline. Resist describing agents in loving detail —
the paper is about evaluation, and architecture detail invites "this is just
TradingAgents". State the decision-score weights explicitly (trend 80,
prediction 22, sentiment 40) because the ablation depends on them.

### 4. The lookahead defect
The strongest section. Show the three-line loop ordering, before and after. State
that the SMA baseline was correctly lagged while the strategy was not, so the bug
manifested as skill. Table 1. Then present the regression test and the
guard-on-the-guard — a reviewer will ask "how do you know it's fixed?"

### 5. Statistical methodology
Why the stationary bootstrap (volatility clustering breaks i.i.d. resampling),
why paired resampling (strategy and benchmark share the price series, ρ ≈ 0.55),
why SPA over the grid. Report the **calibration test**: 30 zero-edge
configurations, SPA correctly declines to reject. That is what makes your
machinery trustworthy.

### 6. Results
Tables 2–5. Every number with n, CI and p. Explicitly report that the naive
p-value is optimistic relative to SPA — it makes the snooping correction concrete.

### 7. Power analysis
The paper's intellectual core. Both derivations, the required-n table, the
power-at-n table. Then the killer line: **5.9% power against a 5% false-positive
rate**. Generalise carefully to the field — "underpowered", never "false".

### 8. Threats to validity
Be first to raise every one (see below).

### 9. Recommendations
Give the field something actionable — a checklist:
1. Report execution lag explicitly; test for it.
2. Report holdout length in days and a power calculation for the claimed effect.
3. Report CIs, not point estimates.
4. Correct for the configuration search (SPA or deflated Sharpe).
5. Benchmark against TSMOM/SMA, not only buy-and-hold.
6. Release the backtest loop — the defect we found is invisible in a results table.

---

## The tables

| # | Content | Command |
|---|---|---|
| 1 | Lookahead impact (3 configs × Sharpe/B&H/beats) | `run_paper.py` §1 |
| 2 | Per-ticker + pooled Sharpe diffs with CI and p | `significance.py` |
| 3 | Required-n and power-at-n | `power_analysis.py` |
| 4 | Ablation cells + external baselines, 6 pairwise tests | `ablation.py` |
| 5 | Reliability ON/OFF | `reliability_replay.py` |

**Figure 1:** power curve — power vs holdout length for true diffs of +0.2/+0.3/
+0.5/+1.0, with vertical markers at FINDEC's 398 days and TradingAgents' ~62.
This one figure carries the paper; build it carefully.

**Figure 2:** equity curves under lag=0 vs lag=1, same axes. Visually devastating.

---

## Threats to validity — write these yourself before a reviewer does

1. **n = 5 tickers, all US large-cap tech, survivorship-selected, one bull-ish
   window.** The most serious limitation. State it in the abstract. Universe
   expansion is blocked on data access (`RESEARCH_PLAN.md` item 5).
2. **Sentiment is absent in backtest**, so the audited configuration is not the
   full live pipeline. Our numbers bound the no-news configuration only.
3. **Reliability replay is partial** — Analyst and RiskManager signals are
   reproducible offline; Researcher and MarketAgent are recorded unavailable.
4. **We audited one system.** Generalisation to others rests on their *reported*
   sample sizes plus our power arithmetic, not on re-running them. Say this
   plainly; it is the honest boundary of the claim.
5. **The LLM layer is unevaluated** (no faithfulness or conflict-detection
   metrics). Therefore explainability is presented as a design property, not a
   result.
6. **Low power cuts both ways** — it means we also cannot prove the pipeline is
   *worse* than baselines. The claim is indistinguishability, not inferiority.

Point 6 matters. Reviewers respect authors who state what their own negative
result does *not* license.

---

## Before submission — blocking items

- [ ] **Read arXiv 2607.04958 and 2601.13770.** Novelty depends on differentiating.
- [ ] Regenerate everything: `python eval/run_paper.py` (not `--quick`).
- [ ] Verify every number in the draft against `eval/results/paper_numbers.md`.
- [ ] Regenerate `eval/results/*.png` — **current charts were produced under the
      lookahead and are wrong.**
- [ ] Purge stale numbers from `CHANGELOG.md`.
- [ ] Decide on the LLM evaluation: run it (needs API key + ~200 labelled cases,
      two annotators, Cohen's κ) or scope the claim down. **Do not fabricate.**
- [ ] Expand the universe if data access can be obtained — biggest single upgrade.

## Venue

**IEEE CIFEr** (Computational Intelligence for Financial Engineering) — best fit;
audience knows Sharpe SEs and will value the SPA test. Alternatives: **ICDMW** or
an **IEEE Big Data** workshop. A negative-results or reproducibility track, if
available, is an excellent fit.

Do **not** submit to a general ML venue — reviewers there tend to read "no
significant results" as "no contribution", which misreads the paper.

---

## The one-sentence pitch

> We tried to show our multi-agent financial system beat the market, found a
> one-day lookahead worth 0.5 Sharpe, removed it, discovered nothing was
> significant, and then proved that at the sample sizes this entire literature
> uses, nothing *could* have been.
