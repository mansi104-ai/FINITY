"""
data_audit.py

Phase A, steps 4-5 of the improvement plan.

Step 4 -- Close vs Adj Close consistency check
------------------------------------------------
The CSVs currently in eval/data/ are Nasdaq.com manual-export format
(header "Close/Last"). IMPORTANT, and worth stating plainly: Nasdaq's
export is a RAW close price, not split/dividend adjusted, unlike
Yahoo's "Adj Close". This script does NOT have an adjusted series to
diff against right now (no Adj Close column exists in these files), so
it can't silently "fix" anything -- what it does instead is:

  1. Flag any single-day return whose magnitude exceeds a threshold
     (default 15%) as a suspected unadjusted split (or a very large
     earnings gap -- it can't fully disambiguate the two from price
     alone, so it reports both candidates and lets you confirm).
  2. If a file has both a raw Close and an Adj Close column, it will
     directly diff them and report every date where they disagree.

This is deliberately conservative: it reports and flags, it does not
resample or interpolate prices, because doing so silently would be a
lookahead / correctness risk (exactly what step 30's audit is for).

Step 5 -- Versioning / checksums
-----------------------------------
Writes eval/data/MANIFEST.json with a SHA-256 checksum, row count,
date range, and source-format fingerprint for every CSV in eval/data/.
Re-run before any eval run that should be reproducible; commit the
manifest alongside the CSVs. `--verify` checks current files against
a previously committed manifest and exits non-zero on any mismatch,
so CI (or you, by hand) can catch a silently-changed data file before
it invalidates a reported eval number.

USAGE:
    python data_audit.py                 # audit + (re)write manifest
    python data_audit.py --verify        # check files against existing manifest, no rewrite
    python data_audit.py --jump-threshold 0.12
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).parent / "data"
MANIFEST_PATH = DATA_DIR / "MANIFEST.json"

CLOSE_COL_CANDIDATES = ["Close", "close", "Close/Last", "close/last"]
ADJ_CLOSE_COL_CANDIDATES = ["Adj Close", "adj close", "Adj_Close", "AdjClose"]
DATE_COL_CANDIDATES = ["Date", "date", "Datetime", "datetime"]

# Non-price files that legitimately live under eval/data/ but must NOT be
# treated as OHLCV price CSVs by this script (e.g. the Financial PhraseBank
# sentiment corpus for the Researcher agent, step 2 of the improvement
# plan). Listing a file here is safer than a try/except-and-skip, since a
# silently-skipped *price* file would defeat the point of the audit.
NON_PRICE_FILES = {"all-data.csv"}


def _price_csvs() -> list[Path]:
    return sorted(p for p in DATA_DIR.glob("*.csv") if p.name not in NON_PRICE_FILES)


def _find_col(df: pd.DataFrame, candidates: list[str]) -> str | None:
    lower_map = {str(c).strip().lower(): c for c in df.columns}
    for cand in candidates:
        hit = lower_map.get(cand.strip().lower())
        if hit is not None:
            return hit
    return None


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def _load_close_series(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    if df.columns[0] in ("Price", "Ticker") or str(df.iloc[0, 0]).strip().lower() == "ticker":
        df = pd.read_csv(path, skiprows=[1, 2])

    date_col = _find_col(df, DATE_COL_CANDIDATES)
    close_col = _find_col(df, CLOSE_COL_CANDIDATES)
    adj_col = _find_col(df, ADJ_CLOSE_COL_CANDIDATES)
    if date_col is None or close_col is None:
        raise ValueError(f"{path.name}: could not find Date/Close columns (found {list(df.columns)})")

    out = pd.DataFrame()
    out["Date"] = pd.to_datetime(df[date_col])
    out["Close"] = pd.to_numeric(
        df[close_col].astype(str).str.replace(r"[\$,]", "", regex=True), errors="coerce"
    )
    if adj_col is not None:
        out["AdjClose"] = pd.to_numeric(
            df[adj_col].astype(str).str.replace(r"[\$,]", "", regex=True), errors="coerce"
        )
    out = out.dropna(subset=["Date", "Close"]).sort_values("Date").reset_index(drop=True)
    out.attrs["had_adj_close"] = adj_col is not None
    out.attrs["close_col_name"] = close_col
    return out


def audit_split_dividend_consistency(path: Path, jump_threshold: float) -> dict:
    df = _load_close_series(path)
    report: dict = {
        "file": path.name,
        "close_col_used": df.attrs["close_col_name"],
        "had_adj_close_col": df.attrs["had_adj_close"],
        "adj_vs_raw_mismatches": [],
        "suspected_unadjusted_jumps": [],
    }

    if df.attrs["had_adj_close"]:
        diffs = df[(df["Close"] - df["AdjClose"]).abs() / df["Close"] > 0.005]
        for _, row in diffs.iterrows():
            report["adj_vs_raw_mismatches"].append(
                {"date": row["Date"].strftime("%Y-%m-%d"),
                 "close": round(row["Close"], 2), "adj_close": round(row["AdjClose"], 2)}
            )
    else:
        ret = df["Close"].pct_change()
        flagged = df.loc[ret.abs() > jump_threshold]
        for idx, row in flagged.iterrows():
            report["suspected_unadjusted_jumps"].append(
                {"date": row["Date"].strftime("%Y-%m-%d"),
                 "return_pct": round(float(ret.loc[idx]) * 100, 2),
                 "note": "No Adj Close column to confirm -- could be a real split/div "
                         "or a large earnings-gap day. Verify manually before trusting "
                         "any feature computed across this date."}
            )
    return report


def build_manifest(jump_threshold: float) -> dict:
    manifest = {
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "jump_threshold_used": jump_threshold,
        "files": {},
    }
    for path in _price_csvs():
        df = _load_close_series(path)
        audit = audit_split_dividend_consistency(path, jump_threshold)
        manifest["files"][path.name] = {
            "sha256": _sha256(path),
            "rows": len(df),
            "date_min": df["Date"].min().strftime("%Y-%m-%d"),
            "date_max": df["Date"].max().strftime("%Y-%m-%d"),
            "close_col_used": audit["close_col_used"],
            "had_adj_close_col": audit["had_adj_close_col"],
            "n_suspected_unadjusted_jumps": len(audit["suspected_unadjusted_jumps"]),
            "n_adj_vs_raw_mismatches": len(audit["adj_vs_raw_mismatches"]),
        }
    for name in NON_PRICE_FILES:
        path = DATA_DIR / name
        if path.exists():
            with open(path, "rb") as f:
                n_rows = sum(1 for _ in f)
            manifest["files"][name] = {
                "sha256": _sha256(path),
                "rows_or_raw_lines": n_rows,
                "kind": "non_price_reference_dataset",
            }
    return manifest


def verify_manifest(jump_threshold: float) -> bool:
    if not MANIFEST_PATH.exists():
        print(f"No manifest found at {MANIFEST_PATH}. Run without --verify first.")
        return False
    with open(MANIFEST_PATH) as f:
        old = json.load(f)

    ok = True
    for path in _price_csvs():
        recorded = old["files"].get(path.name)
        if recorded is None:
            print(f"[NEW]      {path.name} not in manifest (new file since last audit)")
            ok = False
            continue
        current_hash = _sha256(path)
        if current_hash != recorded["sha256"]:
            print(f"[MISMATCH] {path.name} checksum changed: "
                  f"manifest={recorded['sha256'][:12]}... current={current_hash[:12]}...")
            ok = False
        else:
            print(f"[OK]       {path.name} matches manifest ({recorded['rows']} rows, "
                  f"{recorded['date_min']}..{recorded['date_max']})")
    return ok


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--jump-threshold", type=float, default=0.15,
                         help="Abs daily return to flag as a suspected unadjusted split (default 0.15)")
    parser.add_argument("--verify", action="store_true",
                         help="Verify current CSVs against the existing manifest instead of rewriting it")
    args = parser.parse_args()

    if args.verify:
        ok = verify_manifest(args.jump_threshold)
        sys.exit(0 if ok else 1)

    print(f"Auditing {DATA_DIR} (jump threshold = {args.jump_threshold:.0%})\n")
    any_flags = False
    for path in _price_csvs():
        report = audit_split_dividend_consistency(path, args.jump_threshold)
        n_flags = len(report["suspected_unadjusted_jumps"]) + len(report["adj_vs_raw_mismatches"])
        status = "CLEAN" if n_flags == 0 else f"{n_flags} FLAG(S)"
        print(f"  {report['file']:12s} close_col='{report['close_col_used']}' "
              f"has_adj_close={report['had_adj_close_col']}  -> {status}")
        for j in report["suspected_unadjusted_jumps"]:
            print(f"      ! {j['date']}  {j['return_pct']:+.2f}%  {j['note']}")
        for m in report["adj_vs_raw_mismatches"]:
            print(f"      ! {m['date']}  close={m['close']} adj_close={m['adj_close']}")
        any_flags = any_flags or n_flags > 0

    manifest = build_manifest(args.jump_threshold)
    with open(MANIFEST_PATH, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nWrote {MANIFEST_PATH} ({len(manifest['files'])} files checksummed).")
    if any_flags:
        print("\nNOTE: flags above don't block anything automatically -- they're for you to "
              "eyeball before trusting features computed across a flagged date.")
    price_entries = [v for v in manifest["files"].values() if "had_adj_close_col" in v]
    if not any(v["had_adj_close_col"] for v in price_entries):
        print("\nCAVEAT (real limitation, not fixed by this script): none of the current CSVs "
              "have an Adj Close column, so dividend adjustment can't be verified at all right "
              "now -- only large split-like price jumps can be heuristically flagged. If you "
              "export fresh CSVs for step 1, pull Yahoo's 'Adj Close' column (not just "
              "'Close') so this check becomes a real diff instead of a heuristic.")


if __name__ == "__main__":
    main()