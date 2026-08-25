# Figure generation prompts

One prompt per figure in the manuscript. Each is self-contained: the data is
inline, so a prompt can be handed to a coding assistant or a collaborator
without access to this repository.

**These are data figures, not illustrations.** Do not send these prompts to an
image generator. Every value below is a measurement; a figure that renders
plausible-looking bars instead of these numbers is fabricated evidence in a
submitted paper. The output of each prompt should be a Python script using
matplotlib that draws the stated values.

To simply regenerate what already exists:

```powershell
python eval/make_journal_figures.py    # figures 1, 3, 4, 6, 7
python eval/make_results_figure.py     # figure 2
python eval/make_exposure_figure.py    # figure 5
```

---

## Common style block

Prepend this to any figure prompt below.

> Write a Python script using matplotlib (`matplotlib.use("Agg")`) that draws
> the figure described. House style, applied to every panel:
>
> - `font.family: serif`, `font.serif: ["Times New Roman", "DejaVu Serif"]`,
>   `font.size: 8`, `axes.linewidth: 0.6`.
> - **Print-first, ink only.** No hue may carry meaning. Use greyscale fills
>   (`#4a4a4a` for the series under discussion, `#b4b4b4` for reference
>   series, `#1a1a1a` for ink, `#7a7a7a` for muted text and spines). The
>   figure must survive being printed in black and white.
> - Hide the top and right spines; colour the left and bottom spines muted.
> - Horizontal gridlines at `alpha=0.18, linewidth=0.5`, drawn below the data
>   (`set_axisbelow(True)`).
> - Panel titles in the form `(a) Short label`, `fontsize=8.5, pad=6`.
> - Annotate values directly on the marks rather than relying on the reader to
>   estimate from an axis, at `fontsize` 6–7.5.
> - Figure width 7.1 inches (full text width of the journal's single-column
>   layout).
> - Save three files per figure: `<stem>.pdf`, `<stem>.png` (dpi 220+), and a
>   greyscale proof `<stem>_grey.png`, all with `bbox_inches="tight"`.
> - Never place two quantities with different units on shared axes. Use small
>   multiples instead; overlaying unrelated series on twin axes can make any
>   two look coupled.

---

## Figure 1 — `fig_architecture`

Section 3. The only diagram; no measured data.

> Draw a top-down system diagram of a **seven-agent** financial decision system
> on a blank axis (`axis("off")`), with rounded rectangular boxes
> (`FancyBboxPatch`, `boxstyle="round,pad=0.5,rounding_size=1.2"`) connected by
> `FancyArrowPatch` arrows (`arrowstyle="-|>"`, `mutation_scale=8`).
>
> The agents divide into two planes, and **fill encodes the plane**:
> control-plane agents (Planner, Optimizer) take a light grey fill `#e8e8e8`;
> decision-plane agents (Researcher, Market, Analyst, Fundamentals, Risk
> manager) stay white. Border weight is reserved for a different meaning: the
> Analyst gets a heavier border as the component the paper studies.
>
> Six rows, stacked top to bottom. Compute each box's height from its number of
> body lines and lay the rows out sequentially with a fixed gap, so boxes can
> never overlap regardless of content. Pad the four row-3 boxes to a common line
> count with empty strings so they share a height. Each box has a bold title and
> smaller muted body lines, centred.
>
> 1. **Investor query** — "free text, no fixed schema"
> 2. **Planner agent** *(control plane, grey fill)* — "intent (11 classes),
>    entities, horizon, risk posture"; "emits a task graph; only its subtasks
>    are dispatched"
> 3. A row of four equal side-by-side boxes, all decision plane, all white:
>    - **Researcher** — "news retrieval, relevance filter"; "FinBERT polarity,
>      lexicon fallback"; "recency weight, 3-day half-life"; "live-only: no
>      usable archive"
>    - **Market** — "prices, quotes, regime"; "realised volatility scales";
>      "availability flag on failure"; "no directional view emitted"
>    - **Analyst** *(heavier border)* — "σ̂: the one real forecast"; "μ̂ shrunk
>      to 0.25 σ̂"; "P(up), P(dd > x) derived"; "abstains when |μ̂/σ̂| is low".
>      Render these with mathtext.
>    - **Fundamentals** — "valuation and growth"; "recorded as evidence only";
>      "informs but does not vote"; "refuses historical dates"
> 4. **Risk manager** *(decision plane)* — "consumes estimates, not votes";
>    "P(dd) is a constraint, not a score"; "exposure cap by profile: 6 / 10 /
>    16%"
> 5. **Optimizer agent** *(control plane, grey fill)* — "judges evidential
>    sufficiency, may re-query"; "deterministic screen before any LLM call";
>    "iteration bounded by budget and by count"
> 6. **Recommendation + audit trail** — "reliability-weighted fusion over
>    available agents"; "size, downside, citations, per-agent confidence";
>    "abstention is a distinct outcome from hold"
>
> Arrows: query → planner; planner → each of the four row-3 boxes; each of those
> four → risk manager; risk manager → optimizer; optimizer → recommendation.
>
> The arrows from the planner to the **Researcher** and **Fundamentals** boxes
> must be **dashed** and labelled "subtasks" in muted italics; those to Market
> and Analyst are solid.
>
> Add a **dashed feedback path** from the right edge of the Optimizer, out to
> the right margin, up, and back into the right edge of the Fundamentals box,
> labelled "re-query on conflicting evidence" in muted italics. Draw it as three
> `FancyArrowPatch` segments so only the final one carries an arrowhead.
>
> Below the diagram, a centred note: "Shaded boxes are the **control plane**:
> language-model driven, deciding what work to do. Unshaded boxes are the
> **decision plane**: numerical and deterministic given their inputs, deciding
> what the market will do. Keeping the language model out of the decision plane
> is what leaves the retrospective results interpretable, since a model trained
> on the test period cannot be asked to forecast it. Every message carries a
> value, a self-reported confidence, an as-of timestamp, the source window, and
> an availability flag; an unreachable source returns *unavailable*, never a
> neutral value. Dashed edges are traversed only when the plan calls for them."
>
> Figure size 7.1 × 6.6 inches. Set the y-limit from the computed bottom of the
> last box so nothing is clipped.

---

## Figure 2 — `results_panels`

Sections 6.1 and 6.4. Two panels, the paper's two headline results.

> Two panels side by side, figure size 7.1 × 2.5 inches.
>
> **Panel (a) "What is predictable"** — a horizontal bar chart of the
> *magnitude* of the rank correlation between a forecast and its realised
> outcome, for four targets, with the signed value annotated as text to the
> right of each bar:
>
> | Target | Rank correlation |
> |---|---|
> | Direction | -0.0744 |
> | Magnitude | +0.2489 |
> | Volatility | +0.5543 |
> | Drawdown | -0.3199 |
>
> Bar length encodes `abs(value)`; the sign is carried only by the annotation,
> formatted `{:+.3f}`. Invert the y-axis so Direction is at the top. X-limit
> 0 to 0.68, x-label `|rank correlation with outcome|`. Vertical gridlines
> here rather than horizontal, since the bars are horizontal.
>
> **Panel (b) "Accuracy against coverage"** — accuracy versus coverage
> percentage, as a line with circular markers and asymmetric error bars giving
> the 95% Wilson interval computed from `(k, n)` where `k = round(accuracy·n)`:
>
> | Coverage | n | Accuracy |
> |---|---|---|
> | 100% | 5700 | 0.5205263 |
> | 75% | 4275 | 0.5272515 |
> | 50% | 2850 | 0.5375439 |
> | 25% | 1425 | 0.5621053 |
> | 10% | 570 | 0.5754386 |
>
> Draw a dashed muted horizontal line at 0.50 labelled "chance". X-axis is
> coverage in percent; note that accuracy *rises* as coverage *falls*, so
> consider ordering the axis so the trend reads left to right. Implement the
> Wilson interval explicitly:
> `c = (p + z²/2n)/(1 + z²/n)`, `h = z·√(p(1-p)/n + z²/4n²)/(1 + z²/n)`,
> `z = 1.96`.

---

## Figure 3 — `fig_volatility`

Section 6.2. Three panels. The point of the figure is that the three metrics
**disagree about which model is best** — do not smooth this over.

> Three panels side by side, figure size 7.1 × 2.5 inches. Four models on every
> panel, in this order, with two-line x tick labels: "Random\nwalk",
> "Uncond.\nmean", "EWMA\nλ=0.94", "HAR-RV".
>
> Data, from two independent evaluation runs:
>
> | Model | QLIKE (run 1, n=1900) | MSE | IC | MZ slope | QLIKE (run 2, n=5700) |
> |---|---|---|---|---|---|
> | Random walk | -6.5951096 | 4.4858e-07 | 0.6086936 | 0.4609569 | -6.7244917 |
> | Uncond. mean | -6.7455942 | 3.6427e-07 | 0.5750913 | 0.8721040 | *(not run)* |
> | EWMA λ=0.94 | -6.7365081 | 3.9035e-07 | 0.6345282 | 0.5360394 | -6.8231026 |
> | HAR-RV | -6.7107203 | 3.5927e-07 | 0.6546443 | 1.1381627 | -6.7889977 |
>
> **Panel (a) "Loss, lower is better"** — grouped bars showing ΔQLIKE relative
> to the random walk *within each run* (i.e. subtract that run's random-walk
> value). Two bars per model: run 1 in the dark fill, run 2 in the light fill,
> with the unconditional mean having no run-2 bar. Horizontal line at 0. Legend
> naming the two runs with their sample sizes. Y-label "ΔQLIKE vs random walk".
> QLIKE is a **loss**: lower is better, so improvement points downward.
>
> **Panel (b) "Ordering"** — plain bars of IC, y-limit 0 to 0.78, values
> annotated to 3 decimals. Y-label "rank correlation with realised σ".
>
> **Panel (c) "Bias"** — plain bars of the Mincer–Zarnowitz slope, y-limit 0 to
> 1.42, values annotated to 2 decimals. Draw a dashed muted horizontal line at
> 1.0 labelled "unbiased" in italics at the left edge, since a slope of 1
> indicates conditional unbiasedness.

---

## Figure 4 — `fig_calibration`

Section 6.3. Three panels. The figure exists to show that a healthy-looking
aggregate hides a structurally wrong reliability curve.

> Three panels side by side, figure size 7.1 × 2.5 inches. Data from a
> calibration evaluation of derived downside probabilities at three drawdown
> thresholds, n = 3800:
>
> | Threshold x | Mean predicted | Realised rate | Brier | Base-rate Brier | ECE | Beats base? |
> |---|---|---|---|---|---|---|
> | 5% | 0.4015904 | 0.3881579 | 0.2377200 | 0.2374913 | 0.0635508 | no |
> | 10% | 0.1338905 | 0.1547368 | 0.1300549 | 0.1307934 | 0.0499737 | yes |
> | 20% | 0.0139758 | 0.0244737 | 0.0245063 | 0.0238747 | 0.0167826 | no |
>
> Pooled diagnostics: worst-bin gap 0.2647418, reliability-curve slope
> -0.0644075 per bin, mean bias in σ̂ -0.1098961.
>
> **Panel (a) "Reliability"** — mean predicted probability on x against
> realised frequency on y, one marker per threshold, with a dashed 45° identity
> line from (0,0) to (0.45,0.45). Draw a thin vertical connector from each
> marker to the identity line to show the size and direction of the miss.
> Annotate each marker "x=5%" etc. Equal limits 0–0.45 on both axes.
>
> **Panel (b) "Skill against the base rate"** — grouped bars, derived Brier in
> the dark fill against the corresponding base-rate Brier in the light fill,
> one group per threshold. Above each group print "beats" or "loses" in
> italics. Y-label "Brier score (lower is better)".
>
> **Panel (c) "What aggregates hide"** — three bars: worst-bin gap (+0.265),
> reliability slope (-0.064), σ̂ bias (-0.110), with a horizontal line at 0 and
> signed annotations to 3 decimals. Y-limit roughly -0.20 to 0.34 so both
> directions are visible.

---

## Figure 5 — `matched_exposure`

Section 6.5. Three panels — the paper's methodological contribution.

> Three panels side by side, figure size 7.1 × 2.35 inches. Three arms on each
> panel: "Sized policy", "Constant 42%\n(no timing)", "Buy & hold".
>
> | Arm | Sharpe | Annualised return (%) | Max drawdown (%) |
> |---|---|---|---|
> | Sized policy | 0.381 | 9.97 | -38.0 |
> | Constant 42% (no timing) | 0.539 | 11.52 | -33.8 |
> | Buy & hold | 0.497 | 16.52 | -71.7 |
>
> Panel (a) Sharpe ratio, values to 3 decimals; panel (b) annualised return,
> 2 decimals; panel (c) maximum drawdown, 1 decimal.
>
> **Three panels rather than one grouped chart, deliberately:** Sharpe is a
> ratio, the other two are percentages, and drawdown is negative. Shared axes
> would misrepresent all three. Each panel carries its own scale.
>
> The **constant-exposure control is the arm under discussion**, so fill it
> solid dark and leave the other two light — the emphasis must fall on the
> control, not on buy-and-hold. For the drawdown panel, set the y-limit to
> `(min·1.22, 0)` and draw a zero line, so bars descend from the axis.
>
> The figure must support this reading: the control beats the sized policy on
> all three measures at once, while buy-and-hold earns the most and falls
> furthest. That contrast is the argument — comparing against buy-and-hold
> alone cannot reveal the failure, because reduced exposure lowers drawdown
> whatever the timing contributes.

---

## Figure 6 — `fig_forward`

Section 6.7. Three panels. Sealed prospective test; every result is null.

> Three panels side by side, figure size 7.1 × 2.5 inches. Two arms: arm A
> ("numerical", 1 agent, 0.00 LLM calls per decision) and arm B ("agentic", 4
> agents, 0.20 LLM calls per decision).
>
> **Panel (a) "Sealed, out of sample"** — accuracy as a point with a vertical
> 95% Wilson interval for each arm. Arm A: 58 correct of 120. Arm B: 17 of 40.
> Compute the intervals with the Wilson formula rather than a normal
> approximation. Annotate each point "58/120" and "17/40". Dashed muted
> horizontal line at 0.50 labelled "chance". Y-limit about 0.24–0.72. Both
> intervals must visibly straddle 0.50 — that is the finding.
>
> **Panel (b) "Where they differ"** — a four-bar contingency of the 40 paired
> decisions on which both arms ran: both correct 12, A only 9, B only 5,
> neither 14. Fill the two discordant bars ("A only", "B only") dark and the
> two concordant bars light, since the discordant pairs are what the test uses.
> Integer y ticks. Annotate counts above the bars. Add a muted italic note:
> "discordant 9 vs 5, McNemar p = 0.42".
>
> **Panel (c) "What the extra agents cost"** — two bars of median latency: arm
> A 1639 ms, arm B 2260 ms, annotated with a thousands separator. X tick labels
> should carry the arm name, agent count and LLM calls per decision on
> separate lines.

---

## Figure 7 — `fig_power`

Section 7. Two panels. Computed, not tabulated — implement the formula.

> Two panels side by side, figure size 7.1 × 2.6 inches.
>
> Implement the Jobson–Korkie (1981) statistic with the Memmel (2003)
> correction. For annualised Sharpe ratios `s_a`, `s_b` and correlation `ρ`,
> with `T = 252` trading days per year, convert to per-period Sharpes
> `a = s_a/√T`, `b = s_b/√T`, then
>
> ```
> V = (2 - 2ρ + ½(a² + b² - 2ab·ρ²)) · T
> SE(Sharpe_a - Sharpe_b) at n days = √(V/n)
> required n = V · ((z_{α/2} + z_power)/diff)²
> power at n = Φ(|diff|/SE - z_{α/2})
> ```
>
> Calibration constants: ρ = 0.552, benchmark Sharpe = 0.314, actual holdout
> = 398 trading days, α = 0.05, target power = 0.80. The alternative Sharpe is
> `benchmark + diff`.
>
> **Panel (a) "What a Sharpe claim costs"** — required trading days (log y
> axis) against the true Sharpe difference, swept from 0.10 to 1.00. Mark
> points at differences of 0.30, 0.50 and 1.00 and annotate each with the
> required days rounded to thousands and the equivalent in years (`n/252`).
> Draw a dashed muted horizontal line at 398 labelled "our holdout, 398 days".
> The three markers should land at roughly 20k days (78 yr), 7k days (28 yr)
> and 1.8k days (7 yr).
>
> **Panel (b) "Power at a realistic holdout"** — power against holdout length
> (log x axis, from about 252 to 100,000 days) as three curves for true
> differences of +1.00 (solid), +0.50 (dashed) and +0.30 (dotted). Dashed
> horizontal line at 0.80 labelled "80% power"; vertical line at n = 398. Mark
> the point where the +0.30 curve meets n = 398 and annotate it with the power
> as a percentage — it should read about 5.9%, and place the annotation with a
> short leader line so it does not sit on top of the curve. Y-limit 0 to 1.
> Legend titled "true diff.".
>
> Write "80% power" as a plain string, not `80\% power` — matplotlib is not
> using a LaTeX backend here and would render the backslash literally.
