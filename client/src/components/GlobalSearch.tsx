"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchStocks, type StockSearchResult } from "../services/api";

export default function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<StockSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim().length < 2) { setRes([]); return; }
      void searchStocks(q.trim()).then((r) => setRes(r.results.slice(0, 7))).catch(() => setRes([]));
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const d = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", d);
    return () => document.removeEventListener("mousedown", d);
  }, []);

  const go = (sym: string) => {
    setOpen(false); setQ(""); setRes([]);
    router.push(`/stock/${encodeURIComponent(sym)}`);
  };

  return (
    <div className="gsearch" ref={ref}>
      <svg className="gsearch-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
      </svg>
      <input
        className="gsearch-input"
        placeholder="Search stocks…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Enter" && res[0]) go(res[0].symbol); }}
        aria-label="Search stocks"
      />
      {open && res.length > 0 && (
        <div className="gsearch-pop">
          {res.map((s) => (
            <button key={`${s.symbol}-${s.exchange}`} className="gsearch-row" onClick={() => go(s.symbol)}>
              <strong>{s.symbol}</strong>
              <span>{s.name}</span>
              <em>{s.exchange}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
