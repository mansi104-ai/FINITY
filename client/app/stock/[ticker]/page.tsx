"use client";

import { use } from "react";
import StockDetail from "../../../src/views/StockDetail";

export default function StockPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  return <StockDetail ticker={decodeURIComponent(ticker)} />;
}
