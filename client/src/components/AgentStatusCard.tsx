"use client";

import type { AgentStatus } from "../types";

const palette: Record<AgentStatus["state"], string> = {
  queued: "#868e96",
  running: "#1c7ed6",
  completed: "#2b8a3e",
  failed: "#c92a2a"
};

export default function AgentStatusCard({ statuses }: { statuses: AgentStatus[] }) {
  return (
    <section className="card">
      <h3>Agent Status</h3>
      {statuses.length === 0 && <p className="text-muted">No agent execution yet.</p>}
      <div className="grid" style={{ marginTop: "0.75rem" }}>
        {statuses.map((status) => (
          <article
            key={status.agent}
            style={{ border: "1px solid #e9ecef", borderRadius: 10, padding: "0.65rem 0.75rem" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
              <strong>{status.agent}</strong>
              <span className="badge" style={{ background: `${palette[status.state]}22`, color: palette[status.state] }}>
                {status.state}
              </span>
            </div>
            <small className="text-muted">
              {status.durationMs ? `${status.durationMs} ms` : "Pending timing"}
              {status.message ? ` - ${status.message}` : ""}
            </small>
          </article>
        ))}
      </div>
    </section>
  );
}
