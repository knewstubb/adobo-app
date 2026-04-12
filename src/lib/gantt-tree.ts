/**
 * Gantt Tree Builder
 *
 * Builds a hierarchical tree from flat work items for the Gantt chart.
 * Hierarchy: Initiative > Epic > Feature > PBI/Bug/Task
 *
 * Summary rows (Initiative, Epic, Feature) span the full date range
 * of their children. Leaf items use their iteration dates.
 */

import type { WorkItem, Iteration } from "./types";
import type { TimelineRange } from "./timeline-positioning";
import { dateToPercent } from "./timeline-positioning";

/** The hierarchy levels in display order */
const SUMMARY_TYPES = new Set(["Initiative", "Epic", "Feature"]);
const LEAF_TYPES = new Set(["Product Backlog Item", "Bug", "Task", "User Story"]);

export interface GanttRow {
  item: WorkItem;
  depth: number;
  /** Summary rows span their children's date range */
  isSummary: boolean;
  children: GanttRow[];
  /** Computed bar position (null if no dates) */
  barLeft: number | null;
  barWidth: number | null;
}

/** Placeholder row for "+ New" buttons */
export interface AddRow {
  type: "add";
  parentId: number;
  childType: string;
  label: string;
  depth: number;
}

export type FlatRow = { type: "item"; row: GanttRow } | AddRow;

/**
 * Build a hierarchical tree of GanttRows from flat work items.
 * Items are nested by parent_id relationships.
 */
export function buildGanttTree(
  items: WorkItem[],
  iterations: Iteration[],
  range: TimelineRange | null,
  showWeekends: boolean = true
): GanttRow[] {
  const itemMap = new Map<number, WorkItem>();
  for (const item of items) {
    // Exclude Tasks from the Gantt — they're sub-work tracked elsewhere
    if (item.workItemType === "Task") continue;
    itemMap.set(item.id, item);
  }

  // Build adjacency: parentId -> children
  const childrenMap = new Map<number, WorkItem[]>();
  const roots: WorkItem[] = [];

  for (const item of items) {
    if (!itemMap.has(item.id)) continue; // skip filtered-out items (e.g. Tasks)
    if (item.parentId && itemMap.has(item.parentId)) {
      const siblings = childrenMap.get(item.parentId) ?? [];
      siblings.push(item);
      childrenMap.set(item.parentId, siblings);
    } else {
      roots.push(item);
    }
  }

  // Sort children by localSortOrder, then by ID for stability
  const stableSort = (a: WorkItem, b: WorkItem) => {
    const orderDiff = a.localSortOrder - b.localSortOrder;
    return orderDiff !== 0 ? orderDiff : a.id - b.id;
  };
  for (const children of childrenMap.values()) {
    children.sort(stableSort);
  }
  roots.sort(stableSort);

  // Build iteration lookup
  const iterMap = new Map<string, Iteration>();
  for (const iter of iterations) {
    iterMap.set(iter.path, iter);
  }

  // Recursively build rows
  function buildRow(item: WorkItem, depth: number): GanttRow {
    const isSummary = SUMMARY_TYPES.has(item.workItemType);
    const kids = childrenMap.get(item.id) ?? [];
    const childRows = kids.map((child) => buildRow(child, depth + 1));

    let barLeft: number | null = null;
    let barWidth: number | null = null;

    if (range) {
      if (isSummary && childRows.length > 0) {
        // Summary bar spans the full range of children
        const bounds = computeChildBounds(childRows);
        barLeft = bounds.left;
        barWidth = bounds.width;
      } else {
        // Leaf item: use iteration dates
        const pos = computeLeafPosition(item, iterMap, range, showWeekends);
        barLeft = pos.left;
        barWidth = pos.width;
      }
    }

    return { item, depth, isSummary, children: childRows, barLeft, barWidth };
  }

  return roots.map((root) => buildRow(root, 0));
}

/** Compute bar position for a leaf item — uses local dates if set, otherwise iteration dates */
function computeLeafPosition(
  item: WorkItem,
  iterMap: Map<string, Iteration>,
  range: TimelineRange,
  showWeekends: boolean
): { left: number | null; width: number | null } {
  let startDate: Date | null = null;
  let endDate: Date | null = null;

  if (item.localStartDate && item.localEndDate) {
    startDate = new Date(item.localStartDate);
    endDate = new Date(item.localEndDate);
  } else if (item.iterationPath) {
    const iter = iterMap.get(item.iterationPath);
    if (iter?.startDate && iter?.endDate) {
      startDate = iter.startDate;
      endDate = iter.endDate;
    }
  }

  if (!startDate || !endDate) return { left: null, width: null };

  const left = dateToPercent(startDate, range, showWeekends);
  // End date represents "through end of that day", so position at the right edge
  // of the end day by adding one day before converting to percent
  const endPlusOne = new Date(endDate);
  endPlusOne.setUTCDate(endPlusOne.getUTCDate() + 1);
  const right = dateToPercent(endPlusOne, range, showWeekends);

  return { left, width: Math.max(right - left, 0.5) };
}

/** Compute the bounding range of all children (recursive) */
function computeChildBounds(rows: GanttRow[]): { left: number | null; width: number | null } {
  let minLeft = Infinity;
  let maxRight = -Infinity;

  function walk(row: GanttRow) {
    if (row.barLeft !== null && row.barWidth !== null) {
      minLeft = Math.min(minLeft, row.barLeft);
      maxRight = Math.max(maxRight, row.barLeft + row.barWidth);
    }
    for (const child of row.children) {
      walk(child);
    }
  }

  for (const row of rows) {
    walk(row);
  }

  if (minLeft === Infinity) return { left: null, width: null };
  return { left: minLeft, width: maxRight - minLeft };
}

/** Child type mapping: what type of child can be added under each parent type */
const CHILD_TYPE_MAP: Record<string, string> = {
  Initiative: "Epic",
  Epic: "Feature",
  Feature: "Product Backlog Item",
};

const CHILD_LABEL_MAP: Record<string, string> = {
  Epic: "+ New Epic",
  Feature: "+ New Feature",
  "Product Backlog Item": "+ New PBI",
};

/**
 * Flatten the tree into a list of visible rows, respecting collapsed state.
 * Includes "+ New" placeholder rows after each group of children.
 */
export function flattenGanttTree(
  rows: GanttRow[],
  collapsedIds: Set<number>
): FlatRow[] {
  const result: FlatRow[] = [];

  function walk(row: GanttRow) {
    result.push({ type: "item", row });
    if (!collapsedIds.has(row.item.id)) {
      for (const child of row.children) {
        walk(child);
      }
      // Add "+ New" row after children if this is a summary row
      const childType = CHILD_TYPE_MAP[row.item.workItemType];
      if (childType && CHILD_LABEL_MAP[childType]) {
        result.push({
          type: "add",
          parentId: row.item.id,
          childType,
          label: CHILD_LABEL_MAP[childType],
          depth: row.depth + 1,
        });
      }
    }
  }

  for (const row of rows) {
    walk(row);
  }

  return result;
}
