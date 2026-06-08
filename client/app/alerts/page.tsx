"use client";

import { Suspense } from "react";
import Alerts from "../../src/views/Alerts";

export default function AlertsPage() {
  return (
    <Suspense fallback={<p className="findec-kicker" style={{ padding: "2rem" }}>Loading…</p>}>
      <Alerts />
    </Suspense>
  );
}
