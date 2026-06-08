"use client";

import { Suspense } from "react";
import Insights from "../../src/views/Insights";

export default function InsightsPage() {
  return (
    <Suspense fallback={<p className="findec-kicker" style={{ padding: "2rem" }}>Loading…</p>}>
      <Insights />
    </Suspense>
  );
}
