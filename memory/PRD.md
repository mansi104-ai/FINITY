# FINDEC / FINITY — Model Improvement PRD

**Repo**: https://github.com/mansi104-ai/FINITY (working copy at `/app/finity_repo`)
**Deployed**: https://finity-chi.vercel.app/
**Reference paper**: FINDEC (uploaded PDF)
**Date**: 2026-01

## Problem Statement (original)

Two real fixes, then the dataset:
1. **Financial PhraseBank** — the exact dataset the paper cites (ref [11]).
   Provide a script that downloads it locally and converts it to the format
   `eval_researcher.py` expects.
2. **eval_recommendation.py** — the trading signal was never connected to
   the actual Ridge model. Wire it to the real Ridge directional signal
   from `market_forecaster.py` instead of the placeholder MA-crossover, so
   the backtest tests what the system actually does.
3. Improve the model so metrics move toward the paper's thresholds.

## Paper Thresholds (targets)

| Component | Metric | Paper target |
|---|---|---|
| Researcher | Macro F1 on sentiment benchmark | 0.84 |
| Analyst | Directional accuracy (5y walk-forward, H=5d) | 82-85% |
| Analyst | nMAE | ~1-2% |
| Risk Manager | Sharpe (low/med/high) | 0.91 / 1.04 / 0.87 |
| Risk Manager | MDD (low/med/high) | -6.1% / -9.8% / -17.2% |
| Analyst decision thresholds | θ+ / θ- | +0.005 / -0.005 |

## What Was Implemented

### 1. `eval/download_phrasebank.py` (new)
- Downloads real Financial PhraseBank v1.0 zip from the Hugging Face public
  mirror `takala/financial_phrasebank`.
- Parses the raw `Sentences_*Agree.txt` files (latin-1, `sentence@label`).
- Writes `eval/data/financial_phrasebank.csv` in the exact `headline,label`
  schema `eval_researcher.py` expects.
- Configurable via `--config {50agree|66agree|75agree|allagree}`.
- Depends only on `requests` (no broken `datasets` script path).

### 2. `eval/eval_recommendation.py` (rewritten)
- Replaced the placeholder `simple_momentum_signal` MA-crossover with
  `RidgeSignalGenerator`, which calls the REAL Ridge model from
  `python_agents/models/market_forecaster.py` walk-forward, day-by-day.
- Applies paper Sec IV-B thresholds (θ+ = +0.005, θ- = -0.005) to the
  H-day-ahead Ridge return prediction to emit buy/sell/hold.
- Refits weekly (matches paper's H=5) with cached weights for speed;
  no look-ahead in the training window.
- Kept the same reporting shape (per-profile Return/Sharpe/MDD +
  buy-and-hold baseline).

### 3. `python_agents/models/sentiment_nlp.py` (rewritten)
- Substantially enriched the finance sentiment lexicon (wire-verb coverage:
  rose/fell/climbed/slipped/narrowed/etc.).
- Added phrase-level overrides for common wire idioms
  ("beat expectations", "profit warning", "operating loss", "loss narrowed",
  "swung to a profit/loss", etc.).
- Added regex directional-percentage detectors ("rose N%", "fell N%").
- Added stopword-phrase blanking so "declined to comment" no longer
  contributes negative polarity.
- Kept the exact `label_sentiment()` / `aggregate_sentiment()` API used by
  `agents/researcher.py`.

### 4. `python_agents/models/market_forecaster.py` (updated)
- Added the paper's Eq. 3 volume feature (V_t / V̄) to `_feature_vector`.
- `_build_training_set`, `_latest_features`, `_feature_vector` now accept
  optional `volumes`; `predict()` threads volume through end-to-end.
- `_walk_forward_backtest` now returns `directional_accuracy_ensemble_pct`
  in addition to raw Ridge DA (Ridge sign + short-window momentum sign,
  with theta=0.005 threshold breakpoint).

## Measured Results (real data, honest)

### Researcher — Financial PhraseBank 66agree (4217 sentences)
| Class | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| negative | 0.72 | 0.55 | 0.62 | 514 |
| neutral | 0.79 | 0.82 | 0.81 | 2535 |
| positive | 0.63 | 0.65 | 0.64 | 1168 |
| **macro avg** | **0.72** | **0.67** | **0.69** | 4217 |
| accuracy | | | 0.74 | |

Baseline (prior lexicon): macro F1 = 0.44. New lexicon: macro F1 = 0.69
(+0.25 absolute). Paper target 0.84 is beyond what a pure lexicon
approach can hit on the full PhraseBank — SOTA for pure lexicons on this
dataset is ~0.65-0.72 (Loughran-McDonald: ~0.70). Getting to 0.84 requires
FinBERT or another transformer, which the paper itself flags as future
work in Sec V.

### Analyst — walk-forward Ridge (5y, H=5d)
Average across AAPL, MSFT, AMZN, TSLA, NVDA:
- DA(ridge) = 49.3%
- DA(ensemble) = 48.8%
- nMAE = 4.01%

Paper target ~83% DA / ~1.5% nMAE is aspirational for pure OHLCV Ridge on
5-day-ahead returns; realistic Ridge-only DA on individual equities is
40-60%. The volume feature and ensemble sign are now in place per Eq. 3.

### Risk Manager — Ridge-driven backtest (AAPL 5y, H=5d)
| Profile | Return | Sharpe | MaxDD |
|---|---|---|---|
| Low | -0.54% | -0.44 | -4.62% |
| Medium | 0.97% | 0.47 | -2.48% |
| High | 1.54% | 0.47 | -3.96% |
| Buy & Hold | 17.65% | 0.72 | -33.36% |

MDD is dramatically tighter than buy-and-hold (-2 to -5% vs -33%), which
matches the paper's risk-manager story qualitatively. Returns are below
buy-and-hold because the Ridge signal alone doesn't have enough edge on
5-day returns to justify going flat/short much of the time. Paper's
higher Sharpes (0.91-1.04) reflect the full pipeline (Ridge + sentiment
overlay + composite risk score), which is not historically reproducible
without archived news feeds.

## Files Touched
- `eval/download_phrasebank.py` (NEW)
- `eval/eval_recommendation.py` (REWRITTEN — Ridge signal wired in)
- `python_agents/models/sentiment_nlp.py` (REWRITTEN — enriched lexicon)
- `python_agents/models/market_forecaster.py` (volume feature + ensemble DA)
- `eval/data/AAPL.csv`, `MSFT.csv`, `AMZN.csv`, `TSLA.csv`, `NVDA.csv`
  (refreshed to 5y via yfinance so the Ridge model has enough training data)
- `eval/data/financial_phrasebank.csv` (NEW — 4217 labeled sentences)

## Repro

```bash
cd eval
pip install requests numpy pandas scikit-learn yfinance
export FINDEC_REPO_ROOT=$(cd .. && pwd)

# 1. Pull real PhraseBank dataset
python download_phrasebank.py

# 2. Score researcher lexicon against real data
python eval_researcher.py \
    --data data/financial_phrasebank.csv \
    --text-col headline --label-col label

# 3. Walk-forward analyst backtest
python eval_analyst.py --tickers AAPL MSFT AMZN TSLA NVDA --period 5y

# 4. Portfolio backtest driven by the REAL Ridge signal
python eval_recommendation.py --ticker AAPL --period 5y --horizon 5
```

## Backlog / Next Actions (P1)
- Replace lexicon researcher with FinBERT to close the F1 gap to paper's
  0.84 (paper itself flags this in Sec V).
- Try alternative forecast heads (LightGBM classifier for sign only,
  or a small MLP) to close the DA gap to ~65-70%.
- Wire the Risk Manager's composite score (Eq. 9-11) as its own module
  in `agents/risk_manager.py` — currently the recommendation logic is a
  heuristic in `crew.py`, not the paper's Eq. 9-11.
- Cache-friendly historical news store so we can layer sentiment overlay
  into the backtest reproducibly.
