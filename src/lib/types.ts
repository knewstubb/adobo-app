// Core domain types for Ticket Manager

export type WorkItemState =
  | "New"
  | "Under Assessment"
  | "Ready"
  | "Committed"
  | "Approved"
  | "In Development"
  | "Ready to Release"
  | "Active"
  | "Resolved"
  | "Closed"
  | "Done"
  | "To Do";

export const STATE_COLOURS: Record<string, string> = {
  New: "#6B7280",
  "Under Assessment": "#F59E0B",
  Approved: "#8B5CF6",
  Ready: "#3B82F6",
  Committed: "#3B82F6",
  "Carry Over": "#5688E0",
  Done: "#22C55E",
  Removed: "#4B5563",
  // Initiative states
  "In Progress": "#3B82F6",
  "Close Out": "#10B981",
  "Benefits Realisation": "#22C55E",
  // Epic/Feature states
  "In Development": "#14B8A6",
  "Ready to Release": "#10B981",
  Released: "#22C55E",
  // Bug/Task states
  "To Do": "#6B7280",
  // Legacy/other process states
  Active: "#3B82F6",
  Resolved: "#10B981",
  Closed: "#4B5563",
};

export interface WorkItem {
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
  adoChangedDate: Date | null;
  cachedAt: Date;
  localSortOrder: number;
  /** Local start date for day-level Gantt positioning (overrides iteration span) */
  localStartDate: Date | null;
  /** Local end date for day-level Gantt positioning (overrides iteration span) */
  localEndDate: Date | null;
  effort: number | null;
  priority: number | null;
}

export interface WorkItemLink {
  sourceId: number;
  targetId: number;
  linkType: "predecessor" | "successor";
  createdAt: Date;
}

export interface Iteration {
  path: string;
  name: string;
  startDate: Date | null;
  endDate: Date | null;
}

export interface TeamMember {
  uniqueName: string;
  displayName: string;
  imageUrl: string | null;
}

export interface SavedView {
  id: string;
  name: string;
  filterState: FilterState;
  grouping: GroupingDimension | null;
  showDone: boolean;
  iterationViewMode: boolean;
  selectedIterationPath: string | null;
  sortOrder: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FilterState {
  states?: string[];
  iterationPaths?: string[];
  assignedTo?: string[];
  epicIds?: number[];
  featureIds?: number[];
  initiativeIds?: number[];
}

export type GroupingDimension = "person" | "feature" | "epic" | "custom";

export interface SyncMetadata {
  lastSyncAt: Date | null;
  status: "idle" | "running" | "error";
  lastError: string | null;
  itemsSynced: number;
  updatedAt: Date;
}

export interface SyncResult {
  success: boolean;
  itemsUpserted: number;
  itemsDeleted: number;
  timestamp: Date;
  error?: string;
}

export interface SyncStatus {
  lastSyncTimestamp: Date | null;
  isRunning: boolean;
  error?: string;
}

export interface WriteResult {
  success: boolean;
  rolledBack: boolean;
  error?: string;
}

/**
 * Valid state transitions per work item type.
 * Based on the ADO process used by the Spark project.
 * Each type has its own workflow — selecting a state not in this list
 * would be rejected by ADO.
 */
export const STATES_BY_TYPE: Record<string, string[]> = {
  Initiative:             ["New", "Approved", "Committed", "In Progress", "Close Out", "Benefits Realisation", "Done"],
  Epic:                   ["New", "Under Assessment", "Ready", "Approved", "Committed", "In Development", "Ready to Release", "Released", "Done", "Removed"],
  Feature:                ["New", "Under Assessment", "Ready", "Approved", "Committed", "In Development", "Ready to Release", "Released", "Done", "Removed"],
  "Product Backlog Item": ["New", "Under Assessment", "Approved", "Ready", "Committed", "Carry Over", "Done", "Removed"],
  Bug:                    ["To Do", "In Progress", "Done", "Removed"],
  Task:                   ["To Do", "In Progress", "Done", "Removed"],
};

/** Fallback states when the work item type is unknown */
export const DEFAULT_STATES = ["New", "Under Assessment", "Approved", "Ready", "Committed", "Carry Over", "Done", "Removed"];

/** Get the valid states for a given work item type */
export function getStatesForType(workItemType: string): string[] {
  return STATES_BY_TYPE[workItemType] ?? DEFAULT_STATES;
}


export interface ReleaseDate {
  id: string;
  name: string;
  releaseDate: Date;
  codeFreezeDate: Date | null;
  description: string | null;
  acceptanceCriteria: string | null;
  createdAt: Date;
  updatedAt: Date;
}
