"use client";

import { useState, useEffect, useCallback } from "react";

export type ColKey = "title" | "order" | "status" | "assignee" | "effort" | "tags" | "iteration" | "id";

export interface ColumnSettings {
  visibleColumns: ColKey[];
}

export const ALL_COLUMNS: ColKey[] = ["title", "order", "status", "assignee", "effort", "tags", "iteration", "id"];

export const COL_LABELS: Record<ColKey, string> = {
  title: "Title",
  order: "Order",
  status: "Status",
  assignee: "Assignee",
  effort: "Effort",
  tags: "Tags",
  iteration: "Iteration",
  id: "ID",
};

/** Default visible columns per view */
export const GANTT_DEFAULT_COLUMNS: ColKey[] = ["title"];
export const LIST_DEFAULT_COLUMNS: ColKey[] = ["title", "order", "status", "assignee", "effort", "tags", "iteration", "id"];

export const GANTT_COL_KEY = "gantt-col-settings";
export const LIST_COL_KEY = "list-col-settings";

/** Read column settings from localStorage, falling back to defaults */
export function readColumnSettings(storageKey: string, defaults: ColKey[]): ColumnSettings {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as ColumnSettings;
      if (Array.isArray(parsed.visibleColumns) && parsed.visibleColumns.every((k: unknown) => ALL_COLUMNS.includes(k as ColKey))) {
        return parsed;
      }
    }
  } catch {
    // Corrupt or unavailable — fall through to defaults
  }
  return { visibleColumns: [...defaults] };
}

/** Write column settings to localStorage */
export function writeColumnSettings(storageKey: string, settings: ColumnSettings): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(settings));
  } catch {
    // localStorage unavailable (private browsing) — silently ignore
  }
}

interface ColumnsMenuProps {
  storageKey: string;
  defaults: ColKey[];
  onChange?: (visible: ColKey[]) => void;
}

export function ColumnsMenu({ storageKey, defaults, onChange }: ColumnsMenuProps) {
  const [visible, setVisible] = useState<ColKey[]>(() => readColumnSettings(storageKey, defaults).visibleColumns);

  // Sync from localStorage on mount (in case another tab changed it)
  useEffect(() => {
    setVisible(readColumnSettings(storageKey, defaults).visibleColumns);
  }, [storageKey, defaults]);

  const toggle = useCallback((col: ColKey) => {
    setVisible(prev => {
      // Title is always visible — cannot be toggled off
      if (col === "title") return prev;
      const next = prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col];
      const settings: ColumnSettings = { visibleColumns: next };
      writeColumnSettings(storageKey, settings);
      onChange?.(next);
      return next;
    });
  }, [storageKey, onChange]);

  return (
    <div className="py-1">
      {ALL_COLUMNS.map(col => {
        const isOn = visible.includes(col);
        const isTitle = col === "title";
        return (
          <div key={col} className="flex items-center justify-between gap-4 py-1.5 px-1">
            <span className={`text-xs ${isTitle ? "text-text-muted" : "text-text-secondary"}`}>{COL_LABELS[col]}</span>
            <button
              onClick={() => toggle(col)}
              disabled={isTitle}
              className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${isTitle ? "opacity-50 cursor-not-allowed" : ""} ${isOn ? "bg-blue-600" : "bg-surface-button"}`}
            >
              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${isOn ? "left-4" : "left-0.5"}`} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
