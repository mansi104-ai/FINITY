"use client";

import { useMemo, useState } from "react";
import type { AgentReport, ResearchResource } from "../types";

type NodePoint = {
  id: string;
  label: string;
  x: number;
  y: number;
  radius: number;
  kind: "prediction" | "resource";
  resource?: ResearchResource;
  relevance?: number;
};

type Edge = {
  id: string;
  from: string;
  to: string;
  relevance: number;
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "about",
  "after",
  "before",
  "over",
  "under",
  "stock",
  "today",
  "query",
  "market",
  "price",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function sentimentBoost(level?: string): number {
  if (level === "STRONG_BUY" || level === "STRONG_SELL") {
    return 0.18;
  }
  if (level === "BUY" || level === "SELL") {
    return 0.1;
  }
  return 0.03;
}

function computeRelevance(report: AgentReport, resource: ResearchResource): number {
  if (typeof resource.relevanceScore === "number") {
    return resource.relevanceScore;
  }

  const queryTokens = new Set(tokenize(report.query));
  const titleTokens = tokenize(resource.title);
  const snippetTokens = tokenize(resource.snippet ?? "");
  const combinedTokens = [...titleTokens, ...snippetTokens];
  const overlap = combinedTokens.filter((token) => queryTokens.has(token)).length;
  const overlapScore = combinedTokens.length > 0 ? overlap / Math.min(queryTokens.size || 1, 8) : 0;

  const trend = report.prediction?.trend ?? "sideways";
  const level = resource.sentimentLevel ?? "HOLD";
  const alignmentScore =
    (trend === "bullish" && (level === "BUY" || level === "STRONG_BUY")) ||
    (trend === "bearish" && (level === "SELL" || level === "STRONG_SELL"))
      ? 0.18
      : trend === "sideways" && level === "HOLD"
        ? 0.12
        : 0.02;

  const recencyScore = (() => {
    const published = resource.publishedAt ? new Date(resource.publishedAt).getTime() : Number.NaN;
    if (Number.isNaN(published)) {
      return 0.04;
    }
    const ageDays = Math.max(0, (Date.now() - published) / (1000 * 60 * 60 * 24));
    return Math.max(0.02, 0.2 - ageDays * 0.02);
  })();

  return Math.max(
    0.08,
    Math.min(0.98, overlapScore * 0.55 + alignmentScore + recencyScore + sentimentBoost(resource.sentimentLevel)),
  );
}

function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

export default function PredictionDriverGraph({ report }: { report: AgentReport }) {
  const [zoom, setZoom] = useState(1);
  const [selectedId, setSelectedId] = useState<string>("prediction");
  const width = 840;
  const height = 520;

  const graph = useMemo(() => {
    const predictionNode: NodePoint = {
      id: "prediction",
      label: `${report.ticker} forecast`,
      x: width / 2,
      y: height / 2 - 24,
      radius: 44,
      kind: "prediction",
    };

    const resources = (report.sentiment?.resources ?? []).map((resource) => ({
      resource,
      relevance: typeof resource.influenceWeight === "number" ? resource.influenceWeight : computeRelevance(report, resource),
    }));

    const sorted = resources.sort((a, b) => b.relevance - a.relevance);
    const nodes: NodePoint[] = [predictionNode];
    const edges: Edge[] = [];
    const ringRadius = 176;

    sorted.forEach(({ resource, relevance }, index) => {
      const angle = (-Math.PI / 2) + (index / Math.max(sorted.length, 1)) * Math.PI * 2;
      const node: NodePoint = {
        id: `resource-${index}`,
        label: truncate(resource.title, 42),
        x: predictionNode.x + Math.cos(angle) * ringRadius,
        y: predictionNode.y + Math.sin(angle) * ringRadius,
        radius: 14 + relevance * 12,
        kind: "resource",
        resource,
        relevance,
      };
      nodes.push(node);
      edges.push({
        id: `edge-${index}`,
        from: "prediction",
        to: node.id,
        relevance,
      });
    });

    return { nodes, edges };
  }, [report]);

  const selectedNode = graph.nodes.find((node) => node.id === selectedId) ?? graph.nodes[0];

  return (
    <section className="card graph-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Prediction Graph</p>
          <h3>What influenced the forecast</h3>
        </div>
        <div className="graph-toolbar">
          <button className="button button-secondary graph-button" type="button" onClick={() => setZoom((value) => Math.max(0.75, value - 0.15))}>
            Zoom out
          </button>
          <button className="button button-secondary graph-button" type="button" onClick={() => setZoom(1)}>
            Reset
          </button>
          <button className="button button-secondary graph-button" type="button" onClick={() => setZoom((value) => Math.min(1.8, value + 0.15))}>
            Zoom in
          </button>
        </div>
      </div>

      <div className="graph-board">
        <div className="graph-canvas-shell">
          <svg viewBox={`0 0 ${width} ${height}`} className="driver-graph" aria-label="Zoomable prediction relevance graph">
            <g transform={`translate(${width * (1 - zoom) / 2} ${height * (1 - zoom) / 2}) scale(${zoom})`}>
              {graph.edges.map((edge) => {
                const from = graph.nodes.find((node) => node.id === edge.from);
                const to = graph.nodes.find((node) => node.id === edge.to);
                if (!from || !to) {
                  return null;
                }
                return (
                  <line
                    key={edge.id}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={`rgba(36, 107, 255, ${0.18 + edge.relevance * 0.5})`}
                    strokeWidth={1.5 + edge.relevance * 2.5}
                  />
                );
              })}

              {graph.nodes.map((node) => {
                const active = node.id === selectedNode.id;
                return (
                  <g key={node.id} onClick={() => setSelectedId(node.id)} style={{ cursor: "pointer" }}>
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={node.radius}
                      fill={node.kind === "prediction" ? "rgba(36, 107, 255, 0.18)" : "rgba(242, 179, 39, 0.18)"}
                      stroke={active ? "#e66154" : node.kind === "prediction" ? "#246bff" : "#f2b327"}
                      strokeWidth={active ? 3 : 1.5}
                    />
                    <text x={node.x} y={node.y + node.radius + 16} className="graph-node-label" textAnchor="middle">
                      {node.label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        <aside className="graph-detail">
          {selectedNode.kind === "prediction" ? (
            <>
              <p className="eyebrow">Prediction node</p>
              <h4>{report.ticker} forecast core</h4>
              <p className="text-muted">{report.prediction?.predictionMethod ?? "Prediction method unavailable."}</p>
              {report.prediction?.methodFactors?.map((factor) => (
                <p key={factor} className="text-muted">{factor}</p>
              ))}
            </>
          ) : (
            <>
              <p className="eyebrow">Resource node</p>
              <h4>{selectedNode.resource?.title}</h4>
              <p className="text-muted">
                Relevance to forecast: <strong>{Math.round((selectedNode.relevance ?? 0) * 100)}%</strong>
              </p>
              <p className="text-muted">
                {selectedNode.resource?.source} | {selectedNode.resource?.publishedAt ? new Date(selectedNode.resource.publishedAt).toLocaleString() : "Unknown date"}
              </p>
              {selectedNode.resource?.sentimentLevel && (
                <p className="text-muted">Tagged sentiment: {selectedNode.resource.sentimentLevel}</p>
              )}
              {selectedNode.resource?.snippet && <p className="text-muted">{selectedNode.resource.snippet}</p>}
              {selectedNode.resource?.url && (
                <a className="button button-secondary" href={selectedNode.resource.url} target="_blank" rel="noreferrer">
                  Open source
                </a>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
