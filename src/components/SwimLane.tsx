"use client";

import { useState } from "react";
import type { WorkItem, Iteration } from "@/lib/types";
import { STATE_COLOURS } from "@/lib/types";
import type { SwimLane as SwimLaneType } from "@/lib/grouping-logic";
import {
  computeBarPosition,
  type TimelineRange,
  type IterationMarker,
} from "@/lib/timeline-positioning";
import { WorkItemCard } from "./WorkItemCard";

interface SwimLaneProps {
  lane: SwimLaneType;
  iterations: Iteration[];
  range: TimelineRange | null;
  markers: IterationMarker[];
  onItemClick: (item: WorkItem) => void;
  pendingIds?: Set<number>;
}

export function SwimLane({
  lane,
  iterations,
  range,
  markers,
  onItemClick,
  pendingIds,
}: SwimLaneProps) {
  const [collapsed, setCollapsed] = useState(lane.collapsed);

  // Split items into those that can be positioned on the timeline vs those that can't
  const positioned: { item: WorkItem; left: number; width: number }[] = [];
  const unpositioned: WorkItem[] = [];

  if (range) {
    for (const item of lane.items) {
      const pos = computeBarPosition(item, iterations, range);
      if (pos) {
        positioned.push({ item, left: pos.leftPercent, width: pos.widthPercent });
      } else {
        unpositioned.push(item);
      }
    }
  } else {
    unpositioned.push(...lane.items);
  }

  // Assign rows to avoid overlapping bars
  const rows = assignRows(positioned);
  const rowCount = Math.max(rows.length, 1);

  return (
    <div className="border-b border-zinc-800">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-zinc-800/50 transition-colors"
      >
        <span className="text-zinc-500 text-xs">
          {collapsed ? "\u25B6" : "\u25BC"}
        </span>
        <span className="text-sm font-medium text-zinc-300">{lane.label}</span>
        <span className="text-xs text-zinc-600">({lane.items.length})</span>
      </button>

      {!collapsed && (
        <div>
          {/* Gantt bar area */}
          {positioned.length > 0 && (
            <div
              className="relative"
              style={{ height: `${rowCount * 40 + 8}px` }}
            >
              {/* Iteration grid lines */}
              {markers.map((marker) => (
                <div
                  key={marker.path}
                  className="absolute top-0 bottom-0 border-r border-zinc-800/50"
                  style={{
                    left: `${marker.leftPercent}%`,
                    width: `${marker.widthPercent}%`,
                  }}
                />
              ))}

              {/* Bars */}
              {rows.map((rowItems, rowIndex) =>
                rowItems.map(({ item, left, width }) => {
                  const bgColor = STATE_COLOURS[item.state] ?? "#6C757D";
                  const isPending = pendingIds?.has(item.id);

                  return (
                    <button
                      key={item.id}
                      onClick={() => onItemClick(item)}
                      className="absolute rounded text-xs text-left px-2 flex items-center truncate cursor-pointer hover:brightness-125 transition-all border border-transparent hover:border-zinc-400"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        top: `${rowIndex * 40 + 4}px`,
                        height: "32px",
                        backgroundColor: `${bgColor}33`,
                        borderLeftColor: bgColor,
                        borderLeftWidth: 3,
                      }}
                      title={`${item.title} (${item.state})`}
                    >
                      {isPending && (
                        <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse mr-1 flex-shrink-0" />
                      )}
                      <span className="truncate text-zinc-100 font-medium">
                        {item.title}
                      </span>
                      <span
                        className="ml-auto text-[10px] px-1 rounded flex-shrink-0"
                        style={{ backgroundColor: `${bgColor}44`, color: bgColor }}
                      >
                        {item.state}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {/* Unpositioned items (no iteration dates) rendered as cards */}
          {unpositioned.length > 0 && (
            <div className="px-3 pb-2 space-y-1">
              {positioned.length > 0 && (
                <div className="text-[10px] text-zinc-600 pt-1">
                  No dates ({unpositioned.length})
                </div>
              )}
              {unpositioned.map((item) => (
                <WorkItemCard
                  key={item.id}
                  item={item}
                  isPending={pendingIds?.has(item.id)}
                  onClick={onItemClick}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/* ── Row assignment to avoid overlapping bars ── */

function assignRows(
  items: { item: WorkItem; left: number; width: number }[]
): { item: WorkItem; left: number; width: number }[][] {
  const sorted = [...items].sort((a, b) => a.left - b.left);
  const rows: { entries: typeof items; ends: number[] }[] = [];

  for (const entry of sorted) {
    const right = entry.left + entry.width;
    let placed = false;

    for (const row of rows) {
      if (row.ends.every((end) => entry.left >= end)) {
        row.entries.push(entry);
        row.ends.push(right);
        placed = true;
        break;
      }
    }

    if (!placed) {
      rows.push({ entries: [entry], ends: [right] });
    }
  }

  return rows.map((r) => r.entries);
}
