import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  WorkItem,
  Iteration,
  TeamMember,
  SavedView,
  SyncMetadata,
  FilterState,
  GroupingDimension,
} from "./types";

// ---------------------------------------------------------------------------
// IndexedDB row types (dates stored as ISO strings)
// ---------------------------------------------------------------------------

interface WorkItemRow {
  id: number;
  title: string;
  state: string;
  assignedTo: string | null;
  iterationPath: string | null;
  areaPath: string | null;
  workItemType: string;
  description: string | null;
  acceptanceCriteria: string | null;
  parentId: number | null;
  initiativeId: number | null;
  epicId: number | null;
  featureId: number | null;
  tags: string[];
  stackRank: number | null;
  adoChangedDate: string | null;
  cachedAt: string;
  localSortOrder: number;
  localStartDate: string | null;
  localEndDate: string | null;
  effort: number | null;
  priority: number | null;
}

interface IterationRow {
  path: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
}

interface TeamMemberRow {
  uniqueName: string;
  displayName: string;
  imageUrl: string | null;
}

interface SavedViewRow {
  id: string;
  name: string;
  filterState: FilterState;
  grouping: GroupingDimension | null;
  showDone: boolean;
  iterationViewMode: boolean;
  selectedIterationPath: string | null;
  sortOrder: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SyncMetadataRow {
  key: string;
  lastSyncAt: string | null;
  status: string;
  lastError: string | null;
  itemsSynced: number;
  updatedAt: string;
}

interface WorkItemTagRow {
  workItemId: number;
  tag: string;
}

interface ViewHiddenItemRow {
  viewId: string;
  workItemId: number;
}

interface WorkItemLinkRow {
  sourceId: number;
  targetId: number;
  linkType: string;
  createdAt: string;
}

interface SyncAreaPathRow {
  path: string;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// DB Schema
// ---------------------------------------------------------------------------

interface TicketManagerDB extends DBSchema {
  workItems: {
    key: number;
    value: WorkItemRow;
    indexes: {
      "by-state": string;
      "by-assignedTo": string;
      "by-iterationPath": string;
      "by-parentId": number;
      "by-epicId": number;
      "by-featureId": number;
      "by-initiativeId": number;
    };
  };
  iterations: {
    key: string;
    value: IterationRow;
  };
  teamMembers: {
    key: string;
    value: TeamMemberRow;
  };
  savedViews: {
    key: string;
    value: SavedViewRow;
    indexes: {
      "by-sortOrder": number;
    };
  };
  syncMetadata: {
    key: string;
    value: SyncMetadataRow;
  };
  workItemTags: {
    key: [number, string];
    value: WorkItemTagRow;
    indexes: {
      "by-tag": string;
    };
  };
  viewHiddenItems: {
    key: [string, number];
    value: ViewHiddenItemRow;
    indexes: {
      "by-viewId": string;
    };
  };
  workItemLinks: {
    key: [number, number, string];
    value: WorkItemLinkRow;
    indexes: {
      "by-sourceId": number;
      "by-targetId": number;
    };
  };
  syncAreaPaths: {
    key: string;
    value: SyncAreaPathRow;
  };
}

// ---------------------------------------------------------------------------
// Singleton DB accessor
// ---------------------------------------------------------------------------

const DB_NAME = "adobo-db";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<TicketManagerDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<TicketManagerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<TicketManagerDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // workItems
        const workItemStore = db.createObjectStore("workItems", { keyPath: "id" });
        workItemStore.createIndex("by-state", "state");
        workItemStore.createIndex("by-assignedTo", "assignedTo");
        workItemStore.createIndex("by-iterationPath", "iterationPath");
        workItemStore.createIndex("by-parentId", "parentId");
        workItemStore.createIndex("by-epicId", "epicId");
        workItemStore.createIndex("by-featureId", "featureId");
        workItemStore.createIndex("by-initiativeId", "initiativeId");

        // iterations
        db.createObjectStore("iterations", { keyPath: "path" });

        // teamMembers
        db.createObjectStore("teamMembers", { keyPath: "uniqueName" });

        // savedViews
        const savedViewStore = db.createObjectStore("savedViews", { keyPath: "id" });
        savedViewStore.createIndex("by-sortOrder", "sortOrder");

        // syncMetadata
        db.createObjectStore("syncMetadata", { keyPath: "key" });

        // workItemTags
        const tagStore = db.createObjectStore("workItemTags", {
          keyPath: ["workItemId", "tag"],
        });
        tagStore.createIndex("by-tag", "tag");

        // viewHiddenItems
        const hiddenStore = db.createObjectStore("viewHiddenItems", {
          keyPath: ["viewId", "workItemId"],
        });
        hiddenStore.createIndex("by-viewId", "viewId");

        // workItemLinks
        const linkStore = db.createObjectStore("workItemLinks", {
          keyPath: ["sourceId", "targetId", "linkType"],
        });
        linkStore.createIndex("by-sourceId", "sourceId");
        linkStore.createIndex("by-targetId", "targetId");

        // syncAreaPaths
        db.createObjectStore("syncAreaPaths", { keyPath: "path" });
      },
    });
  }
  return dbPromise;
}


/** Reset the singleton — used in tests to get a fresh DB between runs. */
export function _resetDB(): void {
  dbPromise = null;
}

// ---------------------------------------------------------------------------
// Row ↔ Domain mapping helpers
// ---------------------------------------------------------------------------

function workItemToRow(item: WorkItem): WorkItemRow {
  return {
    id: item.id,
    title: item.title,
    state: item.state,
    assignedTo: item.assignedTo,
    iterationPath: item.iterationPath,
    areaPath: item.areaPath,
    workItemType: item.workItemType,
    description: item.description,
    acceptanceCriteria: item.acceptanceCriteria,
    parentId: item.parentId,
    initiativeId: item.initiativeId,
    epicId: item.epicId,
    featureId: item.featureId,
    tags: item.tags,
    stackRank: item.stackRank,
    adoChangedDate: item.adoChangedDate?.toISOString() ?? null,
    cachedAt: item.cachedAt.toISOString(),
    localSortOrder: item.localSortOrder,
    localStartDate: item.localStartDate?.toISOString() ?? null,
    localEndDate: item.localEndDate?.toISOString() ?? null,
    effort: item.effort,
    priority: item.priority,
  };
}

function rowToWorkItem(row: WorkItemRow): WorkItem {
  return {
    id: row.id,
    title: row.title,
    state: row.state,
    assignedTo: row.assignedTo,
    iterationPath: row.iterationPath,
    areaPath: row.areaPath,
    workItemType: row.workItemType,
    description: row.description,
    acceptanceCriteria: row.acceptanceCriteria,
    parentId: row.parentId,
    initiativeId: row.initiativeId,
    epicId: row.epicId,
    featureId: row.featureId,
    tags: row.tags,
    stackRank: row.stackRank,
    adoChangedDate: row.adoChangedDate ? new Date(row.adoChangedDate) : null,
    cachedAt: new Date(row.cachedAt),
    localSortOrder: row.localSortOrder,
    localStartDate: row.localStartDate ? new Date(row.localStartDate) : null,
    localEndDate: row.localEndDate ? new Date(row.localEndDate) : null,
    effort: row.effort,
    priority: row.priority,
  };
}

function iterationToRow(iter: Iteration): IterationRow {
  return {
    path: iter.path,
    name: iter.name,
    startDate: iter.startDate?.toISOString() ?? null,
    endDate: iter.endDate?.toISOString() ?? null,
  };
}

function rowToIteration(row: IterationRow): Iteration {
  return {
    path: row.path,
    name: row.name,
    startDate: row.startDate ? new Date(row.startDate) : null,
    endDate: row.endDate ? new Date(row.endDate) : null,
  };
}

function teamMemberToRow(m: TeamMember): TeamMemberRow {
  return { uniqueName: m.uniqueName, displayName: m.displayName, imageUrl: m.imageUrl };
}

function rowToTeamMember(row: TeamMemberRow): TeamMember {
  return { uniqueName: row.uniqueName, displayName: row.displayName, imageUrl: row.imageUrl };
}

function savedViewToRow(v: SavedView): SavedViewRow {
  return {
    id: v.id,
    name: v.name,
    filterState: v.filterState,
    grouping: v.grouping,
    showDone: v.showDone,
    iterationViewMode: v.iterationViewMode,
    selectedIterationPath: v.selectedIterationPath,
    sortOrder: v.sortOrder,
    isDefault: v.isDefault,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

function rowToSavedView(row: SavedViewRow): SavedView {
  return {
    id: row.id,
    name: row.name,
    filterState: row.filterState,
    grouping: row.grouping,
    showDone: row.showDone,
    iterationViewMode: row.iterationViewMode,
    selectedIterationPath: row.selectedIterationPath,
    sortOrder: row.sortOrder,
    isDefault: row.isDefault,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// QuotaExceededError helper
// ---------------------------------------------------------------------------

function wrapQuotaError(err: unknown, context: string): never {
  if (err instanceof DOMException && err.name === "QuotaExceededError") {
    throw new Error(
      `Browser storage is full (${context}). Clear some browser data or increase the quota.`
    );
  }
  throw err;
}


// ---------------------------------------------------------------------------
// Work Items
// ---------------------------------------------------------------------------

export async function getAllWorkItems(): Promise<WorkItem[]> {
  const db = await getDB();
  const rows = await db.getAll("workItems");
  return rows.map(rowToWorkItem);
}

export async function getWorkItemById(id: number): Promise<WorkItem | null> {
  const db = await getDB();
  const row = await db.get("workItems", id);
  return row ? rowToWorkItem(row) : null;
}

export async function upsertWorkItems(items: WorkItem[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDB();
  try {
    const tx = db.transaction(["workItems", "workItemTags"], "readwrite");
    const itemStore = tx.objectStore("workItems");
    const tagStore = tx.objectStore("workItemTags");

    for (const item of items) {
      const row = workItemToRow(item);
      await itemStore.put(row);

      // Rebuild tags for this item: delete existing, insert new
      const allTagKeys = await tagStore.getAllKeys();
      for (const key of allTagKeys) {
        if ((key as [number, string])[0] === item.id) {
          await tagStore.delete(key);
        }
      }
      for (const tag of item.tags) {
        await tagStore.put({ workItemId: item.id, tag });
      }
    }

    await tx.done;
  } catch (err) {
    wrapQuotaError(err, "upsertWorkItems");
  }
}

export async function deleteWorkItemsNotIn(ids: number[]): Promise<number> {
  const db = await getDB();
  const keepSet = new Set(ids);
  const tx = db.transaction("workItems", "readwrite");
  const store = tx.objectStore("workItems");
  const allKeys = await store.getAllKeys();
  let deleted = 0;

  for (const key of allKeys) {
    if (!keepSet.has(key)) {
      await store.delete(key);
      deleted++;
    }
  }

  await tx.done;
  return deleted;
}

export async function updateWorkItemField(
  id: number,
  field: string,
  value: unknown
): Promise<void> {
  const db = await getDB();
  try {
    const tx = db.transaction("workItems", "readwrite");
    const store = tx.objectStore("workItems");
    const row = await store.get(id);
    if (!row) throw new Error(`Work item ${id} not found`);

    (row as unknown as Record<string, unknown>)[field] = value;
    row.cachedAt = new Date().toISOString();
    await store.put(row);
    await tx.done;
  } catch (err) {
    wrapQuotaError(err, "updateWorkItemField");
  }
}


// ---------------------------------------------------------------------------
// Iterations
// ---------------------------------------------------------------------------

export async function getAllIterations(): Promise<Iteration[]> {
  const db = await getDB();
  const rows = await db.getAll("iterations");
  return rows.map(rowToIteration);
}

export async function upsertIterations(iterations: Iteration[]): Promise<void> {
  if (iterations.length === 0) return;
  const db = await getDB();
  try {
    const tx = db.transaction("iterations", "readwrite");
    const store = tx.objectStore("iterations");
    for (const iter of iterations) {
      await store.put(iterationToRow(iter));
    }
    await tx.done;
  } catch (err) {
    wrapQuotaError(err, "upsertIterations");
  }
}

// ---------------------------------------------------------------------------
// Team Members
// ---------------------------------------------------------------------------

export async function getAllTeamMembers(): Promise<TeamMember[]> {
  const db = await getDB();
  const rows = await db.getAll("teamMembers");
  return rows.map(rowToTeamMember);
}

export async function upsertTeamMembers(members: TeamMember[]): Promise<void> {
  if (members.length === 0) return;
  const db = await getDB();
  try {
    const tx = db.transaction("teamMembers", "readwrite");
    const store = tx.objectStore("teamMembers");
    for (const m of members) {
      await store.put(teamMemberToRow(m));
    }
    await tx.done;
  } catch (err) {
    wrapQuotaError(err, "upsertTeamMembers");
  }
}

// ---------------------------------------------------------------------------
// Saved Views
// ---------------------------------------------------------------------------

export async function getSavedViews(): Promise<SavedView[]> {
  const db = await getDB();
  const rows = await db.getAllFromIndex("savedViews", "by-sortOrder");
  return rows.map(rowToSavedView);
}

export async function createSavedView(
  view: Omit<SavedView, "id" | "createdAt" | "updatedAt">
): Promise<SavedView> {
  const now = new Date();
  const saved: SavedView = {
    ...view,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  const db = await getDB();
  try {
    await db.put("savedViews", savedViewToRow(saved));
  } catch (err) {
    wrapQuotaError(err, "createSavedView");
  }
  return saved;
}

export async function updateSavedView(
  id: string,
  updates: Partial<SavedView>
): Promise<SavedView> {
  const db = await getDB();
  const row = await db.get("savedViews", id);
  if (!row) throw new Error(`Saved view ${id} not found`);

  if (updates.name !== undefined) row.name = updates.name;
  if (updates.filterState !== undefined) row.filterState = updates.filterState;
  if (updates.grouping !== undefined) row.grouping = updates.grouping;
  if (updates.showDone !== undefined) row.showDone = updates.showDone;
  if (updates.iterationViewMode !== undefined) row.iterationViewMode = updates.iterationViewMode;
  if (updates.selectedIterationPath !== undefined) row.selectedIterationPath = updates.selectedIterationPath;
  if (updates.sortOrder !== undefined) row.sortOrder = updates.sortOrder;
  if (updates.isDefault !== undefined) row.isDefault = updates.isDefault;
  row.updatedAt = new Date().toISOString();

  try {
    await db.put("savedViews", row);
  } catch (err) {
    wrapQuotaError(err, "updateSavedView");
  }
  return rowToSavedView(row);
}

export async function deleteSavedView(id: string): Promise<void> {
  const db = await getDB();
  const row = await db.get("savedViews", id);
  // Prevent deleting the default view
  if (row?.isDefault) return;
  await db.delete("savedViews", id);
}


// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export async function getAllTags(): Promise<string[]> {
  const db = await getDB();
  const rows = await db.getAll("workItemTags");
  const unique = [...new Set(rows.map((r) => r.tag))].sort();
  return unique;
}

// ---------------------------------------------------------------------------
// Sync Metadata
// ---------------------------------------------------------------------------

export async function getSyncMetadata(): Promise<SyncMetadata> {
  const db = await getDB();
  const row = await db.get("syncMetadata", "main");
  if (!row) {
    // Return default metadata if none exists yet
    return {
      lastSyncAt: null,
      status: "idle",
      lastError: null,
      itemsSynced: 0,
      updatedAt: new Date(),
    };
  }
  return {
    lastSyncAt: row.lastSyncAt ? new Date(row.lastSyncAt) : null,
    status: row.status as SyncMetadata["status"],
    lastError: row.lastError,
    itemsSynced: row.itemsSynced,
    updatedAt: new Date(row.updatedAt),
  };
}

export async function updateSyncMetadata(
  updates: Partial<SyncMetadata>
): Promise<void> {
  const db = await getDB();
  try {
    const existing = await db.get("syncMetadata", "main");
    const row: SyncMetadataRow = existing ?? {
      key: "main",
      lastSyncAt: null,
      status: "idle",
      lastError: null,
      itemsSynced: 0,
      updatedAt: new Date().toISOString(),
    };

    if (updates.lastSyncAt !== undefined) {
      row.lastSyncAt = updates.lastSyncAt?.toISOString() ?? null;
    }
    if (updates.status !== undefined) row.status = updates.status;
    if (updates.lastError !== undefined) row.lastError = updates.lastError;
    if (updates.itemsSynced !== undefined) row.itemsSynced = updates.itemsSynced;
    row.updatedAt = new Date().toISOString();

    await db.put("syncMetadata", row);
  } catch (err) {
    wrapQuotaError(err, "updateSyncMetadata");
  }
}

// ---------------------------------------------------------------------------
// View Hidden Items
// ---------------------------------------------------------------------------

export async function getHiddenItems(viewId: string): Promise<number[]> {
  const db = await getDB();
  const rows = await db.getAllFromIndex("viewHiddenItems", "by-viewId", viewId);
  return rows.map((r) => r.workItemId);
}

export async function hideItems(viewId: string, itemIds: number[]): Promise<void> {
  if (itemIds.length === 0) return;
  const db = await getDB();
  try {
    const tx = db.transaction("viewHiddenItems", "readwrite");
    const store = tx.objectStore("viewHiddenItems");
    for (const workItemId of itemIds) {
      await store.put({ viewId, workItemId });
    }
    await tx.done;
  } catch (err) {
    wrapQuotaError(err, "hideItems");
  }
}

export async function showItems(viewId: string, itemIds: number[]): Promise<void> {
  if (itemIds.length === 0) return;
  const db = await getDB();
  const tx = db.transaction("viewHiddenItems", "readwrite");
  const store = tx.objectStore("viewHiddenItems");
  for (const workItemId of itemIds) {
    await store.delete([viewId, workItemId]);
  }
  await tx.done;
}

// ---------------------------------------------------------------------------
// Work Item Links
// ---------------------------------------------------------------------------

export async function getLinksForItem(
  itemId: number
): Promise<{ predecessors: number[]; successors: number[] }> {
  const db = await getDB();
  const asSource = await db.getAllFromIndex("workItemLinks", "by-sourceId", itemId);

  const predecessors: number[] = [];
  const successors: number[] = [];

  for (const row of asSource) {
    if (row.linkType === "predecessor") predecessors.push(row.targetId);
    else if (row.linkType === "successor") successors.push(row.targetId);
  }

  return { predecessors, successors };
}

export async function addLink(
  sourceId: number,
  targetId: number,
  linkType: string
): Promise<void> {
  const db = await getDB();
  try {
    await db.put("workItemLinks", {
      sourceId,
      targetId,
      linkType,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    wrapQuotaError(err, "addLink");
  }
}

export async function removeLink(
  sourceId: number,
  targetId: number,
  linkType: string
): Promise<void> {
  const db = await getDB();
  await db.delete("workItemLinks", [sourceId, targetId, linkType]);
}

// ---------------------------------------------------------------------------
// Sync Area Paths
// ---------------------------------------------------------------------------

export async function getSyncAreaPaths(): Promise<string[]> {
  const db = await getDB();
  const rows = await db.getAll("syncAreaPaths");
  return rows.filter((r) => r.enabled).map((r) => r.path);
}

export async function setSyncAreaPath(
  path: string,
  enabled: boolean
): Promise<void> {
  const db = await getDB();
  try {
    await db.put("syncAreaPaths", { path, enabled });
  } catch (err) {
    wrapQuotaError(err, "setSyncAreaPath");
  }
}
