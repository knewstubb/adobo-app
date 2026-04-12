"use client";

import { useState } from "react";
import type { SavedView } from "@/lib/types";

interface SavedViewTabsProps {
  views: SavedView[];
  activeViewId: string | null;
  isDirty: boolean;
  onSelect: (view: SavedView) => void;
  onCreate: (name: string) => void;
  onUpdate: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function SavedViewTabs({ views, activeViewId, isDirty, onSelect, onCreate, onUpdate, onRename, onDelete }: SavedViewTabsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");

  function startRename(view: SavedView) { setEditingId(view.id); setEditName(view.name); }
  function commitRename() { if (editingId && editName.trim()) onRename(editingId, editName.trim()); setEditingId(null); }
  function commitNew() { if (newName.trim()) onCreate(newName.trim()); setNewName(""); setShowNew(false); }

  return (
    <div className="flex items-center gap-1 border-b border-border-subtle px-3 py-1 bg-surface-sidebar overflow-x-auto">
      {views.map((view) => (
        <div key={view.id} className="relative group flex items-center">
          {editingId === view.id ? (
            <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingId(null); }}
              className="text-xs linear-input w-24" />
          ) : (
            <button onClick={() => onSelect(view)} onDoubleClick={() => !view.isDefault && startRename(view)}
              className={`text-xs px-3 py-1.5 rounded-t linear-btn ${
                activeViewId === view.id
                  ? "bg-surface-button text-text-primary border-b-2 border-blue-500"
                  : "text-text-muted hover:text-text-secondary hover:bg-surface-button/50"
              }`}>
              {view.name}
              {activeViewId === view.id && isDirty && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />}
            </button>
          )}
          {!view.isDefault && activeViewId === view.id && (
            <div className="hidden group-hover:flex items-center gap-0.5 ml-1">
              <button onClick={() => onUpdate(view.id)} className="text-[10px] text-text-muted hover:text-text-secondary" title="Save view">&#10003;</button>
              <button onClick={() => onDelete(view.id)} className="text-[10px] text-text-muted hover:text-red-400" title="Delete view">&times;</button>
            </div>
          )}
        </div>
      ))}
      {showNew ? (
        <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onBlur={commitNew}
          onKeyDown={(e) => { if (e.key === "Enter") commitNew(); if (e.key === "Escape") setShowNew(false); }}
          placeholder="View name..." className="text-xs linear-input w-24" />
      ) : (
        <button onClick={() => setShowNew(true)} className="text-xs text-text-muted hover:text-text-secondary px-2 py-1">+ New View</button>
      )}
    </div>
  );
}
