"use client";

import { useRef, useEffect } from "react";
import { Eye } from "@phosphor-icons/react";
import { ColumnsMenu, type ColKey, GANTT_COL_KEY, LIST_COL_KEY, GANTT_DEFAULT_COLUMNS, LIST_DEFAULT_COLUMNS } from "./ColumnsMenu";

interface CustomiseMenuProps {
  open: boolean;
  onClose: () => void;
  onOpenVisibility: () => void;
  viewMode: "timeline" | "kanban" | "list";
  onColumnsChange?: (visible: ColKey[]) => void;
  /** View option toggles */
  showWeekends: boolean;
  onToggleWeekends: () => void;
  showDone: boolean;
  onToggleDone: () => void;
  showOrphans: boolean;
  onToggleOrphans: () => void;
  showTasks: boolean;
  onToggleTasks: () => void;
}

export function CustomiseMenu({
  open,
  onClose,
  onOpenVisibility,
  viewMode,
  onColumnsChange,
  showWeekends,
  onToggleWeekends,
  showDone,
  onToggleDone,
  showOrphans,
  onToggleOrphans,
  showTasks,
  onToggleTasks,
}: CustomiseMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const storageKey = viewMode === "list" ? LIST_COL_KEY : GANTT_COL_KEY;
  const defaults = viewMode === "list" ? LIST_DEFAULT_COLUMNS : GANTT_DEFAULT_COLUMNS;
  const showColumns = viewMode === "timeline" || viewMode === "list";

  return (
    <div ref={ref} className="absolute z-50 mt-1 bg-surface-elevated border border-border-modal rounded-lg shadow-[0px_4px_24px_0px_rgba(0,0,0,0.2)] py-2 px-3 min-w-[220px] right-0">
      {/* View Options section */}
      <div className="pb-2 mb-2 border-b border-border-subtle">
        <span className="text-[10px] uppercase tracking-wider text-text-muted font-medium">View Options</span>
        <div className="mt-1.5 space-y-0">
          <ToggleRow label="Weekends" value={showWeekends} onToggle={onToggleWeekends} />
          <ToggleRow label="Show Done" value={showDone} onToggle={onToggleDone} />
          <ToggleRow label="Show Orphans" value={showOrphans} onToggle={onToggleOrphans} />
          <ToggleRow label="Show Tasks" value={showTasks} onToggle={onToggleTasks} />
        </div>
      </div>

      {/* Path Visibility section */}
      <button
        onClick={() => { onOpenVisibility(); onClose(); }}
        className="w-full flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary py-1.5 px-1 rounded hover:bg-surface-button/50 transition-colors cursor-pointer"
      >
        <Eye size={14} />
        <span>Path Visibility…</span>
      </button>

      {/* Columns section */}
      {showColumns && (
        <div className="pt-2 mt-2 border-t border-border-subtle">
          <span className="text-[10px] uppercase tracking-wider text-text-muted font-medium">Columns</span>
          <ColumnsMenu storageKey={storageKey} defaults={defaults} onChange={onColumnsChange} />
        </div>
      )}
    </div>
  );
}

function ToggleRow({ label, value, onToggle }: { label: string; value: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-xs text-text-secondary">{label}</span>
      <button
        onClick={onToggle}
        className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${value ? "bg-blue-600" : "bg-surface-button"}`}
      >
        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${value ? "left-4" : "left-0.5"}`} />
      </button>
    </div>
  );
}
