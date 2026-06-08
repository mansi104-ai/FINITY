"use client";

import { Suspense } from "react";
import Paper from "../../src/views/Paper";

export default function PaperPage() {
  return (
    <Suspense fallback={<p className="findec-kicker" style={{ padding: "2rem" }}>Loading…</p>}>
      <Paper />
    </Suspense>
  );
}
