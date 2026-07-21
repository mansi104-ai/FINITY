"""Figure 3: accuracy against coverage under confidence-based abstention.

Replaces the TSLA equity chart from v8, which illustrated a drawdown
reduction now known to be an artefact of reduced exposure rather than skill.

Design constraints, in the order the dataviz procedure sets them:

  form   -- one measure over an ordered continuum with an uncertainty band,
            so a line with error bars. A single series, so no legend box: the
            caption names it.
  colour -- one series and print-first, so no categorical palette is
            involved. Everything is ink; the chance reference is a neutral
            dashed rule. This survives greyscale reproduction, which an IEEE
            proceedings may apply without warning.
  marks  -- 2px line, 8px markers, recessive grid at low alpha, axis spines
            trimmed to two sides.
  labels -- selective, not one per point: the endpoints carry values because
            they are the claim; the middle points are read off the axis.

Numbers are read from eval/results/redesign_eval.json so the figure cannot
drift from the table it accompanies.
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


def wilson(k: int, n: int, z: float = 1.96):
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


def main() -> int:
    src = RESULTS / "redesign_eval.json"
    rows = json.loads(src.read_text())["coverage"]
    rows = sorted(rows, key=lambda r: r["coverage"])

    cov = [r["coverage"] * 100 for r in rows]
    acc = [r["accuracy"] for r in rows]
    lo, hi = [], []
    for r in rows:
        a, b = wilson(round(r["accuracy"] * r["n"]), r["n"])
        lo.append(r["accuracy"] - a)
        hi.append(b - r["accuracy"])

    plt.rcParams.update({
        "font.family": "serif",
        "font.serif": ["Times New Roman", "DejaVu Serif"],
        "font.size": 8,
        "axes.linewidth": 0.6,
    })
    fig, ax = plt.subplots(figsize=(3.4, 2.35))

    INK = "#1a1a1a"
    MUTED = "#7a7a7a"

    # Chance reference. Neutral and dashed so it never competes with the data.
    ax.axhline(0.5, color=MUTED, linestyle="--", linewidth=0.8, zorder=1)
    # Right-hand end: at y=0.50 the low-coverage side is empty, whereas the
    # left collides with the 100%-coverage whisker.
    ax.text(11, 0.503, "chance", color=MUTED, fontsize=7,
            ha="left", va="bottom")

    ax.errorbar(cov, acc, yerr=[lo, hi], color=INK, linewidth=1.6,
                marker="o", markersize=4.5, markerfacecolor="white",
                markeredgewidth=1.2, capsize=2.5, elinewidth=0.9, zorder=3)

    # No per-point value labels. Both endpoint labels collided -- one with
    # the y-axis ticks, one with the right spine -- and the accompanying table
    # already carries exact values. An axis a reader can read is worth more
    # than a label fighting the frame.

    ax.set_xlabel("Coverage (\\% of queries answered)" if False
                  else "Coverage (% of queries answered)")
    ax.set_ylabel("Directional accuracy")
    ax.set_xlim(102, 3)          # inverted: abstention increases rightward
    ax.set_ylim(0.485, 0.635)
    ax.set_xticks([100, 75, 50, 25, 10])
    ax.set_yticks([0.50, 0.52, 0.54, 0.56, 0.58, 0.60])
    ax.grid(axis="y", alpha=0.18, linewidth=0.5)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(MUTED)

    fig.tight_layout(pad=0.3)
    for ext in ("png", "pdf"):
        out = RESULTS / f"coverage_accuracy.{ext}"
        fig.savefig(out, dpi=400, bbox_inches="tight")
    print(f"wrote {RESULTS / 'coverage_accuracy.png'}")

    # Greyscale proof: the figure must survive a black-and-white proceedings.
    fig2, ax2 = plt.subplots(figsize=(3.4, 2.35))
    ax2.axhline(0.5, color="0.55", linestyle="--", linewidth=0.8)
    ax2.errorbar(cov, acc, yerr=[lo, hi], color="0.1", linewidth=1.6,
                 marker="o", markersize=4.5, markerfacecolor="white",
                 markeredgewidth=1.2, capsize=2.5, elinewidth=0.9)
    ax2.set_xlim(102, 3); ax2.set_ylim(0.485, 0.635)
    ax2.set_xlabel("Coverage (%)"); ax2.set_ylabel("Accuracy")
    for side in ("top", "right"):
        ax2.spines[side].set_visible(False)
    fig2.tight_layout(pad=0.3)
    fig2.savefig(RESULTS / "coverage_accuracy_grey.png", dpi=200,
                 bbox_inches="tight")
    print(f"wrote {RESULTS / 'coverage_accuracy_grey.png'} (greyscale proof)")

    print("\nplotted values:")
    for c, a, l, h in zip(cov, acc, lo, hi):
        print(f"  coverage {c:5.0f}%  acc {a:.4f}  CI [{a-l:.4f}, {a+h:.4f}]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
