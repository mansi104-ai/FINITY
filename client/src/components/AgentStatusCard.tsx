"use client";

import type { AgentStatus } from "../types";

const palette: Record<AgentStatus["state"], string> = {
  queued: "#8b97b3",
  running: "#36cfc9",
  completed: "#56d364",
  failed: "#ff6b6b",
};

export default function AgentStatusCard({ statuses }: { statuses: AgentStatus[] }) {
  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Execution Trace</p>
          <h3>Agent status board</h3>
        </div>
      </div>
      {statuses.length === 0 && <p className="text-muted">No agent execution yet.</p>}
      <div className="grid grid-3">
        {statuses.map((status) => (
          <article key={status.agent} className="status-card">
            <div className="status-card-top">
              <strong>{status.agent}</strong>
              <span className="badge badge-ghost" style={{ color: palette[status.state], borderColor: `${palette[status.state]}55` }}>
                {status.state}
              </span>
            </div>
            <p className="status-time">{status.durationMs ? `${status.durationMs} ms` : "Pending timing"}</p>
            <p className="text-muted" style={{ marginBottom: 0 }}>
              {status.message ?? "Awaiting additional detail"}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
