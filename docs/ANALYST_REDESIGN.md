# Analyst Agent — redesign from first principles

Written against measured evidence, not intuition. Every design choice below
traces to a number in §1.

---

## 1. The evidence that forces the redesign

196 tickers, 10 years, 43,512 out-of-sample observations, 21-day horizon:

| Target | Spearman IC | R² |
|---|---:|---:|
| Direction (sign of return) | **−0.0744** | 0.014 |
| Magnitude \|return\| | +0.2489 | 0.108 |
| **Realised volatility** | **+0.5543** | **0.286** |
| **Forward max drawdown** | **−0.3199** | 0.084 |
| Trading volume | +0.9695 | 0.924 |

Corroborating, from `analyst_skill.py` (39 tickers, 8,814 decisions):
direction accuracy 0.4875 at h=1 with the 95% interval **excluding 0.50 from
below**, and negative information coefficient at 1, 5 and 21 days.

**The conclusion the design must respect:** with this information set,
*second-moment* quantities are estimable and *first-moment* quantities are
not. Volatility is 7.4× more predictable than direction, and direction is
predictable in the wrong sign.

Volume is excluded from what follows despite its IC of 0.97. Volume is nearly
autocorrelated by construction; forecasting it is close to tautological and
carries little decision value.

---

## 2. Core design principle

> Forecast the second moment. Be honest about the first. Derive everything
> else.

This is not a slogan; it is the architecture. Given a good σ̂ and an honest
μ̂, most of the quantities the Risk Manager needs are **derived rather than
separately predicted**:

| Output | Source |
|---|---|
| Expected volatility σ̂ | **predicted** (the one real forecasting task) |
| Expected return μ̂ | **predicted, heavily shrunk** (§3.2) |
| P(positive return) | derived: Φ(μ̂ / σ̂) |
| P(drawdown > x) | derived: barrier-crossing probability under a drifted random walk |
| Expected max drawdown | derived: scales with σ̂√T |
| Information ratio | derived: μ̂ / σ̂ |
| Confidence | derived from σ̂ dispersion, then **calibrated** on outcomes |
| Cross-sectional rank | derived: percentile of μ̂/σ̂ across the day's universe |
| Regime | classified from realised quantities |
| Abstain | rule on σ̂ uncertainty and \|μ̂/σ̂\| |

Deriving rather than separately predicting matters: it guarantees internal
consistency (P(up), IR and expected drawdown cannot contradict each other),
and it concentrates all the estimation risk in one place where it can be
measured properly.

---

## 3. What the Analyst estimates

### 3.1 Volatility σ̂ — the primary forecast

This is the only quantity the Analyst genuinely *predicts*. Everything else
is derived from it or shrunk toward a prior.

**Model: HAR-RV (Corsi, 2009).** The heterogeneous autoregressive realised
volatility model regresses future realised volatility on daily, weekly and
monthly realised volatility:

    RV_{t+h} = β₀ + β_d·RV_t^{(d)} + β_w·RV_t^{(w)} + β_m·RV_t^{(m)} + ε

It is the standard benchmark in the volatility-forecasting literature,
usually competitive with or better than GARCH, and it is a linear regression
— trivially cheap, fully interpretable, and it inherits the walk-forward
discipline already built.

**Extensions worth testing, in order of expected value:**
1. **Range-based RV estimators** (Parkinson 1980; Garman–Klass 1980;
   Rogers–Satchell 1991). Using high/low information gives a far more
   efficient volatility estimate than close-to-close at the same sample size.
   We already fetch OHLC and currently discard H and L.
2. **Semivariance split** (Barndorff-Nielsen et al.). Downside and upside
   realised variance separately — downside is what the Risk Manager needs.
3. **Jump/continuous decomposition** via bipower variation. Jumps are less
   persistent than the continuous component; separating them improves the
   forecast.
4. **Log target.** Model log RV, not RV. RV is right-skewed and bounded
   below; a log target makes the residuals far closer to Gaussian.

### 3.2 Expected return μ̂ — predicted, but shrunk hard

Direction is anti-predictive, so μ̂ must be treated as a weak prior rather
than a forecast. Two defensible constructions:

- **Shrunk cross-sectional tilt.** A small tilt from 12-1 momentum (skipping
  the most recent month, which is the standard construction because of
  short-term reversal), shrunk by a factor estimated out of sample.
- **Zero.** Genuinely defensible given the evidence, and the correct null.

**The design must support μ̂ = 0 as a first-class configuration**, because if
the shrunk tilt cannot beat zero out of sample, zero is the honest answer and
the system becomes a pure risk model. That is an ablation, not an admission.

Cap |μ̂| at a small multiple of σ̂ so the first moment can never dominate a
quantity we have shown is unforecastable.

### 3.3 Drawdown

For a drifted Brownian motion, the probability of the running minimum
breaching −x over horizon T has a closed form; with μ̂ ≈ 0 it reduces to a
simple reflection-principle expression in x/(σ̂√T). Expected maximum drawdown
similarly scales with σ̂√T.

So drawdown outputs are **derived from σ̂**, not separately fitted. The
measured drawdown IC of −0.320 is consistent with this: trailing volatility
already predicts forward drawdown, which is exactly what the closed form says
it should.

Report both P(DD > 10%) and P(DD > 20%) — the Risk Manager needs the tail
probability, not a point estimate.

### 3.4 Confidence — calibrated, not asserted

Raw confidence from a model is not a probability. The pipeline must be:

1. Raw score from the forecast's own dispersion (e.g. width of the σ̂
   prediction interval, or ensemble disagreement).
2. Map through a **reliability curve fitted on realised outcomes** —
   isotonic regression is the standard choice, with binned reliability as a
   simpler fallback.
3. Report the calibrated value, and always report ECE alongside it.

A stated 0.7 must mean "right about 70% of the time historically", or the
Risk Manager cannot size on it.

### 3.5 Cross-sectional rank

Percentile of μ̂/σ̂ within the day's universe. **This requires a
universe-level call**, which the current per-ticker architecture structurally
cannot make — that is the main structural change the redesign forces.

Worth stating clearly: cross-sectional ranking is a *different* problem from
absolute direction and is untested here. Given the absolute-direction result
I would not expect a large rank IC, but it is cheap to test and it is the
standard formulation in cross-sectional equity work.

### 3.6 Regime

Classify from realised quantities: volatility percentile against the asset's
own history, trend persistence, and drawdown state.

**Important caveat for the paper.** Regime has no observable ground truth —
the labels are constructed by us. Reporting "regime accuracy" against our own
labels is circular. Regime must be evaluated *instrumentally*: does
conditioning on regime improve the σ̂ forecast, or the calibration, or the
downstream decision? If it does not, it is presentation, not prediction.

### 3.7 Abstention

Abstain when the forecast is not usable, on two triggers:
- σ̂ prediction interval too wide (model does not know the risk), or
- |μ̂/σ̂| below a threshold (no directional view worth acting on).

Abstention is a first-class output. Under the evidence, the correct answer
most days is "no view", and a system that cannot say so will manufacture one.

---

## 4. Evaluation — one metric set per output

Directional accuracy is deliberately **not** the primary metric anywhere. It
discards magnitude, is insensitive to calibration, and we have already
measured that the underlying quantity is not predictable.

| Output | Primary metric | Secondary | Baseline to beat |
|---|---|---|---|
| **Volatility σ̂** | **QLIKE** and MSE on the variance proxy | Spearman IC, Mincer–Zarnowitz regression (slope should be 1, intercept 0) | HAR-RV, GARCH(1,1), EWMA (λ=0.94), random walk (RV_t) |
| **Expected return μ̂** | MAE **relative to a zero forecast** | IC, R² vs zero | μ̂ = 0 |
| **P(positive return)** | Brier score | ECE, reliability diagram | constant 0.5; base rate |
| **P(drawdown > x)** | Brier score, calibration curve | realised frequency vs predicted, per bucket | unconditional frequency |
| **Expected max drawdown** | MAE, RMSE | Spearman IC | trailing-vol scaling rule |
| **Confidence** | **ECE** | Brier, reliability diagram, sharpness | perfectly-calibrated constant |
| **Cross-sectional rank** | **Rank IC** (Spearman, per date, then averaged) | top-k precision, long-short decile spread, ICIR | random permutation |
| **Regime** | *instrumental only* — Δ in σ̂ QLIKE when conditioned | ΔECE, Δ downstream Sharpe | unconditional model |
| **Abstention** | **Risk–coverage curve**, AURC | accuracy at coverage {100, 50, 25, 10}% | random abstention at matched coverage |

Two methodological points that must appear in the paper:

**Volatility loss functions.** Patton (2011) shows that when the volatility
target is measured with a noisy proxy — as realised volatility always is —
most loss functions produce biased rankings of forecasts. **MSE and QLIKE are
robust to that noise; MAE is not.** Report QLIKE as primary. This is exactly
the kind of detail a finance reviewer checks.

**Rank IC must be computed per date, then averaged** (with ICIR = mean/std of
the daily series). Pooling across dates conflates cross-sectional with
time-series predictability and inflates the result.

---

## 5. Features

Everything below is backward-looking and computable from OHLCV. Grouped by
what it serves.

**Volatility forecasting (the primary task)**
- Realised volatility at 5/21/63/252 days — the HAR components
- **Range estimators: Parkinson, Garman–Klass, Rogers–Satchell** — the
  highest-value addition, since we already have H/L and currently ignore them
- Downside/upside semivariance
- Bipower variation and the implied jump component
- Vol-of-vol (volatility of the RV series)
- ATR and ATR/price
- Volatility term structure: RV_5 / RV_63

**Distributional shape**
- Rolling skewness and kurtosis (63d)
- Downside deviation, Sortino-style dispersion
- Maximum drawdown over trailing windows; time since peak; recovery duration

**Cross-sectional / relative**
- Rolling beta to a market proxy, and idiosyncratic volatility (residual σ)
- Market-relative and sector-relative strength
- Correlation to the market, and its recent change — correlations rise in
  crises, so this is regime-relevant

**Liquidity**
- **Amihud illiquidity** (|return| / dollar volume) — the standard measure
- Dollar volume, its trend, and turnover
- Volume surge vs trailing average

**Momentum, for the shrunk μ̂ only**
- 12-1 momentum (skipping the most recent month)
- Momentum decay: 5/21/63/126-day, to capture the horizon at which it fades

Deliberately excluded: anything requiring point-in-time fundamentals or news
archives, which we cannot source historically (§9).

---

## 6. Multi-agent information flow

The current design has agents voting BUY/SELL and a weighted-average fusion.
Under the evidence that direction is unforecastable, votes on direction are
votes on noise. The redesign replaces votes with **typed estimates**.

```
                    OHLCV (point-in-time)
                            |
                    feature engineering
                            |
        +-------------------+-------------------+
        |                                       |
   ANALYST (per ticker)                  MARKET / REGIME
   sigma_hat  <- the real forecast       vol percentile, trend,
   mu_hat     <- shrunk, may be 0        correlation state
   P(up), P(DD>x), E[MDD]                        |
   raw confidence                                |
        |                                        |
        +----------------> UNIVERSE RANKER <-----+
                     rank on mu_hat/sigma_hat
                     (needs the whole universe)
                            |
                       CALIBRATOR
              raw confidence -> empirical hit rate
                            |
                       ABSTAIN GATE
              wide interval or |IR| too small -> no view
                            |
                      RISK MANAGER
        consumes sigma_hat, P(DD>x), confidence, rank
        NOT a BUY/SELL vote
                            |
                    position size + limits
```

**What the Risk Manager should consume, and how**

- **σ̂ sets the position scale.** Target a risk budget, not a price view:
  `size ∝ target_vol / σ̂`, capped. This requires no directional forecast and
  is the one mechanism with published support.
- **P(DD > x) sets a hard constraint,** not a score. If P(DD > 20%) exceeds
  the profile's tolerance, the position is capped regardless of conviction.
- **Calibrated confidence scales within the risk budget,** never beyond it.
  A Kelly-style fraction on μ̂/σ̂² is principled, but must be fractional
  (quarter-Kelly or less) — full Kelly on an estimated edge is ruinous when
  the edge estimate is as weak as ours.
- **Rank gates entry** in a cross-sectional setting: act only on top/bottom
  decile, hold the rest flat.
- **Abstention blocks the recommendation entirely.** Not "hold" — *no view*.
  These are different and the UI must distinguish them.

**Researcher Agent.** Under the measured 2.4% news share and no historical
archive, news cannot participate in a historical backtest at all. Its honest
role is *live-only context and explanation*, contributing to the answer text
but not to sizing. Say so rather than quietly weighting it at zero.

**Planner.** Unchanged in structure, but intent now routes to *which
estimates are needed*: a `risk_check` needs σ̂ and P(DD>x) and nothing else;
an `advice` query needs the full set plus rank.

---

## 7. Paper impact

**Does this make FINDEC more consistent with an agentic decision-support
system?** Yes, and for a specific reason: agents that emit calibrated
probabilistic estimates with explicit abstention can be *composed and
audited*. Agents that emit BUY/SELL cannot — you cannot check whether a
"BUY" was well-calibrated. This turns the multi-agent claim from an
architectural assertion into something measurable.

**Is it a stronger scientific contribution?** Substantially, and the strength
does not depend on the redesign working:

> Agentic financial systems overwhelmingly forecast direction. We show, on
> 196 equities over 10 years, that direction is anti-predictive with this
> information set (IC −0.074) while volatility is strongly predictable
> (IC +0.554). We redesign the Analyst around estimable quantities and
> evaluate each output against its proper metric.

That is prescriptive and generalises to TradingAgents, FinRobot, and every
system FINSABER evaluated — all of which predict direction.

**If the redesigned Analyst performs well**, the contribution becomes: a
recipe. "Forecast risk, derive the rest, calibrate, abstain" plus the
evaluation protocol. The headline moves from "here is what fails" to "here
is what to build instead, with evidence for each part".

**If it performs no better**, the contribution is still intact — the
predictability asymmetry and the evaluation protocol stand on their own, and
the negative result on the redesign becomes an honest boundary on what is
achievable from OHLCV alone.

### New evaluation section

**§ Per-output evaluation of a probabilistic Analyst.** One subsection per
quantity, each with the metric table from §4, each against its named
baseline. This replaces the single directional-accuracy number and is a much
better fit for what a 2026 reviewer expects.

### Ablations that become necessary

1. **μ̂ = 0 vs shrunk tilt.** Does any first-moment estimate beat zero?
2. **HAR-RV vs GARCH vs EWMA vs random walk** for σ̂.
3. **Close-to-close vs range-based** volatility estimators — isolates the
   value of the H/L data currently discarded.
4. **Calibrated vs raw confidence** on downstream sizing.
5. **With vs without abstention**, on the risk–coverage curve.
6. **Cross-sectional rank vs per-ticker only.**
7. **Regime-conditioned vs unconditional** σ̂ — the instrumental test of
   whether regime is real.
8. **Derived vs separately-fitted drawdown** — is the closed form as good as
   a fitted model? If yes, that is a simplicity result worth reporting.

### Baselines

- **Volatility:** random walk (RV_t), EWMA λ=0.94 (RiskMetrics), GARCH(1,1),
  HAR-RV. Anything not beating HAR-RV is not a contribution.
- **Return:** zero forecast; historical mean; 12-1 momentum.
- **Rank:** random permutation; simple momentum rank.
- **Portfolio:** buy-and-hold; constant exposure at matched average (the
  control that beat the shipped system); inverse-vol weighting; equal-weight.
- **Calibration:** unconditional base rate.

Inverse-volatility weighting matters as a baseline because it is what a σ̂
forecast most naturally implies — if the full Analyst cannot beat naive
inverse-vol sizing, the extra machinery is unjustified.

---

## 8. Implementation order

Each step is independently useful and independently reportable.

| # | Step | Why first |
|---|---|---|
| 1 | HAR-RV σ̂ with walk-forward, vs the four baselines | The core forecast; everything derives from it |
| 2 | Add range-based estimators | Cheapest large gain; data already fetched |
| 3 | Derive P(up), P(DD>x), E[MDD] from σ̂ | Free once σ̂ exists |
| 4 | Calibration layer + ECE | Makes confidence usable |
| 5 | Abstention + risk–coverage curve | Makes "no view" representable |
| 6 | Universe ranker + Rank IC | The one untested hypothesis |
| 7 | Risk Manager consumes estimates, not votes | Completes the flow |

Steps 1–3 alone produce a publishable evaluation section.

---

## 9. Honest limits

- **No historical news or fundamentals.** Any component depending on them
  cannot be backtested here, and must be scoped to live operation only.
- **Survivorship.** The 196-name universe was selected in 2026; every
  constituent survived. This flatters all results and must be stated.
- **Volatility predictability is not profitability.** A good σ̂ improves risk
  control and sizing; it does not by itself generate return. The paper must
  not slide from "we can forecast risk" to "we can make money".
- **The redesign has not been evaluated.** Everything in this document is a
  design justified by the predictability measurements in §1. The IC of 0.554
  is measured; the performance of the redesigned Analyst is not.
