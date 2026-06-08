"use client";

import { Suspense } from "react";
import Research from "../../src/views/Research";

export default function ResearchPage() {
  return (
    <Suspense fallback={<p className="findec-kicker" style={{ padding: "2rem" }}>Loading…</p>}>
      <Research />
    </Suspense>
  );
}
