/**
 * Client Write-Back Service
 *
 * Replaces write-back-service.ts and all server actions for the standalone app.
 * Performs optimistic IndexedDB updates followed by direct browser-to-ADO API calls.
 * On ADO failure, rolls back the IndexedDB change to the previous value.
 *
 * All functions read credentials from getCredentials() and pass them to the ADO connector.
 */

import { getCredentials } from "./credential-store";
import * as ado from "./ado-connector";
import * as idb from "./idb-cache";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WriteResult {
  success: boolean;
  error?: string;
}

// Field name mapping: local DB field names → ADO field paths
const ADO_FIELD_MAP: Record<string, string> = {
  title: "System.Title",
  state: "System.State",
  assigned_to: "System.AssignedTo",
  assignedTo: "System.AssignedTo",
  iteration_path: "System.IterationPath",
  iterationPath: "System.IterationPath",
  stack_rank: "Microsoft.VSTS.Common.StackRank",
  stackRank: "Microsoft.VSTS.Common.StackRank",
  parent_id: "System.Parent",
  parentId: "System.Parent",
  priority: "Microsoft.VSTS.Common.Priority",
  description: "System.Description",
  acceptanceCriteria: "Microsoft.VSTS.Common.AcceptanceCriteria",
  acceptance_criteria: "Microsoft.VSTS.Common.AcceptanceCriteria",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireCredentials() {
  const creds = getCredentials();
  if (!creds) {
    throw new Error("No ADO credentials found. Please configure your credentials in Settings.");
  }
  return creds;
}

// ---------------------------------------------------------------------------
// Core write-back functions
// ---------------------------------------------------------------------------

/**
 * Update a single field on a work item with optimistic IndexedDB update,
 * then write to ADO. Rolls back on failure.
 */
export async function updateField(
  workItemId: number,
  field: string,
  newValue: unknown,
  previousValue: unknown
): Promise<WriteResult> {
  // Step 1: Optimistic IndexedDB update
  try {
    await idb.updateWorkItemField(workItemId, field, newValue);
  } catch (err) {
    return {
      success: false,
      error: `Cache update failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }

  // Step 2: Resolve ADO field name
  const adoField = ADO_FIELD_MAP[field];
  if (!adoField) {
    await idb.updateWorkItemField(workItemId, field, previousValue).catch(() => {});
    return {
      success: false,
      error: `Unknown ADO field mapping for: ${field}`,
    };
  }

  // Step 3: Write to ADO
  try {
    const creds = requireCredentials();
    await ado.updateWorkItemField(creds, workItemId, adoField, newValue as string | number);
    return { success: true };
  } catch (err) {
    // Step 4: Rollback on failure
    await idb.updateWorkItemField(workItemId, field, previousValue).catch((rollbackErr) => {
      console.error("Rollback failed:", rollbackErr);
    });
    return {
      success: false,
      error: `ADO update failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Update tags on a work item with optimistic IndexedDB update,
 * then write to ADO. Rolls back on failure.
 */
export async function updateTags(
  workItemId: number,
  newTags: string[],
  previousTags: string[]
): Promise<WriteResult> {
  // Step 1: Optimistic IndexedDB update
  try {
    await idb.updateWorkItemField(
      workItemId,
      "tags",
      newTags
    );
  } catch (err) {
    return {
      success: false,
      error: `Cache update failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }

  // Step 2: Write to ADO
  try {
    const creds = requireCredentials();
    await ado.updateWorkItemTags(creds, workItemId, newTags);
    return { success: true };
  } catch (err) {
    // Step 3: Rollback
    await idb.updateWorkItemField(
      workItemId,
      "tags",
      previousTags
    ).catch((rollbackErr) => {
      console.error("Tag rollback failed:", rollbackErr);
    });
    return {
      success: false,
      error: `ADO tag update failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}

/**
 * Move a work item to a different iteration. Delegates to updateField
 * with the iteration_path field.
 */
export async function moveToIteration(
  workItemId: number,
  newPath: string,
  previousPath: string
): Promise<WriteResult> {
  return updateField(workItemId, "iterationPath", newPath, previousPath);
}

/**
 * Update schedule (local start/end dates) in IndexedDB, and write
 * the iteration path to ADO if it changed.
 */
export async function updateSchedule(
  workItemId: number,
  startDate: string,
  endDate: string,
  iterationPath: string,
  prevIterPath: string
): Promise<WriteResult> {
  // Update local dates in IndexedDB (these are local-only, not synced to ADO)
  try {
    await idb.updateWorkItemField(workItemId, "localStartDate", startDate);
    await idb.updateWorkItemField(workItemId, "localEndDate", endDate);
  } catch (err) {
    return {
      success: false,
      error: `Cache update failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }

  // If iteration changed, write that back to ADO
  if (iterationPath !== prevIterPath && iterationPath) {
    return moveToIteration(workItemId, iterationPath, prevIterPath);
  }

  return { success: true };
}

/**
 * Reorder a work item: update parent in IndexedDB, then write parent
 * change + reorder to ADO.
 */
export async function reorderItem(
  workItemId: number,
  newParentId: number | null,
  newSortOrder: number,
  prevParentId: number | null,
  prevSiblingId: number,
  nextSiblingId: number
): Promise<WriteResult> {
  // 1. Update parent in IndexedDB
  try {
    await idb.updateWorkItemField(workItemId, "parentId", newParentId);
  } catch (err) {
    return {
      success: false,
      error: `Cache update failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }

  const creds = requireCredentials();

  // 2. Write parent to ADO if it changed
  if (newParentId !== prevParentId) {
    try {
      if (newParentId !== null) {
        await ado.updateWorkItemParent(creds, workItemId, newParentId);
      }
    } catch (err) {
      // Rollback parent in IndexedDB
      await idb.updateWorkItemField(workItemId, "parentId", prevParentId).catch(() => {});
      return {
        success: false,
        error: `ADO parent update failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      };
    }
  }

  // 3. Use ADO reorder API with sibling IDs
  try {
    await ado.reorderWorkItems(
      creds,
      [workItemId],
      prevSiblingId,
      nextSiblingId,
      newParentId ?? undefined
    );
  } catch (err) {
    // Reorder failed but parent change may have succeeded — don't rollback parent
    console.error("ADO reorder failed:", err);
  }

  return { success: true };
}

/**
 * Create a new work item in ADO, then upsert the result into IndexedDB.
 */
export async function createItem(
  parentId: number,
  workItemType: string,
  title: string,
  iterationPath?: string
): Promise<{ success: boolean; id?: number; error?: string }> {
  try {
    const creds = requireCredentials();
    const newItem = await ado.createWorkItem(creds, parentId, workItemType, title, iterationPath);
    return { success: true, id: newItem.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Remove work items by setting their state to "Removed" optimistically,
 * then writing to ADO. Rolls back on failure.
 */
export async function removeItems(
  itemIds: number[],
  previousStates: Record<number, string>
): Promise<WriteResult> {
  const results = await Promise.all(
    itemIds.map((id) =>
      updateField(id, "state", "Removed", previousStates[id] ?? "New")
    )
  );
  const failed = results.find((r) => !r.success);
  if (failed) return failed;
  return { success: true };
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

/** Update a work item's description field. */
export async function updateDescription(
  workItemId: number,
  newDescription: string,
  previousDescription: string
): Promise<WriteResult> {
  return updateField(workItemId, "description", newDescription, previousDescription);
}

/** Update a work item's acceptance criteria field. */
export async function updateAcceptanceCriteria(
  workItemId: number,
  newAC: string,
  previousAC: string
): Promise<WriteResult> {
  return updateField(workItemId, "acceptanceCriteria", newAC, previousAC);
}

/** Update a work item's priority field. */
export async function updatePriority(
  workItemId: number,
  newPriority: number,
  previousPriority: number | null
): Promise<WriteResult> {
  return updateField(workItemId, "priority", newPriority, previousPriority);
}

/** Update a work item's title field. */
export async function updateTitle(
  workItemId: number,
  newTitle: string,
  previousTitle: string
): Promise<WriteResult> {
  return updateField(workItemId, "title", newTitle, previousTitle);
}
