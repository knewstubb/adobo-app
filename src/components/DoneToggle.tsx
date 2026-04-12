"use client";

interface DoneToggleProps {
  showDone: boolean;
  onChange: (showDone: boolean) => void;
}

export function DoneToggle({ showDone, onChange }: DoneToggleProps) {
  return (
    <button
      onClick={() => onChange(!showDone)}
      className={`text-xs px-2 py-1 rounded border linear-btn ${
        showDone
          ? "border-border-button text-text-secondary bg-surface-button"
          : "border-border-focus text-text-muted hover:border-border-button"
      }`}
    >
      {showDone ? "Showing Done" : "Done hidden"}
    </button>
  );
}
