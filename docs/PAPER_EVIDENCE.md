# FINDEC — evidence ledger for the conference paper

Reference document for writing the paper by hand. Every number here is traced
to how it was produced. Nothing is rounded up, and nothing is included that
cannot be regenerated from the repository.

**Rule for using this document:** if a sentence you write is not supported by a
row below, it is not yet a claim you can make. Add the evidence or drop the
sentence.

Generated 2026-07-21. Re-verify anything marked LIVE before submission.

---

## 0. The decision you must make first

The forward test currently holds **80 sealed predictions and 0 scored
outcomes**. No statement about predictive performance is available today, and
none can be manufactured.

This gives two honest papers:

| | Paper A — submit now | Paper B — submit after outcomes |
|---|---|---|
| Contribution | methodology + negative results | the above + a live out-of-sample result |
| Performance claim | none | directional accuracy with CIs |
| Earliest date | today | first outcomes 2026-07-27; useful n from ~late Sept |
| Risk | "no results" criticism | none of the above is wasted; it all still ships |

**Paper A is publishable.** Its contribution is that a whole class of results
in this literature is unsupportable, demonstrated with a defect found in our
own prior work and a power analysis showing the standard experimental design
cannot succeed. That is a real finding, and it does not depend on FINDEC
winning anything.

Paper B is Paper A plus a results section. Waiting costs nothing except time,
because every claim in A survives into B.

**Do not attempt a paper that claims FINDEC forecasts well. There is no
evidence for it, and the evidence we do have points the other way** (§3).

---

## 1. Evidence ledger

Grades: **SAFE** — state plainly. **CAVEAT** — state only with the stated
qualifier attached. **CANNOT** — do not write this in any form.

### 1.1 The lookahead defect and its correction

| Claim | Value | Grade | Provenance |
|---|---|---|---|
| Original reported mean Sharpe (defective) | 0.724 | SAFE | `eval/eval_recommendation.py` at `execution_lag_days=0` |
| After removing 1-day lookahead | 0.282 | SAFE | same, `lag=1`, rf=0 |
| Fully corrected (lag=1, rf=4%) | **0.192** | SAFE | same, `lag=1`, `risk_free_annual=0.04` |
| Buy-and-hold, same window | 0.312 | SAFE | same run |
| "Beats B&H on 4/5 tickers" | **retracted → 2/5** | SAFE | the 4/5 figure was the bug |
| Regression tests that fail if it returns | 9 tests | SAFE | `eval/test_no_lookahead.py` |

Mechanism, stated precisely: exposure decided from `closes[idx]` was applied to
the return *into* `closes[idx]`, so a decision earned the move it was made on.
The SMA baseline was correctly lagged, which is why the defect presented as
skill rather than as an error.

Also fixed: `sharpe_ratio` guarded zero variance with `std() == 0`, which is
unreachable in floating point. A permanently flat series earning constant
risk-free returned **7.3e16**. Now uses a 1e-12 tolerance.

### 1.2 Significance — nothing survives

Holdout n = 398 days, 5 tickers, profile=high.

| Ticker | Sharpe diff vs B&H | 95% CI | p |
|---|---|---|---|
| AAPL | −0.042 | [−1.411, +1.137] | 0.945 |
| MSFT | +0.978 | [−0.787, +2.584] | 0.258 |
| AMZN | −1.322 | [−2.711, +0.089] | 0.068 |
| TSLA | +0.035 | [−1.176, +1.397] | 0.955 |
| NVDA | −0.267 | [−1.459, +0.834] | 0.636 |
| **Pooled** | **−0.162** | **[−0.752, +0.428]** | **0.599** |

- **0/5** tickers beat buy-and-hold with a CI excluding zero. Same against SMA.
- **Hansen SPA p = 1.0000** across the risk-profile search.
- Methods: stationary bootstrap (Politis–Romano), Diebold–Mariano with
  Newey–West HAC and the Harvey–Leybourne–Newbold small-sample correction.
- 17 known-answer/calibration tests, including a 30-worthless-configuration
  grid that SPA correctly declines to call significant.

Grade: **SAFE**. This is a headline result, not an embarrassment.

### 1.3 Power analysis — the strongest single contribution

Calibrated to the real holdout: ρ = 0.552 between strategy and benchmark,
benchmark Sharpe +0.314, daily vol 0.0245, n = 398.

Required holdout to detect a true Sharpe difference at 80% power:

| True diff | Days | Years |
|---|---:|---:|
| +0.10 | 177,158 | 703 |
| +0.20 | 44,297 | 176 |
| **+0.30** | **19,692** | **78** |
| +0.50 | 7,093 | 28 |
| +1.00 | 1,778 | 7.1 |

Power at n = 398: **+0.30 → 5.9% analytic, 1.7% Monte Carlo**, against a 5%
false-positive rate.

Two independent methods agree: Jobson–Korkie/Memmel analytic, and Monte Carlo
through the actual bootstrap test.

**The sentence this supports:** the experiment was incapable of detecting the
effect it was designed to find, regardless of what the strategy did. By
extension, published results in this literature reporting one to two years of
holdout on a handful of tickers are reporting noise, whether or not they also
carry a lookahead defect.

Grade: **SAFE**, and this is the most defensible novel contribution in the
paper. It generalises beyond FINDEC.

### 1.4 Ablation — the ML component does not help

Pooled holdout, lag=1, rf=4%.

| Cell | Sharpe | AnnRet % | MaxDD % |
|---|---:|---:|---:|
| full (trend 80 + prediction 22) | 0.166 | 5.47 | −33.04 |
| **trend_only (moving average, no ML)** | **0.228** | 6.78 | −31.64 |
| prediction_only (ML analyst alone) | **−0.191** | −4.15 | −58.57 |
| equal_weight | 0.007 | 2.61 | −35.00 |
| **buy & hold** | **0.329** | 9.56 | −53.77 |
| SMA(20/50) | 0.156 | 5.06 | −32.78 |
| TSMOM 12-1 | 0.275 | 7.38 | −53.77 |

**0 of 6 pairwise comparisons significant.** Point estimates: removing the ML
analyst *improves* Sharpe (0.166 → 0.228); the analyst alone is the worst cell
in the study; buy-and-hold beats every configuration; the trend rule does not
beat a textbook SMA crossover (diff +0.072, p = 0.753).

Grade: **SAFE** for the point estimates *with* the "none significant" qualifier
attached in the same sentence. Never quote a cell without it.

### 1.5 Reliability weighting

Chronological replay with a live store; scores do accumulate (Analyst → 0.553,
RiskManager → 0.510).

| Cell | Sharpe | AnnRet % |
|---|---:|---:|
| reliability OFF | 0.166 | 5.47 |
| reliability ON | 0.183 | 5.83 |

Difference **+0.017**, 95% CI [−0.0035, +0.0437], **p = 0.137**.

Grade: **CAVEAT**. Describe as a transparency and auditability mechanism that
exposes per-agent trust in the decision trace. **Do not list "adaptive rather
than static weighting" as a performance contribution** — the evidence does not
support it.

### 1.6 Query taxonomy grounding

Source: Blankespoor, deHaan, Marinovic & Zhu, *Generative AI and Investor
Processing of Financial Information* — 29,242 retail-investor questions to
Public.com's "Alpha", mid-2024, drawn from 40,381. Method: 1,500 manually
labelled, SBERT trained on 1,200, evaluated on 300; reported accuracy 0.75
(task), 0.73 (information source).

| Task | Share |
|---|---:|
| Explain or interpret | 47.5% |
| Screen for securities | 27.8% |
| General company assessment | 8.6% |
| Background | 4.9% |
| Summarize | 4.6% |
| Retrieve | 3.6% |
| Define / Trends / Compare | 3.0% |

Information sources: **Market 73.7%**, Analyst 8.1%, News 2.4%.

**The finding worth stating:** advice-seeking ("should I buy") was *excluded*
from that sample by platform policy — 2,999 of 40,381, ≈7.4%. Systems built
around a buy/sell/hold recommendation therefore address a small slice of
observed demand, while explain and screen together are 75.3%.

Grade: **CAVEAT — mandatory.** Alpha publicly refuses advice questions and
users adapt, so 7.4% is a floor produced by platform policy, **not** a
measurement of investor demand for advice. Writing it as the latter is wrong
and a reviewer who knows the paper will catch it.

### 1.7 Planner intent accuracy — MEASURED IN PRODUCTION MODE

**Individual mode (one call per query, the production path):**

| Subset | n | Accuracy |
|---|---:|---:|
| Published labels (Blankespoor Table 9) | 26 | **0.692** |
| Authored labels (advice, risk_check) | 7 | 0.857 |
| Overall | 33 | 0.727 |

Comparison point: their SBERT scores **0.75**. We are **below** it.

**The earlier 0.923 was an artefact of batch mode and must not be used.**
Classifying all 33 questions in one call lets the model compare them against
each other, which production never does. The inflation is **+0.23** — larger
than most effects this paper discusses, and a caution worth stating in its own
right: an evaluation harness that batches for convenience can manufacture a
result the deployed system cannot reproduce.

Per-label recall shows the failure is concentrated, not diffuse:

| Label | Recall |
|---|---|
| advice, assess, data_point, define, screen | 3/3 or 4/4 |
| trend, risk_check, company_profile | 2/3 |
| compare | 1/2 |
| interpret | 1/3 |
| **summarize** | **0/3** |

`summarize` fails completely — all three go to `company_profile` or
`risk_check`. `interpret`, the largest real-world category at 47.5%, is 1/3.

Grade: **CAVEAT.** Reportable as an honest production measurement. It is
below the published baseline, so it cannot be presented as a contribution —
only as a component measurement, or as motivation for the taxonomy work.
Still tuning-set data (the prompt was revised four times against these
questions), so a held-out set remains required before any claim.

### 1.8 Systems and cost — LIVE

| Metric | Value | Grade | How measured |
|---|---|---|---|
| LLM calls, 40 tickers × 2 arms | 28 for 80 decisions | SAFE | budget ledger, 2026-07-21 |
| Marginal inference cost | $0 (free-tier models) | SAFE | OpenRouter free tier |
| FinBERT throughput, CPU | 189 ms/article | SAFE | measured, 10 threads |
| FinBERT cold load | ~47 s, once per process | SAFE | measured |
| End-to-end, cached plan | 786 ms | SAFE | `/v2/ask`, live |
| End-to-end, cold + planning | 68.5 s | SAFE | first request, includes FinBERT load |
| Planning alone (uncached) | 7.5–24 s | SAFE | model-dependent |
| Serverless bundle | ~83 MB | CAVEAT | estimated from package sizes, not a measured build |

**The "under 1.3 seconds end-to-end" claim from the previous draft is dead.**
Do not carry it over. Planning alone exceeds it by an order of magnitude.

Model: `nvidia/nemotron-3-super-120b-a12b:free`, fallback
`google/gemma-4-26b-a4b-it:free`. Schema-enforced JSON is load-bearing: in a
controlled probe, **0 of 4** free models returned the required object when
merely asked for JSON; **3 of 4** succeeded under `response_format:
json_schema`. Also observed: `strict: true` does not reliably constrain enum
*membership* — an agent name was returned in an intent field — so values are
validated explicitly.

### 1.9 Forward test — LIVE, currently empty of outcomes

| Property | Value |
|---|---|
| Sealed predictions | 80 (40 arm A, 40 arm B) |
| Scored outcomes | **0** |
| Trading days | 1 |
| Universe | 40 US large caps, ≥2 per GICS sector, frozen 2026-07-21 |
| Manifest hash | `06c5e17699d7f9c3` (refuses to change mid-run) |
| Integrity | seals intact, no duplicate keys, no outcome preceding its `as_of` |
| Horizon | 5 trading days |
| First outcomes | 2026-07-27 |

Design properties that are claimable **now**, because they are properties of the
protocol rather than of results:

- Predictions are sealed with SHA-256 before their outcomes exist.
- Outcomes are appended as separate rows joined by `decision_id`; a prediction
  row is never mutated.
- Idempotent on (as_of, ticker, arm, horizon), so a re-run cannot double-log.
- `verify()` detects edited rows, duplicate keys, and any outcome dated on or
  before its own prediction. **Every tripwire is tested by deliberately
  provoking it** — 15 checks, all passing.
- Arms A and B run on identical tickers on identical days: paired within-period,
  not sequential.
- Survivorship bias is structurally absent: the universe was chosen on the start
  date and tracked forward, so nothing about the future informed membership.

Grade: **SAFE** as protocol description. **CANNOT** be described as having
produced any result.

---

## 2. Claims you must not make

Each of these is either unsupported or actively contradicted.

1. **"FINDEC outperforms buy-and-hold."** Contradicted: pooled −0.162, p=0.599;
   0/5 with CI excluding zero; B&H beats every ablation cell.
2. **"The multi-agent architecture improves accuracy."** Untested. The only
   architectural evidence available says removing the ML analyst *helps*.
3. **"Adaptive weighting improves performance."** +0.017, p = 0.137.
4. **Any Sharpe-based superiority claim.** Detecting +0.30 needs ~78 years.
   Do not present Sharpe as a headline metric at all.
5. **"The agentic pipeline beats the numerical baseline."** 0 outcomes.
6. **"Evaluated on a large universe."** Backtest results are 5 tickers. The
   forward test has 40 but no outcomes yet.
7. **"Sub-second end-to-end."** Measured 786 ms only with a cached plan and a
   warm process; cold is 68.5 s.
8. **"FinBERT sentiment in production."** True locally and in the container;
   **false on the serverless deployment**, where torch is excluded to fit a
   500 MB limit and the Researcher reports UNAVAILABLE.
9. **"Only 7% of investors want advice."** Selection effect, see §1.6.
10. **"0.923 intent accuracy"** without the tuning-set qualifier.
11. **Explainability as an evaluated property.** No human study was run. It is a
    design property until ~200 labelled cases with two annotators and Cohen's κ
    exist.

---

## 3. What the evidence actually supports as contributions

Ranked by how well they survive scrutiny.

**C1. A lookahead defect class, measured.** A one-day rebalance offset inflated
mean Sharpe from 0.192 to 0.724 and flipped the headline from 2/5 to 4/5. It
presented as skill because the baseline was correctly lagged. Ships with
regression tests. *This is strong precisely because it is our own prior result
being retracted.*

**C2. A power analysis showing the standard design cannot work.** 5.9% power to
detect +0.30 Sharpe at n = 398; ~78 years required. Generalises to the whole
literature, not just to FINDEC.

**C3. A contamination-free evaluation protocol.** The control/decision plane
separation, motivated by the fact that a current language model in the decision
path recalls rather than forecasts over any recent backtest window; plus a
sealed, tamper-evident, tripwire-tested forward test.

**C4. An empirically grounded query taxonomy**, from 29,242 real questions, with
the observation that recommendation-shaped systems address a small slice of
observed query volume.

**C5. A system that runs the agentic control plane at zero marginal inference
cost on commodity CPU** — 28 LLM calls for 80 decisions, sentiment scored
locally.

**C6. An honest null result on architectural complexity.** The ML analyst
subtracts from performance; the trend rule carries it; neither beats
buy-and-hold. Reported with the "none significant" qualifier.

Note the shape: **none of these require FINDEC to be good at forecasting.**
That is what makes the paper submittable today.

---

## 4. Six-page structure (IEEEtran, two-column)

Approximate budget. IEEEtran fits ~1,050 words per full page of body text;
floats displace roughly their own area.

| § | Content | Space |
|---|---|---|
| I | Introduction — contamination + power as the framing problems | 0.75 p |
| II | Related work — see `docs/RELATED_WORK.md` | 0.6 p |
| III | Query taxonomy and what these systems are actually asked (C4) | 0.6 p |
| IV | Architecture — two planes, agents, dynamic weighting (C3, C5) | 1.1 p + Fig 1 |
| V | Evaluation protocol — sealing, tripwires, arms, power (C2, C3) | 0.9 p |
| VI | Results — lookahead correction, significance, ablation (C1, C6) | 1.2 p + 2 tables |
| VII | Discussion and limitations | 0.5 p |
| VIII | Conclusion | 0.15 p |
| — | References | 0.6 p |

### Tables and figures — 3 tables, 2 figures fits 6 pages

- **Fig 1** — two-plane architecture. `docs/architecture-diagram.svg` exists;
  it must be updated to show the planes, the Optimizer loop and the sealing step.
- **Fig 2** — power curve: detectable Sharpe difference against required sample
  size, with n = 398 marked. This is the paper's most persuasive single image.
- **Table I** — lookahead correction (§1.1), three configurations.
- **Table II** — significance (§1.2), per ticker plus pooled.
- **Table III** — ablation (§1.4), seven cells.

Cost/latency (§1.8) belongs in prose, not a fourth table — space is tighter than
it looks and the numbers are few.

---

## 5. Highest-value work remaining before submission

Ordered by value per hour.

1. **Held-out intent set** (hours). Removes the paper's worst internal
   inconsistency — criticising data snooping while quoting a tuned number.
   Build it the way Blankespoor et al. did: mutually exclusive labels by primary
   intent, ideally two annotators with Cohen's κ. Then run
   `eval/eval_planner_intent.py --mode individual`.
2. **Read the two concurrent lookahead papers** — arXiv 2607.04958 and
   2601.13770. If either scoops C1, the framing must shift toward C2 and C3.
   Not yet read; **do this before writing §I**.
3. **Regenerate Fig 1** to match the built architecture.
4. **Resolve the auditor's run-to-run variance** (0/6 then 6/6 unsound on
   identical input) or omit the Auditor from the claims entirely.
5. **Universe expansion for the backtest** is the reviewers' most likely attack
   on §VI, and remains blocked on data access. State n = 5 in the abstract
   rather than burying it.

---

## 6. Reviewer attacks, and the honest answer to each

| Attack | Answer |
|---|---|
| "No performance improvement is demonstrated." | Correct, and stated. The contribution is that demonstrating one requires far more data than this literature typically uses — quantified in §V. |
| "Five tickers is too few." | Agreed and stated prominently. The power analysis shows the deeper problem: even 40 tickers over a year would not settle a Sharpe claim. |
| "Why should we trust the forward test?" | Because it is sealed, and the seals are checked. Every tripwire is tested by provoking it. |
| "Isn't the LLM contaminated?" | It is, which is why it is confined to the control plane and evaluated on task quality rather than returns. |
| "0.923 looks tuned." | It is; stated explicitly with the number of revisions. Held-out set is the fix. |
| "This is just an ensemble with a chat interface." | The claim is not novelty of ensembling but that the evaluation of such systems is usually invalid, demonstrated on our own prior result. |
| "Negative results are not a contribution." | The power analysis is a positive, quantitative, generalisable result. The null findings are its corollary. |

---

## 7. Citations that must appear

From `docs/RELATED_WORK.md`, plus:

- Blankespoor, deHaan, Marinovic, Zhu — 29,242 investor questions (§1.6)
- FinS-Pilot, arXiv 2506.2037 — workflow-aware intent taxonomy
- Politis & Romano 1994 — stationary bootstrap
- Hansen 2005 — SPA; White 2000 — Reality Check
- Diebold & Mariano 1995; Harvey, Leybourne & Newbold 1997
- Jobson & Korkie 1981; Memmel 2003 — Sharpe difference variance
- Sullivan, Timmermann & White 1999 — closest methodological ancestor
- Brock, Lakonishok & LeBaron 1992; Moskowitz, Ooi & Pedersen 2012 — baselines
- Wilson 1927 — score interval
- arXiv 2607.04958, 2601.13770 — concurrent lookahead work, **unread**
- TradingAgents (Xiao et al.), FinRobot (Yang et al.) — positioning

---

## 8. Reproducibility statement for the paper

True as written, and worth including:

- `python eval/run_paper.py` regenerates every table, running the lookahead
  regression tests first as a correctness gate and aborting on failure. No
  performance number produced after a failed lookahead test is trustworthy.
- The forward-test universe is frozen with a manifest hash that refuses to
  change mid-run.
- Sealed predictions are committed to the repository, so the record is
  independently checkable.

**Note before close-sourcing:** the reproducibility claim depends on the
artifacts being reachable. If the repository is going private, either the
statement must be softened or an archival snapshot (Zenodo DOI, or a
supplementary bundle) must be prepared. A paper claiming public reproducibility
against a dead link is worse than one that claims nothing.
