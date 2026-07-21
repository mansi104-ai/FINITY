# FINDEC — strategic assessment, 2026-07-21

Written in response to: "if we publish from here, is it good enough for a 2026
study, and would a reviewer strong in stats, finance and DL accept it?"

The honest answer is **no, not as currently framed**, and the reason is not
sample size. It is that the contribution has largely been published already.

---

## 1. The finding that changes everything

A literature search (finally successful after repeated tool failures) returns
the following 2025–2026 work:

| Paper | What it does | Overlap with FINDEC |
|---|---|---|
| **FINSABER** | "the first comprehensive evaluation framework for LLM-based investing strategies… supports 20 years of multi-source data and mitigates survivorship, look-ahead, and data-snooping biases" | **Severe.** This is the evaluation-protocol contribution. |
| **"Can LLM-based Financial Investing Strategies Outperform the Market in Long Run?"** (KDD 2026, arXiv 2505.07078) | Large universe, long horizon; most LLM strategies fail to beat buy-and-hold out of sample | **Severe.** This is our headline negative result, at larger scale, already peer-reviewed. |
| **arXiv 2603.27539** — "Toward Reliable Evaluation of LLM-Based Financial Multi-Agent Systems: Taxonomy, Coordination Primacy, and Cost Awareness" | Taxonomy + cost-aware evaluation of financial multi-agent systems | **Severe.** Covers both our taxonomy angle and our cost angle. |
| **arXiv 2605.24564** — "Summoning the Oracle to Slay It" | Mitigating look-ahead bias in backtesting with LLMs | High |
| **arXiv 2512.23847** — "Detecting Lookahead Bias in LLM Forecasts" | Detection methodology | High |
| **arXiv 2602.14233** | "Evaluating LLMs in Finance Requires Explicit Bias Consideration" | High |
| Liang, SSRN, 2026-05-21 | Quantifies look-ahead bias in GPT-4 financial forecasts; argues for point-in-time memory controls | High |

Also established in that literature: frontier LLMs recall in-window index
closes to within 1% error while degrading sharply post-cutoff — the
contamination mechanism FINDEC's plane separation was designed around is
already documented.

**Consequence.** Three of our six claimed contributions (C2 power/evaluation
validity, C3 contamination-free protocol, C5 cost efficiency) sit on top of
existing 2026 work. A reviewer who knows this literature — exactly the
reviewer described in the question — will find FINSABER and the KDD paper
immediately.

---

## 2. Answers to the questions asked

### Where is FINDEC going, and did we plan it this way?

No. The original goal was a multi-agent financial decision system with
performance results. Evidence forced a drift: the lookahead defect, then the
null significance results, then the power analysis. The project is now
effectively an evaluation-methodology project that happens to carry a system.

That drift was correct — the original claims were unsupportable — but it was
not planned, and it moved the work into a crowded area without checking
whether the area was crowded. **That check should have happened in week one.**

### Is read → train → test fine?

Yes, mechanically. The numerical plane does walk-forward with a 220-day
training window and a corrected one-day execution lag; that design is
standard and now regression-tested.

The asymmetry worth noting: the **decision plane learns, the control plane
does not**. The Planner and Optimizer are prompted, not trained. So "training"
in FINDEC means only the Ridge/logistic layer. That limits what a
"train/test" framing can claim about the agentic parts.

### Do we need monthly retraining, or can 200 stocks be approximated from current stats?

Approximation is possible for **power**, not for **performance**.

Power was computed exactly (see §5 below): cross-sectional breadth barely
helps because contemporaneous equity returns are correlated ~0.35, so 500
stocks give only ~2.85 effective independent units against 2.08 for five. The
span is what matters.

Performance cannot be extrapolated — it must be run. But the existing ablation
already shows the ML analyst is *negative* (−0.191 Sharpe, worst cell in the
study). **A larger, better-powered study would most likely confirm that with
tighter intervals — i.e. produce a stronger negative result, not a positive
one.** Anyone planning the 200-stock run should expect that outcome.

### Is the architecture evident enough to produce predictions when the key limit is hit?

Yes, and this is a genuine robustness property. The decision plane needs no
LLM: prices, volatility, VaR and the Ridge forecast all run without one. When
the budget is exhausted the Planner falls back to deterministic parsing and
`planned_by` records the degradation, so affected days are excluded from
control-plane metrics rather than silently averaged in.

The limitation is the mirror image: **under exhaustion arm B collapses toward
arm A**, so the agentic contrast disappears exactly when the quota does.
Observed today — a 33-item evaluation returned 3.8% "accuracy" that was
entirely budget exhaustion, not planner behaviour.

### What will this take us up to?

A realistic ceiling, stated plainly:

- **Numerical plane, 200 names × 60 years**: properly powered, detects a
  +0.20 Sharpe difference. Most likely outcome is a well-evidenced null.
- **Agentic layer**: forward test only. Adequate for directional accuracy and
  calibration within months; **never** adequate for Sharpe.
- **What it cannot reach**: a defensible claim that the agentic architecture
  improves financial outcomes. Not with this data, this budget, or this
  timeline.

### Are we solving a real problem, and should we mention CPU?

The real problem is genuine — unfalsifiable claims in agentic finance — but it
is **already being solved by others** (§1).

CPU/cost: mention it, but not as the contribution. arXiv 2603.27539 already
covers cost-aware evaluation of financial multi-agent systems.

### If we publish from here, is it good enough for 2026?

**No, as framed.** Predicted reviewer response:

- *Stats reviewer*: likes the power analysis; rejects n = 5 tickers over 1.6
  years as an evaluation; asks why it is not simply FINSABER.
- *Finance reviewer*: asks about survivorship bias, transaction costs, and
  the absence of any factor-model benchmark (Fama–French); notes the KDD 2026
  paper reached the same conclusion on a larger universe.
- *DL reviewer*: asks what is learned; notes the ablation says the learned
  component hurts; asks for comparison against 2024–26 agentic baselines,
  which we do not have.

Likely outcome at a strong venue: **reject or major revision.** A workshop or
a lower-tier venue is plausible.

### Are the research gaps covered, and are the steps reproducible?

Reproducibility: **yes, and it is the strongest surviving asset.**
`eval/run_paper.py` regenerates every table behind a correctness gate that
aborts if the lookahead tests fail; the forward-test universe is hash-frozen;
sealed predictions are committed. **This breaks the moment the repository goes
private** — decide on a Zenodo DOI or supplementary bundle before submission.

Gaps: **not covered.** The gap we targeted is occupied.

---

## 3. What actually survives

Ordered by how much of it looks unclaimed.

1. **The quantitative power argument.** FINSABER mitigates biases; the KDD
   paper shows strategies fail. Neither, on the evidence available, states
   *how much data any such claim would require* — 19,692 days for +0.30
   Sharpe, 5.9% power at n = 398. That specific framing may still be novel.
   **Verify against FINSABER's paper before relying on it.**
2. **A live, sealed, prospective forward test.** The cited work is
   retrospective bias-*mitigation*. Sealing predictions before outcomes exist
   is a different and stronger guarantee. Currently 80 predictions, 0 scored.
3. **Retracting one's own published result**, with the defect measured
   (0.192 → 0.724 when reintroduced). Rare and credible.
4. **The Blankespoor grounding** — that recommendation-shaped systems serve a
   small slice of observed query volume. Different angle from the cited work.

Weak or gone: contamination protocol as such, cost-efficiency, "LLM agents
don't beat buy-and-hold", intent classification.

---

## 4. Options

**A. Reframe narrowly around power and prospective sealing.** Cite FINSABER
and the KDD paper as prior work and position as complementary: they mitigate
bias retrospectively, we quantify the sample size any claim needs and seal
prospectively. Requires reading both papers first. Smallest contribution, but
honest and possibly novel.

**B. Run the 200 × 60y study and publish the powered null.** Expect it to
confirm the negative. Overlaps the KDD paper heavily unless the power framing
carries it. Weeks of compute plus a survivorship-bias problem that needs
CRSP/WRDS to solve properly.

**C. Wait for forward-test outcomes and lead with calibration.** Calibration
converges far faster than Sharpe; a reliability diagram on sealed prospective
predictions is defensible and less crowded than the bias-mitigation angle.
Costs ~2–3 months.

**D. Change the question.** The system's genuinely unexploited asset is the
Blankespoor finding: these systems are built for the rarest query type. A
paper about *what financial AI systems should be built for* is a different
literature with different competition.

---

## 5. Supporting computation (already run)

Effective independent units, contemporaneous correlation ρ = 0.35:

| Stocks | 5 | 50 | 200 | 500 |
|---|---:|---:|---:|---:|
| N_eff | 2.08 | 2.75 | 2.83 | 2.85 |

Smallest detectable Sharpe difference, 80% power:

| Design | Detects |
|---|---:|
| 5 tickers, 1.6y (current) | +1.467 |
| 500 stocks, 1.6y | +1.254 |
| 200 stocks, 60y | **+0.204** |
| 500 stocks, 60y | +0.203 |

200 names is statistically equivalent to 500 at 60% of the compute.

---

## 6. Immediate next step

**Read FINSABER and arXiv 2505.07078 in full before writing anything.** Every
option above depends on precisely what they claim. Writing first and reading
second is how a paper gets rejected for duplicating work its authors had not
read.
