"use client";

import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import {
  HistoryManager,
  describeAction,
  isCompound,
  type HistoryEntry,
  type ActionRecord,
} from "./history-manager";
import {
  updateField,
  updateTags,
  updateSchedule,
  reorderItem,
  type WriteResult,
} from "./client-write-back";

// ---------------------------------------------------------------------------
// Context value interface
// ---------------------------------------------------------------------------

export interface UndoRedoContextValue {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  /** Last error message from a failed undo/redo operation, or null. */
  lastError: string | null;
  /** Clear the last error message. */
  clearError: () => void;
  recordAction: (entry: HistoryEntry) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const UndoRedoContext = createContext<UndoRedoContextValue | null>(null);

// ---------------------------------------------------------------------------
// Keyboard handler logic (extracted for testability)
// ---------------------------------------------------------------------------

export interface KeyboardShortcutCallbacks {
  undo: () => void;
  redo: () => void;
}

/**
 * Determines whether a keydown event should trigger undo/redo and calls the
 * appropriate callback. Returns true if the event was handled (undo or redo
 * triggered), false otherwise.
 */
export function handleUndoRedoKeydown(
  e: KeyboardEvent,
  callbacks: KeyboardShortcutCallbacks
): boolean {
  const target = e.target as HTMLElement;
  const isTextInput =
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable;
  if (isTextInput) return false;

  const isMac =
    typeof navigator !== "undefined" && navigator.platform.includes("Mac");
  const mod = isMac ? e.metaKey : e.ctrlKey;

  if (mod && e.key === "z" && !e.shiftKey) {
    e.preventDefault();
    callbacks.undo();
    return true;
  } else if (mod && e.key === "z" && e.shiftKey) {
    e.preventDefault();
    callbacks.redo();
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Provider props
// ---------------------------------------------------------------------------

interface UndoRedoProviderProps {
  children: ReactNode;
  refreshData: () => Promise<void>;
  onError?: (message: string) => void;
  /** Optional ref that will be populated with the recordAction function, allowing parent components to record actions. */
  recordActionRef?: React.MutableRefObject<((entry: HistoryEntry) => void) | null>;
}

// ---------------------------------------------------------------------------
// Write-back helpers (apply a single ActionRecord in a given direction)
// ---------------------------------------------------------------------------

/**
 * Apply a single ActionRecord for undo (swap previous ↔ new) or redo (use original).
 * Returns the WriteResult from the write-back layer.
 */
async function applyRecord(
  record: ActionRecord,
  direction: "undo" | "redo"
): Promise<WriteResult> {
  const value = direction === "undo" ? record.previousValue : record.newValue;
  const rollbackValue = direction === "undo" ? record.newValue : record.previousValue;

  switch (record.type) {
    case "field-change":
      return updateField(
        record.workItemId,
        record.field ?? "",
        value,
        rollbackValue
      );

    case "tags-change":
      return updateTags(
        record.workItemId,
        value as string[],
        rollbackValue as string[]
      );

    case "description-change":
      return updateField(
        record.workItemId,
        "description",
        value,
        rollbackValue
      );

    case "ac-change":
      return updateField(
        record.workItemId,
        "acceptanceCriteria",
        value,
        rollbackValue
      );

    case "schedule-change": {
      const v = value as {
        startDate: string;
        endDate: string;
        iterationPath: string;
      };
      const rv = rollbackValue as {
        startDate: string;
        endDate: string;
        iterationPath: string;
      };
      return updateSchedule(
        record.workItemId,
        v.startDate,
        v.endDate,
        v.iterationPath,
        rv.iterationPath
      );
    }

    case "reorder": {
      const v = value as {
        parentId: number | null;
        sortOrder: number;
        prevSiblingId?: number;
        nextSiblingId?: number;
      };
      const rv = rollbackValue as {
        parentId: number | null;
        sortOrder: number;
        prevSiblingId?: number;
        nextSiblingId?: number;
      };
      return reorderItem(
        record.workItemId,
        v.parentId,
        v.sortOrder,
        rv.parentId,
        v.prevSiblingId ?? 0,
        v.nextSiblingId ?? 0
      );
    }

    case "create-item": {
      // Undo create → set state to "Removed"; Redo create → restore previous state
      if (direction === "undo") {
        return updateField(record.workItemId, "state", "Removed", record.newValue);
      }
      // Redo: restore the item's state from before the undo (i.e. un-remove it)
      const prevState = (record.previousValue as string) ?? "New";
      return updateField(record.workItemId, "state", prevState === "null" ? "New" : prevState, "Removed");
    }

    case "remove-items": {
      // Single record within a compound — undo restores previous state, redo re-removes
      if (direction === "undo") {
        const prevState = record.previousValue as string;
        return updateField(record.workItemId, "state", prevState, "Removed");
      }
      return updateField(
        record.workItemId,
        "state",
        "Removed",
        record.previousValue
      );
    }

    default:
      return { success: false, error: `Unknown action type: ${record.type}` };
  }
}

/**
 * Apply a full HistoryEntry (single or compound) in the given direction.
 * For compound actions, all records are applied. If any fails, the ones
 * already applied are rolled back.
 */
async function applyEntry(
  entry: HistoryEntry,
  direction: "undo" | "redo"
): Promise<WriteResult> {
  if (!isCompound(entry)) {
    return applyRecord(entry, direction);
  }

  // Compound: apply records in order (undo = reverse order, redo = forward order)
  const records =
    direction === "undo" ? [...entry.records].reverse() : entry.records;

  const applied: ActionRecord[] = [];

  for (const record of records) {
    const result = await applyRecord(record, direction);
    if (!result.success) {
      // Roll back already-applied records in reverse
      const rollbackDir = direction === "undo" ? "redo" : "undo";
      for (const done of [...applied].reverse()) {
        await applyRecord(done, rollbackDir).catch(() => {});
      }
      return result;
    }
    applied.push(record);
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Provider component
// ---------------------------------------------------------------------------

export function UndoRedoProvider({
  children,
  refreshData,
  onError,
  recordActionRef,
}: UndoRedoProviderProps) {
  const managerRef = useRef(new HistoryManager());
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);
  const [redoLabel, setRedoLabel] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const clearError = useCallback(() => setLastError(null), []);

  /** Sync React state from the manager's current pointer position. */
  const syncState = useCallback(() => {
    const mgr = managerRef.current;
    setCanUndo(mgr.canUndo());
    setCanRedo(mgr.canRedo());

    const undoEntry = mgr.peekUndo();
    setUndoLabel(undoEntry ? describeAction(undoEntry) : null);

    const redoEntry = mgr.peekRedo();
    setRedoLabel(redoEntry ? describeAction(redoEntry) : null);
  }, []);

  const recordAction = useCallback(
    (entry: HistoryEntry) => {
      managerRef.current.push(entry);
      syncState();
    },
    [syncState]
  );

  // Expose recordAction to parent via ref
  if (recordActionRef) {
    recordActionRef.current = recordAction;
  }

  const undo = useCallback(async () => {
    const mgr = managerRef.current;
    if (!mgr.canUndo()) return;

    const entry = mgr.undo();
    if (!entry) return;

    const result = await applyEntry(entry, "undo");

    if (!result.success) {
      // Restore the pointer — push the entry back by redoing it in the manager
      mgr.redo();
      syncState();
      const errorMsg = `Failed to undo ${describeAction(entry)}: ${result.error ?? "Unknown error"}`;
      setLastError(errorMsg);
      onError?.(errorMsg);
      return;
    }

    await refreshData();
    syncState();
  }, [refreshData, onError, syncState]);

  const redo = useCallback(async () => {
    const mgr = managerRef.current;
    if (!mgr.canRedo()) return;

    const entry = mgr.redo();
    if (!entry) return;

    const result = await applyEntry(entry, "redo");

    if (!result.success) {
      // Restore the pointer — undo the redo in the manager
      mgr.undo();
      syncState();
      const errorMsg = `Failed to redo ${describeAction(entry)}: ${result.error ?? "Unknown error"}`;
      setLastError(errorMsg);
      onError?.(errorMsg);
      return;
    }

    await refreshData();
    syncState();
  }, [refreshData, onError, syncState]);

  // Keyboard shortcuts: Ctrl+Z / Cmd+Z for undo, Ctrl+Shift+Z / Cmd+Shift+Z for redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      handleUndoRedoKeydown(e, { undo, redo });
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [undo, redo]);

  const value: UndoRedoContextValue = {
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    lastError,
    clearError,
    recordAction,
    undo,
    redo,
  };

  return (
    <UndoRedoContext.Provider value={value}>{children}</UndoRedoContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUndoRedo(): UndoRedoContextValue {
  const ctx = useContext(UndoRedoContext);
  if (!ctx) {
    throw new Error("useUndoRedo must be used within an UndoRedoProvider");
  }
  return ctx;
}
