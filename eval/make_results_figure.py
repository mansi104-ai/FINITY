"""Figure 3: the paper's two headline results as small multiples.

Replaces the single coverage panel, and folds in the predictability asymmetry
that until now existed only as a table -- it is the paper's central finding
and deserves a figure.

Why two panels rather than two series on one pair of axes: the quantities
share no axis. Panel (a) is a rank correlation across four targets; panel (b)
is an accuracy against a coverage fraction. Overlaying them would require two
y-scales, which lets any two unrelated series be made to look coupled. Small
multiples show more without asserting a relationship that does not exist.

The TSLA equity curve from the previous version is deliberately absent. It
illustrated a drawdown reduction that the matched-exposure control in
Section V-E shows to be an artefact of reduced exposure; printing it beside a
result that holds would imply the two support each other.

Print-first: ink only, no hue carries meaning, so the figure survives a
greyscale proceedings. A greyscale proof is written alongside.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

_HERE = Path(__file__).resolve().parent
RESULTS = _HERE / "results"

# Panel (a): measured in run_redesign_eval / the predictability sweep.
TARGETS = [
    ("Direction", -0.0744),
    ("Magnitude", 0.2489),
    ("Volatility", 0.5543),
    ("Drawdown", -0.3199),
]


def wilson(k: int, n: int, z: float = 1.96):
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


def draw(grey: bool = False):
    ink = "0.10" if grey else "#1a1a1a"
    muted = "0.55" if grey else "#7a7a7a"
    fill = "0.35" if grey else "#4a4a4a"

    plt.rcParams.update({
        "font.family": "serif",
        "font.serif": ["Times New Roman", "DejaVu Serif"],
        "font.size": 8,
        "axes.linewidth": 0.6,
    })
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(7.1, 2.5))

    # ---- panel (a): predictability by target --------------------------
    names = [t[0] for t in TARGETS]
    vals = [t[1] for t in TARGETS]
    ypos = range(len(names))
    # Magnitude of the relationship is what matters; sign is annotated, so a
    # single ink fill is enough and no hue is doing work.
    ax1.barh(list(ypos), [abs(v) for v in vals], height=0.55,
             color=fill, edgecolor=ink, linewidth=0.6)
    for i, v in enumerate(vals):
        ax1.text(abs(v) + 0.018, i, f"{v:+.3f}", va="center",
                 fontsize=7.5, color=ink)
    ax1.set_yticks(list(ypos))
    ax1.set_yticklabels(names)
    ax1.invert_yaxis()
    ax1.set_xlim(0, 0.68)
    ax1.set_xlabel("$|$rank correlation with outcome$|$")
    ax1.set_title("(a) What is predictable", fontsize=8.5, pad=6)
    ax1.grid(axis="x", alpha=0.18, linewidth=0.5)
    ax1.set_axisbelow(True)
    for s in ("top", "right"):
        ax1.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax1.spines[s].set_color(muted)

    # ---- panel (b): accuracy vs coverage ------------------------------
    rows = sorted(json.loads((RESULTS / "redesign_eval.json").read_text())["coverage"],
                  key=lambda r: r["coverage"])
    cov = [r["coverage"] * 100 for r in rows]
    acc = [r["accuracy"] for r in rows]
    lo, hi = [], []
    for r in rows:
        a, b = wilson(round(r["accuracy"] * r["n"]), r["n"])
        lo.append(r["accuracy"] - a)
        hi.append(b - r["accuracy"])

    ax2.axhline(0.5, color=muted, linestyle="--", linewidth=0.8, zorder=1)
    ax2.text(11, 0.503, "chance", color=muted, fontsize=7, ha="left", va="bottom")
    ax2.errorbar(cov, acc, yerr=[lo, hi], color=ink, linewidth=1.6,
                 marker="o", markersize=4.5, markerfacecolor="white",
                 markeredgewidth=1.2, capsize=2.5, elinewidth=0.9, zorder=3)
    ax2.set_xlim(103, 3)
    ax2.set_ylim(0.485, 0.635)
    ax2.set_xticks([100, 75, 50, 25, 10])
    ax2.set_yticks([0.50, 0.52, 0.54, 0.56, 0.58, 0.60])
    ax2.set_xlabel("Coverage (\\% answered)" if False else "Coverage (% answered)")
    ax2.set_ylabel("Directional accuracy")
    ax2.set_title("(b) Abstention", fontsize=8.5, pad=6)
    ax2.grid(axis="y", alpha=0.18, linewidth=0.5)
    ax2.set_axisbelow(True)
    for s in ("top", "right"):
        ax2.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax2.spines[s].set_color(muted)

    fig.tight_layout(pad=0.5, w_pad=2.0)
    return fig


def main() -> int:
    fig = draw(grey=False)
    for ext in ("png", "pdf"):
        fig.savefig(RESULTS / f"results_panels.{ext}", dpi=400, bbox_inches="tight")
    print(f"wrote {RESULTS / 'results_panels.png'}")

    fig2 = draw(grey=True)
    fig2.savefig(RESULTS / "results_panels_grey.png", dpi=200, bbox_inches="tight")
    print(f"wrote {RESULTS / 'results_panels_grey.png'} (greyscale proof)")

    print("\npanel (a) values:")
    for n, v in TARGETS:
        print(f"  {n:<12}{v:+.4f}")
    print("panel (b) values:")
    rows = sorted(json.loads((RESULTS / 'redesign_eval.json').read_text())["coverage"],
                  key=lambda r: r["coverage"])
    for r in rows:
        a, b = wilson(round(r["accuracy"] * r["n"]), r["n"])
        print(f"  coverage {r['coverage']*100:5.0f}%  acc {r['accuracy']:.4f}  "
              f"[{a:.4f}, {b:.4f}]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
