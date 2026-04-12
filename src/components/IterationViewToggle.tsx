"use client";

import type { Iteration } from "@/lib/types";

interface IterationViewToggleProps {
  active: boolean;
  selectedPath: string | null;
  iterations: Iteration[];
  onToggle: (active: boolean) => void;
  onSelect: (path: string) => void;
}

export function IterationViewToggle({
  active,
  selectedPath,
  iterations,
  onToggle,
  onSelect,
}: IterationViewToggleProps) {
  const currentIdx = iterations.findIndex((i) => i.path === selectedPath);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onToggle(!active)}
        className={`text-xs px-2 py-1 rounded border ${
          active
            ? "border-blue-500 text-blue-400 bg-blue-500/10"
            : "border-border-focus text-text-muted hover:border-border-button linear-btn"
        }`}
      >
        Sprint View
      </button>
      {active && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (currentIdx > 0) onSelect(iterations[currentIdx - 1].path);
            }}
            disabled={currentIdx <= 0}
            className="text-xs text-text-muted hover:text-text-secondary disabled:opacity-30 px-1"
          >
            ←
          </button>
          <span className="text-xs text-text-secondary min-w-[80px] text-center">
            {iterations.find((i) => i.path === selectedPath)?.name ?? "Select"}
          </span>
          <button
            onClick={() => {
              if (currentIdx < iterations.length - 1)
                onSelect(iterations[currentIdx + 1].path);
            }}
            disabled={currentIdx >= iterations.length - 1}
            className="text-xs text-text-muted hover:text-text-secondary disabled:opacity-30 px-1"
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
