# FINDEC Query Taxonomy

Empirical grounding for the Planner's `intent` labels and for routing.

Intent labels were previously invented. That showed: on a probe query
("Is it a good time to add to my Apple position?", unambiguously an advice
question) the planner returned `explain_move` on one run and `exit_timing`
on the next, because the schema offered enum values with no definitions and
the model had nothing to classify against. The taxonomy below is derived
from observed query distributions instead.

## Sources

**[1] Blankespoor, deHaan, Marinovic, Zhu — "Generative AI and Investor
Processing of Financial Information."** 29,242 retail-investor questions
put to Alpha, the AI assistant on Public.com, sampled mid-2024 from a raw
draw of 40,381. Method: 1,500 questions manually labelled into mutually
exclusive categories by primary intent, weighted-random-sampled to reflect
repeated prompts; SBERT trained on 1,200, evaluated on a 300 holdout.
Reported accuracy 0.75 (task) and 0.73 (information source).

**[2] FinS-Pilot — "A Benchmark for Online Financial RAG System"**
(arXiv 2506.2037). A *workflow-aware* intent taxonomy: 9 first-level and 62
second-level categories drawn from production financial-assistant logs,
where each second-level category maps to a specific business workflow so
queries route to the right pipeline. The precedent for treating intent as a
routing key rather than a descriptive label.

## Observed distribution [1, Table 9]

| Task | n | Share |
|---|---:|---:|
| Explain or interpret | 13,877 | 47.5% |
| Screen for securities | 8,121 | 27.8% |
| General company assessment | 2,508 | 8.6% |
| Background | 1,436 | 4.9% |
| Summarize | 1,357 | 4.6% |
| Retrieve | 1,063 | 3.6% |
| Define | 497 | 1.7% |
| Trends | 324 | 1.1% |
| Compare | 59 | 0.2% |

Information sources processed [1, Table 10]: Market **73.7%**, Analyst 8.1%,
Background 4.9%, Financial numbers 4.6%, Earnings call 2.6%, **News 2.4%**,
Educational 1.7%, Industry 1.1%, General 1.1%.

### Selection effects — read before citing these numbers

Three exclusions were applied before the 29,242 sample was formed: 1,917
incoherent, **2,999 asking for explicit advice or guidance**, and 6,223
app-support questions. Alpha declines advice questions as a matter of
policy, and users adapt to a tool that refuses. **The implied ≈7.4%
advice-seeking rate is therefore a floor produced by platform policy, not a
measurement of investor demand for advice.** Nothing here supports the claim
that only 7% of investors want a recommendation.

Two further limits: it is one platform's users over one period, and the
labels come from a 0.75-accuracy classifier, so shares carry roughly
±2 percentage points of classifier noise before sampling error.

### What this implies for FINDEC

- Explain and Screen are **75.3%** of observed volume. FINDEC currently
  serves neither: it answers a single-ticker buy/sell/hold question.
- Market data dominates news **31:1** as an information source. The
  Researcher Agent is prominent in the architecture and the paper; the
  evidence puts the Market Agent first.
- [1]'s 0.75 task-classification accuracy is a published benchmark for the
  Planner to be measured against on a comparable labelled set.

## FINDEC intent labels

Ten labels. Each carries a definition, a disambiguation rule against its
nearest neighbour, and a default agent set. The disambiguation rules exist
because the observed failures were all boundary confusions, not wild
misreads.

| Intent | Definition | Nearest confusion — rule | Default agents |
|---|---|---|---|
| `interpret` | Explain **or interpret** market/financial data: both "why did X move" and "is this metric healthy". The user wants meaning drawn from data, not the raw figure. | vs `assess`: interpret concerns a *specific datum or move*; assess is a standing overall view. | market, researcher |
| `screen` | Find securities matching criteria. No ticker supplied by the user. | vs `compare`: screen searches an open universe; compare ranks a named set. | market, fundamentals |
| `assess` | Overall standing view of a named security. "How's MSFT doing?", "pros and cons". | vs `advice`: assess describes; advice tells the user what to *do* with their own money. | market, analyst, researcher, fundamentals |
| `advice` | A recommended action on the user's own position: buy, sell, add, trim, hold. | vs `assess`: presence of the user's position or money ("my", "should I"). | market, analyst, risk, researcher |
| `risk_check` | Downside, exposure, or sizing for a position. | vs `advice`: risk_check asks *how much could I lose*; advice asks *what should I do*. | risk, market, analyst |
| `background` | Qualitative description of what a **specific company** is or does: business model, strategy, revenue sources. | vs `retrieve`: background is qualitative; retrieve returns a number. vs `define`: background has a company in scope. | fundamentals |
| `summarize` | Condense a specific document or period — earnings call, recent headlines. | vs `interpret`: summarize has a named source document; interpret has a datum or move. | researcher, fundamentals |
| `retrieve` | One specific **number**; the answer is a figure. | vs `trend`: retrieve is a point value, trend a series. vs `interpret`: retrieve wants the figure, interpret wants a judgement on it. | fundamentals, market |
| `trend` | Direction of a metric over a stated window. | vs `interpret`: trend asks *what happened* over a window; interpret asks *why* or *so what*. | market, fundamentals |
| `compare` | Rank or contrast named securities or segments. | vs `screen`: the candidate set is given. | market, fundamentals, analyst |
| `define` | A **general** financial concept with **no specific company** in scope. | vs `background`: if a company is named or implied it is background, not define. Terminal — dispatches nothing. | *(none)* |

Deviations from [1], and why:

- **`advice` is added.** [1] excluded it by platform policy. It is FINDEC's
  primary use case and cannot be dropped.
- **`assess` keeps [1]'s "general company assessment"** rather than being
  merged into `advice`. The two differ in whether the user's own capital is
  in scope, which changes whether the Risk agent is dispatched.
- **`define` dispatches nothing.** Routing a definition through five agents
  spends budget to answer a question no market data bears on.

## Routing consequence

The default agent sets above are the router's prior, not a fixed schedule —
the Planner may add or drop a subtask when the query warrants it. Two rules
hold regardless:

1. **`define` never dispatches.** It is answered directly.
2. **`advice` and `risk_check` always dispatch `risk`.** Any answer bearing
   on the user's own capital gets a downside estimate, whether or not the
   user asked for one.

## Measured accuracy

`eval/eval_planner_intent.py`, prompt v2.3, batch mode, n=33.

| Subset | n | Accuracy |
|---|---:|---:|
| published (labels from [1] Table 9) | 26 | **0.923** |
| authored (advice / risk_check) | 7 | 1.000 |
| overall | 33 | 0.939 |

Comparison point: [1]'s SBERT scores 0.75 on task classification. Same task,
different sample — indicative, not like-for-like, since their figure is over
a 300-question holdout.

### This number is optimistically biased — do not quote it as a result

The prompt was revised four times against these same 26 questions. That is
tuning-set performance and carries the same data-snooping problem as a
strategy tuned on its own backtest. **A claim needs a held-out set the prompt
has never seen.** Build it the way [1] did: mutually exclusive labels,
assigned by primary intent, ideally by two annotators with Cohen's kappa
reported.

The two residual errors are both `interpret` read as `company_profile`
("How healthy are their margins?", "How is their battery business
performing?"). They survived an explicit static-vs-evaluative discriminator
and verbatim worked examples, so they reflect genuine ambiguity rather than a
fixable prompt defect — [1] concedes the same, noting their classifier's
deviations "seem generally reasonable, given the ambiguity of some questions."

### What moved the number, and what did not

Going from 0.615 to 0.923 came almost entirely from **renaming two labels**,
not from adding explanatory prose:

- `background` → `company_profile`. "Background" was being read as
  "background knowledge", which is what `define` means. `define` went 0/3 → 3/3.
- `retrieve` → `data_point`. "Retrieve" named a system action rather than a
  user need, and drew the *agent* name `fundamentals` as an answer.
  0/3 → 3/3.

The lesson generalises: a classifier keys heavily on label semantics, so an
ambiguous label name costs more accuracy than a paragraph of disambiguation
recovers.

Two harness defects found along the way, both of which silently invalidated
runs and are worth guarding against:

1. **A stale cache replayed old responses** because `PLANNER_PROMPT_VERSION`
   was not bumped alongside a prompt change. Cache keys include the version;
   without a bump, prompt edits never reach the model.
2. **The batch harness declared its own bare enum** for `intent`, so none of
   the disambiguation text in `TASK_GRAPH_SCHEMA` was ever sent. It was
   measuring a different classifier from the one that ships. The tell was
   that renames moved the score while description edits did nothing.
