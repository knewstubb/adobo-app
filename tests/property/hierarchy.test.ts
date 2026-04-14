import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { CHILD_TYPE_MAP, SUMMARY_TYPES, LEAF_TYPES, getChildType } from "@/lib/hierarchy";

/**
 * Property 3: Child type mapping consistency across views
 *
 * For any summary work item type, the child type produced by the Gantt
 * Plus_Button, the List view Plus_Button, and the Context_Menu SHALL all
 * be identical and equal to CHILD_TYPE_MAP[parentType].
 *
 * Since all three views (GanttChart, ListView, ContextMenu) now import
 * from the same hierarchy.ts module, this test verifies that getChildType
 * returns the expected child type for each summary type and null for leaf types.
 *
 * **Validates: Requirements 3.3, 4.3, 8.1, 8.2, 8.3, 8.4**
 */

const ALL_WORK_ITEM_TYPES = [
  "Initiative",
  "Epic",
  "Feature",
  "Product Backlog Item",
  "Bug",
  "Task",
  "User Story",
];

/** Arbitrary that produces any known work-item type or a random string. */
const arbWorkItemType = fc.oneof(
  fc.constantFrom(...ALL_WORK_ITEM_TYPES),
  fc.string({ minLength: 1, maxLength: 30 }),
);

describe("P3: Child type mapping consistency across views", () => {
  it("getChildType matches CHILD_TYPE_MAP for every summary type", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Array.from(SUMMARY_TYPES)),
        (summaryType) => {
          const expected = CHILD_TYPE_MAP[summaryType];
          const actual = getChildType(summaryType);

          // getChildType must return the same value as a direct CHILD_TYPE_MAP lookup
          expect(actual).toBe(expected);
          // The value must be non-null for summary types
          expect(actual).not.toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("getChildType returns null for all leaf types", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Array.from(LEAF_TYPES)),
        (leafType) => {
          expect(getChildType(leafType)).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("getChildType returns null for arbitrary non-summary types", () => {
    // Filter out JS prototype keys like "__proto__" which have special behaviour on plain objects
    const safeNonSummary = arbWorkItemType
      .filter((t) => !SUMMARY_TYPES.has(t))
      .filter((t) => !["__proto__", "constructor", "toString", "valueOf"].includes(t));
    fc.assert(
      fc.property(
        safeNonSummary,
        (type) => {
          expect(getChildType(type)).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("CHILD_TYPE_MAP keys are exactly the SUMMARY_TYPES set", () => {
    const mapKeys = new Set(Object.keys(CHILD_TYPE_MAP));
    expect(mapKeys).toEqual(SUMMARY_TYPES);
  });

  it("every SUMMARY_TYPE has a corresponding CHILD_TYPE_MAP entry", () => {
    for (const st of SUMMARY_TYPES) {
      expect(CHILD_TYPE_MAP[st]).toBeDefined();
      expect(getChildType(st)).toBe(CHILD_TYPE_MAP[st]);
    }
  });
});
