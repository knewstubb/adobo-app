import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import type { WorkItem, SavedView, FilterState, GroupingDimension } from "@/lib/types";
import {
  upsertWorkItems,
  getAllWorkItems,
  getWorkItemById,
  updateWorkItemField,
  deleteWorkItemsNotIn,
  getDB,
  _resetDB,
  createSavedView,
  getSavedViews,
  updateSavedView,
  deleteSavedView,
} from "@/lib/idb-cache";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clear work item data from the DB without deleting/recreating it. */
async function clearStores(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["workItems", "workItemTags"], "readwrite");
  await tx.objectStore("workItems").clear();
  await tx.objectStore("workItemTags").clear();
  await tx.done;
}

/** Clear saved views store between iterations. */
async function clearSavedViews(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("savedViews", "readwrite");
  await tx.objectStore("savedViews").clear();
  await tx.done;
}

/** Normalise a Date through ISO round-trip (drops sub-ms precision). */
function normaliseDate(d: Date): string {
  return new Date(d.toISOString()).toISOString();
}

/** Normalise a nullable Date field. */
function normaliseDateOrNull(d: Date | null): string | null {
  return d ? normaliseDate(d) : null;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary that produces a valid Date (finite, non-NaN) with ms precision. */
const arbDate: fc.Arbitrary<Date> = fc
  .integer({ min: 946684800000, max: 4102444800000 }) // 2000-01-01 to 2099-12-31 in epoch ms
  .map((ms) => new Date(ms));

const arbNullableDate: fc.Arbitrary<Date | null> = fc.option(arbDate, { nil: null });

const arbNullableString: fc.Arbitrary<string | null> = fc.option(fc.string(), { nil: null });

const arbNullableNumber: fc.Arbitrary<number | null> = fc.option(fc.integer(), { nil: null });

/** Arbitrary for a single WorkItem given a specific id. */
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

/**
 * Generate an array of WorkItems with unique IDs.
 * Uses uniqueArray of positive integers for IDs, then maps each to a full WorkItem.
 */
const arbWorkItems: fc.Arbitrary<WorkItem[]> = fc
  .uniqueArray(fc.integer({ min: 1, max: 100_000 }), { minLength: 1, maxLength: 20 })
  .chain((ids) => fc.tuple(...ids.map((id) => arbWorkItemWithId(id))));

// ---------------------------------------------------------------------------
// Saved View Arbitraries
// ---------------------------------------------------------------------------

const arbFilterState: fc.Arbitrary<FilterState> = fc.record({
  states: fc.option(fc.array(fc.string({ minLength: 1 }), { maxLength: 3 }), { nil: undefined }),
  iterationPaths: fc.option(fc.array(fc.string({ minLength: 1 }), { maxLength: 3 }), { nil: undefined }),
  assignedTo: fc.option(fc.array(fc.string({ minLength: 1 }), { maxLength: 3 }), { nil: undefined }),
  epicIds: fc.option(fc.array(fc.integer({ min: 1 }), { maxLength: 3 }), { nil: undefined }),
  featureIds: fc.option(fc.array(fc.integer({ min: 1 }), { maxLength: 3 }), { nil: undefined }),
  initiativeIds: fc.option(fc.array(fc.integer({ min: 1 }), { maxLength: 3 }), { nil: undefined }),
});

const arbGrouping: fc.Arbitrary<GroupingDimension | null> = fc.option(
  fc.constantFrom<GroupingDimension>("person", "feature", "epic", "custom"),
  { nil: null }
);

/** Arbitrary for a saved view config (without id, createdAt, updatedAt). */
const arbSavedViewConfig: fc.Arbitrary<Omit<SavedView, "id" | "createdAt" | "updatedAt">> =
  fc.record({
    name: fc.string({ minLength: 1, maxLength: 50 }),
    filterState: arbFilterState,
    grouping: arbGrouping,
    showDone: fc.boolean(),
    iterationViewMode: fc.boolean(),
    selectedIterationPath: fc.option(fc.string({ minLength: 1 }), { nil: null }),
    sortOrder: fc.integer({ min: 0, max: 1000 }),
    isDefault: fc.constant(false), // non-default so delete works
  });

// ---------------------------------------------------------------------------
// Property 3: Work item bulk upsert round-trip
// ---------------------------------------------------------------------------

describe("IndexedDB Cache — Property Tests", () => {
  beforeEach(async () => {
    await clearStores();
  });

  describe("Property 3: Work item bulk upsert round-trip", () => {
    /**
     * **Validates: Requirements 2.2**
     *
     * For any array of valid WorkItem objects with unique IDs, upserting them
     * into IndexedDB via upsertWorkItems() and reading them back via
     * getAllWorkItems() should return a set of items where every original item
     * is present and all fields match (after date serialisation normalisation).
     */
    it("upsertWorkItems then getAllWorkItems round-trips all items", { timeout: 60_000 }, async () => {
      await fc.assert(
        fc.asyncProperty(arbWorkItems, async (items) => {
          // Clear stores for each iteration to avoid cross-contamination
          await clearStores();

          // Upsert
          await upsertWorkItems(items);

          // Read back
          const retrieved = await getAllWorkItems();

          // Same count
          expect(retrieved.length).toBe(items.length);

          // Build a lookup by id for easy comparison
          const retrievedById = new Map(retrieved.map((r) => [r.id, r]));

          for (const original of items) {
            const found = retrievedById.get(original.id);
            expect(found).toBeDefined();
            if (!found) continue;

            // Compare non-date fields directly
            expect(found.id).toBe(original.id);
            expect(found.title).toBe(original.title);
            expect(found.state).toBe(original.state);
            expect(found.assignedTo).toBe(original.assignedTo);
            expect(found.iterationPath).toBe(original.iterationPath);
            expect(found.areaPath).toBe(original.areaPath);
            expect(found.workItemType).toBe(original.workItemType);
            expect(found.description).toBe(original.description);
            expect(found.acceptanceCriteria).toBe(original.acceptanceCriteria);
            expect(found.parentId).toBe(original.parentId);
            expect(found.initiativeId).toBe(original.initiativeId);
            expect(found.epicId).toBe(original.epicId);
            expect(found.featureId).toBe(original.featureId);
            expect(found.tags).toEqual(original.tags);
            expect(found.stackRank).toBe(original.stackRank);
            expect(found.localSortOrder).toBe(original.localSortOrder);
            expect(found.effort).toBe(original.effort);
            expect(found.priority).toBe(original.priority);

            // Compare date fields after ISO normalisation
            expect(normaliseDateOrNull(found.adoChangedDate)).toBe(
              normaliseDateOrNull(original.adoChangedDate)
            );
            expect(normaliseDate(found.cachedAt)).toBe(
              normaliseDate(original.cachedAt)
            );
            expect(normaliseDateOrNull(found.localStartDate)).toBe(
              normaliseDateOrNull(original.localStartDate)
            );
            expect(normaliseDateOrNull(found.localEndDate)).toBe(
              normaliseDateOrNull(original.localEndDate)
            );
          }
        }),
        { numRuns: 100 }
      );
    });
  });

  describe("Property 4: Saved view CRUD round-trip", () => {
    beforeEach(async () => {
      await clearSavedViews();
    });

    /**
     * **Validates: Requirements 2.4**
     *
     * For any valid saved view configuration, creating it via createSavedView()
     * and reading back via getSavedViews() should return a view with matching
     * config fields. Updating a field and reading back should reflect the update.
     * Deleting and reading back should exclude the deleted view.
     */
    it("create → read → update → read → delete → read round-trips correctly", { timeout: 60_000 }, async () => {
      await fc.assert(
        fc.asyncProperty(
          arbSavedViewConfig,
          fc.string({ minLength: 1, maxLength: 50 }),
          async (config, updatedName) => {
            await clearSavedViews();

            // --- CREATE ---
            const created = await createSavedView(config);

            // created should have an id and timestamps
            expect(created.id).toBeTruthy();
            expect(created.createdAt).toBeInstanceOf(Date);
            expect(created.updatedAt).toBeInstanceOf(Date);

            // --- READ after create ---
            const viewsAfterCreate = await getSavedViews();
            const found = viewsAfterCreate.find((v) => v.id === created.id);
            expect(found).toBeDefined();
            if (!found) return;

            // Assert config fields match
            expect(found.name).toBe(config.name);
            expect(found.filterState).toEqual(config.filterState);
            expect(found.grouping).toBe(config.grouping);
            expect(found.showDone).toBe(config.showDone);
            expect(found.iterationViewMode).toBe(config.iterationViewMode);
            expect(found.selectedIterationPath).toBe(config.selectedIterationPath);
            expect(found.sortOrder).toBe(config.sortOrder);
            expect(found.isDefault).toBe(config.isDefault);

            // --- UPDATE ---
            const updated = await updateSavedView(created.id, { name: updatedName });
            expect(updated.name).toBe(updatedName);

            // --- READ after update ---
            const viewsAfterUpdate = await getSavedViews();
            const foundUpdated = viewsAfterUpdate.find((v) => v.id === created.id);
            expect(foundUpdated).toBeDefined();
            if (!foundUpdated) return;
            expect(foundUpdated.name).toBe(updatedName);
            // Other fields should remain unchanged
            expect(foundUpdated.showDone).toBe(config.showDone);
            expect(foundUpdated.grouping).toBe(config.grouping);

            // --- DELETE ---
            await deleteSavedView(created.id);

            // --- READ after delete ---
            const viewsAfterDelete = await getSavedViews();
            const foundDeleted = viewsAfterDelete.find((v) => v.id === created.id);
            expect(foundDeleted).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("Property 5: IndexedDB upsert is last-write-wins", () => {
    beforeEach(async () => {
      await clearStores();
    });

    /**
     * **Validates: Requirements 5.1, 5.5, 9.3**
     *
     * For any work item stored in IndexedDB and for any field update applied
     * via updateWorkItemField(), reading the item back should reflect the most
     * recently written value. If the same item is upserted twice with different
     * values for a field, the second value wins.
     */
    it("updateWorkItemField overwrites the previous value and getWorkItemById returns the latest", { timeout: 60_000 }, async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100_000 }),
          fc.string({ minLength: 1 }),
          async (id, newTitle) => {
            await clearStores();

            // Generate and store an initial work item
            const initial = await fc.sample(arbWorkItemWithId(id), 1)[0];
            await upsertWorkItems([initial]);

            // Update the title field
            await updateWorkItemField(id, "title", newTitle);

            // Read back
            const retrieved = await getWorkItemById(id);
            expect(retrieved).not.toBeNull();
            expect(retrieved!.title).toBe(newTitle);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("upserting the same item twice with different titles results in the second title winning", { timeout: 60_000 }, async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 100_000 }),
          async (id) => {
            await clearStores();

            // Generate two different work items with the same ID but different titles
            const [first, second] = fc.sample(
              fc.tuple(arbWorkItemWithId(id), arbWorkItemWithId(id)),
              1
            )[0];

            // Upsert first version
            await upsertWorkItems([first]);

            // Upsert second version (same ID, potentially different fields)
            await upsertWorkItems([second]);

            // Read back — second write should win
            const retrieved = await getWorkItemById(id);
            expect(retrieved).not.toBeNull();
            expect(retrieved!.title).toBe(second.title);
            expect(retrieved!.state).toBe(second.state);
            expect(retrieved!.assignedTo).toBe(second.assignedTo);
            expect(retrieved!.workItemType).toBe(second.workItemType);
            expect(retrieved!.effort).toBe(second.effort);
            expect(retrieved!.priority).toBe(second.priority);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("Property 7: Stale item deletion correctness", () => {
    beforeEach(async () => {
      await clearStores();
    });

    /**
     * **Validates: Requirements 4.8, 9.5**
     *
     * For any set of work items currently in IndexedDB and for any set of
     * "valid IDs" (representing the ADO response), calling
     * deleteWorkItemsNotIn(validIds) should result in IndexedDB containing
     * exactly the items whose IDs are in the valid set. Items not in the valid
     * set should be removed; items in the valid set should be preserved.
     */
    it("deleteWorkItemsNotIn keeps exactly the valid IDs and removes the rest", { timeout: 60_000 }, async () => {
      await fc.assert(
        fc.asyncProperty(arbWorkItems, async (items) => {
          await clearStores();

          // Upsert all items into IndexedDB
          await upsertWorkItems(items);

          // Pick a random subset of IDs as "valid IDs"
          const allIds = items.map((i) => i.id);
          const validIds = fc.sample(
            fc.subarray(allIds, { minLength: 0, maxLength: allIds.length }),
            1
          )[0];
          const validSet = new Set(validIds);

          // Delete stale items
          const deletedCount = await deleteWorkItemsNotIn(validIds);

          // Read back all remaining items
          const remaining = await getAllWorkItems();
          const remainingIds = new Set(remaining.map((r) => r.id));

          // The number of deleted items should equal total minus valid
          const expectedDeleted = allIds.filter((id) => !validSet.has(id)).length;
          expect(deletedCount).toBe(expectedDeleted);

          // Remaining items should be exactly the valid set
          expect(remainingIds.size).toBe(validSet.size);
          for (const id of validSet) {
            expect(remainingIds.has(id)).toBe(true);
          }

          // No extra items should exist
          for (const id of remainingIds) {
            expect(validSet.has(id)).toBe(true);
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});
