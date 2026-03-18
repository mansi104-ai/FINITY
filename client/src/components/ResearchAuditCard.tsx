"use client";

import type { SentimentResult } from "../types";

function formatDate(dateText: string | undefined): string {
  if (!dateText) {
    return "-";
  }

  const parsed = new Date(dateText);
  return Number.isNaN(parsed.getTime()) ? dateText : parsed.toLocaleString();
}

export default function ResearchAuditCard({ sentiment }: { sentiment: SentimentResult }) {
  if (!sentiment.resources?.length && !sentiment.searchAttempts?.length) {
    return null;
  }

  return (
    <section className="card">
      <h3>Research Audit Trail</h3>
      <p className="text-muted" style={{ marginTop: "0.35rem" }}>
        Detailed trace of what the researcher checked, when it checked, and how it reached its sentiment result.
      </p>

      {sentiment.timeline && (
        <p>
          Timeline: <strong>{formatDate(sentiment.timeline.from)}</strong> to{" "}
          <strong>{formatDate(sentiment.timeline.to)}</strong>
        </p>
      )}

      {sentiment.searchStats && (
        <p>
          Searches: from scratch <strong>{sentiment.searchStats.searchesFromScratch}</strong>, reiterations{" "}
          <strong>{sentiment.searchStats.reiterations}</strong>, successful <strong>{sentiment.searchStats.successfulSearches}</strong> /{" "}
          {sentiment.searchStats.totalSearches}
        </p>
      )}

      {sentiment.reasoning && sentiment.reasoning.length > 0 && (
        <article style={{ marginTop: "0.8rem" }}>
          <h4 style={{ marginBottom: "0.4rem" }}>How It Reached Result</h4>
          {sentiment.reasoning.map((line, idx) => (
            <p key={`${line}-${idx}`} className="text-muted" style={{ margin: "0.25rem 0" }}>
              {idx + 1}. {line}
            </p>
          ))}
        </article>
      )}

      {sentiment.searchAttempts && sentiment.searchAttempts.length > 0 && (
        <article style={{ marginTop: "0.8rem" }}>
          <h4 style={{ marginBottom: "0.4rem" }}>Search Attempts</h4>
          <div className="grid">
            {sentiment.searchAttempts.map((attempt, idx) => (
              <div key={`${attempt.query}-${idx}`} style={{ border: "1px solid #e9ecef", borderRadius: 10, padding: "0.6rem 0.75rem" }}>
                <p style={{ margin: 0 }}>
                  <strong>{attempt.query}</strong> ({attempt.phase})
                </p>
                <p className="text-muted" style={{ margin: "0.25rem 0" }}>
                  Status: {attempt.status} | Results: {attempt.resultCount} | Source: {attempt.source}
                </p>
                <p className="text-muted" style={{ margin: "0.25rem 0" }}>
                  {formatDate(attempt.startedAt)} - {formatDate(attempt.endedAt)}
                </p>
                {attempt.note && (
                  <p className="text-muted" style={{ margin: "0.25rem 0 0" }}>
                    Note: {attempt.note}
                  </p>
                )}
              </div>
            ))}
          </div>
        </article>
      )}

      {sentiment.resources && sentiment.resources.length > 0 && (
        <article style={{ marginTop: "0.8rem" }}>
          <h4 style={{ marginBottom: "0.4rem" }}>Resources Reviewed</h4>
          <div className="grid">
            {sentiment.resources.map((resource, idx) => (
              <div key={`${resource.title}-${idx}`} style={{ border: "1px solid #e9ecef", borderRadius: 10, padding: "0.6rem 0.75rem" }}>
                <p style={{ margin: 0 }}>
                  {resource.url ? (
                    <a href={resource.url} target="_blank" rel="noreferrer">
                      {resource.title}
                    </a>
                  ) : (
                    resource.title
                  )}
                </p>
                <p className="text-muted" style={{ margin: "0.25rem 0" }}>
                  Source: {resource.source} | Published: {formatDate(resource.publishedAt)}
                </p>
                {resource.sentimentLevel && (
                  <p className="text-muted" style={{ margin: "0.25rem 0" }}>
                    Sentiment: {resource.sentimentLevel}
                  </p>
                )}
                {resource.snippet && (
                  <p className="text-muted" style={{ margin: "0.25rem 0 0" }}>
                    {resource.snippet}
                  </p>
                )}
              </div>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}
