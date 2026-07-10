"""
run_logger.py

Drop-in logger for FINDEC's FastAPI POST /run endpoint. Appends ONE ROW
PER REAL REQUEST to a CSV file, starting from whenever you deploy this --
not backfilled. This becomes your genuine, growing evaluation dataset:
after a few weeks of real usage you'll have real query/response pairs
you can analyze, re-score against ground truth, and cite honestly.

INTEGRATION (in your FastAPI app, e.g. main.py):

    from run_logger import log_run

    @app.post("/run")
    def run_pipeline(query: dict):
        result = crew.run(query)
        log_run(query=query, result=result)   # <-- add this line
        return result

That's it. Every call appends a row.

Fields logged: timestamp, ticker, version, risk_profile, sentiment
score/level, predicted return/confidence, risk level, final action,
buy_score, and total latency. Enough to reconstruct real Table I/II/III/IV
style stats later -- but built from what actually happened, run by run.
"""

import csv
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

LOG_PATH = Path(os.getenv("FINDEC_RUN_LOG_PATH", "findec_run_log.csv"))
_lock = threading.Lock()

FIELDNAMES = [
    "timestamp_utc",
    "ticker",
    "user_query",
    "version",
    "risk_profile",
    "sentiment_level",
    "sentiment_score",
    "sentiment_confidence",
    "predicted_return_pct",
    "prediction_confidence",
    "backtest_directional_accuracy_pct",
    "risk_level",
    "value_at_risk_pct",
    "final_action",
    "buy_score",
    "buy_threshold",
    "total_latency_ms",
    "data_source",  # "yfinance" or "synthetic" -- important for honest reporting later
]


def _ensure_header():
    if not LOG_PATH.exists():
        with open(LOG_PATH, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
            writer.writeheader()


def log_run(query: dict, result: dict) -> None:
    """Call this once per real /run request, after computing the result."""
    _ensure_header()

    sentiment = result.get("sentiment") or {}
    prediction = result.get("prediction") or {}
    risk = result.get("risk") or {}
    recommendation = result.get("recommendation") or {}
    backtest = (prediction or {}).get("backtest") or {}

    total_latency_ms = sum(
        (log.get("durationMs") or 0) for log in result.get("agentLogs", [])
    )

    row = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "ticker": result.get("ticker"),
        "user_query": query.get("query", ""),
        "version": result.get("version"),
        "risk_profile": query.get("risk_profile", ""),
        "sentiment_level": sentiment.get("level"),
        "sentiment_score": sentiment.get("score"),
        "sentiment_confidence": sentiment.get("confidence"),
        "predicted_return_pct": prediction.get("predictedReturnPct") if prediction else "",
        "prediction_confidence": prediction.get("confidence") if prediction else "",
        "backtest_directional_accuracy_pct": backtest.get("directionalAccuracyPct", ""),
        "risk_level": risk.get("level") if risk else "",
        "value_at_risk_pct": risk.get("valueAtRiskPct") if risk else "",
        "final_action": recommendation.get("action"),
        "buy_score": recommendation.get("buyScore"),
        "buy_threshold": recommendation.get("buyThreshold"),
        "total_latency_ms": total_latency_ms,
        "data_source": prediction.get("dataSource", "unknown") if prediction else "",
    }

    with _lock:
        with open(LOG_PATH, "a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
            writer.writerow(row)


def summarize_log(path: Optional[Path] = None) -> None:
    """
    Quick sanity-check summary of the log so far. Run this periodically
    (e.g. `python run_logger.py`) to see real usage stats accumulate --
    this is your genuine, growing evidence base for the paper's revision.
    """
    p = path or LOG_PATH
    if not p.exists():
        print(f"No log yet at {p}. It will be created on the first real /run call.")
        return

    with open(p, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    print(f"Total logged runs: {len(rows)}")
    if not rows:
        return

    versions = {}
    actions = {}
    for r in rows:
        versions[r["version"]] = versions.get(r["version"], 0) + 1
        actions[r["final_action"]] = actions.get(r["final_action"], 0) + 1

    print("By version:", versions)
    print("By final action:", actions)

    latencies = [float(r["total_latency_ms"]) for r in rows if r["total_latency_ms"]]
    if latencies:
        print(f"Mean latency: {sum(latencies)/len(latencies):.0f} ms "
              f"(min={min(latencies):.0f}, max={max(latencies):.0f})")


if __name__ == "__main__":
    summarize_log()
