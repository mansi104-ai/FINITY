"use client";

import { useEffect, useState } from "react";
import { getSelectedCountry, setSelectedCountry } from "../services/api";

// Markets we have live tracked symbols for.
const REGIONS: Array<{ cc: string | null; label: string; flag: string }> = [
  { cc: null, label: "Auto (my location)", flag: "🌐" },
  { cc: "US", label: "United States", flag: "🇺🇸" },
  { cc: "IN", label: "India", flag: "🇮🇳" },
  { cc: "GB", label: "United Kingdom", flag: "🇬🇧" },
  { cc: "JP", label: "Japan", flag: "🇯🇵" },
  { cc: "CN", label: "China", flag: "🇨🇳" },
];

export default function RegionGlobe() {
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => { setCurrent(getSelectedCountry()); }, []);

  const choose = (cc: string | null) => {
    setSelectedCountry(cc);
    setCurrent(cc);
    // Reload so the snapshot strip, markets list, research, etc. all re-fetch
    // against the chosen market.
    if (typeof window !== "undefined") window.location.reload();
  };

  const activeLabel = REGIONS.find((r) => r.cc === current)?.label ?? "Auto (my location)";

  return (
    <section className="findec-panel region-panel">
      <div className="region-globe-wrap" aria-hidden>
        <div className="region-globe">
          <div className="region-globe-sphere" />
          <div className="region-globe-ring" />
        </div>
      </div>
      <div className="region-controls">
        <p className="findec-kicker">Market region</p>
        <h3 className="region-active">{activeLabel}</h3>
        <p className="region-hint">Set the market you want to explore — affects the ticker strip, Markets, Screener and Research.</p>
        <div className="region-chips">
          {REGIONS.map((r) => (
            <button
              key={r.label}
              className={`region-chip ${current === r.cc ? "region-chip-on" : ""}`}
              onClick={() => choose(r.cc)}
            >
              <span className="region-flag">{r.flag}</span>{r.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
