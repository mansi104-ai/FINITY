"use client";

import { Suspense } from "react";
import Earnings from "../../src/views/Earnings";

export default function EarningsPage() {
  return (
    <Suspense fallback={<p className="findec-kicker" style={{ padding: "2rem" }}>Loading…</p>}>
      <Earnings />
    </Suspense>
  );
}
