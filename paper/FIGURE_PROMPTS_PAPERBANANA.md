# PaperBanana prompts

Natural-language prompts for [PaperBanana](https://paperbanana.co/), one per
figure. Paste each fenced block verbatim.

These differ from `FIGURE_PROMPTS.md`, which asks a coding assistant for
matplotlib source. These describe the figure to a text-to-image system, so they
specify appearance rather than API calls.

---

## Read this before using figures 2-7

PaperBanana's strength is methodology diagrams and system architectures — its
benchmark is built from NeurIPS methodology figures. **Figure 1 is squarely in
that sweet spot and you should get an excellent result.**

Figures 2-7 are different in kind: they encode measurements, and every bar
height and marker position is a number that a reviewer can check against the
tables in the manuscript. An image-generation model draws pixels that *look
like* a chart; it does not plot data. Expect bar heights that are close but not
metrically faithful, and axis ticks that do not quite line up.

Two practical consequences, then it is your call:

1. **Verify every returned figure against the checklist at the bottom of this
   file** before it goes into the submission. Each prompt below instructs the
   model to print the exact value on every mark, which makes that check fast —
   if the printed number is right and the bar length is wrong, the figure is
   still misleading.
2. Journals are beginning to screen for AI-generated figures, and a
   *statistical chart* that does not match its own data table is the case that
   gets flagged. A methodology diagram carries no such risk.

The committed matplotlib scripts already produce all seven figures from the
result artifacts, so a reasonable split is: use PaperBanana for Figure 1 and
keep the generated charts for 2-7. Whichever you choose, the prompts for all
seven are below.

---

## Figure 1 — System architecture

Section 3. No measured data. Best candidate for this tool.

```
Create a publication-quality system architecture diagram for a research paper,
in a clean academic style: white background, black line work, light grey fills,
serif typography, no gradients, no drop shadows, no 3D effects, no decorative
icons, no colour. Portrait-ish landscape, roughly 7:6.6 aspect ratio.

The diagram shows a SEVEN-agent AI system for financial decision support,
divided into two planes. This division is the most important thing the figure
must communicate:

  - CONTROL PLANE agents are drawn with a LIGHT GREY FILL. There are two of
    them: the Planner and the Optimizer. They are language-model driven and
    decide what work to do.
  - DECISION PLANE agents are drawn UNFILLED, white. There are five: the
    Researcher, Market, Analyst, Fundamentals and Risk manager. They are
    numerical and deterministic and decide what the market will do.

Lay it out top to bottom as six rows of rounded rectangular boxes connected by
downward arrows. Each box has a bold title and smaller grey body lines, centred.

Row 1, one narrow white box, centred: "Investor query", body line "free text,
no fixed schema".

Row 2, one wide GREY-FILLED box: "Planner agent", body lines:
  "intent (11 classes), entities, horizon, risk posture"
  "emits a task graph; only its subtasks are dispatched"

Row 3, FOUR white boxes side by side, all exactly the same height:
  "Researcher"    — "news retrieval, relevance filter"
                    "FinBERT polarity, lexicon fallback"
                    "recency weight, 3-day half-life"
                    "live-only: no usable archive"
  "Market"        — "prices, quotes, regime"
                    "realised volatility scales"
                    "availability flag on failure"
                    "no directional view emitted"
  "Analyst"       — drawn with a NOTICEABLY HEAVIER BORDER but still white,
                    because it is the component the paper studies. Body lines,
                    using mathematical notation with hats over the Greek
                    letters:
                    "sigma-hat: the one real forecast"
                    "mu-hat shrunk to 0.25 sigma-hat"
                    "P(up), P(dd > x) derived"
                    "abstains when |mu-hat / sigma-hat| is low"
  "Fundamentals"  — "valuation and growth"
                    "recorded as evidence only"
                    "informs but does not vote"
                    "refuses historical dates"

Row 4, one wide white box: "Risk manager", body lines:
  "consumes estimates, not votes"
  "P(dd) is a constraint, not a score"
  "exposure cap by profile: 6 / 10 / 16%"

Row 5, one wide GREY-FILLED box: "Optimizer agent", body lines:
  "judges evidential sufficiency, may re-query"
  "deterministic screen before any LLM call"
  "iteration bounded by budget and by count"

Row 6, one wide white box: "Recommendation + audit trail", body lines:
  "reliability-weighted fusion over available agents"
  "size, downside, citations, per-agent confidence"
  "abstention is a distinct outcome from hold"

Arrows: query down to Planner. Four arrows fanning from the Planner down to
each of the four row-3 boxes. Four arrows converging from those boxes down into
the Risk manager. Risk manager down to Optimizer. Optimizer down to
Recommendation.

Two specific arrow requirements:
  1. The arrows from the Planner to the Researcher and to the Fundamentals box
     must be DASHED, each labelled "subtasks" in small grey italics; the arrows
     to Market and Analyst are SOLID. This contrast shows that agents are
     dispatched conditionally rather than always.
  2. Add a DASHED FEEDBACK path running from the right edge of the Optimizer
     box, out to the right margin, up the side, and back into the right edge of
     the Fundamentals box, labelled in small grey italics "re-query on
     conflicting evidence". This shows the control plane can send work back.

Beneath the diagram, add a small centred grey note:
"Shaded boxes are the control plane: language-model driven, deciding what work
to do. Unshaded boxes are the decision plane: numerical and deterministic given
their inputs, deciding what the market will do. Keeping the language model out
of the decision plane is what leaves the retrospective results interpretable,
since a model trained on the test period cannot be asked to forecast it. Every
message carries a value, a self-reported confidence, an as-of timestamp, the
source window, and an availability flag; an unreachable source returns
unavailable, never a neutral value. Dashed edges are traversed only when the
plan calls for them."

Keep all text inside its box, and keep the four row-3 boxes equal in height. Do
not add any component, label, arrow or legend that is not listed above.
```

---

## Figure 2 — Predictability and abstention

Sections 6.1 and 6.4. Two panels.

```
Create a two-panel academic figure for a finance research paper. Wide landscape
format, roughly 7:2.5. Clean journal style: white background, serif font, black
and grey only, thin axis lines, faint gridlines, no colour, no legend boxes
unless stated, no chart junk.

LEFT PANEL, titled "(a) What is predictable".
A horizontal bar chart with four bars, dark grey fill and thin black outline.
The x-axis runs 0 to 0.68 and is labelled "|rank correlation with outcome|".
Bar lengths encode the ABSOLUTE value, and the signed value is printed as text
immediately to the right of each bar. From top to bottom:
  "Direction"   bar length 0.0744, printed label "-0.074"
  "Magnitude"   bar length 0.2489, printed label "+0.249"
  "Volatility"  bar length 0.5543, printed label "+0.554"
  "Drawdown"    bar length 0.3199, printed label "-0.320"
The Volatility bar must be visibly the longest, roughly seven times the length
of the Direction bar, which must be very short. That ratio is the finding.

RIGHT PANEL, titled "(b) Accuracy against coverage".
A line chart with five circular markers connected by a thin black line, each
marker carrying a vertical error bar. The y-axis is "directional accuracy",
ranging about 0.50 to 0.63. The x-axis is "coverage (%)". Plot these points,
with the error bars given as explicit lower and upper bounds:
  coverage 100%, accuracy 0.5205, interval 0.5075 to 0.5335
  coverage  75%, accuracy 0.5273, interval 0.5123 to 0.5422
  coverage  50%, accuracy 0.5375, interval 0.5192 to 0.5558
  coverage  25%, accuracy 0.5621, interval 0.5362 to 0.5877
  coverage  10%, accuracy 0.5754, interval 0.5345 to 0.6154
Draw a horizontal dashed grey line at 0.50 labelled "chance" in small italics.
Accuracy must rise monotonically as coverage falls, and every error bar must sit
entirely above the 0.50 line. Both properties are the result being shown.

Do not invent additional data points, series, trend lines or annotations.
```

---

## Figure 3 — Volatility model comparison

Section 6.2. Three panels. The metrics disagree — that disagreement is the point.

```
Create a three-panel academic figure for a finance research paper. Wide
landscape, roughly 7:2.5. Journal style: white background, serif font, greyscale
only, faint horizontal gridlines, thin axes, no colour.

All three panels show the same four volatility forecasting models along the
x-axis, in this order, with two-line tick labels:
  "Random / walk", "Uncond. / mean", "EWMA / lambda=0.94", "HAR-RV"

LEFT PANEL, titled "(a) Loss, lower is better".
Grouped vertical bars, two per model, hanging DOWNWARD from a horizontal zero
line at the top, because the quantity is an improvement in a loss. Dark grey
bars are run 1, light grey bars are run 2. A small legend reads "universe run
(n=1,900)" and "redesign run (n=5,700)". Y-axis labelled "delta QLIKE vs random
walk", ranging 0 down to about -0.15. Bar depths:
  Random walk:  run 1 = 0,       run 2 = 0
  Uncond. mean: run 1 = -0.1505, run 2 = no bar
  EWMA:         run 1 = -0.1414, run 2 = -0.0986
  HAR-RV:       run 1 = -0.1156, run 2 = -0.0645
Note the unconditional mean has the deepest run-1 bar and no run-2 bar at all.

CENTRE PANEL, titled "(b) Ordering".
Plain dark grey vertical bars, y-axis "rank correlation with realised sigma",
range 0 to 0.78, each bar labelled above with its value to three decimals:
  Random walk 0.609, Uncond. mean 0.575, EWMA 0.635, HAR-RV 0.655
HAR-RV must be the tallest bar and Uncond. mean the shortest.

RIGHT PANEL, titled "(c) Bias".
Plain dark grey vertical bars, y-axis "Mincer-Zarnowitz slope", range 0 to 1.42,
each labelled above with its value to two decimals:
  Random walk 0.46, Uncond. mean 0.87, EWMA 0.54, HAR-RV 1.14
Draw a horizontal dashed grey line at exactly 1.0, labelled "unbiased" in small
grey italics near the left. HAR-RV must be the only bar reaching past that line.

The figure must make it visible that the best model differs by panel: the
unconditional mean wins panel (a) while HAR-RV wins panels (b) and (c). Do not
harmonise this or add a "best model" marker.
```

---

## Figure 4 — Calibration of derived risk

Section 6.3. Three panels.

```
Create a three-panel academic figure for a finance research paper. Wide
landscape, roughly 7:2.5. Journal style: white background, serif font, greyscale
only, thin axes, faint gridlines, no colour.

LEFT PANEL, titled "(a) Reliability".
A scatter plot with three filled black circular markers. X-axis "mean predicted
P(dd > x)" and y-axis "realised frequency", both running 0 to 0.45 with equal
scaling. A dashed grey 45-degree identity line runs corner to corner. Points:
  (0.402, 0.388) labelled "x=5%"
  (0.134, 0.155) labelled "x=10%"
  (0.014, 0.024) labelled "x=20%"
From each marker draw a thin vertical connector to the identity line, showing
the size and direction of the miss. The x=5% point must sit slightly BELOW the
line and the other two slightly ABOVE it.

CENTRE PANEL, titled "(b) Skill against the base rate".
Grouped vertical bars, two per threshold: dark grey "derived" and light grey
"base rate", with a small legend. Y-axis "Brier score (lower is better)", range
0 to 0.30. Three groups along the x-axis labelled "x=5%", "x=10%", "x=20%":
  x=5%:  derived 0.2377, base rate 0.2375
  x=10%: derived 0.1301, base rate 0.1308
  x=20%: derived 0.0245, base rate 0.0239
Above each group print a small italic verdict: "loses" over x=5%, "beats" over
x=10%, "loses" over x=20%. The paired bars are nearly equal in every group, and
that near-equality is the finding.

RIGHT PANEL, titled "(c) What aggregates hide".
Three dark grey vertical bars around a horizontal zero line, y-axis range about
-0.20 to 0.34, each labelled with its signed value:
  "worst-bin / gap"      +0.265, above the line
  "reliability / slope"  -0.064, below the line
  "sigma-hat bias"       -0.110, below the line

Do not add data points, thresholds or series beyond those listed.
```

---

## Figure 5 — The matched-exposure control

Section 6.5. Three panels. The paper's methodological contribution.

```
Create a three-panel academic figure for a finance research paper. Wide
landscape, roughly 7:2.35. Journal style: white background, serif font,
greyscale only, faint horizontal gridlines, thin axes, no colour.

All three panels compare the same three portfolio arms along the x-axis:
  "Sized policy", "Constant 42% / (no timing)", "Buy & hold"

Fill the MIDDLE bar (the constant-exposure control) solid dark grey in every
panel, and the outer two light grey. The emphasis must fall on the control,
because it is the arm under discussion.

LEFT PANEL, titled "(a) Risk-adjusted return".
Y-axis "Sharpe ratio", bars labelled above with three decimals:
  Sized policy 0.381, Constant 42% 0.539, Buy & hold 0.497
The control must be the tallest bar.

CENTRE PANEL, titled "(b) Return".
Y-axis "Annualised return (%)", bars labelled above with two decimals:
  Sized policy 9.97, Constant 42% 11.52, Buy & hold 16.52
Buy & hold must be the tallest here.

RIGHT PANEL, titled "(c) Downside".
Y-axis "Maximum drawdown (%)", all values negative, bars hanging DOWNWARD from a
zero line at the top, labelled below each bar with one decimal:
  Sized policy -38.0, Constant 42% -33.8, Buy & hold -71.7
Buy & hold must fall by far the furthest, and the control the least.

Each panel keeps its own independent y-scale; do not merge them into a single
grouped chart, because a ratio, a percentage return and a negative drawdown
cannot share an axis honestly.

The figure must support this reading: the middle arm beats the first on all
three panels at once, while buy & hold earns the most and falls the furthest.
```

---

## Figure 6 — Sealed prospective test

Section 6.7. Three panels. Every result is null.

```
Create a three-panel academic figure for a finance research paper. Wide
landscape, roughly 7:2.5. Journal style: white background, serif font, greyscale
only, thin axes, faint gridlines, no colour.

LEFT PANEL, titled "(a) Sealed, out of sample".
Two filled black circular markers, each with a tall vertical error bar. Y-axis
"directional accuracy", range about 0.24 to 0.72. X-axis has two two-line
categories: "Arm A / numerical" and "Arm B / agentic".
  Arm A: accuracy 0.483, error bar from 0.396 to 0.572, annotated "58/120"
  Arm B: accuracy 0.425, error bar from 0.285 to 0.578, annotated "17/40"
Draw a horizontal dashed grey line at 0.50 labelled "chance" in small italics.
BOTH error bars must clearly cross that line — that neither arm separates from
chance is the entire result.

CENTRE PANEL, titled "(b) Where they differ".
A four-bar vertical chart, y-axis "paired decisions (n=40)", integer ticks,
range 0 to about 18, each bar labelled above with its count. Categories and
values:
  "both / correct"  12, light grey
  "A only"           9, dark grey
  "B only"           5, dark grey
  "neither"         14, light grey
The two middle bars are dark because the discordant pairs are what the test
uses. Add a small grey italic note inside the panel: "discordant 9 vs 5,
McNemar p = 0.42".

RIGHT PANEL, titled "(c) What the extra agents cost".
Two dark grey vertical bars, y-axis "median latency (ms)", range 0 to about
2,900, labelled above with a thousands separator:
  Arm A 1,639 ms
  Arm B 2,260 ms
X tick labels carry three lines each:
  "Arm A / numerical / 1 agent, 0.00 LLM calls"
  "Arm B / agentic / 4 agents, 0.20 LLM calls"

Do not add a winner marker, a significance star, or any annotation implying one
arm outperforms the other.
```

---

## Figure 7 — Statistical power

Section 7. Two panels. Smooth analytic curves.

```
Create a two-panel academic figure for a statistics-heavy finance paper. Wide
landscape, roughly 7:2.6. Journal style: white background, serif font, greyscale
only, thin axes, faint gridlines, no colour.

LEFT PANEL, titled "(a) What a Sharpe claim costs".
A single smooth black curve, steeply decreasing and convex, on a LOGARITHMIC
y-axis. X-axis "true difference in Sharpe ratio", linear, running 0.1 to 1.0.
Y-axis "trading days for 80% power", logarithmic, running about 1,000 to
200,000. The curve passes through these three points, each marked with a filled
black circle and annotated in two lines:
  x = 0.30, y = 19,700   annotation "approx 20k days / (78 yr)"
  x = 0.50, y =  7,100   annotation "approx 7k days / (28 yr)"
  x = 1.00, y =  1,800   annotation "approx 1.8k days / (7 yr)"
Draw a horizontal dashed grey line at y = 398, labelled "our holdout, 398 days"
in small grey italics. That line must sit well BELOW every point on the curve.

RIGHT PANEL, titled "(b) Power at a realistic holdout".
Three smooth S-shaped curves rising from bottom-left to top-right, all in black,
distinguished only by line style, on a LOGARITHMIC x-axis. X-axis "holdout
length (trading days)" running 252 to 100,000. Y-axis "power", linear, 0 to 1.
  Solid line, labelled "+1.00", rises earliest, reaching 0.8 near x = 1,800
  Dashed line, labelled "+0.50", reaching 0.8 near x = 7,100
  Dotted line, labelled "+0.30", rises last, reaching 0.8 near x = 19,700
A small legend titled "true diff." names the three. Draw a horizontal dashed
grey line at y = 0.80 labelled "80% power", and a vertical grey line at
x = 398. Mark with a filled circle the point where the DOTTED curve meets
x = 398, at y = 0.059, and annotate it with a short leader line reading
"5.9% at +0.30" so the text does not sit on top of the curve.

Write the percent labels as plain text, for example "80% power". Do not add
confidence bands, shaded regions or extra curves.
```

---

## Verification checklist

Check each returned figure against this before it enters the manuscript. These
are the values the tables in the paper state, so any mismatch is a discrepancy a
reviewer can find.

**Figure 2.** Volatility bar ~7x the Direction bar. Printed labels -0.074,
+0.249, +0.554, -0.320. Five accuracy points 0.5205 / 0.5273 / 0.5375 / 0.5621 /
0.5754, rising monotonically, all error bars above 0.50.

**Figure 3.** Panel (a): deepest run-1 bar is Uncond. mean, and it has no run-2
bar. Panel (b): HAR-RV tallest at 0.655. Panel (c): HAR-RV is the only bar above
1.0, at 1.14. Different winners in different panels.

**Figure 4.** Panel (a): x=5% below the diagonal, other two above. Panel (b):
"beats" appears only over x=10%. Panel (c): one positive bar (+0.265), two
negative (-0.064, -0.110).

**Figure 5.** Middle bar tallest in (a) at 0.539 and in (b) at 11.52 it is NOT
tallest — buy & hold is, at 16.52. In (c) buy & hold falls furthest at -71.7.
Middle bar dark in all three panels.

**Figure 6.** Both error bars in (a) cross 0.50. Counts in (b) are 12 / 9 / 5 /
14 and sum to 40. Arm B latency higher than Arm A in (c).

**Figure 7.** Holdout line at 398 sits below the whole curve in (a). In (b) the
dotted curve meets x=398 at y≈0.059, and curve order left to right is solid,
dashed, dotted.

**All figures.** No invented series, no extra categories, no significance stars,
no colour, axis labels present and spelled as specified.
