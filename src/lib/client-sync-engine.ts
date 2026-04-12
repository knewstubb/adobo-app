/**
 * Client Sync Engine
 *
 * Browser-side replacement for the server-side sync-engine.ts.
 * Runs entirely in the browser using setInterval + Page Visibility API.
 * Fetches data from ADO, upserts into IndexedDB, and notifies the UI.
 */

import { getCredentials } from "./credential-store";
import * as ado from "./ado-connector";
import * as idb from "./idb-cache";
import type { WorkItem } from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SyncEngineConfig {
  intervalMs?: number; // default 300_000 (5 min)
}

export interface SyncResult {
  success: boolean;
  itemsSynced: number;
  error?: string;
  skipped?: boolean; // true if sync was skipped because already running
}

export type SyncStatus = "idle" | "running" | "error";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 300_000; // 5 min

let intervalTimer: ReturnType<typeof setInterval> | null = null;
let currentStatus: SyncStatus = "idle";
let isRunning = false;
let lastSyncTime: number = 0; // epoch ms of last successful sync
const listeners: Set<(result: SyncResult) => void> = new Set();
let visibilityHandler: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Auto-tag logic
// ---------------------------------------------------------------------------

const DONE_TAG = "-Done";
const DONE_STATES = new Set(["Done", "Removed"]);

/**
 * Auto-tag PBIs where all child Tasks (excluding tasks named "test") are
 * Done or Removed. Adds the "-Done" tag if the condition is met, removes
 * it if not. Uses the user's credentials for ADO write-back.
 */
async function autoTagCompletedPBIs(allItems: WorkItem[]): Promise<void> {
  const creds = getCredentials();
  if (!creds) return;

  try {
    // Build parent→children map for Tasks only
    const tasksByParent = new Map<number, WorkItem[]>();
    for (const item of allItems) {
      if (item.workItemType === "Task" && item.parentId) {
        if (!tasksByParent.has(item.parentId)) tasksByParent.set(item.parentId, []);
        tasksByParent.get(item.parentId)!.push(item);
      }
    }

    // Check each PBI/Bug that has child tasks
    for (const item of allItems) {
      if (item.workItemType !== "Product Backlog Item" && item.workItemType !== "Bug") continue;
      const tasks = tasksByParent.get(item.id);
      if (!tasks || tasks.length === 0) continue;

      // Filter out tasks named "test" (case-insensitive)
      const relevantTasks = tasks.filter(t => t.title.toLowerCase() !== "test");
      if (relevantTasks.length === 0) continue;

      const allDone = relevantTasks.every(t => DONE_STATES.has(t.state));
      const hasTag = item.tags.includes(DONE_TAG);

      if (allDone && !hasTag) {
        const newTags = [...item.tags, DONE_TAG];
        await ado.updateWorkItemTags(creds, item.id, newTags);
        // Also update local cache
        item.tags = newTags;
      } else if (!allDone && hasTag) {
        const newTags = item.tags.filter(t => t !== DONE_TAG);
        await ado.updateWorkItemTags(creds, item.id, newTags);
        item.tags = newTags;
      }
    }
  } catch (err) {
    console.error("[auto-tag] Failed to auto-tag PBIs:", err);
    // Non-fatal — don't break the sync
  }
}

// ---------------------------------------------------------------------------
// Core sync
// ---------------------------------------------------------------------------

export async function performSync(): Promise<SyncResult> {
  // Guard: prevent concurrent syncs
  if (isRunning) {
    return { success: true, itemsSynced: 0, skipped: true };
  }

  const creds = getCredentials();
  if (!creds) {
    return { success: false, itemsSynced: 0, error: "No credentials stored" };
  }

  isRunning = true;
  currentStatus = "running";

  try {
    await idb.updateSyncMetadata({ status: "running" });

    // Read configured area paths from IndexedDB
    const areaPaths = await idb.getSyncAreaPaths();

    // Fetch all data from ADO in parallel
    const [workItems, iterations, teamMembers, backlogOrderMap] = await Promise.all([
      ado.fetchWorkItems(creds, areaPaths.length > 0 ? areaPaths : undefined),
      ado.fetchIterations(creds),
      ado.fetchTeamMembers(creds),
      ado.fetchAllBacklogOrders(creds),
    ]);

    // Apply backlog order — this is the source of truth for display order
    for (const item of workItems) {
      const order = backlogOrderMap.get(item.id);
      if (order !== undefined) {
        item.localSortOrder = order;
      }
    }

    // Filter out any Removed items defensively
    const validItems = workItems.filter(wi => wi.state !== "Removed");

    // Keep iterations that have dates
    const relevantIterations = iterations.filter(i => i.startDate && i.endDate);

    // Upsert into IndexedDB
    await idb.upsertWorkItems(validItems);

    // Delete stale items not in ADO response
    const validIds = validItems.map(wi => wi.id);
    await idb.deleteWorkItemsNotIn(validIds);

    // Upsert iterations and team members
    await idb.upsertIterations(relevantIterations);
    await idb.upsertTeamMembers(teamMembers);

    // Auto-tag completed PBIs
    await autoTagCompletedPBIs(validItems);

    // Update sync metadata
    const now = new Date();
    await idb.updateSyncMetadata({
      status: "idle",
      lastSyncAt: now,
      itemsSynced: validItems.length,
      lastError: null,
    });

    lastSyncTime = Date.now();
    currentStatus = "idle";

    const result: SyncResult = {
      success: true,
      itemsSynced: validItems.length,
    };

    notifyListeners(result);
    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown sync error";
    currentStatus = "error";

    await idb.updateSyncMetadata({
      status: "error",
      lastError: errorMessage,
    }).catch(() => {
      console.error("Failed to update sync metadata after error:", errorMessage);
    });

    const result: SyncResult = {
      success: false,
      itemsSynced: 0,
      error: errorMessage,
    };

    notifyListeners(result);
    return result;
  } finally {
    isRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Engine lifecycle
// ---------------------------------------------------------------------------

export function startSyncEngine(config?: SyncEngineConfig): void {
  const intervalMs = config?.intervalMs ?? DEFAULT_INTERVAL_MS;

  // Perform initial sync immediately
  performSync().catch(err => {
    console.error("Initial sync failed:", err);
  });

  // Set up periodic sync
  if (intervalTimer) clearInterval(intervalTimer);
  intervalTimer = setInterval(() => {
    performSync().catch(err => {
      console.error("Periodic sync failed:", err);
    });
  }, intervalMs);

  // Set up visibility change listener
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
  }
  visibilityHandler = () => {
    if (document.visibilityState === "visible") {
      const elapsed = Date.now() - lastSyncTime;
      if (elapsed >= DEFAULT_INTERVAL_MS) {
        performSync().catch(err => {
          console.error("Visibility sync failed:", err);
        });
      }
    }
  };
  document.addEventListener("visibilitychange", visibilityHandler);
}

export function stopSyncEngine(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
}

// ---------------------------------------------------------------------------
// Status & callbacks
// ---------------------------------------------------------------------------

export function getSyncStatus(): SyncStatus {
  return currentStatus;
}

/**
 * Register a callback that fires after every sync completes.
 * Returns an unsubscribe function.
 */
export function onSyncComplete(callback: (result: SyncResult) => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function notifyListeners(result: SyncResult): void {
  for (const cb of listeners) {
    try {
      cb(result);
    } catch (err) {
      console.error("Sync complete callback error:", err);
    }
  }
}
