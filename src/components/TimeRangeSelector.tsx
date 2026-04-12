"use client";

import { Minus, Plus } from "@phosphor-icons/react";

interface TimeRangeSelectorProps {
  value: number;
  onChange: (count: number) => void;
  maxIterations: number;
}

export function TimeRangeSelector({
  value,
  onChange,
  maxIterations,
}: TimeRangeSelectorProps) {
  const min = 1;
  const max = Math.max(maxIterations, 12);

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-text-muted">Zoom:</span>
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="text-text-muted hover:text-text-primary disabled:opacity-30 p-0.5"
      >
        <Plus size={12} />
      </button>
      <span className="text-xs text-text-secondary w-4 text-center">{value}</span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="text-text-muted hover:text-text-primary disabled:opacity-30 p-0.5"
      >
        <Minus size={12} />
      </button>
    </div>
  );
}
