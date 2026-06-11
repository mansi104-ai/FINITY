"use client";

/** Shimmer skeleton primitives — used in place of "Loading…" text. */
export function SkelLine({ w = "100%", h }: { w?: string; h?: string }) {
  return <div className="fd-skel fd-skel-line" style={{ width: w, ...(h ? { height: h } : {}) }} />;
}

/** A skeleton table with N rows and C columns — for list/screener loading. */
export function SkelTable({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="findec-panel" style={{ padding: "0.4rem 1rem" }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="fd-skel-row">
          <div style={{ flex: 2 }}><div className="fd-skel fd-skel-line" style={{ width: "55%" }} /></div>
          {Array.from({ length: cols - 1 }).map((_, c) => (
            <div key={c} style={{ flex: 1 }}><div className="fd-skel fd-skel-line" style={{ width: "70%", marginLeft: "auto" }} /></div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** A grid of skeleton cards — for dashboards/detail loading. */
export function SkelCards({ count = 4, height = "90px" }: { count?: number; height?: string }) {
  return (
    <div className="fd-skel-grid" style={{ gridTemplateColumns: `repeat(${Math.min(count, 4)}, minmax(0,1fr))` }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="fd-skel" style={{ height }} />
      ))}
    </div>
  );
}
