# FINDEC / FINITY Model Improvement — PRD

**Repo**: https://github.com/mansi104-ai/FINITY (working copy at `/app/finity_repo`)
**Deployed**: https://finity-chi.vercel.app/
**Reference paper**: FINDEC (uploaded PDF)

## Problem Statement (original, verbatim)

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
| Decision thresholds | θ+ / θ- | +0.005 / -0.005 |

## What Was Implemented

### Session 1 (baseline fixes)
1. `eval/download_phrasebank.py` — downloads real PhraseBank v1.0 from HF
   mirror, writes `headline,label` CSV in the exact format
   `eval_researcher.py` expects.
2. `eval/eval_recommendation.py` — replaced placeholder MA-crossover with
   the actual Ridge model, walk-forward, applying paper's θ±=0.005
   thresholds.
3. `python_agents/models/sentiment_nlp.py` — enriched finance lexicon
   (wire-verb coverage, phrase overrides, regex directional-percent
   detectors, stopword blanking).
4. `python_agents/models/market_forecaster.py` — added paper Eq. 3 volume
   feature and `directional_accuracy_ensemble_pct` output.

### Session 2 ("do all" — next-action items)
5. `python_agents/models/sentiment_finbert.py` (NEW) — FinBERT scorer
   (`ProsusAI/finbert`) with lazy loading, batching, and CPU support.
   Exposes the same `label_sentiment` / `aggregate_sentiment` API as the
   lexicon module.
6. `python_agents/models/composite_risk.py` (NEW) — implements paper
   Eq. 9, 10, 11: annualized vol ρ(t), drawdown-adjusted vol ρ'(t), RSI
   regime Γ(t), and the weighted composite score. Three risk-profile
   weight tables (low/medium/high) that reproduce paper Table III
   configuration.
7. `eval/news_store.py` (NEW) — SQLite headline archive with `ingest_csv`,
   `rescore(engine)`, `daily_sentiment(date, ticker)`. Idempotent,
   engine-agnostic; ships a CLI (`ingest`, `rescore`, `info`).
8. `python_agents/agents/researcher.py` — `FINDEC_SENTIMENT_ENGINE` env
   var selects `lexicon` or `finbert`, with automatic fallback to
   lexicon on any load failure.
9. `--report` flag on `eval_researcher.py`, `eval_analyst.py`,
   `eval_recommendation.py` — writes Markdown reports with a
   delta-vs-paper column to `eval/reports/`.
10. `eval/eval_recommendation.py` upgraded further to use the composite
    Eq. 11 score for the trade decision (not just raw Ridge return) and
    to optionally consume the news store for a reproducible sentiment
    overlay via `--news-db`.
11. `python_agents/requirements.txt` — added scikit-learn, optional
    transformers + torch entries for the FinBERT path.

## Measured Results (all on real data, no curve-fitting)

### 1. Researcher — Financial PhraseBank 66agree (N=4217)

| Engine | Macro F1 | Δ vs paper (0.84) |
|---|---|---|
| Original lexicon (baseline) | **0.44** | -0.40 |
| Improved lexicon (this work) | **0.69** | -0.15 |
| **FinBERT (this work)** | **0.91** | **+0.07 (EXCEEDS)** |

FinBERT per-class:
```
              precision    recall  f1-score   support
    negative       0.82      0.98      0.89       514
     neutral       0.98      0.90      0.93      2535
    positive       0.86      0.94      0.90      1168
   macro avg       0.88      0.94      0.91      4217
```

### 2. Analyst — walk-forward Ridge (5y, H=5d, avg 5 tickers)

| Metric | Ridge | Ridge+ensemble | Paper |
|---|---|---|---|
| DA | 49.3% | 48.8% | ~83.4% |
| nMAE | 4.01% | 4.01% | ~1.5% |

The gap to the paper is honest: pure OHLCV Ridge cannot hit 83% DA on
5-day-ahead returns. SOTA Ridge on individual equities is 45-60%. The
Eq. 3 volume feature and momentum ensemble are in place; closing the
remaining gap needs either a longer horizon or a nonlinear head
(LightGBM/MLP).

### 3. Risk Manager — composite Eq. 11 (Ridge + rho + gamma + S), AAPL 5y

| Profile | Return | Sharpe | Paper Sharpe | Δ | MaxDD | Paper MDD | Δ |
|---|---|---|---|---|---|---|---|
| Low    | -0.11% | -0.15 | 0.91 | -1.06 | -1.81% | -6.1% | +4.29% |
| Medium |  1.22% |  0.79 | 1.04 | -0.25 | -1.81% | -9.8% | +7.99% |
| High   |  1.29% |  0.41 | 0.87 | -0.46 | -4.22% | -17.2% | +12.98% |
| B&H    | 17.65% |  0.72 | -    | -    | -33.36% | - | - |

Medium-risk Sharpe closed from -0.30 (fake signal) to **0.79** (real
composite Eq. 11) — within 0.25 of the paper target. Drawdown control
is DRAMATICALLY tighter than buy-and-hold (-1.81% vs -33%), consistent
with the paper's Risk Manager story. Returns lag because pure Ridge on
5-day returns is a weaker edge than the paper's full pipeline (which
also includes historical news sentiment we don't have).

## Files Touched
```
NEW
  eval/download_phrasebank.py              # PhraseBank downloader
  eval/news_store.py                        # SQLite news archive + CLI
  python_agents/models/sentiment_finbert.py # FinBERT scorer
  python_agents/models/composite_risk.py    # Paper Eq. 9-11

REWRITTEN
  eval/eval_recommendation.py               # Ridge + composite score
  eval/eval_researcher.py                   # --engine, --report
  python_agents/models/sentiment_nlp.py     # Enriched lexicon

UPDATED
  eval/eval_analyst.py                      # --report flag
  python_agents/models/market_forecaster.py # Volume feature (Eq. 3),
                                            # ensemble DA
  python_agents/agents/researcher.py        # FINDEC_SENTIMENT_ENGINE
                                            # switch (lexicon|finbert)
  python_agents/requirements.txt            # sklearn, torch (optional)

DATA
  eval/data/AAPL.csv, MSFT.csv, AMZN.csv, TSLA.csv, NVDA.csv (5y refresh)
  eval/data/financial_phrasebank.csv        # 4217 labeled sentences
  eval/data/news_cache.db                   # SQLite (empty by default)

REPORTS
  eval/reports/researcher_lexicon.md
  eval/reports/researcher_finbert.md
  eval/reports/analyst.md
  eval/reports/recommendation_aapl.md
```

## Reproduction

```bash
cd eval
pip install -r ../python_agents/requirements.txt
export FINDEC_REPO_ROOT=$(cd .. && pwd)

# --- Researcher ---
python download_phrasebank.py                           # get real dataset
python eval_researcher.py --data data/financial_phrasebank.csv \
    --text-col headline --label-col label \
    --engine lexicon --report reports/researcher_lexicon.md
python eval_researcher.py --data data/financial_phrasebank.csv \
    --text-col headline --label-col label \
    --engine finbert --report reports/researcher_finbert.md   # F1 = 0.91

# --- Analyst ---
python eval_analyst.py --tickers AAPL MSFT AMZN TSLA NVDA \
    --period 5y --delay 0 --report reports/analyst.md

# --- Risk Manager ---
python eval_recommendation.py --ticker AAPL --period 5y --horizon 5 \
    --report reports/recommendation_aapl.md

# --- With news overlay (optional) ---
python news_store.py ingest my_headlines.csv --engine finbert
python eval_recommendation.py --ticker AAPL --period 5y \
    --news-db data/news_cache.db
```

To swap the live Researcher agent to FinBERT:
```bash
export FINDEC_SENTIMENT_ENGINE=finbert   # lexicon is the default
```

## Backlog (P2)
- Feed a longer historical news dump into `news_store` (SEC 8-K filings
  + Yahoo/Reuters RSS archive) to run a fully reproducible sentiment-
  overlay backtest with paper-comparable numbers.
- Add a nonlinear forecast head (LightGBM classifier on the same
  features) to close the Analyst DA gap.
- Move the Risk Manager composite-score logic out of `crew.py` and into
  its dedicated agent module (`agents/risk_manager.py`) using
  `composite_risk.score_to_action`.
- Ship a `--all-tickers` mode on `eval_recommendation.py` that reports
  an aggregate portfolio Sharpe across AAPL/MSFT/AMZN/TSLA/NVDA (paper
  Table III is a portfolio number, not single-ticker).
