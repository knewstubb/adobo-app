import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  HistoryManager,
  isCompound,
  type ActionType,
  type ActionRecord,
  type CompoundAction,
  type HistoryEntry,
} from "@/lib/history-manager";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const ALL_ACTION_TYPES: ActionType[] = [
  "field-change",
  "tags-change",
  "schedule-change",
  "reorder",
  "create-item",
  "remove-items",
  "description-change",
  "ac-change",
];

const arbActionType: fc.Arbitrary<ActionType> = fc.constantFrom(...ALL_ACTION_TYPES);

const arbFieldName: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom("state", "assignedTo", "iterationPath", "priority", "title"),
);

/** Arbitrary that produces a plausible previous/new value. */
const arbValue: fc.Arbitrary<unknown> = fc.oneof(
  fc.string({ minLength: 0, maxLength: 50 }),
  fc.integer({ min: -1000, max: 1000 }),
  fc.constant(null),
  fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 5 }),
);

const arbWorkItemId: fc.Arbitrary<number> = fc.integer({ min: 1, max: 999999 });

/** Generate a single ActionRecord with random data. */
const arbActionRecord: fc.Arbitrary<ActionRecord> = fc.record({
  id: fc.uuid(),
  type: arbActionType,
  timestamp: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  workItemId: arbWorkItemId,
  field: arbFieldName,
  previousValue: arbValue,
  newValue: arbValue,
});

/** Generate a CompoundAction with 1–5 sub-records. */
const arbCompoundAction: fc.Arbitrary<CompoundAction> = fc.record({
  id: fc.uuid(),
  type: arbActionType,
  timestamp: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  label: fc.string({ minLength: 0, maxLength: 60 }),
  records: fc.array(arbActionRecord, { minLength: 1, maxLength: 5 }),
});

/** Generate either an ActionRecord or a CompoundAction. */
const arbHistoryEntry: fc.Arbitrary<HistoryEntry> = fc.oneof(
  arbActionRecord,
  arbCompoundAction,
);

// ---------------------------------------------------------------------------
// Property 1: Push records correct values
// Feature: undo-redo, Property 1: Push records correct values
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11**
// ---------------------------------------------------------------------------

describe("Feature: undo-redo, Property 1: Push records correct values", () => {
  it("pushed ActionRecord is retrievable via peekUndo with identical data", () => {
    fc.assert(
      fc.property(arbActionRecord, (record) => {
        const mgr = new HistoryManager();
        mgr.push(record);

        const peeked = mgr.peekUndo();
        expect(peeked).not.toBeNull();
        expect(peeked).toBe(record);

        // Verify the entry is an ActionRecord (not compound)
        expect(isCompound(peeked!)).toBe(false);
        const r = peeked as ActionRecord;
        expect(r.id).toBe(record.id);
        expect(r.type).toBe(record.type);
        expect(r.timestamp).toBe(record.timestamp);
        expect(r.workItemId).toBe(record.workItemId);
        expect(r.field).toBe(record.field);
        expect(r.previousValue).toEqual(record.previousValue);
        expect(r.newValue).toEqual(record.newValue);
      }),
      { numRuns: 100 },
    );
  });

  it("pushed CompoundAction is retrievable via peekUndo with identical data", () => {
    fc.assert(
      fc.property(arbCompoundAction, (compound) => {
        const mgr = new HistoryManager();
        mgr.push(compound);

        const peeked = mgr.peekUndo();
        expect(peeked).not.toBeNull();
        expect(peeked).toBe(compound);

        expect(isCompound(peeked!)).toBe(true);
        const c = peeked as CompoundAction;
        expect(c.id).toBe(compound.id);
        expect(c.type).toBe(compound.type);
        expect(c.timestamp).toBe(compound.timestamp);
        expect(c.label).toBe(compound.label);
        expect(c.records).toEqual(compound.records);
      }),
      { numRuns: 100 },
    );
  });

  it("undo returns the exact entry that was pushed", () => {
    fc.assert(
      fc.property(arbHistoryEntry, (entry) => {
        const mgr = new HistoryManager();
        mgr.push(entry);

        const undone = mgr.undo();
        expect(undone).toBe(entry);
      }),
      { numRuns: 100 },
    );
  });

  it("last pushed entry is always the one returned by peekUndo", () => {
    fc.assert(
      fc.property(
        fc.array(arbHistoryEntry, { minLength: 1, maxLength: 20 }),
        (entries) => {
          const mgr = new HistoryManager();
          for (const e of entries) {
            mgr.push(e);
          }
          const last = entries[entries.length - 1];
          expect(mgr.peekUndo()).toBe(last);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: New push clears redo tail
// Feature: undo-redo, Property 4: New push clears redo tail
// **Validates: Requirements 4.1**
// ---------------------------------------------------------------------------

describe("Feature: undo-redo, Property 4: New push clears redo tail", () => {
  it("canRedo is false after push-undo-push sequence", () => {
    fc.assert(
      fc.property(
        fc.array(arbHistoryEntry, { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 1, max: 20 }),
        arbHistoryEntry,
        (initialEntries, undoCount, newEntry) => {
          const mgr = new HistoryManager();

          // Push initial entries
          for (const e of initialEntries) {
            mgr.push(e);
          }

          // Undo some number of times (capped to what's available)
          const actualUndos = Math.min(undoCount, initialEntries.length);
          for (let i = 0; i < actualUndos; i++) {
            mgr.undo();
          }

          // At this point canRedo should be true if we undid at least once
          if (actualUndos > 0) {
            expect(mgr.canRedo()).toBe(true);
          }

          // Push a new entry — this must clear the redo tail
          mgr.push(newEntry);
          expect(mgr.canRedo()).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("redo returns null immediately after a new push following undos", () => {
    fc.assert(
      fc.property(
        fc.array(arbHistoryEntry, { minLength: 2, maxLength: 10 }),
        arbHistoryEntry,
        (entries, newEntry) => {
          const mgr = new HistoryManager();
          for (const e of entries) {
            mgr.push(e);
          }

          // Undo once to create a redo tail
          mgr.undo();
          expect(mgr.canRedo()).toBe(true);

          // Push new entry
          mgr.push(newEntry);
          expect(mgr.redo()).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Stack size invariant
// Feature: undo-redo, Property 5: Stack size invariant
// **Validates: Requirements 6.1, 6.2**
// ---------------------------------------------------------------------------

describe("Feature: undo-redo, Property 5: Stack size invariant", () => {
  it("stack length never exceeds 50 for any sequence of pushes", () => {
    fc.assert(
      fc.property(
        fc.array(arbHistoryEntry, { minLength: 1, maxLength: 200 }),
        (entries) => {
          const mgr = new HistoryManager();

          for (const e of entries) {
            mgr.push(e);

            // After every push, count reachable entries via undo
            let count = 0;
            const snapshot = new HistoryManager();
            // We can't peek inside the manager directly, so we verify
            // the invariant by checking canUndo count doesn't exceed 50.
            // Instead, we'll accumulate and check at the end.
          }

          // After all pushes, count how many undos are possible
          let undoCount = 0;
          while (mgr.canUndo()) {
            mgr.undo();
            undoCount++;
          }

          expect(undoCount).toBeLessThanOrEqual(50);
          expect(undoCount).toBe(Math.min(entries.length, 50));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("oldest entry is evicted when pushing beyond 50", () => {
    fc.assert(
      fc.property(
        fc.array(arbHistoryEntry, { minLength: 51, maxLength: 200 }),
        (entries) => {
          const mgr = new HistoryManager();
          for (const e of entries) {
            mgr.push(e);
          }

          // The most recent entry should be the last one pushed
          expect(mgr.peekUndo()).toBe(entries[entries.length - 1]);

          // Total undoable entries should be exactly 50
          let undoCount = 0;
          while (mgr.canUndo()) {
            mgr.undo();
            undoCount++;
          }
          expect(undoCount).toBe(50);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 2: Undo round-trip restores original state
// Feature: undo-redo, Property 2: Undo round-trip restores original state
// **Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.6**
// ---------------------------------------------------------------------------

describe("Feature: undo-redo, Property 2: Undo round-trip restores original state", () => {
  it("undo returns entry whose previousValue matches what was pushed", () => {
    fc.assert(
      fc.property(
        fc.array(arbHistoryEntry, { minLength: 1, maxLength: 30 }),
        (entries) => {
          const mgr = new HistoryManager();
          for (const e of entries) {
            mgr.push(e);
          }

          // Undo each entry and verify the returned entry has the correct previousValue
          for (let i = entries.length - 1; i >= Math.max(0, entries.length - 50); i--) {
            const undone = mgr.undo();
            expect(undone).not.toBeNull();

            const original = entries[i];
            if (isCompound(original)) {
              expect(isCompound(undone!)).toBe(true);
              const undoneCompound = undone as CompoundAction;
              // Each sub-record's previousValue should match the original
              expect(undoneCompound.records.length).toBe(original.records.length);
              for (let r = 0; r < original.records.length; r++) {
                expect(undoneCompound.records[r].previousValue).toEqual(
                  original.records[r].previousValue,
                );
                expect(undoneCompound.records[r].newValue).toEqual(
                  original.records[r].newValue,
                );
              }
            } else {
              expect(isCompound(undone!)).toBe(false);
              const undoneRecord = undone as ActionRecord;
              expect(undoneRecord.previousValue).toEqual(original.previousValue);
              expect(undoneRecord.newValue).toEqual(original.newValue);
              expect(undoneRecord.workItemId).toBe(original.workItemId);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("after push then undo, the entry's previousValue is the value to restore", () => {
    fc.assert(
      fc.property(arbActionRecord, (record) => {
        const mgr = new HistoryManager();
        mgr.push(record);

        const undone = mgr.undo();
        expect(undone).not.toBeNull();

        // The caller (context) would use previousValue to restore the field
        const r = undone as ActionRecord;
        expect(r.previousValue).toEqual(record.previousValue);
        expect(r.field).toBe(record.field);
        expect(r.workItemId).toBe(record.workItemId);
      }),
      { numRuns: 100 },
    );
  });

  it("compound action undo returns all sub-records with correct previousValues", () => {
    fc.assert(
      fc.property(arbCompoundAction, (compound) => {
        const mgr = new HistoryManager();
        mgr.push(compound);

        const undone = mgr.undo();
        expect(undone).not.toBeNull();
        expect(isCompound(undone!)).toBe(true);

        const c = undone as CompoundAction;
        expect(c.records.length).toBe(compound.records.length);
        for (let i = 0; i < compound.records.length; i++) {
          expect(c.records[i].previousValue).toEqual(compound.records[i].previousValue);
          expect(c.records[i].workItemId).toBe(compound.records[i].workItemId);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("multiple undos return entries in reverse push order with correct previousValues", () => {
    fc.assert(
      fc.property(
        fc.array(arbActionRecord, { minLength: 2, maxLength: 20 }),
        (records) => {
          const mgr = new HistoryManager();
          for (const r of records) {
            mgr.push(r);
          }

          // Undo all and verify reverse order
          for (let i = records.length - 1; i >= 0; i--) {
            const undone = mgr.undo() as ActionRecord;
            expect(undone).not.toBeNull();
            expect(undone.previousValue).toEqual(records[i].previousValue);
            expect(undone.newValue).toEqual(records[i].newValue);
            expect(undone.id).toBe(records[i].id);
          }

          // No more undos
          expect(mgr.undo()).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Redo round-trip re-applies new state
// Feature: undo-redo, Property 3: Redo round-trip re-applies new state
// **Validates: Requirements 3.1, 3.2, 3.3**
// ---------------------------------------------------------------------------

describe("Feature: undo-redo, Property 3: Redo round-trip re-applies new state", () => {
  it("after push-undo-redo, the redone entry's newValue matches the original push", () => {
    fc.assert(
      fc.property(arbActionRecord, (record) => {
        const mgr = new HistoryManager();
        mgr.push(record);
        mgr.undo();

        const redone = mgr.redo();
        expect(redone).not.toBeNull();

        // The caller (context) would use newValue to re-apply the mutation
        const r = redone as ActionRecord;
        expect(r.newValue).toEqual(record.newValue);
        expect(r.field).toBe(record.field);
        expect(r.workItemId).toBe(record.workItemId);
      }),
      { numRuns: 100 },
    );
  });

  it("compound action redo returns all sub-records with correct newValues", () => {
    fc.assert(
      fc.property(arbCompoundAction, (compound) => {
        const mgr = new HistoryManager();
        mgr.push(compound);
        mgr.undo();

        const redone = mgr.redo();
        expect(redone).not.toBeNull();
        expect(isCompound(redone!)).toBe(true);

        const c = redone as CompoundAction;
        expect(c.records.length).toBe(compound.records.length);
        for (let i = 0; i < compound.records.length; i++) {
          expect(c.records[i].newValue).toEqual(compound.records[i].newValue);
          expect(c.records[i].workItemId).toBe(compound.records[i].workItemId);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("multiple undo-then-redo restores entries in forward order with correct newValues", () => {
    fc.assert(
      fc.property(
        fc.array(arbActionRecord, { minLength: 2, maxLength: 20 }),
        fc.integer({ min: 1, max: 20 }),
        (records, undoCount) => {
          const mgr = new HistoryManager();
          for (const r of records) {
            mgr.push(r);
          }

          const actualUndos = Math.min(undoCount, records.length);
          for (let i = 0; i < actualUndos; i++) {
            mgr.undo();
          }

          // Redo all undone entries and verify forward order
          for (let i = 0; i < actualUndos; i++) {
            const idx = records.length - actualUndos + i;
            const redone = mgr.redo() as ActionRecord;
            expect(redone).not.toBeNull();
            expect(redone.newValue).toEqual(records[idx].newValue);
            expect(redone.previousValue).toEqual(records[idx].previousValue);
            expect(redone.id).toBe(records[idx].id);
          }

          // No more redos
          expect(mgr.redo()).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("undo-redo cycle is idempotent: entry values are unchanged after round-trip", () => {
    fc.assert(
      fc.property(
        fc.array(arbHistoryEntry, { minLength: 1, maxLength: 15 }),
        fc.integer({ min: 1, max: 15 }),
        (entries, cycles) => {
          const mgr = new HistoryManager();
          for (const e of entries) {
            mgr.push(e);
          }

          const actualCycles = Math.min(cycles, entries.length);

          // Perform N undo-redo cycles on the top entry
          for (let c = 0; c < actualCycles; c++) {
            const undone = mgr.undo();
            expect(undone).not.toBeNull();
            const redone = mgr.redo();
            expect(redone).not.toBeNull();

            // The redone entry should be the same object as the undone entry
            expect(redone).toBe(undone);
          }

          // After all cycles, peekUndo should still be the last pushed entry
          expect(mgr.peekUndo()).toBe(entries[entries.length - 1]);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: Failed undo/redo rolls back to pre-attempt state
// Feature: undo-redo, Property 6: Failed undo/redo rolls back
// **Validates: Requirements 9.1, 9.2**
//
// Since HistoryManager is a pure data structure, we simulate the failure
// recovery pattern used by UndoRedoContext: on failed undo, call redo() to
// restore the pointer; on failed redo, call undo() to restore the pointer.
// We verify that after this rollback, the manager's observable state
// (canUndo, canRedo, peekUndo, peekRedo) is identical to before the attempt.
// ---------------------------------------------------------------------------

describe("Feature: undo-redo, Property 6: Failed undo/redo rolls back", () => {
  it("failed undo: undo + redo restores canUndo/canRedo/peekUndo/peekRedo", () => {
    fc.assert(
      fc.property(
        fc.array(arbHistoryEntry, { minLength: 1, maxLength: 30 }),
        (entries) => {
          const mgr = new HistoryManager();
          for (const e of entries) {
            mgr.push(e);
          }

          // Snapshot state before the undo attempt
          const preCanUndo = mgr.canUndo();
          const preCanRedo = mgr.canRedo();
          const prePeekUndo = mgr.peekUndo();
          const prePeekRedo = mgr.peekRedo();

          // Simulate: undo succeeds at manager level, but write-back fails
          const undone = mgr.undo();
          expect(undone).not.toBeNull();

          // Simulate failure recovery: redo to restore pointer
          mgr.redo();

          // Verify state is identical to pre-attempt
          expect(mgr.canUndo()).toBe(preCanUndo);
          expect(mgr.canRedo()).toBe(preCanRedo);
          expect(mgr.peekUndo()).toBe(prePeekUndo);
          expect(mgr.peekRedo()).toBe(prePeekRedo);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("failed redo: redo + undo restores canUndo/canRedo/peekUndo/peekRedo", () => {
    fc.assert(
      fc.property(
        fc.array(arbHistoryEntry, { minLength: 2, maxLength: 30 }),
        fc.integer({ min: 1, max: 30 }),
        (entries, undoCount) => {
          const mgr = new HistoryManager();
          for (const e of entries) {
            mgr.push(e);
          }

          // Undo some entries to create a redo tail
          const actualUndos = Math.min(undoCount, entries.length);
          for (let i = 0; i < actualUndos; i++) {
            mgr.undo();
          }

          if (!mgr.canRedo()) return; // skip if nothing to redo

          // Snapshot state before the redo attempt
          const preCanUndo = mgr.canUndo();
          const preCanRedo = mgr.canRedo();
          const prePeekUndo = mgr.peekUndo();
          const prePeekRedo = mgr.peekRedo();

          // Simulate: redo succeeds at manager level, but write-back fails
          const redone = mgr.redo();
          expect(redone).not.toBeNull();

          // Simulate failure recovery: undo to restore pointer
          mgr.undo();

          // Verify state is identical to pre-attempt
          expect(mgr.canUndo()).toBe(preCanUndo);
          expect(mgr.canRedo()).toBe(preCanRedo);
          expect(mgr.peekUndo()).toBe(prePeekUndo);
          expect(mgr.peekRedo()).toBe(prePeekRedo);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("failed undo on single-entry stack: state fully restored after undo+redo", () => {
    fc.assert(
      fc.property(arbHistoryEntry, (entry) => {
        const mgr = new HistoryManager();
        mgr.push(entry);

        const preCanUndo = mgr.canUndo();
        const preCanRedo = mgr.canRedo();
        const prePeekUndo = mgr.peekUndo();

        // Simulate failed undo
        mgr.undo();
        mgr.redo(); // rollback

        expect(mgr.canUndo()).toBe(preCanUndo);
        expect(mgr.canRedo()).toBe(preCanRedo);
        expect(mgr.peekUndo()).toBe(prePeekUndo);
      }),
      { numRuns: 100 },
    );
  });

  it("failed redo at stack top: state fully restored after redo+undo", () => {
    fc.assert(
      fc.property(
        fc.array(arbHistoryEntry, { minLength: 1, maxLength: 20 }),
        (entries) => {
          const mgr = new HistoryManager();
          for (const e of entries) {
            mgr.push(e);
          }

          // Undo exactly one to create a single redo entry
          mgr.undo();

          if (!mgr.canRedo()) return;

          const preCanUndo = mgr.canUndo();
          const preCanRedo = mgr.canRedo();
          const prePeekUndo = mgr.peekUndo();
          const prePeekRedo = mgr.peekRedo();

          // Simulate failed redo
          mgr.redo();
          mgr.undo(); // rollback

          expect(mgr.canUndo()).toBe(preCanUndo);
          expect(mgr.canRedo()).toBe(preCanRedo);
          expect(mgr.peekUndo()).toBe(prePeekUndo);
          expect(mgr.peekRedo()).toBe(prePeekRedo);
        },
      ),
      { numRuns: 100 },
    );
  });
});
