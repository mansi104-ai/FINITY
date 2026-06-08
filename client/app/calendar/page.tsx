"use client";

import { Suspense } from "react";
import Calendar from "../../src/views/Calendar";

export default function CalendarPage() {
  return (
    <Suspense fallback={<p className="findec-kicker" style={{ padding: "2rem" }}>Loading…</p>}>
      <Calendar />
    </Suspense>
  );
}
