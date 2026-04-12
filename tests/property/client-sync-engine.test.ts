import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";
import { _resetDB, getDB, getSyncMetadata, getAllWorkItems } from "@/lib/idb-cache";

/**
 * **Validates: Requirements 4.6**
 *
 * Property 8: Concurrent sync prevention
 *
 * For any sequence of performSync() calls initiated while a sync is already
 * in progress, at most one sync should execute at a time. The second call
 * should return immediately with a "sync already in progress" result
 * (skipped: true) without modifying sync metadata or IndexedDB state.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Each call to fetchWorkItems creates a new controllable promise.
let fetchResolvers: Array<(items: never[]) => void> = [];
let fetchWorkItemsCallCount = 0;

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
  fetchWorkItems: vi.fn((): Promise<never[]> => {
    fetchWorkItemsCallCount++;
    return new Promise<never[]>((resolve) => {
      fetchResolvers.push(resolve);
    });
  }),
  fetchIterations: vi.fn(() => Promise.resolve([])),
  fetchTeamMembers: vi.fn(() => Promise.resolve([])),
  fetchAllBacklogOrders: vi.fn(() => Promise.resolve(new Map())),
  updateWorkItemTags: vi.fn(() => Promise.resolve()),
}));

// Import after mocks are established
import { performSync, getSyncStatus } from "@/lib/client-sync-engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush microtasks and pending IndexedDB operations */
async function flushAsync(): Promise<void> {
  // Multiple yields to let IndexedDB transactions and promise chains settle
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Client Sync Engine — Property Tests", () => {
  beforeEach(async () => {
    _resetDB();
    await getDB();
    fetchResolvers = [];
    fetchWorkItemsCallCount = 0;
  });

  describe("Property 8: Concurrent sync prevention", () => {
    it(
      "a second performSync() call while sync is running returns skipped:true without modifying state",
      { timeout: 120_000 },
      async () => {
        // Use fc.sample to generate arbitrary inputs, then run iterations
        // sequentially to ensure module-level isRunning state is clean.
        const NUM_RUNS = 100;
        const samples = fc.sample(
          fc.tuple(
            fc.integer({ min: 1, max: 500 }),
            fc.integer({ min: 0, max: 50 })
          ),
          NUM_RUNS
        );

        for (const [_delayMs, _workItemCount] of samples) {
          // Reset state for this iteration
          _resetDB();
          await getDB();
          fetchResolvers = [];
          fetchWorkItemsCallCount = 0;

          // Snapshot IndexedDB state before any sync
          const workItemsBefore = await getAllWorkItems();

          // 1. Start the first sync — it sets isRunning = true synchronously,
          //    then suspends at the first await (updateSyncMetadata).
          const firstSyncPromise = performSync();

          // 2. Flush async to let the first sync progress past its initial
          //    awaits (metadata write, area paths read) and into the
          //    fetchWorkItems call where it will block on our mock.
          await flushAsync();

          // The engine should now be in running state with fetchWorkItems blocked
          expect(getSyncStatus()).toBe("running");
          expect(fetchWorkItemsCallCount).toBe(1);

          // Snapshot sync metadata while first sync is in progress
          const metaDuring = await getSyncMetadata();

          // 3. Call performSync() again — should be skipped immediately
          const secondResult = await performSync();

          // 4. Assert the second call returned with skipped: true
          expect(secondResult).toEqual({
            success: true,
            itemsSynced: 0,
            skipped: true,
          });

          // 5. Assert sync metadata was NOT modified by the second call
          const metaAfterSecondCall = await getSyncMetadata();
          expect(metaAfterSecondCall.status).toBe(metaDuring.status);
          expect(metaAfterSecondCall.itemsSynced).toBe(metaDuring.itemsSynced);

          // 6. Assert IndexedDB work items were NOT modified by the second call
          const workItemsDuring = await getAllWorkItems();
          expect(workItemsDuring.length).toBe(workItemsBefore.length);

          // 7. fetchWorkItems was called exactly once — the second call
          //    never reached the ADO fetch layer
          expect(fetchWorkItemsCallCount).toBe(1);

          // 8. Resolve the first sync so it completes
          fetchResolvers[0]([] as never[]);
          const firstResult = await firstSyncPromise;

          // 9. Assert the first sync completed successfully
          expect(firstResult.success).toBe(true);
          expect(firstResult.skipped).toBeUndefined();

          // 10. Final sync metadata reflects the completed first sync
          const metaAfter = await getSyncMetadata();
          expect(metaAfter.status).toBe("idle");
          expect(metaAfter.lastError).toBeNull();

          // Engine is idle, ready for next iteration
          expect(getSyncStatus()).toBe("idle");
        }
      }
    );
  });
});
