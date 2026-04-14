/**
 * Shared hierarchy constants
 *
 * Single source of truth for the ADO work-item hierarchy used by
 * GanttChart, ListView, and ContextMenu.
 *
 * Hierarchy: Initiative → Epic → Feature → PBI / Bug / Task
 */

/** Maps a parent work-item type to the child type that can be created under it. */
export const CHILD_TYPE_MAP: Record<string, string> = {
  Initiative: "Epic",
  Epic: "Feature",
  Feature: "Product Backlog Item",
};

/** Work-item types that act as summary/parent rows (can have children). */
export const SUMMARY_TYPES = new Set(["Initiative", "Epic", "Feature"]);

/** Work-item types that are leaf-level (no children in the standard hierarchy). */
export const LEAF_TYPES = new Set(["Product Backlog Item", "Bug", "Task", "User Story"]);

/** Returns the child type for a given parent type, or `null` if the type has no children. */
export function getChildType(parentType: string): string | null {
  return CHILD_TYPE_MAP[parentType] ?? null;
}
