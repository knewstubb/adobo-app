"use client";

import type { MutableRefObject } from "react";
import type { WorkItem, Iteration, GroupingDimension } from "@/lib/types";
import { GanttChart } from "./GanttChart";
import type { IterationMarker, TimelineRange } from "@/lib/timeline-positioning";

interface TimelineViewProps {
  items: WorkItem[];
  iterations: Iteration[];
  markers: IterationMarker[];
  range: TimelineRange | null;
  grouping: GroupingDimension | null;
  onItemClick: (item: WorkItem) => void;
  onScheduleChange?: (itemId: number, startDate: Date, endDate: Date, iterationPath: string) => void;
  onReorder?: (itemId: number, newParentId: number | null, newSortOrder: number, previousSiblingId?: number, nextSiblingId?: number) => void;
  onCreateItem?: (parentId: number, workItemType: string) => void;
  onContextMenu?: (item: WorkItem, x: number, y: number) => void;
  pendingIds?: Set<number>;
  showWeekends?: boolean;
  zoomWidth?: number;
  onScrollToTodayRef?: MutableRefObject<(() => void) | null>;
  onZoom?: (delta: number) => void;
}

export function TimelineView({
  items,
  iterations,
  markers,
  range,
  onItemClick,
  onScheduleChange,
  onReorder,
  onCreateItem,
  onContextMenu,
  pendingIds,
  showWeekends,
  zoomWidth,
  onScrollToTodayRef,
  onZoom,
}: TimelineViewProps) {
  if (!range || markers.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
        No iteration data available. Trigger a sync to load iterations.
      </div>
    );
  }

  return (
    <GanttChart
      items={items}
      iterations={iterations}
      markers={markers}
      range={range}
      onItemClick={onItemClick}
      onScheduleChange={onScheduleChange}
      onReorder={onReorder}
      onCreateItem={onCreateItem}
      onContextMenu={onContextMenu}
      pendingIds={pendingIds}
      showWeekends={showWeekends}
      zoomWidth={zoomWidth}
      onScrollToTodayRef={onScrollToTodayRef}
      onZoom={onZoom}
    />
  );
}
