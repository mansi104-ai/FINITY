"use client";

import type { SentimentResult } from "../types";

function formatDate(dateText: string | undefined): string {
  if (!dateText) {
    return "-";
  }

  const parsed = new Date(dateText);
  return Number.isNaN(parsed.getTime())
    ? dateText
    : parsed.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      });
}

export default function ResearchAuditCard({ sentiment }: { sentiment: SentimentResult }) {
  if (!sentiment.resources?.length && !sentiment.searchAttempts?.length) {
    return null;
  }

  return (
    <section className="card analyst-resources">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Analyst Resources</p>
          <h3>Everything reviewed</h3>
        </div>
        <p className="text-muted">
          Every search, source, timestamp, and reasoning note used by the researcher is visible here.
        </p>
      </div>

      <div className="grid grid-2">
        {sentiment.timeline && (
          <article className="mini-panel">
            <h4>Coverage window</h4>
            <p>{formatDate(sentiment.timeline.from)}</p>
            <p>{formatDate(sentiment.timeline.to)}</p>
          </article>
        )}
        {sentiment.searchStats && (
          <article className="mini-panel">
            <h4>Search quality</h4>
            <p>
              Fresh searches: <strong>{sentiment.searchStats.searchesFromScratch}</strong>
            </p>
            <p>
              Reiterations: <strong>{sentiment.searchStats.reiterations}</strong>
            </p>
            <p>
              Successful: <strong>{sentiment.searchStats.successfulSearches}</strong> /{" "}
              {sentiment.searchStats.totalSearches}
            </p>
          </article>
        )}
      </div>

      {sentiment.reasoning && sentiment.reasoning.length > 0 && (
        <article className="mini-panel">
          <h4>Reasoning</h4>
          {sentiment.reasoning.map((line, idx) => (
            <p key={`${line}-${idx}`} className="text-muted">
              {idx + 1}. {line}
            </p>
          ))}
        </article>
      )}

      {sentiment.searchAttempts && sentiment.searchAttempts.length > 0 && (
        <article className="mini-panel">
          <h4>Search attempts</h4>
          <div className="grid">
            {sentiment.searchAttempts.map((attempt, idx) => (
              <div key={`${attempt.query}-${idx}`} className="audit-card">
                <p style={{ marginTop: 0 }}>
                  <strong>{attempt.query}</strong>
                </p>
                <p className="text-muted">
                  {attempt.phase} | {attempt.status} | {attempt.resultCount} results
                </p>
                <p className="text-muted">
                  {formatDate(attempt.startedAt)} to {formatDate(attempt.endedAt)}
                </p>
                {attempt.note && <p className="text-muted">{attempt.note}</p>}
              </div>
            ))}
          </div>
        </article>
      )}

      {sentiment.resources && sentiment.resources.length > 0 && (
        <article className="mini-panel">
          <h4>Resources reviewed</h4>
          <div className="grid">
            {sentiment.resources.map((resource, idx) => (
              <div key={`${resource.title}-${idx}`} className="audit-card">
                <p style={{ marginTop: 0 }}>
                  {resource.url ? (
                    <a href={resource.url} target="_blank" rel="noreferrer">
                      {resource.title}
                    </a>
                  ) : (
                    resource.title
                  )}
                </p>
                <p className="text-muted">
                  {resource.source} | {formatDate(resource.publishedAt)}
                </p>
                {(typeof resource.relevanceScore === "number" || typeof resource.influenceWeight === "number") && (
                  <p className="text-muted">
                    Relevance: {typeof resource.relevanceScore === "number" ? `${Math.round(resource.relevanceScore * 100)}%` : "n/a"} | Influence:{" "}
                    {typeof resource.influenceWeight === "number" ? resource.influenceWeight.toFixed(2) : "n/a"}
                  </p>
                )}
                {(typeof resource.recencyWeight === "number" || typeof resource.ageHours === "number") && (
                  <p className="text-muted">
                    Recency weight: {typeof resource.recencyWeight === "number" ? resource.recencyWeight.toFixed(2) : "n/a"} | Age:{" "}
                    {typeof resource.ageHours === "number" ? `${resource.ageHours.toFixed(1)} hours` : "n/a"}
                  </p>
                )}
                {resource.sentimentLevel && <p className="text-muted">Sentiment: {resource.sentimentLevel}</p>}
                {resource.snippet && <p className="text-muted">{resource.snippet}</p>}
              </div>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}
