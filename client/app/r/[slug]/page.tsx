"use client";

import { Suspense } from "react";
import PublicReport from "../../../src/views/PublicReport";

export default function PublicReportPage({ params }: { params: { slug: string } }) {
  return (
    <Suspense fallback={<p className="findec-kicker" style={{ padding: "2rem" }}>Loading…</p>}>
      <PublicReport slug={params.slug} />
    </Suspense>
  );
}
