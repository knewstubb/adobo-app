import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { SUMMARY_TYPES, getChildType } from "@/lib/hierarchy";

/**
 * Property 2: Plus_Button rendered iff workItemType is in SUMMARY_TYPES
 *
 * For any work item type, a Plus_Button should be present on the Gantt sidebar
 * row if and only if the item's workItemType is in SUMMARY_TYPES and
 * getChildType returns a non-null value.
 *
 * **Validates: Requirements 3.1, 3.6**
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

/** Arbitrary that produces any known work-item type or a random string.
 *  Filters out JS prototype keys (e.g. "constructor", "valueOf") which exist
 *  on plain objects and would produce false positives in CHILD_TYPE_MAP lookups. */
const arbWorkItemType = fc.oneof(
  fc.constantFrom(...ALL_WORK_ITEM_TYPES),
  fc.string({ minLength: 1, maxLength: 30 }).filter(
    (t) => !["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString"].includes(t),
  ),
);

describe("P2: Plus_Button rendered iff workItemType is in SUMMARY_TYPES", () => {
  it("should show Plus_Button only for summary types", () => {
    fc.assert(
      fc.property(arbWorkItemType, (type) => {
        const isSummary = SUMMARY_TYPES.has(type);
        const childType = getChildType(type);

        // Plus_Button is rendered iff the type is a summary type
        // (which also means getChildType returns non-null)
        if (isSummary) {
          expect(childType).not.toBeNull();
        } else {
          expect(childType).toBeNull();
        }

        // The biconditional: SUMMARY_TYPES.has(type) ↔ getChildType(type) !== null
        expect(isSummary).toBe(childType !== null);
      }),
      { numRuns: 200 },
    );
  });
});
