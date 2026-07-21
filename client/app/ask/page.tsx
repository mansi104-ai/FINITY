"use client";

/**
 * Chat surface for FINDEC.
 *
 * One input, one thread. The design decision worth naming: the evidence is
 * collapsed but never hidden, and it always renders -- including when an
 * agent reports UNAVAILABLE. In a domain where being wrong costs money, a
 * recommendation nobody can interrogate is worth very little, and a gap in
 * the evidence is itself information the user should have.
 */

import { useEffect, useRef, useState } from "react";
import "./ask.css";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

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
    screen: string;
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
  links?: { label: string; href: string }[];
  duration_ms: number;
  disclaimer: string;
};

type Msg =
  | { role: "user"; text: string }
  | { role: "assistant"; data: Answer }
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

export default function AskPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  function grow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    if (taRef.current) taRef.current.style.height = "auto";

    try {
      const res = await fetch(`${API_BASE}/v2/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data: Answer = await res.json();
      setMessages((m) => [...m, { role: "assistant", data }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: "error",
          text:
            e instanceof Error
              ? `${e.message}. The agent service may not be running — start it with "uvicorn main:app" in python_agents.`
              : "Something went wrong.",
        },
      ]);
    } finally {
      setBusy(false);
    }
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
          ) : (
            <div key={i} className="ask-msg">
              <AnswerCard data={m.data} />
            </div>
          )
        )}

        {busy && (
          <div className="ask-msg">
            <div className="ask-thinking">
              <span className="ask-dots">
                <span /><span /><span />
              </span>
              Planning, gathering evidence, weighing it…
            </div>
          </div>
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
          <button
            className="ask-send"
            onClick={() => send(input)}
            disabled={busy || !input.trim()}
            aria-label="Send"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
        <p className="ask-hint">
          Decision support, not investment advice. Enter to send, Shift+Enter for a new line.
        </p>
      </div>
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

  return (
    <div className="ask-answer">
      {d && (
        <div className="ask-verdict">
          <span className={`ask-action ${d.action}`}>{d.action.toUpperCase()}</span>
          <span className="ask-meta">
            {data.tickers?.join(", ")} · {data.horizon_days}-day view ·{" "}
            {Math.round(d.confidence * 100)}% conviction
            {d.position_pct > 0 && <> · size {d.position_pct.toFixed(1)}% of capital</>}
          </span>
        </div>
      )}

      {d && <p className="ask-line">{d.sizing_rationale}</p>}
      {data.fusion && <p className="ask-line">{data.fusion.explanation}</p>}

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
          Show the evidence — {data.agents.length} agents, {(data.duration_ms / 1000).toFixed(1)}s
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
