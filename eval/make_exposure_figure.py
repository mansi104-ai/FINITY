"""Figure 4: the matched-exposure control.

Section V-E's finding has no figure, though it is the paper's methodological
contribution: a constant-exposure portfolio holding the sized policy's own
average exposure, with no timing at all, beats that policy on Sharpe ratio,
annualised return and maximum drawdown simultaneously.

The comparison that matters is sized policy against the matched control.
Buy-and-hold is included as the conventional reference, and its presence
makes the point sharper -- it earns the most but falls furthest, which is
exactly why comparing against it alone cannot reveal the failure. Reduced
exposure lowers drawdown, so a delevered policy looks like risk management
whatever its timing does.

Three panels rather than one chart: Sharpe is a ratio, the others are
percentages, and drawdown is negative. Forcing them onto shared axes would
misrepresent all three. Each panel carries its own scale.

Print-first: ink only, hue carries no meaning, greyscale proof written
alongside.
"""

from __future__ import annotations

from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

RESULTS = Path(__file__).resolve().parent / "results"

# From eval/results/ablate_drawdown.json -- 10 tickers, 10 years, lag=1, rf=4%.
ARMS = ["Sized policy", "Constant 42%\n(no timing)", "Buy \\& hold"]
ARMS_PLAIN = ["Sized policy", "Constant 42%\n(no timing)", "Buy & hold"]
SHARPE = [0.381, 0.539, 0.497]
ANNRET = [9.97, 11.52, 16.52]
MAXDD = [-38.0, -33.8, -71.7]


def draw(grey: bool = False):
    ink = "0.10" if grey else "#1a1a1a"
    muted = "0.55" if grey else "#7a7a7a"
    # The control is the arm under discussion, so it is the one filled solid.
    fills = ["0.72" if grey else "#b8b8b8",
             "0.28" if grey else "#3a3a3a",
             "0.72" if grey else "#b8b8b8"]

    plt.rcParams.update({
        "font.family": "serif",
        "font.serif": ["Times New Roman", "DejaVu Serif"],
        "font.size": 8,
        "axes.linewidth": 0.6,
    })
    fig, axes = plt.subplots(1, 3, figsize=(7.1, 2.35))

    panels = [
        (axes[0], SHARPE, "Sharpe ratio", "(a) Risk-adjusted return", "{:.3f}"),
        (axes[1], ANNRET, "Annualised return (%)", "(b) Return", "{:.2f}"),
        (axes[2], MAXDD, "Maximum drawdown (%)", "(c) Downside", "{:.1f}"),
    ]

    x = range(len(ARMS_PLAIN))
    for ax, vals, ylab, title, fmt in panels:
        ax.bar(list(x), vals, width=0.6, color=fills,
               edgecolor=ink, linewidth=0.7)
        for i, v in enumerate(vals):
            off = 3 if v >= 0 else -11
            ax.annotate(fmt.format(v), (i, v), textcoords="offset points",
                        xytext=(0, off), ha="center", fontsize=7.5, color=ink)
        ax.set_xticks(list(x))
        ax.set_xticklabels(ARMS_PLAIN, fontsize=7)
        ax.set_ylabel(ylab, fontsize=8)
        ax.set_title(title, fontsize=8.5, pad=6)
        ax.grid(axis="y", alpha=0.18, linewidth=0.5)
        ax.set_axisbelow(True)
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)
        for s in ("left", "bottom"):
            ax.spines[s].set_color(muted)
        if min(vals) < 0:
            ax.axhline(0, color=muted, linewidth=0.6)
            ax.set_ylim(min(vals) * 1.22, 0)
        else:
            ax.set_ylim(0, max(vals) * 1.20)

    fig.tight_layout(pad=0.5, w_pad=1.9)
    return fig


def main() -> int:
    fig = draw(False)
    for ext in ("png", "pdf"):
        fig.savefig(RESULTS / f"matched_exposure.{ext}", dpi=400,
                    bbox_inches="tight")
    print(f"wrote {RESULTS / 'matched_exposure.png'}")

    draw(True).savefig(RESULTS / "matched_exposure_grey.png", dpi=200,
                       bbox_inches="tight")
    print(f"wrote {RESULTS / 'matched_exposure_grey.png'} (greyscale proof)")

    print("\nsized policy vs matched control:")
    print(f"  Sharpe   {SHARPE[0]:.3f} vs {SHARPE[1]:.3f}  "
          f"({SHARPE[1]-SHARPE[0]:+.3f} for the control)")
    print(f"  AnnRet   {ANNRET[0]:.2f}% vs {ANNRET[1]:.2f}%  "
          f"({ANNRET[1]-ANNRET[0]:+.2f} pp)")
    print(f"  MaxDD    {MAXDD[0]:.1f}% vs {MAXDD[1]:.1f}%  "
          f"({MAXDD[1]-MAXDD[0]:+.1f} pp, shallower)")
    print("\nnote: the control beats the SIZED POLICY on all three, but earns")
    print("less than buy-and-hold. The paper claims only the former.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
