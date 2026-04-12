/**
 * Grouping Logic
 *
 * Partitions work items into swim lanes based on a grouping dimension.
 * Each lane has a key, label, and list of items sorted by localSortOrder.
 */

import type { WorkItem, GroupingDimension } from "./types";

export interface SwimLane {
  key: string;
  label: string;
  items: WorkItem[];
  collapsed: boolean;
}

function getGroupKey(
  item: WorkItem,
  dimension: GroupingDimension
): string | null {
  switch (dimension) {
    case "person":
      return item.assignedTo;
    case "feature":
      return item.featureId?.toString() ?? null;
    case "epic":
      return item.epicId?.toString() ?? null;
    case "custom":
      return item.localSortOrder.toString();
    default:
      return null;
  }
}

function getGroupLabel(
  item: WorkItem,
  dimension: GroupingDimension
): string {
  switch (dimension) {
    case "person":
      return item.assignedTo ?? "Unassigned";
    case "feature":
      return item.featureId?.toString() ?? "No Feature";
    case "epic":
      return item.epicId?.toString() ?? "No Epic";
    case "custom":
      return "Custom";
    default:
      return "Unknown";
  }
}

export function groupWorkItems(
  items: WorkItem[],
  dimension: GroupingDimension | null
): SwimLane[] {
  // No grouping: single flat lane
  if (!dimension) {
    return [
      {
        key: "__all__",
        label: "All Items",
        items: [...items].sort((a, b) => a.localSortOrder - b.localSortOrder),
        collapsed: false,
      },
    ];
  }

  const laneMap = new Map<string, { label: string; items: WorkItem[] }>();
  const ungrouped: WorkItem[] = [];

  for (const item of items) {
    const key = getGroupKey(item, dimension);
    if (key === null) {
      ungrouped.push(item);
      continue;
    }

    if (!laneMap.has(key)) {
      laneMap.set(key, {
        label: getGroupLabel(item, dimension),
        items: [],
      });
    }
    laneMap.get(key)!.items.push(item);
  }

  // Sort items within each lane
  const lanes: SwimLane[] = [];
  for (const [key, lane] of laneMap) {
    lanes.push({
      key,
      label: lane.label,
      items: lane.items.sort((a, b) => a.localSortOrder - b.localSortOrder),
      collapsed: false,
    });
  }

  // Sort lanes alphabetically by label
  lanes.sort((a, b) => a.label.localeCompare(b.label));

  // Add ungrouped lane at the bottom if there are ungrouped items
  if (ungrouped.length > 0) {
    lanes.push({
      key: "__ungrouped__",
      label: "Ungrouped",
      items: ungrouped.sort((a, b) => a.localSortOrder - b.localSortOrder),
      collapsed: false,
    });
  }

  return lanes;
}
