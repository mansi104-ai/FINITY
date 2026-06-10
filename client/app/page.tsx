"use client";

import { Suspense } from "react";
import HomeDashboard from "../src/views/HomeDashboard";

export default function HomePage() {
  return (
    <Suspense fallback={<p className="findec-kicker" style={{ padding: "2rem" }}>Loading…</p>}>
      <HomeDashboard />
    </Suspense>
  );
}
