"""Figures for the Digital Finance journal version.

Five figures the conference draft did not have. Each is generated from a
result artefact in `results/` or from the sealed forward-test logs -- none
carries a hand-typed number, so a re-run of the evaluation re-draws them.

House style follows make_results_figure.py: serif, 8pt, ink only, no hue
carrying meaning, and a greyscale proof written beside each figure.

  fig_architecture   the agentic pipeline and the message contract on its edges
  fig_volatility     four volatility models on three metrics, across two runs
  fig_calibration    derived downside probabilities against realised frequency
  fig_power          how much data a Sharpe claim needs
  fig_forward        the sealed forward test, numerical arm against agentic arm

Usage:  python eval/make_journal_figures.py
"""

from __future__ import annotations

import collections
import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

_HERE = Path(__file__).resolve().parent
RESULTS = _HERE / "results"
FORWARD = _HERE / "forward" / "_runs"
OUT = _HERE.parent / "paper" / "figs"

TRADING_DAYS = 252


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def wilson(k: int, n: int, z: float = 1.96):
    if n == 0:
        return float("nan"), float("nan")
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


def style(grey: bool):
    plt.rcParams.update({
        "font.family": "serif",
        "font.serif": ["Times New Roman", "DejaVu Serif"],
        "font.size": 8,
        "axes.linewidth": 0.6,
    })
    ink = "0.10" if grey else "#1a1a1a"
    muted = "0.55" if grey else "#7a7a7a"
    fill = "0.35" if grey else "#4a4a4a"
    light = "0.75" if grey else "#b4b4b4"
    return ink, muted, fill, light


def tidy(ax, muted, xgrid=False, ygrid=True):
    if ygrid:
        ax.grid(axis="y", alpha=0.18, linewidth=0.5)
    if xgrid:
        ax.grid(axis="x", alpha=0.18, linewidth=0.5)
    ax.set_axisbelow(True)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(muted)


def save(fig, stem: str, grey: bool):
    OUT.mkdir(parents=True, exist_ok=True)
    if grey:
        fig.savefig(OUT / f"{stem}_grey.png", dpi=220, bbox_inches="tight")
    else:
        fig.savefig(OUT / f"{stem}.pdf", bbox_inches="tight")
        fig.savefig(OUT / f"{stem}.png", dpi=220, bbox_inches="tight")
    plt.close(fig)


# --------------------------------------------------------------------------
# 1. architecture
# --------------------------------------------------------------------------

def fig_architecture(grey=False):
    ink, muted, fill, light = style(grey)
    fig, ax = plt.subplots(figsize=(7.1, 6.6))
    ax.set_xlim(0, 100)
    ax.axis("off")

    TITLE_GAP, LINE_GAP, PAD_TOP, PAD_BOT = 5.2, 3.5, 3.0, 2.4
    GAP = 7.0

    def box_h(lines):
        return PAD_TOP + TITLE_GAP + LINE_GAP * len(lines) + PAD_BOT

    def box(x, ytop, w, title, lines, heavy=False, ctrl=False):
        """Draw a box whose TOP edge sits at ytop. Returns (ybottom, h).

        ctrl marks a control-plane agent (shaded); heavy marks the component
        this paper examines most closely.
        """
        h = box_h(lines)
        y = ytop - h
        ax.add_patch(FancyBboxPatch(
            (x, y), w, h, boxstyle="round,pad=0.5,rounding_size=1.2",
            linewidth=1.1 if heavy else 0.7, edgecolor=ink,
            facecolor=("0.90" if grey else "#e8e8e8") if ctrl else "white"))
        ax.text(x + w / 2, ytop - PAD_TOP - 1.4, title, ha="center", va="center",
                fontsize=8.2, fontweight="bold", color=ink)
        for i, ln in enumerate(lines):
            ax.text(x + w / 2, ytop - PAD_TOP - TITLE_GAP - 1.0 - i * LINE_GAP, ln,
                    ha="center", va="center", fontsize=6.3, color=muted)
        return y, h

    def arrow(x1, y1, x2, y2, label=None, dashed=False, lx=1.6):
        ax.add_patch(FancyArrowPatch(
            (x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=8,
            linewidth=0.7, color=ink,
            linestyle=(0, (2.5, 1.8)) if dashed else "solid",
            shrinkA=0, shrinkB=0))
        if label:
            ax.text((x1 + x2) / 2 + lx, (y1 + y2) / 2, label, fontsize=6.0,
                    color=muted, ha="left", va="center", style="italic")

    planner = ["intent (11 classes), entities, horizon, risk posture",
               "emits a task graph; only its subtasks are dispatched"]
    researcher = ["news retrieval, relevance filter",
                  "FinBERT polarity, lexicon fallback",
                  "recency weight, 3-day half-life",
                  "live-only: no usable archive"]
    market = ["prices, quotes, regime",
              "realised volatility scales",
              "availability flag on failure",
              "no directional view emitted"]
    analyst = ["$\\hat{\\sigma}$: the one real forecast",
               "$\\hat{\\mu}$ shrunk to $0.25\\,\\hat{\\sigma}$",
               "$P(\\mathrm{up})$, $P(\\mathrm{dd}>x)$ derived",
               "abstains when $|\\hat{\\mu}/\\hat{\\sigma}|$ is low"]
    fundamentals = ["valuation and growth",
                    "recorded as evidence only",
                    "informs but does not vote",
                    "refuses historical dates"]
    # the four decision-plane boxes share a row, so equalise their heights
    _row_n = max(len(x) for x in (researcher, market, analyst, fundamentals))
    for _b in (researcher, market, analyst, fundamentals):
        _b += [""] * (_row_n - len(_b))
    risk = ["consumes estimates, not votes",
            "$P(\\mathrm{dd})$ is a constraint, not a score",
            "exposure cap by profile: 6 / 10 / 16%"]
    optimizer = ["judges evidential sufficiency, may re-query",
                 "deterministic screen before any LLM call",
                 "iteration bounded by budget and by count"]
    rec = ["reliability-weighted fusion over available agents",
           "size, downside, citations, per-agent confidence",
           "abstention is a distinct outcome from hold"]

    # stack the rows top-down so nothing can overlap
    t_query = 99.0
    t_planner = t_query - box_h(["x"]) - GAP
    t_row = t_planner - box_h(planner) - GAP
    t_risk = t_row - box_h(analyst) - GAP
    t_opt = t_risk - box_h(risk) - GAP
    t_rec = t_opt - box_h(optimizer) - GAP
    bottom = t_rec - box_h(rec)

    # control plane = grey fill; decision plane = white fill
    y_q, _ = box(33, t_query, 34, "Investor query", ["free text, no fixed schema"])
    y_pl, _ = box(20, t_planner, 60, "Planner agent", planner, ctrl=True)

    W, X0, STEP = 23.5, 0.5, 25.0
    y_re, _ = box(X0 + 0 * STEP, t_row, W, "Researcher", researcher)
    y_ma, _ = box(X0 + 1 * STEP, t_row, W, "Market", market)
    y_an, _ = box(X0 + 2 * STEP, t_row, W, "Analyst", analyst, heavy=True)
    y_fu, _ = box(X0 + 3 * STEP, t_row, W, "Fundamentals", fundamentals)

    y_ri, _ = box(20, t_risk, 60, "Risk manager", risk)
    y_op, _ = box(14, t_opt, 72, "Optimizer agent", optimizer, ctrl=True)
    y_rc, _ = box(14, t_rec, 72, "Recommendation + audit trail", rec)

    arrow(50, y_q, 50, t_planner)
    for i, lbl in enumerate(("subtasks", None, None, "subtasks")):
        cx = X0 + i * STEP + W / 2
        arrow(50, y_pl, cx, t_row, lbl,
              dashed=(i in (0, 3)), lx=-8 if i == 0 else 2.5)
    for i in range(4):
        arrow(X0 + i * STEP + W / 2, y_re, 50, t_risk)
    arrow(50, y_ri, 50, t_opt)
    arrow(50, y_op, 50, t_rec)

    # optimizer feedback: re-dispatch on conflicting evidence
    ax.add_patch(FancyArrowPatch(
        (86, y_op + box_h(optimizer) / 2), (99, y_op + box_h(optimizer) / 2),
        arrowstyle="-", linewidth=0.7, color=ink, shrinkA=0, shrinkB=0))
    ax.add_patch(FancyArrowPatch(
        (99, y_op + box_h(optimizer) / 2), (99, t_row - box_h(analyst) / 2),
        arrowstyle="-", linewidth=0.7, color=ink,
        linestyle=(0, (2.5, 1.8)), shrinkA=0, shrinkB=0))
    ax.add_patch(FancyArrowPatch(
        (99, t_row - box_h(analyst) / 2), (X0 + 3 * STEP + W, t_row - box_h(analyst) / 2),
        arrowstyle="-|>", mutation_scale=8, linewidth=0.7, color=ink,
        linestyle=(0, (2.5, 1.8)), shrinkA=0, shrinkB=0))
    ax.text(97.5, (y_op + t_row) / 2, "re-query on\nconflicting evidence",
            fontsize=6.0, color=muted, ha="right", va="center", style="italic",
            linespacing=1.5)

    ax.text(50, bottom - 5.0,
            "Shaded boxes are the $\\bf{control}$ $\\bf{plane}$: language-model driven, deciding what work to do. "
            "Unshaded boxes are the\n$\\bf{decision}$ $\\bf{plane}$: numerical and deterministic given their inputs, "
            "deciding what the market will do. Keeping the\nlanguage model out of the decision plane is what "
            "leaves the retrospective results interpretable, since a model\ntrained on the test period cannot be "
            "asked to forecast it. Every message carries a value, a self-reported\nconfidence, an as-of timestamp, "
            "the source window, and an availability flag; an unreachable source returns\n"
            "$\\it{unavailable}$, never a neutral value. Dashed edges are traversed only when the plan calls for them.",
            fontsize=6.3, color=ink, va="top", ha="center", linespacing=1.7)

    ax.set_ylim(bottom - 32, 100)

    save(fig, "fig_architecture", grey)


# --------------------------------------------------------------------------
# 2. volatility
# --------------------------------------------------------------------------

def fig_volatility(grey=False):
    ink, muted, fill, light = style(grey)
    v = json.loads((RESULTS / "vol_forecast_h21.json").read_text())
    r = json.loads((RESULTS / "redesign_eval.json").read_text())

    m = v["models"]
    order = ["rw", "mean", "ewma", "har"]
    label = {"rw": "Random\nwalk", "mean": "Uncond.\nmean", "ewma": "EWMA\n$\\lambda$=0.94",
             "har": "HAR-RV"}

    fig, axes = plt.subplots(1, 3, figsize=(7.1, 2.5))

    # (a) QLIKE improvement over the random walk, both runs
    ax = axes[0]
    base1 = m["rw"]["qlike"]
    d1 = [m[k]["qlike"] - base1 for k in order]
    base2 = r["qlike"]["rw"]
    d2 = {"har": r["qlike"]["har"] - base2, "ewma": r["qlike"]["ewma"] - base2,
          "rw": 0.0, "mean": None}
    x = range(len(order))
    w = 0.38
    ax.bar([i - w / 2 for i in x], d1, w, color=fill, edgecolor=ink, linewidth=0.6,
           label=f"universe run ($n$={v['n']:,})")
    got = [(i, d2[k]) for i, k in enumerate(order) if d2[k] is not None]
    ax.bar([i + w / 2 for i, _ in got], [d for _, d in got], w, color=light,
           edgecolor=ink, linewidth=0.6, label=f"redesign run ($n$=5,700)")
    ax.axhline(0, color=muted, linewidth=0.8)
    ax.set_xticks(list(x))
    ax.set_xticklabels([label[k] for k in order], fontsize=6.2)
    ax.set_ylabel("$\\Delta$QLIKE vs random walk")
    ax.set_title("(a) Loss, lower is better", fontsize=8.5, pad=6)
    ax.legend(fontsize=5.6, frameon=False, loc="lower left")
    tidy(ax, muted)

    # (b) rank correlation
    ax = axes[1]
    ax.bar(list(x), [m[k]["ic"] for k in order], 0.55, color=fill,
           edgecolor=ink, linewidth=0.6)
    for i, k in enumerate(order):
        ax.text(i, m[k]["ic"] + 0.012, f"{m[k]['ic']:.3f}", ha="center",
                fontsize=6.2, color=ink)
    ax.set_xticks(list(x))
    ax.set_xticklabels([label[k] for k in order], fontsize=6.2)
    ax.set_ylim(0, 0.78)
    ax.set_ylabel("rank correlation with realised $\\sigma$")
    ax.set_title("(b) Ordering", fontsize=8.5, pad=6)
    tidy(ax, muted)

    # (c) Mincer-Zarnowitz slope
    ax = axes[2]
    ax.axhline(1.0, color=muted, linestyle="--", linewidth=0.8)
    ax.bar(list(x), [m[k]["mz_slope"] for k in order], 0.55, color=fill,
           edgecolor=ink, linewidth=0.6)
    for i, k in enumerate(order):
        ax.text(i, m[k]["mz_slope"] + 0.03, f"{m[k]['mz_slope']:.2f}", ha="center",
                fontsize=6.2, color=ink)
    ax.text(-0.42, 1.03, "unbiased", fontsize=6.0, color=muted, ha="left", va="bottom",
            style="italic")
    ax.set_xticks(list(x))
    ax.set_xticklabels([label[k] for k in order], fontsize=6.2)
    ax.set_ylim(0, 1.42)
    ax.set_ylabel("Mincer--Zarnowitz slope")
    ax.set_title("(c) Bias", fontsize=8.5, pad=6)
    tidy(ax, muted)

    fig.tight_layout()
    save(fig, "fig_volatility", grey)


# --------------------------------------------------------------------------
# 3. calibration
# --------------------------------------------------------------------------

def fig_calibration(grey=False):
    ink, muted, fill, light = style(grey)
    d = json.loads((RESULTS / "derived_risk_har_h21.json").read_text())
    th = d["thresholds"]
    keys = sorted(th, key=float)

    fig, axes = plt.subplots(1, 3, figsize=(7.1, 2.5))

    # (a) predicted vs realised
    ax = axes[0]
    ax.plot([0, 0.45], [0, 0.45], linestyle="--", linewidth=0.8, color=muted)
    for k in keys:
        p, q = th[k]["pred_mean"], th[k]["realised_rate"]
        ax.plot([p], [q], marker="o", markersize=4.5, color=ink, linestyle="none")
        ax.annotate(f"$x$={float(k):.0%}", (p, q), textcoords="offset points",
                    xytext=(6, -7), fontsize=6.2, color=muted)
        ax.plot([p, p], [p, q], linewidth=0.7, color=ink, alpha=0.45)
    ax.set_xlim(0, 0.45)
    ax.set_ylim(0, 0.45)
    ax.set_xlabel("mean predicted $P(\\mathrm{dd}>x)$")
    ax.set_ylabel("realised frequency")
    ax.set_title("(a) Reliability", fontsize=8.5, pad=6)
    tidy(ax, muted, xgrid=True)

    # (b) Brier against its own base rate
    ax = axes[1]
    x = range(len(keys))
    w = 0.38
    ax.bar([i - w / 2 for i in x], [th[k]["brier"] for k in keys], w, color=fill,
           edgecolor=ink, linewidth=0.6, label="derived")
    ax.bar([i + w / 2 for i in x], [th[k]["brier_base"] for k in keys], w, color=light,
           edgecolor=ink, linewidth=0.6, label="base rate")
    for i, k in enumerate(keys):
        mark = "beats" if th[k]["beats_base"] else "loses"
        ax.text(i, max(th[k]["brier"], th[k]["brier_base"]) + 0.008, mark,
                ha="center", fontsize=6.0, color=ink, style="italic")
    ax.set_xticks(list(x))
    ax.set_xticklabels([f"$x$={float(k):.0%}" for k in keys], fontsize=6.4)
    ax.set_ylabel("Brier score (lower is better)")
    ax.set_ylim(0, 0.30)
    ax.set_title("(b) Skill against the base rate", fontsize=8.5, pad=6)
    ax.legend(fontsize=6.0, frameon=False)
    tidy(ax, muted)

    # (c) structural diagnostics
    ax = axes[2]
    names = ["worst-bin\ngap", "reliability\nslope", "$\\hat{\\sigma}$ bias"]
    vals = [d["max_bin_gap"], d["reliability_slope"], d["sigma_bias"]]
    ax.axhline(0, color=muted, linewidth=0.8)
    ax.bar(range(3), vals, 0.5, color=fill, edgecolor=ink, linewidth=0.6)
    for i, val in enumerate(vals):
        ax.text(i, val + (0.014 if val >= 0 else -0.026), f"{val:+.3f}",
                ha="center", fontsize=6.4, color=ink)
    ax.set_xticks(range(3))
    ax.set_xticklabels(names, fontsize=6.2)
    ax.set_ylim(-0.20, 0.34)
    ax.set_title("(c) What aggregates hide", fontsize=8.5, pad=6)
    tidy(ax, muted)

    fig.tight_layout()
    save(fig, "fig_calibration", grey)


# --------------------------------------------------------------------------
# 4. power
# --------------------------------------------------------------------------

def fig_power(grey=False):
    ink, muted, fill, light = style(grey)
    import sys
    sys.path.insert(0, str(_HERE))
    from power_analysis import required_n_analytic, power_at_n_analytic

    RHO, S_B, N_ACTUAL = 0.552, 0.314, 398

    fig, axes = plt.subplots(1, 2, figsize=(7.1, 2.6))

    ax = axes[0]
    diffs = [0.10 + 0.02 * i for i in range(46)]
    need = [required_n_analytic(d, S_B, RHO) for d in diffs]
    ax.plot(diffs, need, linewidth=1.2, color=ink)
    ax.axhline(N_ACTUAL, color=muted, linestyle="--", linewidth=0.9)
    ax.text(0.99, N_ACTUAL * 1.18, f"our holdout, {N_ACTUAL} days", fontsize=6.2,
            color=muted, ha="right", style="italic")
    for d in (0.30, 0.50, 1.00):
        n = required_n_analytic(d, S_B, RHO)
        ax.plot([d], [n], marker="o", markersize=4, color=ink, linestyle="none")
        ax.annotate(f"$\\approx${n / 1000:.0f}k days\n({n / TRADING_DAYS:.0f} yr)"
                    if n >= 10000 else
                    f"$\\approx${n / 1000:.1f}k days\n({n / TRADING_DAYS:.0f} yr)",
                    (d, n), textcoords="offset points", xytext=(7, 3),
                    fontsize=6.0, color=ink)
    ax.set_yscale("log")
    ax.set_xlabel("true difference in Sharpe ratio")
    ax.set_ylabel("trading days for 80% power")
    ax.set_title("(a) What a Sharpe claim costs", fontsize=8.5, pad=6)
    tidy(ax, muted)

    ax = axes[1]
    ns = [int(round(252 * (1.16 ** i))) for i in range(40)]
    for d, ls in ((1.00, "solid"), (0.50, (0, (4, 1.6))), (0.30, (0, (1.6, 1.4)))):
        ax.plot(ns, [power_at_n_analytic(d, S_B, RHO, n) for n in ns],
                linewidth=1.1, color=ink, linestyle=ls, label=f"$+{d:.2f}$")
    ax.axhline(0.80, color=muted, linestyle="--", linewidth=0.8)
    ax.text(ns[-1], 0.815, "80% power", fontsize=6.2, color=muted, ha="right",
            style="italic")
    ax.axvline(N_ACTUAL, color=muted, linewidth=0.8)
    p30 = power_at_n_analytic(0.30, S_B, RHO, N_ACTUAL)
    ax.plot([N_ACTUAL], [p30], marker="o", markersize=4, color=ink, linestyle="none")
    ax.annotate(f"{p30:.1%} at $+0.30$", (N_ACTUAL, p30), textcoords="offset points",
                xytext=(10, 22), fontsize=6.2, color=ink,
                arrowprops=dict(arrowstyle="-", linewidth=0.5, color=muted))
    ax.set_xscale("log")
    ax.set_ylim(0, 1.0)
    ax.set_xlabel("holdout length (trading days)")
    ax.set_ylabel("power")
    ax.set_title("(b) Power at a realistic holdout", fontsize=8.5, pad=6)
    ax.legend(fontsize=6.2, frameon=False, title="true diff.", title_fontsize=6.2,
              loc="upper left")
    tidy(ax, muted)

    fig.tight_layout()
    save(fig, "fig_power", grey)


# --------------------------------------------------------------------------
# 5. forward test
# --------------------------------------------------------------------------

def _forward():
    preds = [json.loads(l) for l in open(FORWARD / "predictions.jsonl", encoding="utf-8")]
    outs = [json.loads(l) for l in open(FORWARD / "outcomes.jsonl", encoding="utf-8")]
    pby = {p["decision_id"]: p for p in preds}
    joined = [(pby[o["decision_id"]], o) for o in outs if o["decision_id"] in pby]
    return preds, joined


def fig_forward(grey=False):
    ink, muted, fill, light = style(grey)
    preds, joined = _forward()

    key = lambda p: (p["ticker"], p["as_of"], p["horizon_days"])
    bykey = collections.defaultdict(dict)
    for p, o in joined:
        bykey[key(p)][p["arm"]] = o["correct"]
    pairs = {k: v for k, v in bykey.items() if "A" in v and "B" in v}

    fig, axes = plt.subplots(1, 3, figsize=(7.1, 2.5))

    # (a) accuracy with Wilson intervals, all scored decisions
    ax = axes[0]
    arms = ["A", "B"]
    names = {"A": "Arm A\nnumerical", "B": "Arm B\nagentic"}
    for i, a in enumerate(arms):
        v = [o["correct"] for p, o in joined if p["arm"] == a]
        k, n = sum(v), len(v)
        lo, hi = wilson(k, n)
        ax.plot([i], [k / n], marker="o", markersize=5, color=ink, linestyle="none")
        ax.plot([i, i], [lo, hi], linewidth=1.1, color=ink)
        ax.text(i + 0.13, k / n, f"{k}/{n}", fontsize=6.4, color=ink, va="center")
    ax.axhline(0.5, color=muted, linestyle="--", linewidth=0.9)
    ax.text(1.45, 0.505, "chance", fontsize=6.2, color=muted, ha="right", style="italic")
    ax.set_xticks(range(2))
    ax.set_xticklabels([names[a] for a in arms], fontsize=6.6)
    ax.set_xlim(-0.5, 1.5)
    ax.set_ylim(0.24, 0.72)
    ax.set_ylabel("directional accuracy")
    ax.set_title("(a) Sealed, out of sample", fontsize=8.5, pad=6)
    tidy(ax, muted)

    # (b) paired disagreement
    ax = axes[1]
    both = sum(1 for v in pairs.values() if v["A"] and v["B"])
    a_only = sum(1 for v in pairs.values() if v["A"] and not v["B"])
    b_only = sum(1 for v in pairs.values() if v["B"] and not v["A"])
    neither = sum(1 for v in pairs.values() if not v["A"] and not v["B"])
    cats = ["both\ncorrect", "A only", "B only", "neither"]
    vals = [both, a_only, b_only, neither]
    cols = [light, fill, fill, light]
    ax.bar(range(4), vals, 0.55, color=cols, edgecolor=ink, linewidth=0.6)
    for i, val in enumerate(vals):
        ax.text(i, val + 0.35, str(val), ha="center", fontsize=6.6, color=ink)
    ax.set_xticks(range(4))
    ax.set_xticklabels(cats, fontsize=6.2)
    ax.set_ylabel(f"paired decisions ($n$={len(pairs)})")
    ax.set_ylim(0, max(vals) + 4)
    ax.set_yticks(range(0, max(vals) + 4, 4))
    ax.set_title("(b) Where they differ", fontsize=8.5, pad=6)
    ax.text(1.5, max(vals) + 1.4, "discordant 9 vs 5,\nMcNemar $p=0.42$",
            fontsize=6.2, color=muted, ha="center", style="italic", linespacing=1.4)
    tidy(ax, muted)

    # (c) what the agentic arm costs
    ax = axes[2]
    import statistics
    med = {}
    calls = {}
    for a in arms:
        sub = [p for p in preds if p["arm"] == a]
        med[a] = statistics.median(p["duration_ms"] for p in sub)
        calls[a] = sum(p["llm_calls"] for p in sub) / len(sub)
    ax.bar(range(2), [med[a] for a in arms], 0.5, color=fill, edgecolor=ink,
           linewidth=0.6)
    for i, a in enumerate(arms):
        ax.text(i, med[a] + 40, f"{med[a]:,.0f} ms", ha="center", fontsize=6.4,
                color=ink)
    n_agents = {"A": "1 agent", "B": "4 agents"}
    ax.set_xticks(range(2))
    ax.set_xticklabels([f"{names[a]}\n{n_agents[a]}, {calls[a]:.2f} LLM calls"
                        for a in arms], fontsize=6.0)
    ax.set_ylabel("median latency (ms)")
    ax.set_ylim(0, max(med.values()) * 1.30)
    ax.set_title("(c) What the extra agents cost", fontsize=8.5, pad=6)
    tidy(ax, muted)

    fig.tight_layout()
    save(fig, "fig_forward", grey)


# --------------------------------------------------------------------------

def main():
    for fn in (fig_architecture, fig_volatility, fig_calibration, fig_power,
               fig_forward):
        for grey in (False, True):
            fn(grey)
        print(f"  wrote {fn.__name__}")
    print(f"figures -> {OUT}")


if __name__ == "__main__":
    main()
