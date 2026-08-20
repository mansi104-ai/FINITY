"use client";

/**
 * Chat surface for FINDEC.
 *
 * One input, one thread. Two design decisions worth naming.
 *
 * First, the reasoning is streamed, not awaited. A query that dispatches five
 * agents takes the better part of a minute, and a spinner for that whole time
 * is the moment the product looks least like the team of analysts it is. So
 * the plan, the roster of agents, and each agent's finding appear as they
 * land, over Server-Sent Events from `/v2/ask/stream`. Where that route is
 * unavailable the page falls back to the blocking `/v2/ask` and simply shows
 * the finished answer.
 *
 * Second, the evidence is collapsed but never hidden, and it always renders --
 * including when an agent reports UNAVAILABLE, and including when the honest
 * answer is that there is no confident view. In a domain where being wrong
 * costs money, a recommendation nobody can interrogate is worth very little,
 * and a gap in the evidence is itself information the user should have.
 */

import { useEffect, useRef, useState } from "react";
import "./ask.css";

const AGENTS_BASE = (
  // The Python agent service, NOT NEXT_PUBLIC_API_URL -- that one points at
  // the Node backend on :4000, which has no /v2 routes. Using it here made
  // every request 404 against a server that was running perfectly well.
  process.env.NEXT_PUBLIC_AGENTS_URL || "http://127.0.0.1:8000"
).trim().replace(/\/$/, "");

type AgentTrace = {
  agent: string;
  status: string;
  confidence: number;
  /** Share of total evidence weight — includes agents that never vote. */
  weight: number | null;
  /** Share of the directional vote, renormalised over actual voters. */
  voting_weight: number | null;
  votes_on_direction: boolean;
  summary: string[];
  payload: Record<string, unknown>;
  as_of: string | null;
  duration_ms: number;
};

type Provenance = { agent: string; as_of: string };

type Answer = {
  intent: string;
  terminal: boolean;
  answer?: string;
  tickers?: string[];
  horizon_days?: number;
  risk_posture?: string;
  plan?: { rationale?: string; planned_by?: string; cached?: boolean };
  agents: AgentTrace[];
  optimizer?: {
    sufficient: boolean;
    conflict: string;
    assessment: string;
    iterations: number;
    used_llm: boolean;
  };
  decision: {
    action: string;
    score: number;
    confidence: number;
    position_pct: number;
    sizing_rationale: string;
    contributing_agents: number;
  } | null;
  fusion?: { regime: string; explanation: string };
  provenance?: Provenance[];
  links?: { label: string; href: string }[];
  duration_ms: number;
  disclaimer: string;
};

/** One agent's slot in the live view: pending until its result lands. */
type LiveAgent = {
  agent: string;
  pending: boolean;
  status?: string;
  confidence?: number;
  summary?: string[];
  as_of?: string | null;
};

/** Accumulates the stream as events arrive, until the decision replaces it. */
type Live = {
  plan?: {
    intent: string;
    tickers: string[];
    horizon_days: number;
    risk_posture: string;
    planned_by?: string;
  };
  order: string[];
  agents: Record<string, LiveAgent>;
  optimizer?: Answer["optimizer"];
  answer?: Answer;
  done: boolean;
  stopped?: boolean;
  error?: string;
};

type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; data: Answer }
  | { role: "live"; live: Live }
  | { role: "error"; text: string };

const SAMPLES = [
  { q: "I'm up 40% on my Nvidia position but nervous about earnings in three weeks. Should I take some off the table? I can't stomach a big drawdown.", why: "advice, with a risk constraint" },
  { q: "Why is AMD moving today?", why: "interpret a price move" },
  { q: "What's my downside if I hold 200 shares of TSLA through earnings?", why: "risk check" },
  { q: "How does Tesla compare to Rivian on margins?", why: "comparison" },
];

const AGENT_ROLE: Record<string, string> = {
  market: "price & volatility",
  analyst: "directional forecast",
  researcher: "news sentiment",
  risk: "downside & sizing",
  fundamentals: "valuation",
};

/** Human label for a provenance source. */
const SOURCE_LABEL: Record<string, string> = {
  market: "Prices",
  analyst: "Model",
  researcher: "News",
  risk: "Risk model",
  fundamentals: "Fundamentals",
};

export default function AskPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  function grow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }

  /** Mutate the trailing live message. Only one stream runs at a time (the
   *  busy guard), so the last message is always the current live one. */
  function updateLive(fn: (l: Live) => Live) {
    setMessages((m) => {
      const i = m.length - 1;
      if (i < 0 || m[i].role !== "live") return m;
      const copy = m.slice();
      copy[i] = { role: "live", live: fn((m[i] as { live: Live }).live) };
      return copy;
    });
  }

  function applyEvent(evt: Record<string, unknown>) {
    const type = evt.type as string;
    if (type === "plan") {
      updateLive((l) => ({
        ...l,
        plan: {
          intent: evt.intent as string,
          tickers: (evt.tickers as string[]) ?? [],
          horizon_days: evt.horizon_days as number,
          risk_posture: evt.risk_posture as string,
          planned_by: evt.planned_by as string,
        },
      }));
    } else if (type === "agents_planned") {
      const agents = (evt.agents as { agent: string }[]) ?? [];
      updateLive((l) => {
        const order = agents.map((a) => a.agent);
        const slots: Record<string, LiveAgent> = {};
        for (const a of order) slots[a] = { agent: a, pending: true };
        return { ...l, order, agents: slots };
      });
    } else if (type === "agent_done") {
      updateLive((l) => ({
        ...l,
        agents: {
          ...l.agents,
          [evt.agent as string]: {
            agent: evt.agent as string,
            pending: false,
            status: evt.status as string,
            confidence: evt.confidence as number,
            summary: (evt.summary as string[]) ?? [],
            as_of: (evt.as_of as string) ?? null,
          },
        },
      }));
    } else if (type === "optimizer") {
      updateLive((l) => ({
        ...l,
        optimizer: {
          sufficient: evt.sufficient as boolean,
          conflict: evt.conflict as string,
          assessment: evt.assessment as string,
          iterations: evt.iterations as number,
          used_llm: evt.used_llm as boolean,
        },
      }));
    } else if (type === "decision") {
      updateLive((l) => ({
        ...l,
        answer: {
          intent: evt.intent as string,
          terminal: (evt.terminal as boolean) ?? false,
          answer: evt.answer as string | undefined,
          tickers: evt.tickers as string[] | undefined,
          horizon_days: evt.horizon_days as number | undefined,
          risk_posture: evt.risk_posture as string | undefined,
          plan: evt.plan as Answer["plan"],
          agents: (evt.agents as AgentTrace[]) ?? [],
          optimizer: l.optimizer,
          decision: (evt.decision as Answer["decision"]) ?? null,
          fusion: evt.fusion as Answer["fusion"],
          provenance: evt.provenance as Provenance[] | undefined,
          links: evt.links as Answer["links"],
          duration_ms: 0,
          disclaimer: evt.disclaimer as string,
        },
      }));
    } else if (type === "done") {
      updateLive((l) => ({
        ...l,
        done: true,
        answer: l.answer
          ? { ...l.answer, duration_ms: (evt.duration_ms as number) ?? 0 }
          : l.answer,
      }));
    } else if (type === "error") {
      updateLive((l) => ({ ...l, done: true, error: evt.message as string }));
    }
  }

  /** Fallback for when the streaming route is unavailable (e.g. an older
   *  backend that only serves the blocking `/v2/ask`). */
  async function runBlocking(q: string, signal: AbortSignal) {
    const res = await fetch(`${AGENTS_BASE}/v2/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q }),
      signal,
    });
    if (!res.ok) throw new Error(`Agent service returned ${res.status} from ${AGENTS_BASE}/v2/ask.`);
    const data: Answer = await res.json();
    updateLive((l) => ({ ...l, done: true, answer: data }));
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setMessages((m) => [
      ...m,
      { role: "user", text: q },
      { role: "live", live: { order: [], agents: {}, done: false } },
    ]);
    setInput("");
    setBusy(true);
    if (taRef.current) taRef.current.style.height = "auto";

    try {
      const res = await fetch(`${AGENTS_BASE}/v2/ask/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ query: q }),
        signal: ctrl.signal,
      });

      // If the stream route is missing (404) or the body is not readable, fall
      // back to the blocking endpoint rather than failing the whole request.
      if (res.status === 404 || !res.body) {
        await runBlocking(q, ctrl.signal);
        return;
      }
      if (!res.ok) {
        throw new Error(`Agent service returned ${res.status} from ${AGENTS_BASE}/v2/ask/stream.`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep;
        // SSE frames are separated by a blank line.
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const dataLine = frame.split("\n").find((ln) => ln.startsWith("data:"));
          if (!dataLine) continue;
          try {
            applyEvent(JSON.parse(dataLine.slice(5).trim()));
          } catch {
            /* a truncated frame is impossible here — we split on \n\n — but
               guard anyway so one bad line cannot abort the stream */
          }
        }
      }
    } catch (e) {
      if (ctrl.signal.aborted) {
        updateLive((l) => ({ ...l, done: true, stopped: true }));
      } else {
        const isNetwork = e instanceof TypeError; // fetch rejects this way when nothing answers
        // Replace the live placeholder with a plain error message.
        setMessages((m) => {
          const i = m.length - 1;
          const copy = m[i]?.role === "live" ? m.slice(0, i) : m.slice();
          return [
            ...copy,
            {
              role: "error",
              text: isNetwork
                ? `Could not reach the agent service at ${AGENTS_BASE}. Start it with ` +
                  `"uvicorn main:app --port 8000" in python_agents, or set NEXT_PUBLIC_AGENTS_URL.`
                : e instanceof Error
                  ? e.message
                  : "Something went wrong.",
            },
          ];
        });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div className="ask-wrap">
      <div className="ask-thread" ref={threadRef}>
        {messages.length === 0 && (
          <div className="ask-empty">
            <h1>What are you deciding?</h1>
            <p>
              Ask in your own words. FINDEC plans which evidence it needs, gathers it,
              and shows you every step behind the answer.
            </p>
            <div className="ask-samples">
              {SAMPLES.map((s) => (
                <button key={s.q} className="ask-sample" onClick={() => send(s.q)}>
                  {s.q.length > 96 ? `${s.q.slice(0, 96)}…` : s.q}
                  <span>{s.why}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ask-msg user">
              <div className="ask-bubble">{m.text}</div>
            </div>
          ) : m.role === "error" ? (
            <div key={i} className="ask-msg">
              <div className="ask-error">{m.text}</div>
            </div>
          ) : m.role === "live" ? (
            <div key={i} className="ask-msg">
              {m.live.error ? (
                <div className="ask-error">{m.live.error}</div>
              ) : m.live.answer ? (
                <AnswerCard data={m.live.answer} />
              ) : (
                <LiveProgress live={m.live} />
              )}
            </div>
          ) : (
            <div key={i} className="ask-msg">
              <AnswerCard data={m.data} />
            </div>
          )
        )}
      </div>

      <div className="ask-composer">
        <div className="ask-inputrow">
          <textarea
            ref={taRef}
            className="ask-input"
            rows={1}
            placeholder="Ask about a stock, a position, or a decision…"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              grow();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          {busy ? (
            <button className="ask-send ask-stop" onClick={stop} aria-label="Stop">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              className="ask-send"
              onClick={() => send(input)}
              disabled={!input.trim()}
              aria-label="Send"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
        <p className="ask-hint">
          Decision support, not investment advice. Enter to send, Shift+Enter for a new line.
        </p>
      </div>
    </div>
  );
}

/** The reasoning-in-progress view: the plan, then a card per agent that fills
 *  in the moment its result lands. This is the streamed substitute for a
 *  spinner — the user watches the team work instead of watching a dot. */
function LiveProgress({ live }: { live: Live }) {
  const p = live.plan;
  const roster = live.order;
  return (
    <div className="ask-answer ask-live">
      <div className="ask-live-head">
        {p ? (
          <>
            <span className="ask-live-pulse" aria-hidden />
            Reasoning about {p.tickers.length ? p.tickers.join(", ") : "your question"}
            {" · "}
            <span className="ask-live-intent">{p.intent}</span>
            {p.horizon_days ? ` · ${p.horizon_days}-day view` : ""}
          </>
        ) : (
          <>
            <span className="ask-live-pulse" aria-hidden />
            Planning which evidence to gather…
          </>
        )}
      </div>

      {roster.length > 0 && (
        <div className="ask-live-agents">
          {roster.map((name) => {
            const a = live.agents[name];
            const done = a && !a.pending;
            const ok = done && a.status === "ok";
            return (
              <div key={name} className={`ask-live-agent ${done ? (ok ? "ok" : "warn") : "pending"}`}>
                <div className="ask-live-agent-top">
                  <span className="ask-live-status" aria-hidden>
                    {done ? (ok ? "✓" : "⚠") : <span className="ask-live-spin" />}
                  </span>
                  <span className="ask-live-agent-name">{name}</span>
                  <em>{AGENT_ROLE[name] ?? ""}</em>
                  {ok && a.confidence != null && (
                    <span className="ask-live-conf">conf {a.confidence.toFixed(2)}</span>
                  )}
                </div>
                {done && (
                  <div className="ask-live-agent-detail">
                    {ok
                      ? (a.summary?.[0] ?? "returned evidence")
                      : `${a.status} — ${a.summary?.[0] ?? "no detail"}`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AnswerCard({ data }: { data: Answer }) {
  if (data.terminal) {
    return (
      <div className="ask-answer">
        <p className="ask-line">{data.answer}</p>
        <p className="ask-disclaimer">
          Classified as <strong>{data.intent}</strong> — a general concept rather than a
          question about a specific security, so no market data was gathered.
        </p>
      </div>
    );
  }

  const d = data.decision;
  const usable = data.agents.filter((a) => a.status === "ok");
  const missing = data.agents.filter((a) => a.status !== "ok");
  // A "hold" is not a weak buy — it is the honest output when the evidence
  // does not support a directional call. The Analyst cannot forecast
  // direction, and saying so is the paper's one positive result, so the UI
  // frames abstention as a finding rather than a shrug.
  const abstained = d != null && d.action === "hold";

  return (
    <div className="ask-answer">
      {d && !abstained && (
        <div className="ask-verdict">
          <span className={`ask-action ${d.action}`}>{d.action.toUpperCase()}</span>
          <span className="ask-meta">
            {data.tickers?.join(", ")} · {data.horizon_days}-day view ·{" "}
            {Math.round(d.confidence * 100)}% conviction
            {d.position_pct > 0 && <> · size {d.position_pct.toFixed(1)}% of capital</>}
          </span>
        </div>
      )}

      {abstained && (
        <div className="ask-abstain">
          <div className="ask-abstain-head">No confident directional view</div>
          <p className="ask-line">
            The evidence for {data.tickers?.join(", ")} does not support a
            {" "}{data.horizon_days}-day call in either direction, so FINDEC holds rather
            than manufacture conviction it does not have. Withholding a weak signal is a
            deliberate output here, not a failure to produce one.
          </p>
        </div>
      )}

      {d && !abstained && <p className="ask-line">{d.sizing_rationale}</p>}
      {data.fusion && <p className="ask-line">{data.fusion.explanation}</p>}

      {/* Freshness stated up front: a stale price silently changes the answer. */}
      {data.provenance && data.provenance.length > 0 && (
        <p className="ask-provenance">
          {data.provenance.map((s, i) => (
            <span key={s.agent}>
              {i > 0 && " · "}
              {SOURCE_LABEL[s.agent] ?? s.agent} to {s.as_of}
            </span>
          ))}
        </p>
      )}

      {/* A disagreement the user should see rather than have averaged away. */}
      {data.optimizer?.conflict && (
        <p className="ask-line">
          <strong>Agents disagreed.</strong> {data.optimizer.conflict}.{" "}
          {data.optimizer.assessment}
        </p>
      )}

      {missing.length > 0 && (
        <p className="ask-line" style={{ color: "var(--warning)" }}>
          {missing.map((a) => a.agent).join(", ")} could not be consulted, so this
          view rests on {usable.length} of {data.agents.length} evidence sources.
        </p>
      )}

      <details className="ask-evidence">
        <summary>
          Show the evidence — {data.agents.length} agents
          {data.duration_ms ? `, ${(data.duration_ms / 1000).toFixed(1)}s` : ""}
          {data.plan?.planned_by && data.plan.planned_by !== "deterministic-fallback"
            ? ""
            : " (planner degraded)"}
        </summary>
        <div style={{ marginTop: "0.6rem" }}>
          {data.agents.map((a) => (
            <div className="ask-agent" key={a.agent}>
              <div className="ask-agent-name">
                {a.agent}
                <em>{AGENT_ROLE[a.agent] ?? ""}</em>
              </div>
              <div className="ask-agent-body">
                {a.status === "ok" ? (
                  <>
                    {a.summary.map((s, i) => (
                      <div key={i}>{s}</div>
                    ))}
                    {/* Evidence weight and voting weight are shown apart.
                        Risk routinely carries the largest evidence weight
                        while contributing nothing to the direction, and a
                        single percentage next to a BUY invites exactly the
                        wrong inference. */}
                    <div style={{ marginTop: "0.2rem", fontSize: "0.76rem" }}>
                      confidence {a.confidence.toFixed(2)}
                      {a.weight != null && <> · {Math.round(a.weight * 100)}% of evidence</>}
                      {a.votes_on_direction && a.voting_weight != null ? (
                        <> · {Math.round(a.voting_weight * 100)}% of the call</>
                      ) : (
                        <> · does not vote on direction</>
                      )}
                      {a.as_of && <> · as of {a.as_of}</>}
                    </div>
                    {a.weight != null && (
                      <div
                        className="ask-weightbar"
                        style={{
                          width: `${Math.max(2, a.weight * 100)}%`,
                          opacity: a.votes_on_direction ? 0.55 : 0.22,
                        }}
                      />
                    )}
                  </>
                ) : (
                  <span className="unavailable">
                    {a.status} — {a.summary[0] ?? "no detail"}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </details>

      {data.links && data.links.length > 0 && (
        <div className="ask-links">
          {data.links.map((l) => (
            <a key={l.href} className="ask-link" href={l.href}>
              {l.label}
            </a>
          ))}
        </div>
      )}

      <p className="ask-disclaimer">{data.disclaimer}</p>
    </div>
  );
}
