"use client";

/**
 * Research showcase, aimed at someone assessing whether the work is sound.
 *
 * The live sections read straight from the sealed forward-test store and
 * render whatever is there -- including nothing. A results page that only
 * appears once the results look good is not evidence of anything, so the
 * empty state is a first-class part of this page rather than an oversight.
 */

import { useEffect, useState } from "react";
import "./method.css";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

type Forward = {
  summary: { predictions: number; scored: number; trading_days: number; tickers: number; date_range: string[] | null };
  integrity: { ok: boolean; broken_seals_predictions: string[]; duplicate_keys: unknown[]; outcomes_not_after_as_of: string[] };
  arms: Record<string, { n: number; up: number; down: number; flat: number; degraded: number; mean_confidence: number | null }>;
  universe: { hash?: string; frozen_on?: string; n_tickers?: number; n_sectors?: number; selection_rule?: string };
  status_note: string;
};

type Agents = {
  outcomes_scored: number;
  agents: Record<string, Record<string, { n: number; correct: number; accuracy: number | null; ci95: number[]; distinguishable_from_chance: boolean }>>;
  fused: Agents["agents"];
  note: string;
};

export default function MethodPage() {
  const [fwd, setFwd] = useState<Forward | null>(null);
  const [ag, setAg] = useState<Agents | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [f, a] = await Promise.all([
          fetch(`${API_BASE}/v2/forward`).then((r) => r.json()),
          fetch(`${API_BASE}/v2/agents`).then((r) => r.json()),
        ]);
        setFwd(f);
        setAg(a);
      } catch {
        setErr("Live evaluation data is unavailable — the agent service is not reachable.");
      }
    })();
  }, []);

  return (
    <div className="mth">
      <header className="mth-hero">
        <p className="mth-kicker">FINDEC · method and evidence</p>
        <h1>An agentic financial decision system, evaluated without lookahead.</h1>
        <p className="mth-lede">
          FINDEC plans which evidence a question needs, gathers it from specialist agents,
          reconciles their disagreements, and weighs them by their measured track record.
          It is evaluated by a forward test whose predictions are sealed before their
          outcomes exist — so no result on this page could have been informed by the
          outcome it reports.
        </p>
      </header>

      {/* ---------------- architecture ---------------- */}
      <section>
        <h2>Two planes, separated on purpose</h2>
        <p className="mth-sub">The separation is what makes the numbers interpretable.</p>
        <div className="mth-planes">
          <div className="mth-plane control">
            <h3>Control plane</h3>
            <p className="role">Decides <em>what work to do</em>. Language-model driven.</p>
            <div className="mth-agents">
              {["planner", "optimizer", "auditor", "curator"].map((a) => (
                <span className="mth-chip" key={a}>{a}</span>
              ))}
            </div>
            <p className="note">
              Not backtestable, and not asked to be: a model trained on data covering the
              test window recalls rather than forecasts. It is evaluated on task quality
              instead — planning accuracy, routing, adjudication.
            </p>
          </div>
          <div className="mth-plane decision">
            <h3>Decision plane</h3>
            <p className="role">Decides <em>what the market will do</em>. Numerical and deterministic.</p>
            <div className="mth-agents">
              {["market", "analyst", "researcher", "risk", "fundamentals"].map((a) => (
                <span className="mth-chip" key={a}>{a}</span>
              ))}
            </div>
            <p className="note">
              Deterministic given its inputs, so its out-of-sample performance means what
              it appears to mean. Sentiment is scored locally by FinBERT, which is frozen
              and carries no knowledge of the evaluation window.
            </p>
          </div>
        </div>

        <div className="mth-callout">
          <p>
            <strong>Why this matters.</strong> Put a current language model in the
            decision path and backtest it on 2018–2023 and it is not forecasting — it
            already knows what happened. Keeping the numerical claims free of it is the
            difference between a result and an artefact.
          </p>
        </div>
      </section>

      {/* ---------------- weighting ---------------- */}
      <section>
        <h2>Weights that move</h2>
        <p className="mth-sub">No constant anywhere in the fusion step.</p>
        <p>
          Each agent&apos;s influence is a function of observable state:
          its self-reported <strong>confidence</strong>, its <strong>measured</strong> hit
          rate in the prevailing volatility regime, and the <strong>freshness</strong> of
          the data behind it. Self-reported confidence and earned reliability are kept in
          separate terms deliberately — otherwise a confident agent outvotes an accurate one.
        </p>
        <p className="muted">
          A language model is never asked to emit a weight. A number produced that way
          would be unbacktestable, unstable between runs, and impossible to audit after
          the fact; a weight derived from measurable state is none of those and adapts
          just as much.
        </p>
      </section>

      {/* ---------------- live forward test ---------------- */}
      <section>
        <h2>The forward test, live</h2>
        <p className="mth-sub">
          Read directly from the sealed store. Whatever it currently shows is what it shows.
        </p>

        {err && <p className="mth-loading">{err}</p>}
        {!fwd && !err && <p className="mth-loading">Loading live evaluation data…</p>}

        {fwd && (
          <>
            <div className="mth-stats">
              <div className="mth-stat">
                <div className="n">{fwd.summary.predictions}</div>
                <div className="l">sealed predictions</div>
              </div>
              <div className="mth-stat">
                <div className="n">{fwd.summary.scored}</div>
                <div className="l">scored (horizon elapsed)</div>
              </div>
              <div className="mth-stat">
                <div className="n">{fwd.summary.trading_days}</div>
                <div className="l">trading days</div>
              </div>
              <div className="mth-stat">
                <div className="n">{fwd.summary.tickers}</div>
                <div className="l">tickers, {fwd.universe.n_sectors ?? "—"} sectors</div>
              </div>
              <div className="mth-stat">
                <div className="n">
                  <span className={`mth-flag ${fwd.integrity.ok ? "ok" : "warn"}`}>
                    {fwd.integrity.ok ? "intact" : "FAILED"}
                  </span>
                </div>
                <div className="l">seal &amp; lookahead checks</div>
              </div>
            </div>

            <p className="muted" style={{ fontSize: "0.87rem" }}>{fwd.status_note}</p>

            <div className="mth-tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Arm</th><th>Pipeline</th><th className="num">n</th>
                    <th className="num">up</th><th className="num">down</th><th className="num">flat</th>
                    <th className="num">mean conf.</th><th className="num">degraded</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(fwd.arms).map(([arm, v]) => (
                    <tr key={arm}>
                      <td><strong>{arm}</strong></td>
                      <td>{arm === "A" ? "numerical only (control)" : "full agentic"}</td>
                      <td className="num">{v.n}</td>
                      <td className="num">{v.up}</td>
                      <td className="num">{v.down}</td>
                      <td className="num">{v.flat}</td>
                      <td className="num">{v.mean_confidence?.toFixed(2) ?? "—"}</td>
                      <td className="num">{v.degraded}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="muted" style={{ fontSize: "0.85rem" }}>
              Both arms run on the same tickers on the same days, so the comparison is
              paired within period rather than one arm followed by the other — a
              sequential design would confound the difference with whatever the market
              did in between.
              {fwd.universe.hash && (
                <> Universe frozen {fwd.universe.frozen_on}, manifest{" "}
                  <code>{fwd.universe.hash}</code>; it refuses to change mid-run.</>
              )}
            </p>
          </>
        )}
      </section>

      {/* ---------------- per-agent ---------------- */}
      <section>
        <h2>Per-agent accuracy</h2>
        <p className="mth-sub">Each agent judged on what it said, not on whether it was followed.</p>

        {ag && ag.outcomes_scored === 0 ? (
          <div className="mth-callout">
            <p>
              <strong>No outcomes yet.</strong> Predictions are sealed and waiting for
              their horizons to elapse. Until then no agent has a track record, every
              reliability term is still its 0.50 prior, and no accuracy claim is possible.
              This section will populate itself.
            </p>
          </div>
        ) : ag ? (
          <div className="mth-tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Agent</th><th>Regime</th><th className="num">n</th>
                  <th className="num">accuracy</th><th>95% CI</th><th />
                </tr>
              </thead>
              <tbody>
                {Object.entries({ ...ag.agents, ...ag.fused }).flatMap(([name, regimes]) =>
                  Object.entries(regimes).map(([regime, v]) => (
                    <tr key={`${name}-${regime}`}>
                      <td>{name}</td>
                      <td>{regime}</td>
                      <td className="num">{v.n}</td>
                      <td className="num">{v.accuracy?.toFixed(3) ?? "—"}</td>
                      <td>[{v.ci95[0].toFixed(2)}, {v.ci95[1].toFixed(2)}]</td>
                      <td>
                        <span className={`mth-flag ${v.distinguishable_from_chance ? "ok" : "warn"}`}>
                          {v.distinguishable_from_chance ? "beats chance" : "spans 0.5"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}

        {ag && <p className="muted" style={{ fontSize: "0.85rem" }}>{ag.note}</p>}
      </section>

      {/* ---------------- taxonomy ---------------- */}
      <section>
        <h2>Intent taxonomy, grounded rather than invented</h2>
        <p>
          The Planner classifies a query into one of eleven intents, derived from
          Blankespoor et al.&apos;s study of <strong>29,242 real retail-investor
          questions</strong> rather than from intuition. On that paper&apos;s own published
          labels the Planner scores <strong>0.923</strong>, against the 0.75 their trained
          SBERT classifier achieves on the same task.
        </p>
        <div className="mth-callout">
          <p>
            <strong>This figure is not yet quotable.</strong> The prompt was revised four
            times against those same 26 questions, so it is tuning-set performance and
            carries the same optimism as a strategy tuned on its own backtest. A held-out
            set the prompt has never seen is required before the number means anything.
          </p>
        </div>
        <p className="muted">
          The same data also shows what FINDEC does <em>not</em> yet serve: explaining and
          screening are 75% of what investors actually ask, and market data outweighs news
          31:1 as an information source.
        </p>
      </section>

      {/* ---------------- limitations ---------------- */}
      <section>
        <h2>What this does not yet show</h2>
        <p className="mth-sub">Stated here rather than left to be discovered.</p>
        <ul className="mth-limits">
          <li>
            <strong>No performance claim.</strong> The forward test has produced no scored
            outcomes yet. Nothing here says the agentic arm beats the numerical control.
          </li>
          <li>
            <strong>Risk-adjusted claims are out of reach.</strong> An earlier five-ticker
            study had 5.9% power to detect a +0.30 Sharpe difference. Breadth was widened
            to 40 names precisely because duration cannot fix that, and directional
            accuracy — not Sharpe — is what this design can support.
          </li>
          <li>
            <strong>Agent reliability is still a prior.</strong> Every weight currently
            uses 0.50 for measured reliability, because no agent has a track record yet.
          </li>
          <li>
            <strong>The Auditor is not yet a trustworthy instrument.</strong> It returned
            different verdicts on identical input across two runs; that variance needs
            explaining before any audit figure is reported.
          </li>
          <li>
            <strong>Fundamentals are point-in-time incapable.</strong> The source reports
            only current values, so that agent refuses historical dates outright rather
            than serving a figure that would be quiet lookahead.
          </li>
        </ul>
      </section>

      <section>
        <h2>Read further</h2>
        <div className="mth-links">
          <a href="/paper">The paper</a>
          <a href="/ask">Try the system</a>
          <a href="https://github.com/mansi104-ai/FINITY" target="_blank" rel="noreferrer">Source</a>
          <a href="/disclaimer">Disclaimer</a>
        </div>
      </section>
    </div>
  );
}
