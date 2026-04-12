/**
 * Filter Logic
 *
 * Pure functions for filtering work items. These operate on in-memory arrays
 * (already fetched from cache) for client-side re-filtering without DB round-trips.
 * Filters are conjunctive (AND across all dimensions).
 */

import type { WorkItem, FilterState } from "./types";

export function applyFilters(
  items: WorkItem[],
  filters: FilterState
): WorkItem[] {
  return items.filter((item) => {
    if (filters.states?.length && !filters.states.includes(item.state)) {
      return false;
    }
    if (
      filters.iterationPaths?.length &&
      (!item.iterationPath ||
        !filters.iterationPaths.includes(item.iterationPath))
    ) {
      return false;
    }
    if (
      filters.assignedTo?.length &&
      (!item.assignedTo || !filters.assignedTo.includes(item.assignedTo))
    ) {
      return false;
    }
    if (
      filters.epicIds?.length &&
      (item.epicId === null || !filters.epicIds.includes(item.epicId))
    ) {
      return false;
    }
    if (
      filters.featureIds?.length &&
      (item.featureId === null || !filters.featureIds.includes(item.featureId))
    ) {
      return false;
    }
    if (
      filters.initiativeIds?.length &&
      (item.initiativeId === null ||
        !filters.initiativeIds.includes(item.initiativeId))
    ) {
      return false;
    }
    return true;
  });
}

export function getFilterCounts(
  allItems: WorkItem[],
  filteredItems: WorkItem[]
): { visible: number; total: number } {
  return { visible: filteredItems.length, total: allItems.length };
}

/** Extract distinct filter options from a set of work items */
export function extractFilterOptions(items: WorkItem[]) {
  const states = new Set<string>();
  const iterationPaths = new Set<string>();
  const assignees = new Set<string>();
  const epicIds = new Set<number>();
  const featureIds = new Set<number>();
  const initiativeIds = new Set<number>();

  for (const item of items) {
    states.add(item.state);
    if (item.iterationPath) iterationPaths.add(item.iterationPath);
    if (item.assignedTo) assignees.add(item.assignedTo);
    if (item.epicId !== null) epicIds.add(item.epicId);
    if (item.featureId !== null) featureIds.add(item.featureId);
    if (item.initiativeId !== null) initiativeIds.add(item.initiativeId);
  }

  return {
    states: [...states].sort(),
    iterationPaths: [...iterationPaths].sort(),
    assignees: [...assignees].sort(),
    epicIds: [...epicIds].sort((a, b) => a - b),
    featureIds: [...featureIds].sort((a, b) => a - b),
    initiativeIds: [...initiativeIds].sort((a, b) => a - b),
  };
}

/** Hide Done items unless showDone is true */
export function applyDoneFilter(
  items: WorkItem[],
  showDone: boolean
): WorkItem[] {
  if (showDone) return items;
  return items.filter((item) => item.state !== "Done");
}
