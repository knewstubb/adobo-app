"use client";

import type { IterationMarker } from "@/lib/timeline-positioning";

interface TimelineHeaderProps {
  markers: IterationMarker[];
}

export function TimelineHeader({ markers }: TimelineHeaderProps) {
  return (
    <div className="relative flex h-12 border-b border-zinc-700 bg-zinc-900 sticky top-0 z-10">
      {markers.map((marker) => (
        <div
          key={marker.path}
          className="absolute top-0 h-full border-r border-zinc-700 px-2 flex items-center"
          style={{
            left: `${marker.leftPercent}%`,
            width: `${marker.widthPercent}%`,
          }}
        >
          <span className="text-xs text-zinc-400 truncate font-medium">
            {marker.name}
          </span>
        </div>
      ))}
    </div>
  );
}
