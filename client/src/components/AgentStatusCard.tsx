"use client";

import type { AgentStatus } from "../types";

const palette: Record<AgentStatus["state"], string> = {
  queued: "#7b86a5",
  running: "#246bff",
  completed: "#33b36b",
  failed: "#e66154"
};

function friendlyAgentName(agent: string): string {
  const normalized = agent.toLowerCase();

  if (normalized.includes("research")) {
    return "News and sentiment";
  }

  if (normalized.includes("analyst")) {
    return "Price outlook";
  }

  if (normalized.includes("risk")) {
    return "Risk check";
  }

  if (normalized.includes("alloc")) {
    return "Position sizing";
  }

  return agent
    .split(/[_\s-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function friendlyStateLabel(state: AgentStatus["state"]): string {
  const labels: Record<AgentStatus["state"], string> = {
    queued: "Queued",
    running: "Working",
    completed: "Done",
    failed: "Needs attention"
  };

  return labels[state];
}

function formatDuration(durationMs?: number): string {
  if (!durationMs) {
    return "Time not available";
  }

  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(1)} sec`;
  }

  return `${durationMs} ms`;
}

export default function AgentStatusCard({ statuses }: { statuses: AgentStatus[] }) {
  const completedCount = statuses.filter((status) => status.state === "completed").length;

  return (
    <details className="card simple-details">
      <summary className="details-summary details-summary-spread">
        <div>
          <p className="eyebrow">Behind The Scenes</p>
          <h3 style={{ margin: 0 }}>What the app checked for you</h3>
        </div>
        <span className="badge badge-ghost">
          {completedCount}/{statuses.length} done
        </span>
      </summary>

      {statuses.length === 0 && <p className="text-muted">No background checks have run yet.</p>}

      <div className="grid grid-3">
        {statuses.map((status) => (
          <article key={status.agent} className="status-card">
            <div className="status-card-top">
              <strong>{friendlyAgentName(status.agent)}</strong>
              <span className="badge badge-ghost" style={{ color: palette[status.state], borderColor: `${palette[status.state]}55` }}>
                {friendlyStateLabel(status.state)}
              </span>
            </div>
            <p className="status-time">{formatDuration(status.durationMs)}</p>
            <p className="text-muted" style={{ marginBottom: 0 }}>
              {status.message ?? "No extra detail was recorded for this step."}
            </p>
          </article>
        ))}
      </div>
    </details>
  );
}
