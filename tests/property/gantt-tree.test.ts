import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { WorkItem, Iteration } from "@/lib/types";
import { buildGanttTree, flattenGanttTree } from "@/lib/gantt-tree";

/**
 * **Validates: Requirements 1.1, 1.2, 1.3**
 *
 * Property 1: Flattened tree contains no add-rows
 * For any valid set of work items and collapsed-ID set,
 * `flattenGanttTree` returns only entries where `type === "item"`
 * and zero entries where `type === "add"`.
 */

const WORK_ITEM_TYPES = ["Initiative", "Epic", "Feature", "Product Backlog Item", "Bug"];

/** Arbitrary that generates a minimal WorkItem with a given id and optional parentId */
function arbWorkItem(id: number, parentId: number | null, workItemType: string): WorkItem {
  return {
    id,
    title: `Item ${id}`,
    state: "New",
    assignedTo: null,
    iterationPath: null,
    areaPath: null,
    workItemType,
    description: null,
    acceptanceCriteria: null,
    parentId,
    initiativeId: null,
    epicId: null,
    featureId: null,
    tags: [],
    stackRank: null,
    adoChangedDate: null,
    cachedAt: new Date(),
    localSortOrder: id,
    localStartDate: null,
    localEndDate: null,
    effort: null,
    priority: null,
  };
}

/**
 * Generates a random work item hierarchy.
 * Returns an array of WorkItems forming a valid parent-child tree.
 */
const arbWorkItemHierarchy: fc.Arbitrary<WorkItem[]> = fc
  .tuple(
    fc.integer({ min: 0, max: 5 }), // number of initiatives
    fc.integer({ min: 0, max: 5 }), // epics per initiative
    fc.integer({ min: 0, max: 5 }), // features per epic
    fc.integer({ min: 0, max: 5 })  // PBIs per feature
  )
  .map(([numInit, epicsPerInit, featPerEpic, pbisPerFeat]) => {
    const items: WorkItem[] = [];
    let nextId = 1;

    for (let i = 0; i < numInit; i++) {
      const initId = nextId++;
      items.push(arbWorkItem(initId, null, "Initiative"));

      for (let e = 0; e < epicsPerInit; e++) {
        const epicId = nextId++;
        items.push(arbWorkItem(epicId, initId, "Epic"));

        for (let f = 0; f < featPerEpic; f++) {
          const featId = nextId++;
          items.push(arbWorkItem(featId, epicId, "Feature"));

          for (let p = 0; p < pbisPerFeat; p++) {
            const pbiId = nextId++;
            items.push(arbWorkItem(pbiId, featId, "Product Backlog Item"));
          }
        }
      }
    }

    return items;
  });

/** Generates a collapsed set from a list of work items (random subset of IDs) */
function arbCollapsedSet(items: WorkItem[]): fc.Arbitrary<Set<number>> {
  if (items.length === 0) return fc.constant(new Set<number>());
  return fc
    .subarray(items.map((i) => i.id))
    .map((ids) => new Set(ids));
}

describe("Gantt Tree — Property Tests", () => {
  it("P1: flattenGanttTree returns zero type='add' entries for any hierarchy and collapsed set", () => {
    fc.assert(
      fc.property(
        arbWorkItemHierarchy.chain((items) =>
          arbCollapsedSet(items).map((collapsed) => ({ items, collapsed }))
        ),
        ({ items, collapsed }) => {
          const tree = buildGanttTree(items, [], null, true);
          const flat = flattenGanttTree(tree, collapsed);

          // Every entry must be type "item"
          for (const row of flat) {
            expect(row.type).toBe("item");
          }

          // Explicitly check no "add" entries exist
          const addRows = flat.filter((r) => (r as { type: string }).type === "add");
          expect(addRows).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
