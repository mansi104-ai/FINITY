import { useEffect, useRef, useState } from "react";

interface MetricInfoPopoverProps {
  label: string;
  value: string | number;
  explanation: string;
}

export function MetricInfoPopover({ label, value, explanation }: MetricInfoPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

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
    <div className="metric-card metric-popover-card" ref={popoverRef}>
      <div className="metric-popover-header">
        <span className="metric-label">{label}</span>
        <button
          aria-expanded={isOpen}
          aria-label={`Get info about ${label}`}
          className="metric-info-button"
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          i
        </button>
      </div>

      <strong>{value}</strong>

      {isOpen && <div className="metric-popover-panel">{explanation}</div>}
    </div>
  );
}
