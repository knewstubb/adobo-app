import { describe, it, expect, beforeEach } from "vitest";
import {
  HistoryManager,
  describeAction,
  type ActionRecord,
  type CompoundAction,
} from "@/lib/history-manager";

// ---------------------------------------------------------------------------
// Helpers — mirror the makeRecord/makeCompound pattern from history-manager tests
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<ActionRecord> = {}): ActionRecord {
  return {
    id: crypto.randomUUID(),
    type: "field-change",
    timestamp: Date.now(),
    workItemId: 12345,
    field: "state",
    previousValue: "New",
    newValue: "Active",
    ...overrides,
  };
}

function makeCompound(
  overrides: Partial<CompoundAction> = {},
  recordCount = 2,
): CompoundAction {
  return {
    id: crypto.randomUUID(),
    type: "reorder",
    timestamp: Date.now(),
    label: "",
    records: Array.from({ length: recordCount }, (_, i) =>
      makeRecord({ workItemId: 100 + i }),
    ),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Simulate the context value derivation that UndoRedoProvider performs.
// This mirrors the syncState() logic in undo-redo-context.tsx.
// ---------------------------------------------------------------------------

function deriveToolbarState(mgr: HistoryManager) {
  const canUndo = mgr.canUndo();
  const canRedo = mgr.canRedo();
  const undoEntry = mgr.peekUndo();
  const redoEntry = mgr.peekRedo();
  const undoLabel = undoEntry ? describeAction(undoEntry) : null;
  const redoLabel = redoEntry ? describeAction(redoEntry) : null;

  // Tooltip strings match UndoRedoToolbar.tsx title attributes
  const undoTooltip = undoLabel ? `Undo ${undoLabel}` : "Nothing to undo";
  const redoTooltip = redoLabel ? `Redo ${redoLabel}` : "Nothing to redo";

  return { canUndo, canRedo, undoLabel, redoLabel, undoTooltip, redoTooltip };
}

// ---------------------------------------------------------------------------
// Tests — Task 7.3: Toolbar button rendering and state
// Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2
// ---------------------------------------------------------------------------

describe("Task 7.3 – Undo/Redo toolbar button state", () => {
  let mgr: HistoryManager;

  beforeEach(() => {
    mgr = new HistoryManager();
  });

  // -- Req 7.1, 7.2: Buttons render (context provides values) ---------------

  it("provides canUndo and canRedo flags for button rendering", () => {
    const state = deriveToolbarState(mgr);
    expect(state).toHaveProperty("canUndo");
    expect(state).toHaveProperty("canRedo");
  });

  // -- Req 7.3: Undo button disabled when stack empty -----------------------

  it("undo button is disabled when undo stack is empty", () => {
    const state = deriveToolbarState(mgr);
    expect(state.canUndo).toBe(false);
  });

  // -- Req 7.4: Redo button disabled when redo stack empty ------------------

  it("redo button is disabled when redo stack is empty", () => {
    const state = deriveToolbarState(mgr);
    expect(state.canRedo).toBe(false);
  });

  // -- Req 7.3 (inverse): Undo button enabled after push -------------------

  it("undo button is enabled after pushing an action", () => {
    mgr.push(makeRecord());
    const state = deriveToolbarState(mgr);
    expect(state.canUndo).toBe(true);
  });

  // -- Req 7.4 (inverse): Redo button enabled after undo -------------------

  it("redo button is enabled after an undo", () => {
    mgr.push(makeRecord());
    mgr.undo();
    const state = deriveToolbarState(mgr);
    expect(state.canRedo).toBe(true);
  });

  // -- Req 7.5: Button states update after undo/redo operations -------------

  it("button states update correctly through push → undo → redo cycle", () => {
    // Initial: both disabled
    let state = deriveToolbarState(mgr);
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(false);

    // After push: undo enabled, redo disabled
    mgr.push(makeRecord({ workItemId: 1 }));
    state = deriveToolbarState(mgr);
    expect(state.canUndo).toBe(true);
    expect(state.canRedo).toBe(false);

    // After undo: undo disabled (only 1 entry), redo enabled
    mgr.undo();
    state = deriveToolbarState(mgr);
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(true);

    // After redo: undo enabled, redo disabled
    mgr.redo();
    state = deriveToolbarState(mgr);
    expect(state.canUndo).toBe(true);
    expect(state.canRedo).toBe(false);
  });

  it("button states update with multiple entries", () => {
    mgr.push(makeRecord({ workItemId: 1 }));
    mgr.push(makeRecord({ workItemId: 2 }));
    mgr.push(makeRecord({ workItemId: 3 }));

    // Undo once: both should be enabled
    mgr.undo();
    let state = deriveToolbarState(mgr);
    expect(state.canUndo).toBe(true);
    expect(state.canRedo).toBe(true);

    // Undo all remaining
    mgr.undo();
    mgr.undo();
    state = deriveToolbarState(mgr);
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(true);
  });

  // -- Req 8.1: Tooltip describes next undo action --------------------------

  it("undo tooltip shows action description when stack is non-empty", () => {
    mgr.push(makeRecord({ field: "state", workItemId: 42 }));
    const state = deriveToolbarState(mgr);
    expect(state.undoTooltip).toBe("Undo state change on #42");
  });

  it("undo tooltip shows 'Nothing to undo' when stack is empty", () => {
    const state = deriveToolbarState(mgr);
    expect(state.undoTooltip).toBe("Nothing to undo");
  });

  // -- Req 8.2: Tooltip describes next redo action --------------------------

  it("redo tooltip shows action description when redo stack is non-empty", () => {
    mgr.push(makeRecord({ field: "priority", workItemId: 99 }));
    mgr.undo();
    const state = deriveToolbarState(mgr);
    expect(state.redoTooltip).toBe("Redo priority change on #99");
  });

  it("redo tooltip shows 'Nothing to redo' when redo stack is empty", () => {
    const state = deriveToolbarState(mgr);
    expect(state.redoTooltip).toBe("Nothing to redo");
  });

  // -- Tooltip updates after operations -------------------------------------

  it("tooltips update after undo/redo operations", () => {
    const r1 = makeRecord({ field: "state", workItemId: 10 });
    const r2 = makeRecord({ field: "assignedTo", workItemId: 20 });
    mgr.push(r1);
    mgr.push(r2);

    // Before undo: undo tooltip shows r2, redo tooltip is empty
    let state = deriveToolbarState(mgr);
    expect(state.undoTooltip).toBe("Undo assignedTo change on #20");
    expect(state.redoTooltip).toBe("Nothing to redo");

    // After undoing r2: undo tooltip shows r1, redo tooltip shows r2
    mgr.undo();
    state = deriveToolbarState(mgr);
    expect(state.undoTooltip).toBe("Undo state change on #10");
    expect(state.redoTooltip).toBe("Redo assignedTo change on #20");

    // After undoing r1: undo empty, redo shows r1
    mgr.undo();
    state = deriveToolbarState(mgr);
    expect(state.undoTooltip).toBe("Nothing to undo");
    expect(state.redoTooltip).toBe("Redo state change on #10");
  });

  // -- Compound action tooltips ---------------------------------------------

  it("tooltip shows compound action label", () => {
    const compound = makeCompound(
      { type: "reorder", label: "reorder 3 items" },
      3,
    );
    mgr.push(compound);
    const state = deriveToolbarState(mgr);
    expect(state.undoTooltip).toBe("Undo reorder 3 items");
  });

  // -- Labels are null when stacks are empty --------------------------------

  it("undoLabel and redoLabel are null initially", () => {
    const state = deriveToolbarState(mgr);
    expect(state.undoLabel).toBeNull();
    expect(state.redoLabel).toBeNull();
  });

  it("undoLabel is set after push, redoLabel remains null", () => {
    mgr.push(makeRecord({ field: "state", workItemId: 5 }));
    const state = deriveToolbarState(mgr);
    expect(state.undoLabel).toBe("state change on #5");
    expect(state.redoLabel).toBeNull();
  });

  it("redoLabel is set after undo", () => {
    mgr.push(makeRecord({ field: "state", workItemId: 5 }));
    mgr.undo();
    const state = deriveToolbarState(mgr);
    expect(state.undoLabel).toBeNull();
    expect(state.redoLabel).toBe("state change on #5");
  });
});
