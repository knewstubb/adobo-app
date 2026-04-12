"use client";

import { useState } from "react";
import type { WorkItem } from "@/lib/types";
import { Warning } from "@phosphor-icons/react";

interface RemoveConfirmModalProps {
  item: WorkItem;
  allItems: WorkItem[];
  onConfirm: (itemIds: number[]) => void;
  onCancel: () => void;
}

export function RemoveConfirmModal({ item, allItems, onConfirm, onCancel }: RemoveConfirmModalProps) {
  const [confirming, setConfirming] = useState(false);

  // Find all descendants
  const descendants: WorkItem[] = [];
  function findDescendants(parentId: number) {
    for (const wi of allItems) {
      if (wi.parentId === parentId && wi.state !== "Removed") {
        descendants.push(wi);
        findDescendants(wi.id);
      }
    }
  }
  findDescendants(item.id);

  const totalCount = 1 + descendants.length;
  const allIds = [item.id, ...descendants.map(d => d.id)];

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="bg-surface-elevated border border-border-modal rounded-lg shadow-[0px_16px_70px_0px_rgba(0,0,0,0.5)] w-[420px] p-5 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-red-500/15 flex items-center justify-center">
            <Warning size={18} className="text-red-400" />
          </div>
          <h3 className="text-sm font-medium text-text-primary">Remove {item.workItemType}?</h3>
        </div>

        <p className="text-xs text-text-secondary mb-3">
          This will set <span className="text-text-primary font-medium">{item.title}</span> and all its children to Removed in ADO.
        </p>

        {descendants.length > 0 && (
          <div className="bg-surface-app border border-border-subtle rounded-md p-3 mb-4 max-h-[200px] overflow-y-auto">
            <p className="text-[10px] text-text-muted mb-2">{totalCount} items will be removed:</p>
            <ul className="space-y-1">
              <li className="text-[10px] text-text-secondary font-medium">{item.title}</li>
              {descendants.map(d => (
                <li key={d.id} className="text-[10px] text-text-muted pl-2">- {d.title}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs text-text-muted hover:text-text-secondary border border-border-subtle rounded-md hover:border-border-button transition-colors">
            Cancel
          </button>
          <button
            onClick={() => { setConfirming(true); onConfirm(allIds); }}
            disabled={confirming}
            className="px-3 py-1.5 text-xs text-white bg-red-500 hover:bg-red-600 rounded-md transition-colors disabled:opacity-50"
          >
            {confirming ? "Removing..." : `Remove ${totalCount} item${totalCount > 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
