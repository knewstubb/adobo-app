import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";
import type { WorkItem } from "@/lib/types";
import {
  upsertWorkItems,
  getWorkItemById,
  getDB,
  _resetDB,
} from "@/lib/idb-cache";

/**
 * **Validates: Requirements 5.3**
 *
 * Property 6: Write-back rollback restores previous value
 *
 * For any work item in IndexedDB, for any field, and for any new value,
 * if the optimistic update succeeds but the subsequent ADO API call fails,
 * then after rollback the field value in IndexedDB should equal the original
 * value before the update was attempted.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/credential-store", () => ({
  getCredentials: () => ({
    org: "test-org",
    project: "test-project",
    team: "test-team",
    pat: "test-pat",
  }),
  setCredentials: vi.fn(),
  clearCredentials: vi.fn(),
  hasCredentials: () => true,
}));

vi.mock("@/lib/ado-connector", () => ({
  updateWorkItemField: vi.fn(() => {
    throw new Error("Simulated ADO failure");
  }),
  updateWorkItemTags: vi.fn(() => {
    throw new Error("Simulated ADO failure");
  }),
  fetchWorkItems: vi.fn(() => Promise.resolve([])),
  fetchIterations: vi.fn(() => Promise.resolve([])),
  fetchTeamMembers: vi.fn(() => Promise.resolve([])),
  fetchAllBacklogOrders: vi.fn(() => Promise.resolve(new Map())),
  reorderWorkItems: vi.fn(() => Promise.resolve(true)),
  createWorkItem: vi.fn(() => Promise.resolve({ id: 1 })),
  updateWorkItemParent: vi.fn(() => Promise.resolve()),
}));

// Import after mocks are established
import { updateField } from "@/lib/client-write-back";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbDate: fc.Arbitrary<Date> = fc
  .integer({ min: 946684800000, max: 4102444800000 })
  .map((ms) => new Date(ms));

const arbNullableDate: fc.Arbitrary<Date | null> = fc.option(arbDate, { nil: null });
const arbNullableString: fc.Arbitrary<string | null> = fc.option(fc.string(), { nil: null });
const arbNullableNumber: fc.Arbitrary<number | null> = fc.option(fc.integer(), { nil: null });

function arbWorkItemWithId(id: number): fc.Arbitrary<WorkItem> {
  return fc.record({
    id: fc.constant(id),
    title: fc.string({ minLength: 1 }),
    state: fc.string({ minLength: 1 }),
    assignedTo: arbNullableString,
    iterationPath: arbNullableString,
    areaPath: arbNullableString,
    workItemType: fc.string({ minLength: 1 }),
    description: arbNullableString,
    acceptanceCriteria: arbNullableString,
    parentId: arbNullableNumber,
    initiativeId: arbNullableNumber,
    epicId: arbNullableNumber,
    featureId: arbNullableNumber,
    tags: fc.array(fc.string({ minLength: 1 }), { maxLength: 5 }),
    stackRank: arbNullableNumber,
    adoChangedDate: arbNullableDate,
    cachedAt: arbDate,
    localSortOrder: fc.integer(),
    localStartDate: arbNullableDate,
    localEndDate: arbNullableDate,
    effort: arbNullableNumber,
    priority: arbNullableNumber,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Client Write-Back — Property Tests", () => {
  beforeEach(async () => {
    _resetDB();
    await getDB();
  });

  describe("Property 6: Write-back rollback restores previous value", () => {
    it(
      "updateField rolls back to the original title in IndexedDB when ADO call fails",
      { timeout: 120_000 },
      async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.integer({ min: 1, max: 100_000 }),
            fc.string({ minLength: 1 }),
            async (id, newTitle) => {
              // Reset DB for each iteration
              _resetDB();
              await getDB();

              // 1. Generate and store a work item with a known title
              const workItem = fc.sample(arbWorkItemWithId(id), 1)[0];
              const originalTitle = workItem.title;
              await upsertWorkItems([workItem]);

              // 2. Call updateField — ADO is mocked to throw, so rollback should occur
              const result = await updateField(id, "title", newTitle, originalTitle);

              // 3. The write should have failed
              expect(result.success).toBe(false);
              expect(result.error).toBeDefined();

              // 4. The title in IndexedDB should be rolled back to the original
              const retrieved = await getWorkItemById(id);
              expect(retrieved).not.toBeNull();
              expect(retrieved!.title).toBe(originalTitle);
            }
          ),
          { numRuns: 100 }
        );
      }
    );
  });
});
