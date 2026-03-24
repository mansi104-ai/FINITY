"use client";

import Link from "next/link";

const guideItems = [
  {
    title: "1. Build Thesis",
    description: "Start from Query to enter the asset, budget, and market thesis you want the system to evaluate.",
    href: "/query",
    cta: "Open Query",
  },
  {
    title: "2. Read Forecast",
    description: "Use the report workspace to inspect the forecast, algorithms, relevance graph, scenarios, and decision path.",
    href: "/history",
    cta: "Open History",
  },
  {
    title: "3. Manage Capital",
    description: "Set your base capital and risk profile in Profile so sizing and allocator outputs stay consistent.",
    href: "/profile",
    cta: "Open Profile",
  },
];

export default function WorkspaceGuide() {
  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Workspace Guide</p>
          <h3>How to use FINDEC</h3>
        </div>
        <p className="text-muted">
          This product is organized as a simple workflow: thesis in, forecast out, evidence visible, capital rules applied.
        </p>
      </div>

      <div className="grid grid-3">
        {guideItems.map((item) => (
          <article key={item.title} className="mini-panel">
            <h4>{item.title}</h4>
            <p className="text-muted">{item.description}</p>
            <Link className="button button-secondary" href={item.href}>
              {item.cta}
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
