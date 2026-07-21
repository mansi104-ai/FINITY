# FINDEC v9 — writing kit

Facts, argument beats and constraints. **Deliberately not prose.** Compose
your own sentences from these; do not paraphrase `FINDEC_v9.tex`, because
paraphrase reads worse than either the original or a fresh draft, and it
preserves exactly the structural patterns that make text look generated.

Use `FINDEC_v9.tex` only for: LaTeX scaffolding, table markup, equation
markup, section ordering. Write every sentence yourself.

---

## How to use this

For each section below you get: **the point** (what the section must
establish), **the facts** (verified numbers, quote exactly), **the beats**
(the order the argument moves in), and **traps** (things that read as
generated, or that a reviewer will attack).

Write one section per sitting, from the beats, without the `.tex` open.
Then check your numbers against the facts list.

---

## Abstract

**The point.** A reader who stops here should know: direction is
unpredictable, volatility is not, and abstention works.

**Facts.** 196 equities · 10 years · 43,512 observations · direction rank
corr. −0.074 · volatility +0.554 · drawdown −0.320 · directional accuracy
0.4875 at h=1, CI excludes 0.50 from below · abstention 52.1% → 57.5% as
coverage falls 100% → 10%.

**Beats.** (1) Retail investors get fragmented evidence. (2) Agentic systems
consolidate it but are judged on portfolio return and almost all forecast
direction. (3) We evaluate each agent separately. (4) The asymmetry. (5) The
downstream consequence. (6) Abstention survives. (7) Claim: uncertainty
estimation beats directional forecasting as a foundation.

**Traps.** Don't write "we propose a novel framework" — the novelty is the
measurement, not the framework. Don't list all four agents in the abstract;
name them once, briefly.

---

## I. Introduction

**The point.** Two properties of the literature deserve scrutiny, and one
question comes before the other.

**Beats.**
1. Four competences in an investment decision; institutions split them; retail
   investors don't have that.
2. Agentic AI offers the same split in software (FinRobot, TradingAgents,
   FinGPT).
3. Two recurring properties: evaluation is end-to-end; the target is almost
   always direction.
4. Why each is a problem — an aggregate can't localise a failure; the target
   is chosen for convenience, not evidence.
5. So we ask the prior question: is direction predictable at all?
6. RQ1–RQ3, then C1–C4.

**Traps.** Avoid "In recent years, ... has garnered significant attention."
Avoid a three-item list where two items would do. The transition into §4 is
the paper's hinge — write it in your own voice and don't rush it.

---

## II. Related Work — four subsections, ~0.6 page

**A. Multi-agent financial AI.** TradingAgents splits analysis/research/
execution; FinRobot layers LLMs over tooling. Both need commercial endpoints
or accelerators. FINDEC keeps the analytical path deterministic.

**B. Financial language models.** FinBERT and successors improve sentiment
extraction. **The point to make:** they help live interpretation but
complicate retrospective evaluation, since a pretrained encoder may encode
the test period.

**C. Volatility forecasting.** Corsi's HAR-RV (daily/weekly/monthly
components); GARCH; RiskMetrics EWMA. Patton (2011): with a noisy proxy most
loss functions rank forecasts wrongly; MSE and QLIKE are robust. **Say you
adopt QLIKE and why** — a finance reviewer checks this.

**D. Risk-aware recommendation.** Realised volatility, VaR, CVaR. Recent work
adds linguistic regime signals. Sullivan–Timmermann–White on data snooping.

**Traps.** Don't survey. Each subsection is three or four sentences that end
in "…and this is why our design differs."

---

## III. Architecture — ~0.7 page + Fig 1

**The point.** What makes it agentic rather than a fixed pipeline.

**Beats.** Three tiers, named briefly. Then the two things that matter:
- The **set of agents invoked is decided per query**. `define` dispatches
  nothing; anything touching the user's capital always dispatches Risk.
- Every result is **typed and carries provenance** — own confidence, the
  newest datum consulted, the window drawn from. Unreachable source returns
  *unavailable*, never a neutral value.

**Traps.** Don't spend words on ports and Docker. The version-gating detail
from v8 is gone; don't reinstate it.

---

## IV. Agent Design — ~1.4 pages, Analyst dominant

### 4.1 Planner
Eleven intents, schema-validated task graph. Vocabulary derived from observed
usage: interpretation and screening dominate real queries; explicit advice is
a small minority. Resolves names→symbols, relative horizons→days, risk
posture from how loss is described.

**The sentence worth writing carefully:** two post-conditions are enforced
*after* the model returns, not requested in the prompt — a prompt expresses
an intention, a post-condition enforces one.

### 4.2 Researcher
Structured evidence, not prose. Filter → dedupe → transformer encoder with
lexicon fallback → recency weight, 3-day half-life → aggregate polarity,
agreement-based confidence, citations.

**Scope statement (do not omit):** news history at this tier reaches ~30 days;
beyond that the provider refuses. Even with an archive, a pretrained encoder
may already encode the test period. So: evaluated prospectively, excluded
from retrospective results.

### 4.3 Analyst ← longest subsection

**(a) Why direction is the wrong target.** Original design: ridge + logistic
over engineered features, emitting a label. At scale the rank correlation is
negative at every horizon. *A point estimate of an unforecastable quantity is
not a useful object.*

**(b) Features.** Backward-looking only. Emphasis on dispersion, not
direction: realised volatility at multiple scales, short/long volatility
ratio, downside semivariance, rolling skew and kurtosis, drawdown depth and
time since peak, volume vs its own trend, return vs market proxy.

**(c) The distribution.** Governing principle — **estimate the second moment,
be honest about the first, derive the rest.**
- Eq: σ̂_h = √h · σ̂_daily, |μ̂_h| ≤ κσ̂_h, κ = 0.25
- P(up) = Φ(μ̂/σ̂)
- Eq: P(drawdown > x) = 2Φ(−x/σ̂_h) — reflection principle
- E[max DD] scales with σ̂_h
- **Why derive rather than fit separately:** guarantees mutual consistency;
  concentrates estimation risk in one measurable place.

**(d) Confidence and abstention.** Raw confidence from |μ̂/σ̂|, mapped through
a reliability curve fitted on outcomes, so a stated value matches an observed
frequency. Below threshold → abstain. *No view is frequently the correct
answer, and a system that cannot say so will manufacture one.*

**(e) Cross-sectional rank.** Percentile of μ̂/σ̂ within the day's universe.
Requires a universe-level call; per-ticker invocation cannot produce it.

### 4.4 Risk Manager
Consumes estimates, not votes. σ̂ sets scale against a risk budget;
P(DD > x) is a **constraint**, not a score; calibrated confidence modulates
within the budget; abstention **suppresses** the recommendation (distinct
from hold). Caps 6% / 10% / 16%.

Execution lag: decisions take effect the session *after* the close that
produced them.

---

## V. Experimental Evaluation — results only, no interpretation

### Setup
196 US equities, 10 years, ≥2 per sector. Refit on trailing window, scored on
unseen. 95% Wilson intervals. **Survivorship stated here:** universe chosen at
end of sample, all constituents survived, flatters every column equally.

### Table I — agent-level
| Agent | Metric | Result | Baseline |
|---|---|---|---|
| Planner | intent accuracy | 0.692 | 0.75 |
| Researcher | retrospective coverage | n/a | — |
| Analyst | rank corr., direction | −0.074 | 0 |
| Analyst | rank corr., volatility | +0.554 | 0 |
| Analyst | accuracy @10% coverage | 0.575 | 0.50 |
| Risk Mgr | Sharpe vs matched exposure | 0.381 | 0.539 |

Planner **trails** its baseline — say so plainly, call it a component
measurement.

### Table II — Analyst
Upper: direction −0.0744 (R² 0.014) · magnitude +0.2489 (0.108) ·
**volatility +0.5543 (0.286)** · drawdown −0.3199 (0.084).
Lower: h=1 0.4875 [0.4771, 0.4980] · h=5 0.5021 [0.4916, 0.5126] ·
h=21 0.5073 [0.4968, 0.5178].

Prose after the table: volatility ~7× more predictable; direction wrong sign;
at h=1 the interval lies **wholly below 0.50** — worse than chance, not
merely uninformative.

Volatility forecasting, 5,700 forecasts, QLIKE: HAR −6.789, random walk
−6.725, EWMA −6.823. **Report honestly that EWMA wins.** Sentence to land:
volatility *ordering* is estimated well where its *level* is not — and
ordering is what a sizing rule needs.

Derived drawdown probabilities: beat base rate only marginally; reliability
curve slopes downward, overstating risk where predicted risk is highest.

### Table III + Figure — abstention
100% 0.5205 [0.5075,0.5335] · 75% 0.5273 · 50% 0.5375 · 25% 0.5621 ·
**10% 0.5754 [0.5345,0.6154]**. Monotone; **every interval excludes chance**.

### Position sizing (prose, no table)
Sized policy: Sharpe 0.381, return 9.97%, DD −38.0%.
Constant-exposure control at same average: **0.539, 11.52%, −33.8%** —
dominates on all three. Fully-invested arm reproduces buy-and-hold exactly
(harness validation — say this).
Volatility targeting across 196: t = −8.80, p < 0.0001, wins 47/196, buys
3.6pp of drawdown. Sharpe invariant to constant rescaling → risk profiles are
a leverage dial.

**Trap.** Keep interpretation out of §V. "Dominates on all three" is a
result; "which means delevering masquerades as risk management" is §VI.

---

## VI. Discussion — exactly three subsections

### A. Direction remains hard
Adverse at short horizons, not merely weak. Consistent with weak-form
efficiency. *The models aren't badly tuned; the target is wrong.*

Then sample size: ρ ≈ 0.55, +0.30 Sharpe needs **19,692 trading days**,
holdout gives **5.9% power** vs 5% false-positive rate. Breadth doesn't fix
it — 500 names ≈ **2.85 effective independent units** vs 2.08 for five.
Accuracy and calibration converge in hundreds, which is why they carry the
conclusions.

### B. Uncertainty carries more information
Volatility and drawdown estimable from identical inputs. Actionable: sizing,
constraints, abstention — none need to know direction.

**The caveat that must appear:** volatility predictability is *not*
profitability. A good σ̂ improves risk control; it does not generate return.

Then the methodological point: comparing only against buy-and-hold **cannot
detect** the sizing failure, because reduced exposure lowers drawdown and so
presents as risk management. A matched-exposure control should accompany any
such comparison.

Same reasoning for execution lag: same-session application inflated Sharpe
**0.192 → 0.724** and reversed the reported outcome, and it presented as
skill because the baseline *was* correctly lagged.

### C. Agentic decomposition enables per-agent measurement
The benefit is epistemic. Separable agents → failure localised to the
Analyst's *target* rather than blamed on the system. **Agents emitting
calibrated estimates with explicit abstention can be audited; agents emitting
buy/sell labels cannot, because a label carries no claim checkable against
frequency.**

---

## VII. Conclusion — 3–4 sentences
Direction anti-predictive, volatility and drawdown estimable, abstention
raises accuracy 52.1% → 57.5%, matched-exposure control shows reduced
exposure isn't risk management. Future work: range-based estimators, archival
news for the Researcher, the live prospective deployment.

---

## Ten claims that must not appear

1. FINDEC outperforms buy-and-hold.
2. Better than B&H on drawdown **and** return (return is 3.3× worse).
3. Any Sharpe superiority claim.
4. Adaptive weighting improves performance (+0.017, p = 0.137).
5. Sub-second end-to-end (786 ms cached; 68.5 s cold).
6. FinBERT sentiment in production (absent on the serverless deployment).
7. "Only 7% of investors want advice" — platform-policy artefact.
8. Intent accuracy as a contribution — 0.692 is below baseline.
9. Explainability as an evaluated property — no human study was run.
10. Per-agent reliability from the historical replay — Researcher/Market
    scored ≈0.03 because they had no data, not because they are unreliable.

---

## Phrasings that read as generated — avoid

- "In recent years, X has garnered significant attention."
- "This paper proposes a novel framework that leverages…"
- "Comprehensive experiments demonstrate the effectiveness of…"
- "It is worth noting that…" / "It should be emphasised that…"
- Triads where two items suffice ("robust, scalable, and efficient").
- Every paragraph opening with a discourse marker (Moreover, Furthermore,
  Additionally).
- A summary sentence restating the paragraph that just ended.
- Hedging stacked two deep ("may potentially suggest").

**What to do instead:** open paragraphs with the claim. Let some sentences be
short. Where a number carries the argument, put it in the sentence rather
than in a trailing parenthesis.

---

## Before submission

- Every number checked against `eval/results/paper_numbers.md`, not against
  prose documents — bootstrap figures differ slightly between them.
- `references.bib` needs: yang2024finrobot, xiao2024tradingagents,
  yang2023fingpt, araci2019finbert, sun2025financial, chen2026smart,
  mantshimuli2026toward. Add Corsi, Patton, Sullivan–Timmermann–White if you
  cite them inline.
- Figures needed: `FINDEC-Arch1.png`, `FINDEC_agents.png` (redraw the Analyst
  box to emit a distribution), `coverage_accuracy.png` (generated).
- Reproducibility statement dies if the repository goes private — soften it or
  mint an archival DOI.
- Verify FINSABER does not already quantify required sample size; if it does,
  §VI-A becomes corroboration rather than contribution.
