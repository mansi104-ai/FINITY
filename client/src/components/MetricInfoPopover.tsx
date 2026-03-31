import React, { useState, useRef, useEffect } from "react";

interface MetricInfoPopoverProps {
  label: string;
  value: string | number;
  explanation: string;
}

export function MetricInfoPopover({ label, value, explanation }: MetricInfoPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className="metric-card" style={{ position: "relative" }} ref={popoverRef}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span className="metric-label">{label}</span>
        <button 
          onClick={() => setIsOpen(!isOpen)}
          aria-label={`Get info about ${label}`}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--muted)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "2px",
            borderRadius: "50%",
            width: "20px",
            height: "20px",
            fontSize: "12px",
            lineHeight: 1,
            backgroundColor: "rgba(32, 38, 58, 0.05)"
          }}
        >
          ℹ
        </button>
      </div>
      
      <strong>{value}</strong>

      {isOpen && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          marginTop: "0.5rem",
          padding: "1rem",
          background: "var(--card-strong)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          boxShadow: "var(--shadow)",
          zIndex: 50,
          width: "280px",
          fontSize: "0.9rem",
          color: "var(--text)",
          animation: "fadeIn 0.2s ease"
        }}>
          {explanation}
        </div>
      )}
    </div>
  );
}
