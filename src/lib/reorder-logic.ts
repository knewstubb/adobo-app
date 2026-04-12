/**
 * Reorder Logic
 *
 * Validates and computes reorder operations for the Gantt chart.
 * Enforces ADO hierarchy rules:
 * - Child objects can be reordered within their parent
 * - Child objects can be moved to a different parent of the same type
 * - Parent objects (Initiative/Epic/Feature) cannot be dragged inside other parents
 * - Child objects cannot skip hierarchy levels
 */

import type { GanttRow } from "./gantt-tree";

/** The valid parent type for each child type */
const VALID_PARENT_TYPES: Record<string, string[]> = {
  "Product Backlog Item": ["Feature", "Epic"],
  "Bug": ["Feature", "Epic"],
  "Task": ["Product Backlog Item", "Bug"],
  "User Story": ["Feature", "Epic"],
  "Feature": ["Epic", "Initiative"],
  "Epic": ["Initiative"],
  "Initiative": [], // cannot be nested
};

export interface DropTarget {
  /** The row we're dropping relative to */
  targetRow: GanttRow;
  /** Where relative to the target: before, after, or inside (as child) */
  position: "before" | "after" | "inside";
  /** The parent the dragged item would end up under */
  newParentId: number | null;
  /** The sort order for the dragged item */
  newSortOrder: number;
  /** Visual Y position for the drop indicator line */
  indicatorY: number;
  /** ADO sibling IDs for the reorder API */
  previousSiblingId: number;
  nextSiblingId: number;
}

/**
 * Check if a dragged item can be dropped at a given position relative to a target row.
 */
export function canDrop(
  draggedRow: GanttRow,
  targetRow: GanttRow,
  position: "before" | "after" | "inside"
): boolean {
  // Can't drop on yourself
  if (draggedRow.item.id === targetRow.item.id) return false;

  // Can't drop inside your own descendants
  if (isDescendant(targetRow, draggedRow)) return false;

  if (position === "inside") {
    // Dropping inside: target becomes the parent
    const validParents = VALID_PARENT_TYPES[draggedRow.item.workItemType] ?? [];
    return validParents.includes(targetRow.item.workItemType);
  }

  // Dropping before/after: dragged item gets the same parent as the target
  // This is valid if the dragged item is the same type as the target (siblings)
  // or if the target's parent type is valid for the dragged item
  const draggedType = draggedRow.item.workItemType;
  const targetType = targetRow.item.workItemType;

  // Same type = always valid as siblings
  if (draggedType === targetType) return true;

  // Same current parent = valid (reordering within parent)
  if (targetRow.item.parentId === draggedRow.item.parentId) return true;

  return false;
}

/** Check if `possibleDescendant` is a descendant of `ancestor` */
function isDescendant(possibleDescendant: GanttRow, ancestor: GanttRow): boolean {
  for (const child of ancestor.children) {
    if (child.item.id === possibleDescendant.item.id) return true;
    if (isDescendant(possibleDescendant, child)) return true;
  }
  return false;
}

/**
 * Compute the drop target based on cursor position relative to visible rows.
 */
export function computeDropTarget(
  draggedRow: GanttRow,
  visibleRows: GanttRow[],
  cursorY: number,
  rowHeight: number,
  scrollTop: number
): DropTarget | null {
  const adjustedY = cursorY + scrollTop;
  const targetIdx = Math.floor(adjustedY / rowHeight);

  if (targetIdx < 0 || targetIdx >= visibleRows.length) return null;

  const targetRow = visibleRows[targetIdx];
  const rowTop = targetIdx * rowHeight;
  const relativeY = adjustedY - rowTop;
  const zone = relativeY / rowHeight; // 0-1 within the row

  // For summary rows (Epic/Feature/Initiative): default to "inside" unless at the very edges
  // For leaf rows: top half = before, bottom half = after
  let position: "before" | "after" | "inside";
  if (targetRow.isSummary) {
    if (zone < 0.15) {
      position = "before";
    } else if (zone > 0.85) {
      position = "after";
    } else {
      position = "inside"; // Most of the row = drop inside
    }
  } else {
    if (zone < 0.5) {
      position = "before";
    } else {
      position = "after";
    }
  }

  // Validate and try alternatives
  if (!canDrop(draggedRow, targetRow, position)) {
    const alternatives: ("before" | "after" | "inside")[] = 
      position === "inside" ? ["after", "before"] :
      position === "before" ? ["inside", "after"] :
      ["inside", "before"];
    let found = false;
    for (const alt of alternatives) {
      if (canDrop(draggedRow, targetRow, alt)) {
        position = alt;
        found = true;
        break;
      }
    }
    if (!found) return null;
  }

  // Compute new parent and sort order
  let newParentId: number | null;
  let newSortOrder: number;

  let previousSiblingId = 0;
  let nextSiblingId = 0;

  if (position === "inside") {
    newParentId = targetRow.item.id;
    const lastChild = targetRow.children[targetRow.children.length - 1];
    newSortOrder = lastChild ? lastChild.item.localSortOrder + 100 : 100;
    // Inside: previous = last child, next = 0 (end of list)
    previousSiblingId = lastChild ? lastChild.item.id : 0;
    nextSiblingId = 0;
  } else if (position === "before") {
    newParentId = targetRow.item.parentId;
    newSortOrder = targetRow.item.localSortOrder - 50;
    // Before target: previous = item before target, next = target
    const siblings = visibleRows.filter(r => r.item.parentId === targetRow.item.parentId && r.item.id !== draggedRow.item.id);
    const targetIdx = siblings.findIndex(r => r.item.id === targetRow.item.id);
    previousSiblingId = targetIdx > 0 ? siblings[targetIdx - 1].item.id : 0;
    nextSiblingId = targetRow.item.id;
  } else {
    newParentId = targetRow.item.parentId;
    const siblings = visibleRows.filter(r => r.item.parentId === targetRow.item.parentId && r.item.id !== draggedRow.item.id);
    const targetIdx = siblings.findIndex(r => r.item.id === targetRow.item.id);
    const nextSibling = targetIdx < siblings.length - 1 ? siblings[targetIdx + 1] : null;
    newSortOrder = nextSibling
      ? (targetRow.item.localSortOrder + nextSibling.item.localSortOrder) / 2
      : targetRow.item.localSortOrder + 100;
    // After target: previous = target, next = item after target
    previousSiblingId = targetRow.item.id;
    nextSiblingId = nextSibling ? nextSibling.item.id : 0;
  }

  // Compute indicator Y position
  let indicatorY: number;
  if (position === "before") {
    indicatorY = targetIdx * rowHeight;
  } else if (position === "after") {
    indicatorY = (targetIdx + 1) * rowHeight;
  } else {
    indicatorY = (targetIdx + 1) * rowHeight; // bottom of the target row for "inside"
  }

  return { targetRow, position, newParentId, newSortOrder, indicatorY, previousSiblingId, nextSiblingId };
}
