// ---------------------------------------------------------------------------
// HistoryManager – pure TypeScript undo/redo stack (no React dependency)
// ---------------------------------------------------------------------------

// ---- Task 1.1: Types ------------------------------------------------------

/** All mutation types recognised by the undo/redo system. */
export type ActionType =
  | "field-change"
  | "tags-change"
  | "schedule-change"
  | "reorder"
  | "create-item"
  | "remove-items"
  | "description-change"
  | "ac-change";

/** A single reversible mutation on one work item. */
export interface ActionRecord {
  id: string;
  type: ActionType;
  timestamp: number;
  workItemId: number;
  field?: string;
  previousValue: unknown;
  newValue: unknown;
}

/** A group of records produced by a single user gesture (e.g. reorder). */
export interface CompoundAction {
  id: string;
  type: ActionType;
  timestamp: number;
  label: string;
  records: ActionRecord[];
}

/** Either a single record or a compound action. */
export type HistoryEntry = ActionRecord | CompoundAction;

/** Type guard – returns true when the entry is a CompoundAction. */
export function isCompound(entry: HistoryEntry): entry is CompoundAction {
  return "records" in entry;
}

// ---- Task 1.2: HistoryManager class ---------------------------------------

export class HistoryManager {
  private stack: HistoryEntry[] = [];
  private pointer: number = -1;
  private readonly maxSize = 50;

  /**
   * Push a new entry onto the stack.
   * - Truncates everything above the pointer (discards redo tail).
   * - Appends the new entry.
   * - Evicts the oldest entry when the stack exceeds maxSize.
   */
  push(entry: HistoryEntry): void {
    // Discard redo tail
    this.stack.length = this.pointer + 1;
    this.stack.push(entry);
    this.pointer = this.stack.length - 1;

    // Evict oldest if over capacity
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
      this.pointer--;
    }
  }

  /**
   * Undo the most recent action.
   * Returns the entry that was undone, or null if nothing to undo.
   */
  undo(): HistoryEntry | null {
    if (!this.canUndo()) return null;
    const entry = this.stack[this.pointer];
    this.pointer--;
    return entry;
  }

  /**
   * Redo the next undone action.
   * Returns the entry that was redone, or null if nothing to redo.
   */
  redo(): HistoryEntry | null {
    if (!this.canRedo()) return null;
    this.pointer++;
    return this.stack[this.pointer];
  }

  /** True when there is at least one entry to undo. */
  canUndo(): boolean {
    return this.pointer >= 0;
  }

  /** True when there is at least one entry to redo. */
  canRedo(): boolean {
    return this.pointer < this.stack.length - 1;
  }

  /** Return the entry that would be undone, without moving the pointer. */
  peekUndo(): HistoryEntry | null {
    if (!this.canUndo()) return null;
    return this.stack[this.pointer];
  }

  /** Return the entry that would be redone, without moving the pointer. */
  peekRedo(): HistoryEntry | null {
    if (!this.canRedo()) return null;
    return this.stack[this.pointer + 1];
  }

  /** Reset the stack and pointer to their initial empty state. */
  clear(): void {
    this.stack = [];
    this.pointer = -1;
  }
}

// ---- Task 1.3: describeAction helper --------------------------------------

/**
 * Generate a short human-readable label for a history entry.
 *
 * Examples:
 *   "state change on #12345"
 *   "reorder 3 items"
 *   "create PBI"
 *   "remove #12345, #12346"
 */
export function describeAction(entry: HistoryEntry): string {
  if (isCompound(entry)) {
    return describeCompound(entry);
  }
  return describeSingle(entry);
}

function describeSingle(record: ActionRecord): string {
  switch (record.type) {
    case "field-change":
      return `${record.field ?? "field"} change on #${record.workItemId}`;
    case "tags-change":
      return `tags change on #${record.workItemId}`;
    case "schedule-change":
      return `schedule change on #${record.workItemId}`;
    case "description-change":
      return `description change on #${record.workItemId}`;
    case "ac-change":
      return `acceptance criteria change on #${record.workItemId}`;
    case "create-item":
      return `create item #${record.workItemId}`;
    case "remove-items":
      return `remove #${record.workItemId}`;
    case "reorder":
      return `reorder #${record.workItemId}`;
    default:
      return `change on #${record.workItemId}`;
  }
}

function describeCompound(action: CompoundAction): string {
  // If the compound already has a label, prefer it
  if (action.label) return action.label;

  const count = action.records.length;
  switch (action.type) {
    case "reorder":
      return `reorder ${count} item${count === 1 ? "" : "s"}`;
    case "remove-items": {
      const ids = action.records.map((r) => `#${r.workItemId}`).join(", ");
      return `remove ${ids}`;
    }
    case "schedule-change":
      return `schedule change on ${count} item${count === 1 ? "" : "s"}`;
    default:
      return `${action.type} on ${count} item${count === 1 ? "" : "s"}`;
  }
}
