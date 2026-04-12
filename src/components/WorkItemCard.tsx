"use client";

import type { WorkItem } from "@/lib/types";
import { STATE_COLOURS } from "@/lib/types";

interface WorkItemCardProps {
  item: WorkItem;
  isPending?: boolean;
  onClick: (item: WorkItem) => void;
}

export function WorkItemCard({ item, isPending, onClick }: WorkItemCardProps) {
  const bgColor = STATE_COLOURS[item.state] ?? "#6C757D";

  return (
    <button
      onClick={() => onClick(item)}
      className="relative w-full text-left rounded px-2 py-1.5 text-xs cursor-pointer transition-opacity hover:opacity-90 border border-transparent hover:border-zinc-500"
      style={{ backgroundColor: `${bgColor}22`, borderLeftColor: bgColor, borderLeftWidth: 3 }}
    >
      {isPending && (
        <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
      )}
      <p className="truncate font-medium text-zinc-100">{item.title}</p>
      <div className="flex items-center gap-2 mt-0.5">
        <span
          className="inline-block rounded px-1 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: `${bgColor}44`, color: bgColor }}
        >
          {item.state}
        </span>
        {item.assignedTo && (
          <span className="text-[10px] text-zinc-500 truncate">
            {item.assignedTo}
          </span>
        )}
      </div>
    </button>
  );
}
