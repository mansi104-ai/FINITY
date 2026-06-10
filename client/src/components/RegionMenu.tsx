"use client";

import { useEffect, useRef, useState } from "react";
import { getSelectedCountry, setSelectedCountry } from "../services/api";

const REGIONS: Array<{ cc: string | null; label: string; flag: string }> = [
  { cc: null, label: "Auto (my location)", flag: "🌐" },
  { cc: "US", label: "United States", flag: "🇺🇸" },
  { cc: "IN", label: "India", flag: "🇮🇳" },
  { cc: "GB", label: "United Kingdom", flag: "🇬🇧" },
  { cc: "JP", label: "Japan", flag: "🇯🇵" },
  { cc: "CN", label: "China", flag: "🇨🇳" },
];

export default function RegionMenu() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setCur(getSelectedCountry()); }, []);
  useEffect(() => {
    const d = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", d);
    return () => document.removeEventListener("mousedown", d);
  }, []);

  const choose = (cc: string | null) => {
    setSelectedCountry(cc);
    if (typeof window !== "undefined") window.location.reload();
  };

  const active = REGIONS.find((r) => r.cc === cur) ?? REGIONS[0];

  return (
    <div className="rmenu" ref={ref}>
      <button className="rmenu-btn" onClick={() => setOpen((v) => !v)} aria-label="Market region" title="Market region">
        <span className="rmenu-flag">{active.flag}</span>
        <span className="rmenu-cc">{active.cc ?? "Auto"}</span>
        <span className="rmenu-caret">▾</span>
      </button>
      {open && (
        <div className="rmenu-pop">
          <span className="rmenu-pop-title">Market region</span>
          {REGIONS.map((r) => (
            <button key={r.label} className={`rmenu-item${r.cc === cur ? " rmenu-item-on" : ""}`} onClick={() => choose(r.cc)}>
              <span className="rmenu-flag">{r.flag}</span>{r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
