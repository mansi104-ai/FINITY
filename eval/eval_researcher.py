"""
eval_researcher.py

Honest evaluation of the FINDEC Researcher Agent's sentiment lexicon.

This calls the REAL functions from sentiment_nlp.py (label_sentiment,
aggregate_sentiment) against a labeled dataset you provide. It does not
invent, adjust, or curve-fit any numbers -- whatever comes out is what
the lexicon actually does on your data.

USAGE:
    python eval_researcher.py --data headlines.csv --text-col headline --label-col label

CSV FORMAT expected:
    headline,label
    "Company X beats earnings expectations",positive
    "Company Y misses revenue targets",negative
    "Company Z reports stable quarterly results",neutral

label column must contain: positive / neutral / negative
(case-insensitive; also accepts 1/0/-1 or bullish/bearish/hold)

WHERE TO GET REAL LABELED DATA (free, academic-standard):
    - Financial PhraseBank (Malo et al. 2014) - the standard dataset cited
      in your paper's related work [11]. Search "Financial PhraseBank"
      on Hugging Face datasets or Kaggle.
    - Or hand-label a sample of real headlines yourself for a smaller,
      fully-defensible custom benchmark.

If you don't have real data yet, run with --demo to see the script work
on a TINY illustrative fixture (10 headlines) so you can check the
pipeline runs end-to-end. Do NOT report --demo numbers in the paper --
they exist only to prove the script works, not as evaluation results.
"""

import argparse
import csv
import os
import sys
from pathlib import Path


def _locate_and_add(module_filename: str) -> None:
    """
    Finds module_filename somewhere under the repo and adds its folder to
    sys.path, so `from <module> import ...` works regardless of your repo
    layout. Override with env var FINDEC_REPO_ROOT if autodetect fails.
    """
    here = Path(__file__).resolve().parent
    repo_root = Path(os.environ.get("FINDEC_REPO_ROOT", here.parent))

    candidates = [
        repo_root / "python_agents" / "models",
        repo_root / "python_agents" / "agents",
        repo_root / "python_agents",
        repo_root / "models",
        repo_root,
        here / "agent_src",
    ]
    for c in candidates:
        if (c / module_filename).exists():
            sys.path.insert(0, str(c))
            return

    for found in repo_root.rglob(module_filename):
        sys.path.insert(0, str(found.parent))
        return

    print(f"WARNING: could not find {module_filename} under {repo_root}.\n"
          f"Set FINDEC_REPO_ROOT to your repo's root folder, e.g.:\n"
          f"  set FINDEC_REPO_ROOT=C:\\Users\\mansi\\FINITY   (Windows)\n"
          f"  export FINDEC_REPO_ROOT=/path/to/FINITY        (Mac/Linux)")


_locate_and_add("sentiment_nlp.py")
from sentiment_nlp import label_sentiment, aggregate_sentiment  # noqa: E402

LABEL_MAP_5_TO_3 = {
    "STRONG_BUY": "positive",
    "BUY": "positive",
    "HOLD": "neutral",
    "SELL": "negative",
    "STRONG_SELL": "negative",
}

GT_NORMALIZE = {
    "positive": "positive", "pos": "positive", "1": "positive", "bullish": "positive",
    "neutral": "neutral", "0": "neutral", "hold": "neutral",
    "negative": "negative", "neg": "negative", "-1": "negative", "bearish": "negative",
}

DEMO_FIXTURE = [
    ("Company reports record earnings and strong guidance", "positive"),
    ("Stock surges after breakthrough product launch", "positive"),
    ("Shares rally on upgrade from major bank", "positive"),
    ("Quarterly results in line with expectations", "neutral"),
    ("Company maintains steady outlook for next year", "neutral"),
    ("Management issues balanced statement on demand", "neutral"),
    ("Stock drops after weak earnings miss", "negative"),
    ("Shares plunge amid fraud investigation", "negative"),
    ("Company faces bankruptcy risk after covenant breach", "negative"),
    ("Analysts downgrade stock citing headwinds", "negative"),
]


def _looks_like_phrasebank(path: str) -> bool:
    """
    Detects the standard Financial PhraseBank `all-data.csv` layout (Malo
    et al. 2014, Kaggle/HF mirror): no header row, two columns as
    `label,sentence`, Latin-1 encoded, rows separated by a bare `\r`
    (classic Mac line endings) rather than `\n`/`\r\n`. Different enough
    from the headline/label CSV-with-header format this script was
    originally built for that it needs its own loader.
    """
    try:
        with open(path, "rb") as f:
            head = f.read(200)
        first_field = head.split(b",", 1)[0].strip().strip(b'"').lower()
        return first_field in (b"positive", b"negative", b"neutral")
    except OSError:
        return False


def load_phrasebank_csv(path: str):
    """
    Loads the real Financial PhraseBank corpus. Encoding is Latin-1, not
    UTF-8 -- the source file has non-ASCII bytes (e.g. in company names)
    that raise UnicodeDecodeError under utf-8. Row separator is a bare
    `\r`, so the file is read whole and split on `\r` manually rather than
    relying on csv.reader's newline handling, since `newline=""` disables
    Python's universal-newline translation and there's no `\n` at all to
    split on otherwise.
    """
    with open(path, "r", encoding="latin-1", newline="") as f:
        raw = f.read()
    lines = [ln for ln in raw.split("\r") if ln.strip()]
    rows = []
    for label, sentence in csv.reader(lines):
        rows.append((sentence, label))
    return rows


def load_csv(path: str, text_col: str, label_col: str):
    if _looks_like_phrasebank(path):
        return load_phrasebank_csv(path)
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            rows.append((r[text_col], r[label_col]))
    return rows


def evaluate(rows):
    y_true, y_pred = [], []
    for text, gt_label in rows:
        gt_norm = GT_NORMALIZE.get(str(gt_label).strip().lower())
        if gt_norm is None:
            continue  # skip rows with unparseable labels
        pred_5class = label_sentiment(text)
        pred_3class = LABEL_MAP_5_TO_3[pred_5class]
        y_true.append(gt_norm)
        y_pred.append(pred_3class)
    return y_true, y_pred


def print_report(y_true, y_pred):
    try:
        from sklearn.metrics import classification_report
        print(classification_report(y_true, y_pred, digits=2))
    except ImportError:
        # fallback: manual precision/recall/F1 per class, no sklearn needed
        classes = sorted(set(y_true) | set(y_pred))
        print(f"{'class':<10}{'precision':>10}{'recall':>10}{'f1':>10}{'support':>10}")
        for c in classes:
            tp = sum(1 for t, p in zip(y_true, y_pred) if t == c and p == c)
            fp = sum(1 for t, p in zip(y_true, y_pred) if t != c and p == c)
            fn = sum(1 for t, p in zip(y_true, y_pred) if t == c and p != c)
            support = sum(1 for t in y_true if t == c)
            prec = tp / (tp + fp) if (tp + fp) else 0.0
            rec = tp / (tp + fn) if (tp + fn) else 0.0
            f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
            print(f"{c:<10}{prec:>10.2f}{rec:>10.2f}{f1:>10.2f}{support:>10d}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", help="path to labeled CSV")
    parser.add_argument("--text-col", default="headline")
    parser.add_argument("--label-col", default="label")
    parser.add_argument("--demo", action="store_true", help="run on tiny illustrative fixture only")
    args = parser.parse_args()

    if args.demo or not args.data:
        print("Running on DEMO fixture (10 headlines).\n")
        rows = DEMO_FIXTURE
    else:
        rows = load_csv(args.data, args.text_col, args.label_col)
        print(f"Loaded {len(rows)} labeled rows from {args.data}\n")

    y_true, y_pred = evaluate(rows)
    print(f"Evaluated {len(y_true)} rows (dropped {len(rows) - len(y_true)} with unparseable labels)\n")
    print_report(y_true, y_pred)


if __name__ == "__main__":
    main()