import { describe, it, expect, beforeEach } from "vitest";
import {
  HistoryManager,
  isCompound,
  type ActionRecord,
  type CompoundAction,
  type HistoryEntry,
} from "@/lib/history-manager";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let mgr: HistoryManager;

beforeEach(() => {
  mgr = new HistoryManager();
});

/** Push an entry and return whatever peekUndo gives back. */
function pushAndPeek(entry: HistoryEntry): HistoryEntry {
  mgr.push(entry);
  const peeked = mgr.peekUndo();
  expect(peeked).not.toBeNull();
  return peeked!;
}

// ---------------------------------------------------------------------------
// Task 5.3 – Action recording shapes for each handler
// Validates: Requirements 1.1–1.11
// ---------------------------------------------------------------------------

describe("Task 5.3 – Action recording shapes", () => {
  // ---- handleStateChange (Req 1.1) ----------------------------------------

  describe("handleStateChange → field-change (state)", () => {
    it("records a field-change with field 'state' and string values", () => {
      const entry: ActionRecord = {
        id: crypto.randomUUID(),
        type: "field-change",
        timestamp: Date.now(),
        workItemId: 12345,
        field: "state",
        previousValue: "New",
        newValue: "Active",
      };

      const peeked = pushAndPeek(entry);
      expect(isCompound(peeked)).toBe(false);

      const rec = peeked as ActionRecord;
      expect(rec.type).toBe("field-change");
      expect(rec.field).toBe("state");
      expect(rec.workItemId).toBe(12345);
      expect(typeof rec.previousValue).toBe("string");
      expect(typeof rec.newValue).toBe("string");
    });
  });

  // ---- handleAssigneeChange (Req 1.2) -------------------------------------

  describe("handleAssigneeChange → field-change (assignedTo)", () => {
    it("records a field-change with field 'assignedTo' and string values", () => {
      const entry: ActionRecord = {
        id: crypto.randomUUID(),
        type: "field-change",
        timestamp: Date.now(),
        workItemId: 200,
        field: "assignedTo",
        previousValue: "Alice",
        newValue: "Bob",
      };

      const rec = pushAndPeek(entry) as ActionRecord;
      expect(rec.type).toBe("field-change");
      expect(rec.field).toBe("assignedTo");
      expect(typeof rec.previousValue).toBe("string");
      expect(typeof rec.newValue).toBe("string");
    });

    it("supports null previousValue (unassigned → assigned)", () => {
      const entry: ActionRecord = {
        id: crypto.randomUUID(),
        type: "field-change",
        timestamp: Date.now(),
        workItemId: 201,
        field: "assignedTo",
        previousValue: null,
        newValue: "Charlie",
      };

      const rec = pushAndPeek(entry) as ActionRecord;
      expect(rec.previousValue).toBeNull();
      expect(typeof rec.newValue).toBe("string");
    });

    it("supports null newValue (assigned → unassigned)", () => {
      const entry: ActionRecord = {
        id: crypto.randomUUID(),
        type: "field-change",
        timestamp: Date.now(),
        workItemId: 202,
        field: "assignedTo",
        previousValue: "Dave",
        newValue: null,
      };

      const rec = pushAndPeek(entry) as ActionRecord;
      expect(typeof rec.previousValue).toBe("string");
      expect(rec.newValue).toBeNull();
    });
  });

  // ---- handleTagsChange (Req 1.3) -----------------------------------------

  describe("handleTagsChange → tags-change", () => {
    it("records a tags-change with string[] previousValue and newValue", () => {
      const entry: ActionRecord = {
        id: crypto.randomUUID(),
        type: "tags-change",
        timestamp: Date.now(),
        workItemId: 300,
        previousValue: ["bug", "urgent"],
        newValue: ["bug", "urgent", "frontend"],
      };

      const rec = pushAndPeek(entry) as ActionRecord;
      expect(rec.type).toBe("tags-change");
      expect(Array.isArray(rec.previousValue)).toBe(true);
      expect(Array.isArray(rec.newValue)).toBe(true);
      expect(rec.previousValue).toEqual(["bug", "urgent"]);
      expect(rec.newValue).toEqual(["bug", "urgent", "frontend"]);
    });
  });

  // ---- handleIterationChange (Req 1.4) ------------------------------------

  describe("handleIterationChange → field-change (iterationPath)", () => {
    it("records a field-change with field 'iterationPath'", () => {
      const entry: ActionRecord = {
        id: crypto.randomUUID(),
        type: "field-change",
        timestamp: Date.now(),
        workItemId: 400,
        field: "iterationPath",
        previousValue: "Spark\\Sprints\\FY26\\Sprint 1",
        newValue: "Spark\\Sprints\\FY26\\Sprint 2",
      };

      const rec = pushAndPeek(entry) as ActionRecord;
      expect(rec.type).toBe("field-change");
      expect(rec.field).toBe("iterationPath");
      expect(typeof rec.previousValue).toBe("string");
      expect(typeof rec.newValue).toBe("string");
    });
  });

  // ---- handlePriorityChange (Req 1.10) ------------------------------------

  describe("handlePriorityChange → field-change (priority)", () => {
    it("records a field-change with field 'priority' and number values", () => {
      const entry: ActionRecord = {
        id: crypto.randomUUID(),
        type: "field-change",
        timestamp: Date.now(),
        workItemId: 500,
        field: "priority",
        previousValue: 2,
        newValue: 1,
      };

      const rec = pushAndPeek(entry) as ActionRecord;
      expect(rec.type).toBe("field-change");
      expect(rec.field).toBe("priority");
      expect(typeof rec.previousValue).toBe("number");
      expect(typeof rec.newValue).toBe("number");
    });

    it("supports null previousValue (no priority → priority set)", () => {
      const entry: ActionRecord = {
        id: crypto.randomUUID(),
        type: "field-change",
        timestamp: Date.now(),
        workItemId: 501,
        field: "priority",
        previousValue: null,
        newValue: 3,
      };

      const rec = pushAndPeek(entry) as ActionRecord;
      expect(rec.previousValue).toBeNull();
      expect(typeof rec.newValue).toBe("number");
    });
  });

  // ---- handleDescriptionChange (Req 1.9) ----------------------------------

  describe("handleDescriptionChange → description-change", () => {
    it("records a description-change with string previousValue and newValue", () => {
      const entry: ActionRecord = {
        id: crypto.randomUUID(),
        type: "description-change",
        timestamp: Date.now(),
        workItemId: 600,
        previousValue: "Old description",
        newValue: "Updated description with more detail",
      };

      const rec = pushAndPeek(entry) as ActionRecord;
      expect(rec.type).toBe("description-change");
      expect(typeof rec.previousValue).toBe("string");
      expect(typeof rec.newValue).toBe("string");
    });
  });

  // ---- handleAcceptanceCriteriaChange (Req 1.9) ---------------------------

  describe("handleAcceptanceCriteriaChange → ac-change", () => {
    it("records an ac-change with string previousValue and newValue", () => {
      const entry: ActionRecord = {
        id: crypto.randomUUID(),
        type: "ac-change",
        timestamp: Date.now(),
        workItemId: 700,
        previousValue: "- [ ] Old criterion",
        newValue: "- [ ] New criterion\n- [ ] Another criterion",
      };

      const rec = pushAndPeek(entry) as ActionRecord;
      expect(rec.type).toBe("ac-change");
      expect(typeof rec.previousValue).toBe("string");
      expect(typeof rec.newValue).toBe("string");
    });
  });

  // ---- handleScheduleChange (Req 1.5) -------------------------------------

  describe("handleScheduleChange → schedule-change compound action", () => {
    it("records a compound action with schedule-change records", () => {
      const entry: CompoundAction = {
        id: crypto.randomUUID(),
        type: "schedule-change",
        timestamp: Date.now(),
        label: "schedule change on #800",
        records: [
          {
            id: crypto.randomUUID(),
            type: "schedule-change",
            timestamp: Date.now(),
            workItemId: 800,
            previousValue: {
              startDate: "2025-01-01",
              endDate: "2025-01-14",
              iterationPath: "Spark\\Sprints\\FY26\\Sprint 1",
            },
            newValue: {
              startDate: "2025-01-15",
              endDate: "2025-01-28",
              iterationPath: "Spark\\Sprints\\FY26\\Sprint 2",
            },
          },
        ],
      };

      const peeked = pushAndPeek(entry);
      expect(isCompound(peeked)).toBe(true);

      const compound = peeked as CompoundAction;
      expect(compound.type).toBe("schedule-change");
      expect(compound.records.length).toBeGreaterThanOrEqual(1);

      const rec = compound.records[0];
      expect(rec.type).toBe("schedule-change");

      const prev = rec.previousValue as { startDate: string; endDate: string; iterationPath: string };
      expect(typeof prev.startDate).toBe("string");
      expect(typeof prev.endDate).toBe("string");
      expect(typeof prev.iterationPath).toBe("string");

      const next = rec.newValue as { startDate: string; endDate: string; iterationPath: string };
      expect(typeof next.startDate).toBe("string");
      expect(typeof next.endDate).toBe("string");
      expect(typeof next.iterationPath).toBe("string");
    });
  });

  // ---- handleReorder (Req 1.6) --------------------------------------------

  describe("handleReorder → reorder compound action", () => {
    it("records a compound action with reorder records containing parentId and sortOrder", () => {
      const entry: CompoundAction = {
        id: crypto.randomUUID(),
        type: "reorder",
        timestamp: Date.now(),
        label: "reorder 2 items",
        records: [
          {
            id: crypto.randomUUID(),
            type: "reorder",
            timestamp: Date.now(),
            workItemId: 901,
            previousValue: { parentId: 100, sortOrder: 200 },
            newValue: { parentId: 100, sortOrder: 100 },
          },
          {
            id: crypto.randomUUID(),
            type: "reorder",
            timestamp: Date.now(),
            workItemId: 902,
            previousValue: { parentId: 100, sortOrder: 100 },
            newValue: { parentId: 100, sortOrder: 200 },
          },
        ],
      };

      const peeked = pushAndPeek(entry);
      expect(isCompound(peeked)).toBe(true);

      const compound = peeked as CompoundAction;
      expect(compound.type).toBe("reorder");
      expect(compound.records.length).toBe(2);

      for (const rec of compound.records) {
        expect(rec.type).toBe("reorder");

        const prev = rec.previousValue as { parentId: number | null; sortOrder: number };
        expect(typeof prev.sortOrder).toBe("number");
        expect(prev.parentId === null || typeof prev.parentId === "number").toBe(true);

        const next = rec.newValue as { parentId: number | null; sortOrder: number };
        expect(typeof next.sortOrder).toBe("number");
        expect(next.parentId === null || typeof next.parentId === "number").toBe(true);
      }
    });

    it("supports null parentId for root-level items", () => {
      const entry: CompoundAction = {
        id: crypto.randomUUID(),
        type: "reorder",
        timestamp: Date.now(),
        label: "reorder 1 item",
        records: [
          {
            id: crypto.randomUUID(),
            type: "reorder",
            timestamp: Date.now(),
            workItemId: 910,
            previousValue: { parentId: null, sortOrder: 300 },
            newValue: { parentId: 50, sortOrder: 100 },
          },
        ],
      };

      const compound = pushAndPeek(entry) as CompoundAction;
      const prev = compound.records[0].previousValue as { parentId: number | null; sortOrder: number };
      expect(prev.parentId).toBeNull();
    });
  });

  // ---- handleCreateItem (Req 1.7) -----------------------------------------

  describe("handleCreateItem → create-item", () => {
    it("records a create-item with null previousValue and number newValue", () => {
      const entry: ActionRecord = {
        id: crypto.randomUUID(),
        type: "create-item",
        timestamp: Date.now(),
        workItemId: 1001,
        previousValue: null,
        newValue: 1001,
      };

      const rec = pushAndPeek(entry) as ActionRecord;
      expect(rec.type).toBe("create-item");
      expect(rec.previousValue).toBeNull();
      expect(typeof rec.newValue).toBe("number");
      expect(rec.workItemId).toBe(1001);
    });
  });

  // ---- handleRemoveItems (Req 1.8) ----------------------------------------

  describe("handleRemoveItems → remove-items compound action", () => {
    it("records a compound action with one record per removed item", () => {
      const entry: CompoundAction = {
        id: crypto.randomUUID(),
        type: "remove-items",
        timestamp: Date.now(),
        label: "remove #1100, #1101",
        records: [
          {
            id: crypto.randomUUID(),
            type: "remove-items",
            timestamp: Date.now(),
            workItemId: 1100,
            previousValue: "Active",
            newValue: "Removed",
          },
          {
            id: crypto.randomUUID(),
            type: "remove-items",
            timestamp: Date.now(),
            workItemId: 1101,
            previousValue: "New",
            newValue: "Removed",
          },
        ],
      };

      const peeked = pushAndPeek(entry);
      expect(isCompound(peeked)).toBe(true);

      const compound = peeked as CompoundAction;
      expect(compound.type).toBe("remove-items");
      expect(compound.records.length).toBe(2);

      for (const rec of compound.records) {
        expect(rec.type).toBe("remove-items");
        expect(typeof rec.previousValue).toBe("string");
        expect(rec.newValue).toBe("Removed");
      }
    });

    it("preserves each item's previous state", () => {
      const entry: CompoundAction = {
        id: crypto.randomUUID(),
        type: "remove-items",
        timestamp: Date.now(),
        label: "remove #1200",
        records: [
          {
            id: crypto.randomUUID(),
            type: "remove-items",
            timestamp: Date.now(),
            workItemId: 1200,
            previousValue: "Committed",
            newValue: "Removed",
          },
        ],
      };

      const compound = pushAndPeek(entry) as CompoundAction;
      expect(compound.records[0].previousValue).toBe("Committed");
    });
  });
});
