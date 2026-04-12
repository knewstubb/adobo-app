"use client";

import { useEffect, useRef } from "react";
import type { WorkItem } from "@/lib/types";
import { Plus, Trash } from "@phosphor-icons/react";

const CHILD_TYPE_MAP: Record<string, string> = {
  Initiative: "Epic",
  Epic: "Feature",
  Feature: "Product Backlog Item",
};

const TASK_PARENT_TYPES = new Set(["Product Backlog Item", "Bug"]);

interface ContextMenuProps {
  item: WorkItem;
  x: number;
  y: number;
  showTasks?: boolean;
  onClose: () => void;
  onCreateChild?: (parentId: number, workItemType: string) => void;
  onRemove?: (item: WorkItem) => void;
}

export function ContextMenu({ item, x, y, showTasks, onClose, onCreateChild, onRemove }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    return () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); };
  }, []);

  function handleMouseLeave() {
    leaveTimer.current = setTimeout(onClose, 400);
  }

  function handleMouseEnter() {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
  }

  // Flip upward if menu would go off-screen
  const menuHeight = 80; // approximate
  const flipY = y + menuHeight > window.innerHeight;
  const flipX = x + 180 > window.innerWidth;

  const style: React.CSSProperties = {
    position: "fixed",
    left: flipX ? x - 180 : x,
    top: flipY ? y - menuHeight : y,
    zIndex: 9999,
  };

  const childType = CHILD_TYPE_MAP[item.workItemType] ?? (showTasks && TASK_PARENT_TYPES.has(item.workItemType) ? "Task" : undefined);
  const childLabel = childType === "Product Backlog Item" ? "PBI" : childType;

  return (
    <div ref={ref} style={style} onMouseLeave={handleMouseLeave} onMouseEnter={handleMouseEnter} className="bg-surface-elevated border border-border-modal rounded-lg shadow-[0px_4px_24px_0px_rgba(0,0,0,0.3)] py-1 min-w-[180px] animate-in fade-in zoom-in-95 duration-100">
      {childType && onCreateChild && (
        <button
          onClick={() => { onCreateChild(item.id, childType); onClose(); }}
          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-header/60 transition-colors text-left"
        >
          <Plus size={13} className="text-text-muted" />
          Create {childLabel}
        </button>
      )}
      {onRemove && (
        <button
          onClick={() => { onRemove(item); onClose(); }}
          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors text-left"
        >
          <Trash size={13} />
          Remove
        </button>
      )}
    </div>
  );
}
