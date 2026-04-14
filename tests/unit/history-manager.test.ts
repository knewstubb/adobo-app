import { describe, it, expect, beforeEach } from "vitest";
import {
  HistoryManager,
  isCompound,
  describeAction,
  type ActionRecord,
  type CompoundAction,
  type HistoryEntry,
} from "@/lib/history-manager";

// ---- helpers --------------------------------------------------------------

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

// ---- Task 1.1: Type tests -------------------------------------------------

describe("Task 1.1 – Types and type guard", () => {
  it("isCompound returns true for CompoundAction", () => {
    const compound = makeCompound();
    expect(isCompound(compound)).toBe(true);
  });

  it("isCompound returns false for ActionRecord", () => {
    const record = makeRecord();
    expect(isCompound(record)).toBe(false);
  });
});

// ---- Task 1.2: HistoryManager class tests ---------------------------------

describe("Task 1.2 – HistoryManager", () => {
  let mgr: HistoryManager;

  beforeEach(() => {
    mgr = new HistoryManager();
  });

  // -- push / basic state ---------------------------------------------------

  it("starts with empty stacks", () => {
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(false);
    expect(mgr.peekUndo()).toBeNull();
    expect(mgr.peekRedo()).toBeNull();
  });

  it("push makes canUndo true", () => {
    mgr.push(makeRecord());
    expect(mgr.canUndo()).toBe(true);
    expect(mgr.canRedo()).toBe(false);
  });

  // -- undo -----------------------------------------------------------------

  it("undo returns the pushed entry and decrements pointer", () => {
    const entry = makeRecord();
    mgr.push(entry);
    const undone = mgr.undo();
    expect(undone).toBe(entry);
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(true);
  });

  it("undo on empty stack returns null", () => {
    expect(mgr.undo()).toBeNull();
  });

  // -- redo -----------------------------------------------------------------

  it("redo returns the undone entry", () => {
    const entry = makeRecord();
    mgr.push(entry);
    mgr.undo();
    const redone = mgr.redo();
    expect(redone).toBe(entry);
    expect(mgr.canRedo()).toBe(false);
  });

  it("redo on empty redo stack returns null", () => {
    mgr.push(makeRecord());
    expect(mgr.redo()).toBeNull();
  });

  // -- push truncates redo tail ---------------------------------------------

  it("push after undo discards redo tail", () => {
    mgr.push(makeRecord({ workItemId: 1 }));
    mgr.push(makeRecord({ workItemId: 2 }));
    mgr.push(makeRecord({ workItemId: 3 }));
    mgr.undo(); // pointer at entry 2
    mgr.undo(); // pointer at entry 1

    const newEntry = makeRecord({ workItemId: 99 });
    mgr.push(newEntry);

    expect(mgr.canRedo()).toBe(false);
    expect(mgr.peekUndo()).toBe(newEntry);
  });

  // -- peek -----------------------------------------------------------------

  it("peekUndo returns entry without moving pointer", () => {
    const a = makeRecord({ workItemId: 1 });
    const b = makeRecord({ workItemId: 2 });
    mgr.push(a);
    mgr.push(b);

    expect(mgr.peekUndo()).toBe(b);
    expect(mgr.peekUndo()).toBe(b); // still the same
  });

  it("peekRedo returns entry without moving pointer", () => {
    const a = makeRecord({ workItemId: 1 });
    const b = makeRecord({ workItemId: 2 });
    mgr.push(a);
    mgr.push(b);
    mgr.undo();

    expect(mgr.peekRedo()).toBe(b);
    expect(mgr.peekRedo()).toBe(b); // still the same
  });

  // -- clear ----------------------------------------------------------------

  it("clear resets everything", () => {
    mgr.push(makeRecord());
    mgr.push(makeRecord());
    mgr.clear();

    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(false);
    expect(mgr.undo()).toBeNull();
    expect(mgr.redo()).toBeNull();
  });

  // -- max size eviction ----------------------------------------------------

  it("evicts oldest entry when stack exceeds 50", () => {
    const first = makeRecord({ workItemId: 0 });
    mgr.push(first);

    for (let i = 1; i <= 50; i++) {
      mgr.push(makeRecord({ workItemId: i }));
    }

    // 51 pushes → oldest evicted → 50 remain
    // The first entry should no longer be reachable
    let count = 0;
    while (mgr.canUndo()) {
      mgr.undo();
      count++;
    }
    expect(count).toBe(50);
  });

  // -- pointer model matches design doc -------------------------------------

  it("matches the design doc stack model example", () => {
    // push 5 entries: stack = [e0, e1, e2, e3, e4], pointer = 4
    const entries: HistoryEntry[] = [];
    for (let i = 0; i < 5; i++) {
      const e = makeRecord({ workItemId: i });
      entries.push(e);
      mgr.push(e);
    }

    // undo → pointer 3, returns entry4
    expect(mgr.undo()).toBe(entries[4]);
    expect(mgr.canUndo()).toBe(true);
    expect(mgr.canRedo()).toBe(true);

    // undo → pointer 2, returns entry3
    expect(mgr.undo()).toBe(entries[3]);

    // redo → pointer 3, returns entry3
    expect(mgr.redo()).toBe(entries[3]);

    // push new → truncates [entry4], pointer = 3
    const newEntry = makeRecord({ workItemId: 99 });
    mgr.push(newEntry);
    expect(mgr.canRedo()).toBe(false);
    expect(mgr.peekUndo()).toBe(newEntry);
  });
});

// ---- Task 1.3: describeAction tests ---------------------------------------

describe("Task 1.3 – describeAction", () => {
  it("describes a field-change with field name", () => {
    const r = makeRecord({ field: "state", workItemId: 12345 });
    expect(describeAction(r)).toBe("state change on #12345");
  });

  it("describes a field-change without field name", () => {
    const r = makeRecord({ field: undefined, workItemId: 42 });
    expect(describeAction(r)).toBe("field change on #42");
  });

  it("describes tags-change", () => {
    const r = makeRecord({ type: "tags-change", workItemId: 99 });
    expect(describeAction(r)).toBe("tags change on #99");
  });

  it("describes description-change", () => {
    const r = makeRecord({ type: "description-change", workItemId: 7 });
    expect(describeAction(r)).toBe("description change on #7");
  });

  it("describes ac-change", () => {
    const r = makeRecord({ type: "ac-change", workItemId: 8 });
    expect(describeAction(r)).toBe("acceptance criteria change on #8");
  });

  it("describes create-item", () => {
    const r = makeRecord({ type: "create-item", workItemId: 555 });
    expect(describeAction(r)).toBe("create item #555");
  });

  it("describes remove-items (single record)", () => {
    const r = makeRecord({ type: "remove-items", workItemId: 111 });
    expect(describeAction(r)).toBe("remove #111");
  });

  it("describes compound reorder with label", () => {
    const c = makeCompound({ type: "reorder", label: "reorder 3 items" }, 3);
    expect(describeAction(c)).toBe("reorder 3 items");
  });

  it("describes compound reorder without label", () => {
    const c = makeCompound({ type: "reorder", label: "" }, 3);
    expect(describeAction(c)).toBe("reorder 3 items");
  });

  it("describes compound remove-items without label", () => {
    const c = makeCompound(
      {
        type: "remove-items",
        label: "",
        records: [
          makeRecord({ workItemId: 12345 }),
          makeRecord({ workItemId: 12346 }),
        ],
      },
      0, // ignored since we provide records
    );
    // Override records directly
    c.records = [
      makeRecord({ workItemId: 12345 }),
      makeRecord({ workItemId: 12346 }),
    ];
    expect(describeAction(c)).toBe("remove #12345, #12346");
  });

  it("describes compound with explicit label (takes priority)", () => {
    const c = makeCompound({ label: "schedule change on #42" });
    expect(describeAction(c)).toBe("schedule change on #42");
  });
});
