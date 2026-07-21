"""Measure Planner intent-classification accuracy against a labelled set.

Ground truth comes from two places, kept separate because they carry
different authority:

**published** -- verbatim sample questions from Blankespoor et al., Table 9,
with that table's own category as the label. These are real retail-investor
questions to Public.com's Alpha, labelled by that paper's authors, and the
mapping to FINDEC intents is recorded in docs/QUERY_TAXONOMY.md. Their SBERT
classifier scores 0.75 on this task, which is the number to beat.

**authored** -- written here to cover `advice` and `risk_check`, which the
source excludes by platform policy. These are ours, so they are reported
separately: scoring well on labels we invented proves less than scoring well
on labels someone else published.

Two modes:
  --individual  one call per question. Matches production and is the number
                to quote. Costs one LLM call per item.
  --batch       all questions in one call. Cheap for iterating on the prompt,
                but the model sees the other questions and can classify by
                contrast, so it is NOT comparable to the published baseline.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "python_agents"))

from contracts import PLANNER_PROMPT_VERSION, PLANNER_SYSTEM, TASK_GRAPH_SCHEMA, Intent  # noqa: E402
from services.llm import get_llm, stable_key  # noqa: E402
from agents.planner_v2 import PlannerAgent  # noqa: E402


# (question, gold_intent, provenance)
LABELLED = [
    # --- published: Blankespoor et al. Table 9 -----------------------
    ("Why is NVDA moving?", "interpret", "published"),
    ("How healthy are their margins?", "interpret", "published"),
    ("How is their battery business performing?", "interpret", "published"),
    ("Show me some stocks at 52 week highs", "screen", "published"),
    ("What are some interesting companies working on climate change?", "screen", "published"),
    ("What stocks have a negative beta?", "screen", "published"),
    ("What are some pros and cons of this investment?", "assess", "published"),
    ("How's MSFT been doing?", "assess", "published"),
    ("What do you think about Ferrari stocks?", "assess", "published"),
    ("What does this company do?", "company_profile", "published"),
    ("What's their AI strategy?", "company_profile", "published"),
    ("Where does most of their revenue come from?", "company_profile", "published"),
    ("Summarize their most recent earnings call", "summarize", "published"),
    ("Give me a TL;DR on recent headlines", "summarize", "published"),
    ("Summarize coinbase latest earnings report", "summarize", "published"),
    ("What is the P/E ratio?", "data_point", "published"),
    ("How many vehicles did they deliver last quarter?", "data_point", "published"),
    ("What was Nvidia's gaming revenue in 2023?", "data_point", "published"),
    ("What's coupon vs yield rate?", "define", "published"),
    ("What does high liquidity mean?", "define", "published"),
    ("If a stock splits, what happens to my position?", "define", "published"),
    ("How has growth trended over the last year?", "trend", "published"),
    ("How has TSLA stock performed the last six months?", "trend", "published"),
    ("How has theater attendance been trending?", "trend", "published"),
    ("How does gaming compare to other revenue segments?", "compare", "published"),
    ("How does Tsla compare to RIVN?", "compare", "published"),

    # --- authored: intents the source excludes ------------------------
    ("Should I add to my Apple position? Six months out, I'm aggressive.", "advice", "authored"),
    ("I'm up 40% on Nvidia and nervous about earnings in three weeks. "
     "Should I take some off the table?", "advice", "authored"),
    ("Is now a good time to buy AMD?", "advice", "authored"),
    ("Thinking of trimming my Microsoft stake before the Fed meeting.", "advice", "authored"),
    ("What's my downside if I hold 200 shares of TSLA through earnings?", "risk_check", "authored"),
    ("How much could I lose on a $10,000 position in Netflix over a month?", "risk_check", "authored"),
    ("What position size in GOOGL makes sense if I can't stomach a 15% drawdown?",
     "risk_check", "authored"),
]

_INTENTS = [i.value for i in Intent]

# Reuse the production intent property verbatim -- description included.
# An earlier version declared a bare {"type":"string","enum":_INTENTS} here,
# which silently measured a different classifier from the one that ships: all
# the disambiguation text lives in TASK_GRAPH_SCHEMA and was never sent. The
# symptom was label renames moving the score while description edits did
# nothing, because only enum *values* were reaching the model.
_INTENT_PROPERTY = TASK_GRAPH_SCHEMA["properties"]["intent"]

BATCH_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["classifications"],
    "properties": {
        "classifications": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["index", "intent"],
                "properties": {
                    "index": {"type": "integer"},
                    "intent": _INTENT_PROPERTY,
                },
            },
        }
    },
}


def run_batch(items):
    llm = get_llm()
    listing = "\n".join(f"{i}. {q}" for i, (q, _, _) in enumerate(items))
    res = llm.complete_json(
        system=PLANNER_SYSTEM,
        user=("Classify each query by primary intent. Return one entry per "
              "query, using its index.\n\n" + listing),
        schema=BATCH_SCHEMA,
        schema_name="batch_intents",
        category="planner",
        cache_key=stable_key("intent-batch", PLANNER_PROMPT_VERSION, listing),
        max_tokens=2000,
    )
    if res is None:
        print(f"batch call failed: {llm.last_error}")
        return None
    got = {c["index"]: c["intent"] for c in res.data.get("classifications", [])}
    return [got.get(i, "<missing>") for i in range(len(items))]


def run_individual(items):
    planner = PlannerAgent()
    out = []
    for i, (q, _, _) in enumerate(items, 1):
        g = planner.plan(q)
        out.append(g.intent.value if g.planned_by != "deterministic-fallback"
                   else "<fallback>")
        print(f"    {i}/{len(items)} {out[-1]:14s} {q[:56]}")
    return out


def report(items, preds):
    rows = [(q, gold, prov, pred) for (q, gold, prov), pred in zip(items, preds)]

    # `strict: true` does not reliably constrain enum MEMBERSHIP on free-tier
    # OpenRouter -- an agent name ("fundamentals") was once returned in the
    # intent field. Structure is enforced; the value set is not. So validate
    # explicitly and report violations separately from ordinary errors: a
    # value outside the enum is a contract failure, not a wrong label.
    valid = set(_INTENTS)
    violations = [(q, p) for q, _, _, p in rows if p not in valid]
    if violations:
        print("\n--- SCHEMA VIOLATIONS (value outside intent enum) ---")
        for q, p in violations:
            print(f"  returned {p!r} for: {q[:60]}")
        print(f"  rate: {len(violations)}/{len(rows)} = {len(violations)/len(rows):.1%}")

    print("\n--- misclassifications ---")
    for q, gold, prov, pred in rows:
        if pred != gold:
            flag = "  <-- INVALID" if pred not in valid else ""
            print(f"  gold={gold:15s} pred={pred:15s} [{prov:9s}] {q[:50]}{flag}")

    print("\n--- accuracy ---")
    overall = sum(p == g for _, g, _, p in rows) / len(rows)
    for prov in ("published", "authored"):
        sub = [r for r in rows if r[2] == prov]
        if sub:
            acc = sum(p == g for _, g, _, p in sub) / len(sub)
            print(f"  {prov:10s} n={len(sub):3d}  accuracy={acc:.3f}")
    print(f"  {'OVERALL':10s} n={len(rows):3d}  accuracy={overall:.3f}")

    pub = [r for r in rows if r[2] == "published"]
    if pub:
        pub_acc = sum(p == g for _, g, _, p in pub) / len(pub)
        base = 0.75
        verdict = "ABOVE" if pub_acc > base else ("EQUAL" if pub_acc == base else "BELOW")
        print(f"\n  Blankespoor et al. SBERT baseline (task classification): {base:.2f}")
        print(f"  FINDEC planner on published subset:                      {pub_acc:.3f}  [{verdict}]")
        print("  NOTE: same task, different sample. Indicative, not a like-for-like"
              "\n        comparison -- their 0.75 is over a 300-question holdout.")

    print("\n--- per-gold-label recall ---")
    by_gold = Counter(g for _, g, _, _ in rows)
    hit = Counter(g for _, g, _, p in rows if p == g)
    for lbl in sorted(by_gold):
        print(f"  {lbl:14s} {hit[lbl]}/{by_gold[lbl]}")
    return overall


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["batch", "individual"], default="batch")
    ap.add_argument("--out", default=str(_HERE / "results" / "planner_intent.json"))
    a = ap.parse_args()

    print(f"mode={a.mode}  n={len(LABELLED)}  prompt={PLANNER_PROMPT_VERSION}")
    print(f"budget before: {json.dumps(get_llm().budget_report()['by_category']['planner'])}")

    preds = run_batch(LABELLED) if a.mode == "batch" else run_individual(LABELLED)
    if preds is None:
        return 1
    acc = report(LABELLED, preds)

    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps({
        "mode": a.mode,
        "prompt_version": PLANNER_PROMPT_VERSION,
        "n": len(LABELLED),
        "accuracy": acc,
        "predictions": [
            {"query": q, "gold": g, "provenance": pr, "pred": p}
            for (q, g, pr), p in zip(LABELLED, preds)
        ],
    }, indent=2), encoding="utf-8")
    print(f"\nwrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
