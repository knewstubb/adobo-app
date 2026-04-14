"use client";

import { useEffect } from "react";
import { ArrowCounterClockwise, ArrowClockwise } from "@phosphor-icons/react";
import { useUndoRedo } from "@/lib/undo-redo-context";

/**
 * Renders undo/redo icon buttons and an error toast for failed operations.
 * Must be rendered inside <UndoRedoProvider>.
 */
export function UndoRedoToolbar() {
  const { canUndo, canRedo, undoLabel, redoLabel, undo, redo, lastError, clearError } = useUndoRedo();

  // Auto-dismiss error toast after 5 seconds
  useEffect(() => {
    if (!lastError) return;
    const timer = setTimeout(() => clearError(), 5000);
    return () => clearTimeout(timer);
  }, [lastError, clearError]);

  return (
    <>
      <button
        onClick={undo}
        disabled={!canUndo}
        title={undoLabel ? `Undo ${undoLabel}` : "Nothing to undo"}
        className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-button linear-btn disabled:opacity-30 disabled:pointer-events-none"
      >
        <ArrowCounterClockwise size={16} />
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        title={redoLabel ? `Redo ${redoLabel}` : "Nothing to redo"}
        className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-button linear-btn disabled:opacity-30 disabled:pointer-events-none"
      >
        <ArrowClockwise size={16} />
      </button>

      {/* Error toast for failed undo/redo */}
      {lastError && (
        <div className="fixed top-4 right-4 z-[100] max-w-sm px-4 py-2.5 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs shadow-lg">
          <div className="flex items-start gap-2">
            <span className="flex-1">{lastError}</span>
            <button
              onClick={clearError}
              className="text-red-400 hover:text-red-200 shrink-0"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
