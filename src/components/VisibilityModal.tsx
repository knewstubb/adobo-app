"use client";

import { useState, useMemo } from "react";
import type { WorkItem } from "@/lib/types";
import { CaretRight, CaretDown, DotOutline, Asterisk, CrownSimple, Trophy, Eye, EyeSlash, X, UsersThree } from "@phosphor-icons/react";

interface VisibilityModalProps {
  items: WorkItem[];
  hiddenIds: Set<number>;
  onToggle: (itemId: number, visible: boolean) => void;
  onToggleBranch: (itemId: number, visible: boolean) => void;
  onClose: () => void;
  areaPaths: string[];
  selectedAreaPath: string | null;
  onAreaPathChange: (path: string | null) => void;
}

const SUMMARY_TYPES = new Set(["Initiative", "Epic", "Feature"]);

interface TreeNode {
  item: WorkItem;
  children: TreeNode[];
}

export function VisibilityModal({
  items,
  hiddenIds,
  onToggle,
  onToggleBranch,
  onClose,
  areaPaths,
  selectedAreaPath,
  onAreaPathChange,
}: VisibilityModalProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");

  // Filter to summary types only (Initiative > Epic > Feature), exclude Removed
  const summaryItems = useMemo(() => {
    let filtered = items.filter(i => SUMMARY_TYPES.has(i.workItemType) && i.state !== "Removed");
    if (selectedAreaPath) {
      filtered = filtered.filter(i => i.areaPath?.startsWith(selectedAreaPath));
    }
    return filtered;
  }, [items, selectedAreaPath]);

  // Build tree grouped by area path
  interface AreaGroup {
    path: string;
    label: string;
    roots: TreeNode[];
  }

  const areaGroups = useMemo((): AreaGroup[] => {
    const itemMap = new Map<number, WorkItem>();
    for (const item of summaryItems) itemMap.set(item.id, item);

    const childrenMap = new Map<number, TreeNode[]>();
    const roots: TreeNode[] = [];

    for (const item of summaryItems) {
      const node: TreeNode = { item, children: [] };
      if (item.parentId && itemMap.has(item.parentId)) {
        const siblings = childrenMap.get(item.parentId) ?? [];
        siblings.push(node);
        childrenMap.set(item.parentId, siblings);
      } else {
        roots.push(node);
      }
    }

    function attachChildren(node: TreeNode) {
      node.children = childrenMap.get(node.item.id) ?? [];
      node.children.sort((a, b) => a.item.localSortOrder - b.item.localSortOrder || a.item.id - b.item.id);
      for (const child of node.children) attachChildren(child);
    }
    for (const root of roots) attachChildren(root);
    roots.sort((a, b) => a.item.localSortOrder - b.item.localSortOrder || a.item.id - b.item.id);

    // Group roots by area path
    const groupMap = new Map<string, TreeNode[]>();
    for (const root of roots) {
      const path = root.item.areaPath ?? "Unknown";
      const group = groupMap.get(path) ?? [];
      group.push(root);
      groupMap.set(path, group);
    }

    // If filtering by area path, only show that group
    const groups: AreaGroup[] = [];
    for (const [path, groupRoots] of groupMap) {
      if (selectedAreaPath && !path.startsWith(selectedAreaPath)) continue;
      groups.push({
        path,
        label: path.split("\\").pop() ?? path,
        roots: groupRoots,
      });
    }
    groups.sort((a, b) => a.label.localeCompare(b.label));
    return groups;
  }, [summaryItems, selectedAreaPath]);

  // Search filter
  const matchesSearch = (item: WorkItem) => {
    if (!search) return true;
    return item.title.toLowerCase().includes(search.toLowerCase());
  };

  // Count children (including PBIs) for display
  const childCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const item of items) {
      if (item.parentId) {
        counts.set(item.parentId, (counts.get(item.parentId) ?? 0) + 1);
      }
    }
    return counts;
  }, [items]);

  function toggleCollapse(id: number) {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function isVisible(id: number) {
    return !hiddenIds.has(id);
  }

  // Check if any descendant is visible
  function hasVisibleDescendant(node: TreeNode): boolean {
    if (isVisible(node.item.id)) return true;
    return node.children.some(c => hasVisibleDescendant(c));
  }

  function renderNode(node: TreeNode, depth: number): React.ReactNode {
    if (!matchesSearch(node.item) && !node.children.some(c => matchesSearch(c.item))) {
      return null;
    }

    const visible = isVisible(node.item.id);
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.item.id);
    const count = childCounts.get(node.item.id) ?? 0;

    const typeColor2 = node.item.workItemType === "Initiative" ? "text-blue-500"
      : node.item.workItemType === "Epic" ? "text-orange-400"
      : "text-purple-400";



    return (
      <div key={node.item.id}>
        <div
          className="flex items-center gap-2 py-1.5 px-2 hover:bg-surface-button/50 rounded transition-colors"
          style={{ paddingLeft: depth * 20 + 8 }}
        >
          {/* Expand/collapse */}
          <button
            onClick={() => hasChildren && toggleCollapse(node.item.id)}
            className="w-4 h-4 flex items-center justify-center text-text-muted flex-shrink-0"
          >
            {hasChildren ? (isCollapsed ? <CaretRight size={10} /> : <CaretDown size={10} />) : <DotOutline size={10} className="text-border-default" />}
          </button>

          {/* Eye toggle */}
          <button
            onClick={() => onToggleBranch(node.item.id, !visible)}
            className={`w-5 h-5 flex items-center justify-center rounded transition-colors flex-shrink-0 ${
              visible ? "text-blue-400 hover:text-blue-300" : "text-text-muted hover:text-text-muted"
            }`}
            title={visible ? "Hide this item and children" : "Show this item and parents"}
          >
            {visible ? <Eye size={14} /> : <EyeSlash size={14} />}
          </button>

          {/* Type icon */}
          <span className={`${typeColor2} flex-shrink-0`}>
            {node.item.workItemType === "Initiative" ? <Asterisk size={12} weight="bold" /> : node.item.workItemType === "Epic" ? <CrownSimple size={12} weight="fill" /> : <Trophy size={12} weight="fill" />}
          </span>

          {/* Title */}
          <span className={`text-xs truncate flex-1 ${visible ? "text-text-primary" : "text-text-muted"}`}>
            {node.item.title}
          </span>

          {/* Child count */}
          {count > 0 && (
            <span className="text-[10px] text-text-muted flex-shrink-0">{count}</span>
          )}
        </div>

        {/* Children */}
        {hasChildren && !isCollapsed && (
          <div>
            {node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface-elevated border border-border-default rounded-lg shadow-xl w-[500px] max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h2 className="text-sm font-medium text-text-primary">Visibility</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary"><X size={16} /></button>
        </div>

        {/* Area path selector */}
        <div className="px-4 py-2 border-b border-border-subtle">
          <select
            value={selectedAreaPath ?? ""}
            onChange={e => onAreaPathChange(e.target.value || null)}
            className="w-full linear-input text-xs"
          >
            <option value="">All area paths</option>
            {areaPaths.map(p => (
              <option key={p} value={p}>{p.split("\\").pop()}</option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-border-subtle">
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full linear-input text-xs"
          />
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {areaGroups.length === 0 ? (
            <div className="text-center text-text-muted text-xs py-8">
              No items found. Try syncing or selecting a different area path.
            </div>
          ) : (
            areaGroups.map(group => {
              const groupCollapsed = collapsed.has(-group.path.length); // use negative hash as key
              const groupKey = -Math.abs(group.path.split("").reduce((a, c) => a + c.charCodeAt(0), 0));
              const isGroupCollapsed = collapsed.has(groupKey);
              return (
                <div key={group.path}>
                  {(() => {
                    const allRootIds = group.roots.map(r => r.item.id);
                    const allGroupVisible = allRootIds.every(id => !hiddenIds.has(id));
                    return (
                      <div className="flex items-center gap-2 py-2 px-2 hover:bg-surface-button/50 rounded transition-colors">
                        <button
                          onClick={() => toggleCollapse(groupKey)}
                          className="w-4 h-4 flex items-center justify-center text-text-muted flex-shrink-0"
                        >
                          {isGroupCollapsed ? <CaretRight size={10} /> : <CaretDown size={10} />}
                        </button>
                        <button
                          onClick={() => { for (const id of allRootIds) onToggleBranch(id, !allGroupVisible); }}
                          className={`w-5 h-5 flex items-center justify-center rounded transition-colors flex-shrink-0 ${allGroupVisible ? "text-blue-400 hover:text-blue-300" : "text-text-muted hover:text-text-muted"}`}
                          title={allGroupVisible ? "Hide all in this area" : "Show all in this area"}
                        >
                          {allGroupVisible ? <Eye size={14} /> : <EyeSlash size={14} />}
                        </button>
                        <UsersThree size={14} weight="fill" className="text-teal-400 flex-shrink-0" />
                        <span className={`text-xs font-medium ${allGroupVisible ? "text-text-primary" : "text-text-muted"}`}>{group.label}</span>
                        <span className="text-[10px] text-text-muted">{group.roots.length}</span>
                      </div>
                    );
                  })()}
                  {!isGroupCollapsed && group.roots.map(node => renderNode(node, 1))}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border-default">
          <span className="text-[10px] text-text-muted">
            {items.filter(i => !hiddenIds.has(i.id)).length} / {items.length} visible
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => { for (const item of summaryItems) onToggle(item.id, true); }}
              className="text-[10px] text-text-muted hover:text-text-primary px-2 py-1 rounded hover:bg-surface-button"
            >
              Show all
            </button>
            <button
              onClick={onClose}
              className="text-xs text-text-secondary bg-surface-button hover:bg-surface-header px-3 py-1 rounded"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
