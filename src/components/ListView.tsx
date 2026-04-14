"use client";

import { useState, useRef, useCallback, useLayoutEffect, useEffect } from "react";
import type { WorkItem } from "@/lib/types";
import { STATE_COLOURS } from "@/lib/types";
import { CHILD_TYPE_MAP, SUMMARY_TYPES } from "@/lib/hierarchy";
import { CaretRight, CaretDown, DotOutline, Asterisk, CrownSimple, Trophy, ListChecks, ClipboardText, Plus, Bug, Copy, Check } from "@phosphor-icons/react";

interface ListViewProps {
  items: WorkItem[];
  allItems: WorkItem[];
  onItemClick: (item: WorkItem) => void;
  onReorder?: (itemId: number, newParentId: number | null, newSortOrder: number) => void;
  onCreateItem?: (parentId: number, workItemType: string) => void;
  onContextMenu?: (item: WorkItem, x: number, y: number) => void;
  pendingIds?: Set<number>;
  showOrphans?: boolean;
  visibleColumns?: ColKey[];
}

interface TreeNode {
  item: WorkItem;
  children: TreeNode[];
  depth: number;
}

type ColKey = "title" | "order" | "status" | "assignee" | "effort" | "tags" | "iteration" | "id";

const COL_META: Record<ColKey, { label: string; minWidth: number; align: string }> = {
  title:     { label: "Title",     minWidth: 150, align: "left" },
  order:     { label: "Order",     minWidth: 40,  align: "center" },
  status:    { label: "Status",    minWidth: 60,  align: "left" },
  assignee:  { label: "Assignee",  minWidth: 60,  align: "left" },
  effort:    { label: "Effort",    minWidth: 40,  align: "center" },
  tags:      { label: "Tags",      minWidth: 60,  align: "left" },
  iteration: { label: "Iteration", minWidth: 60,  align: "left" },
  id:        { label: "ID",        minWidth: 50,  align: "left" },
};

const INITIAL_WIDTHS: Record<ColKey, number> = {
  title: 0,
  order: 70,
  status: 120,
  assignee: 100,
  effort: 50,
  tags: 120,
  iteration: 110,
  id: 70,
};

const INITIAL_ORDER: ColKey[] = ["title", "order", "status", "assignee", "effort", "tags", "iteration", "id"];

function buildTree(items: WorkItem[], showOrphans: boolean): TreeNode[] {
  const itemMap = new Map(items.map(i => [i.id, i]));
  const childrenMap = new Map<number | null, WorkItem[]>();
  for (const item of items) {
    const pid = item.parentId;
    if (!childrenMap.has(pid)) childrenMap.set(pid, []);
    childrenMap.get(pid)!.push(item);
  }
  function buildNodes(parentId: number | null, depth: number): TreeNode[] {
    return (childrenMap.get(parentId) ?? [])
      .sort((a, b) => a.localSortOrder - b.localSortOrder || a.id - b.id)
      .map(item => ({ item, children: buildNodes(item.id, depth + 1), depth }));
  }
  const roots: TreeNode[] = [];
  const orphans: TreeNode[] = [];
  for (const item of items) {
    if (!item.parentId || !itemMap.has(item.parentId)) {
      const node: TreeNode = { item, children: buildNodes(item.id, 1), depth: 0 };
      (SUMMARY_TYPES.has(item.workItemType) || !item.parentId ? roots : orphans).push(node);
    }
  }
  roots.sort((a, b) => a.item.localSortOrder - b.item.localSortOrder || a.item.id - b.item.id);
  orphans.sort((a, b) => a.item.localSortOrder - b.item.localSortOrder || a.item.id - b.item.id);
  return showOrphans ? [...roots, ...orphans] : roots;
}

function flattenTree(nodes: TreeNode[], collapsed: Set<number>): TreeNode[] {
  const result: TreeNode[] = [];
  function walk(n: TreeNode) { result.push(n); if (!collapsed.has(n.item.id)) n.children.forEach(walk); }
  nodes.forEach(walk);
  return result;
}

export function ListView({ items, allItems, onItemClick, onReorder, onCreateItem, onContextMenu, pendingIds, showOrphans = false, visibleColumns }: ListViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<"above" | "below" | "inside" | null>(null);

  // All columns have fixed pixel widths. Title gets the remainder on mount.
  // Persist to localStorage so settings survive navigation.
  const [widths, setWidths] = useState<Record<ColKey, number>>(() => {
    if (typeof window !== "undefined") {
      try { const s = localStorage.getItem("listview-col-widths"); if (s) return JSON.parse(s); } catch {}
    }
    return INITIAL_WIDTHS;
  });
  const [colOrder, setColOrder] = useState<ColKey[]>(() => {
    if (typeof window !== "undefined") {
      try { const s = localStorage.getItem("listview-col-order"); if (s) return JSON.parse(s); } catch {}
    }
    return INITIAL_ORDER;
  });
  const [isResizing, setIsResizing] = useState(false);

  // Save to localStorage when widths or order change
  useEffect(() => {
    try { localStorage.setItem("listview-col-widths", JSON.stringify(widths)); } catch {}
  }, [widths]);
  useEffect(() => {
    try { localStorage.setItem("listview-col-order", JSON.stringify(colOrder)); } catch {}
  }, [colOrder]);

  // On mount, compute title width = container width - sum of other columns
  // Skip if widths were restored from localStorage (title > 0 means it was saved)
  const initialized = useRef(false);
  useLayoutEffect(() => {
    if (initialized.current) return;
    if (!containerRef.current) return;
    if (widths.title > 0) { initialized.current = true; return; }
    const cw = containerRef.current.clientWidth;
    const fixedSum = INITIAL_ORDER.filter(k => k !== "title").reduce((s, k) => s + INITIAL_WIDTHS[k], 0);
    const titleW = Math.max(COL_META.title.minWidth, cw - fixedSum);
    setWidths(prev => ({ ...prev, title: titleW }));
    initialized.current = true;
  }, []);

  // Resize: dragging the right edge of column[i] adjusts column[i] width.
  // The columns to the right just shift — no coupled resize needed since we allow horizontal scroll.
  const resizeRef = useRef<{ col: ColKey; startX: number; startW: number } | null>(null);

  const onResizePointerDown = useCallback((e: React.PointerEvent, col: ColKey) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizeRef.current = { col, startX: e.clientX, startW: widths[col] };
    setIsResizing(true);
  }, [widths]);

  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    const { col, startX, startW } = resizeRef.current;
    const delta = e.clientX - startX;
    const min = COL_META[col].minWidth;
    setWidths(prev => ({ ...prev, [col]: Math.max(min, startW + delta) }));
  }, []);

  const onResizePointerUp = useCallback(() => {
    resizeRef.current = null;
    setIsResizing(false);
  }, []);

  // Column drag-reorder
  const [dragCol, setDragCol] = useState<ColKey | null>(null);
  const [dropCol, setDropCol] = useState<ColKey | null>(null);
  const [dropSide, setDropSide] = useState<"left" | "right">("left");

  const tree = buildTree(items, showOrphans);
  const rows = flattenTree(tree, collapsed);

  // Filter columns by visibility settings (if provided)
  const effectiveColOrder = visibleColumns
    ? colOrder.filter(k => visibleColumns.includes(k))
    : colOrder;

  function toggle(id: number) {
    setCollapsed(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  // ADO hierarchy: Initiative(0) → Epic(1) → Feature(2) → PBI/Bug/Task(3)
  const HIERARCHY_LEVEL: Record<string, number> = {
    Initiative: 0, Epic: 1, Feature: 2,
    "Product Backlog Item": 3, Bug: 3, Task: 3,
  };

  function getLevel(type: string): number { return HIERARCHY_LEVEL[type] ?? 3; }

  // Can the dragged item be a direct child of the target?
  // Only valid if target is exactly one level above (direct parent relationship).
  function canBeDirectChildOf(dragType: string, targetType: string): boolean {
    return getLevel(targetType) === getLevel(dragType) - 1;
  }

  // Row drag handlers
  function handleRowDragStart(e: React.DragEvent, item: WorkItem) {
    setDragId(item.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(item.id));
  }

  function handleRowDragOver(e: React.DragEvent, targetId: number) {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top, h = rect.height;
    const t = items.find(i => i.id === targetId);
    const dragItem = dragId ? items.find(i => i.id === dragId) : null;
    if (!t || !dragItem || dragItem.id === t.id) {
      setDropTargetId(null); setDropPosition(null); return;
    }

    // Above/below: only allowed if target shares the same parent as the dragged item
    // This means reorder only — no re-parenting via above/below.
    const sameParent = dragItem.parentId === t.parentId;

    // Inside: only allowed if target is the correct direct parent type
    const canNest = SUMMARY_TYPES.has(t.workItemType) && canBeDirectChildOf(dragItem.workItemType, t.workItemType);

    let pos: "above" | "below" | "inside" | null = null;
    if (y < h * 0.25 && sameParent) pos = "above";
    else if (y > h * 0.75 && sameParent) pos = "below";
    else if (canNest) pos = "inside";
    else if (sameParent) pos = y < h * 0.5 ? "above" : "below";

    if (pos) {
      e.dataTransfer.dropEffect = "move";
      setDropPosition(pos);
      setDropTargetId(targetId);
    } else {
      e.dataTransfer.dropEffect = "none";
      setDropPosition(null);
      setDropTargetId(null);
    }
  }

  function handleRowDrop(e: React.DragEvent) {
    e.preventDefault();
    if (!dragId || !dropTargetId || !onReorder || !dropPosition) return;
    const t = items.find(i => i.id === dropTargetId);
    const dragItem = items.find(i => i.id === dragId);
    if (!t || !dragItem) return;

    if (dropPosition === "inside") {
      // Re-parent: make dragged item a child of target
      if (!canBeDirectChildOf(dragItem.workItemType, t.workItemType)) return;
      const sibs = items.filter(i => i.parentId === dropTargetId);
      onReorder(dragId, dropTargetId, sibs.length > 0 ? Math.max(...sibs.map(s => s.localSortOrder)) + 100 : 100);
    } else {
      // Reorder: must share the same parent — no re-parenting
      if (dragItem.parentId !== t.parentId) return;
      const pid = t.parentId;
      const sibs = items.filter(i => i.parentId === pid && i.id !== dragId).sort((a, b) => a.localSortOrder - b.localSortOrder);
      const ti = sibs.findIndex(s => s.id === dropTargetId);
      const ii = dropPosition === "above" ? ti : ti + 1;
      const prev = ii > 0 ? sibs[ii - 1].localSortOrder : 0;
      const next = ii < sibs.length ? sibs[ii].localSortOrder : prev + 200;
      onReorder(dragId, pid, Math.floor((prev + next) / 2));
    }
    setDragId(null); setDropTargetId(null); setDropPosition(null);
  }
  function handleRowDragEnd() { setDragId(null); setDropTargetId(null); setDropPosition(null); }

  const TypeIcon = (type: string) => {
    if (type === "Initiative") return <Asterisk size={12} weight="bold" className="text-blue-500" />;
    if (type === "Epic") return <CrownSimple size={12} weight="fill" className="text-orange-400" />;
    if (type === "Feature") return <Trophy size={12} weight="fill" className="text-purple-400" />;
    if (type === "Task") return <ClipboardText size={12} weight="fill" className="text-yellow-400" />;
    if (type === "Bug") return <Bug size={12} weight="fill" className="text-red-500" />;
    return <ListChecks size={12} className="text-blue-400" />;
  };

  // Columns that are blank for summary types (Initiative, Epic, Feature)
  const SUMMARY_ONLY_COLS = new Set<ColKey>(["title", "order", "id"]);

  function renderCell(col: ColKey, item: WorkItem) {
    // For summary types, only show title, order, status, and ID
    if (SUMMARY_TYPES.has(item.workItemType) && !SUMMARY_ONLY_COLS.has(col)) return null;

    switch (col) {
      case "order":
        return (
          <span className="text-[9px] text-text-muted font-mono" title={`localSortOrder: ${item.localSortOrder}\nstackRank: ${item.stackRank ?? "null"}`}>
            {item.localSortOrder}
            {item.stackRank != null && <span className="text-text-muted/60 ml-0.5">/{Math.round(item.stackRank)}</span>}
          </span>
        );
      case "status": {
        const bg = STATE_COLOURS[item.state] ?? "#6C757D";
        const isOutline = item.state === "Ready";
        return (
          <span className="flex items-center gap-1.5 text-[10px] text-text-muted whitespace-nowrap">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={isOutline ? { border: `1.5px solid ${bg}`, backgroundColor: "transparent" } : { backgroundColor: bg }} />
            {item.state}
          </span>
        );
      }
      case "assignee":
        return item.assignedTo
          ? <span className="text-[10px] text-text-muted truncate block">{item.assignedTo.split(" ")[0]}</span>
          : <span className="text-[10px] text-text-muted/60">--</span>;
      case "effort":
        return (
          <span className={`inline-flex w-5 h-5 rounded-full items-center justify-center text-[10px] font-medium leading-none ${
            item.effort != null ? "bg-blue-500/20 text-blue-400" : "bg-surface-button text-text-muted/60"
          }`}>
            {item.effort != null ? item.effort : "–"}
          </span>
        );
      case "tags":
        return item.tags.length > 0
          ? <span className="flex items-center gap-1 overflow-hidden">{item.tags.map(t => <span key={t} className="inline-block px-1.5 py-0.5 rounded text-[9px] bg-surface-button text-text-muted whitespace-nowrap">{t}</span>)}</span>
          : <span className="text-[10px] text-text-muted/60">--</span>;
      case "iteration": {
        const iterName = item.iterationPath?.split("\\").pop();
        const hasIteration = item.iterationPath && item.iterationPath !== "Spark" && iterName !== "Spark";
        return hasIteration
          ? <span className="text-[10px] text-text-muted truncate block">{iterName}</span>
          : <span className="text-[10px] text-text-muted/60">--</span>;
      }
      case "id": {
        const url = `https://dev.azure.com/${process.env.NEXT_PUBLIC_ADO_ORG ?? "sparknz"}/${process.env.NEXT_PUBLIC_ADO_PROJECT ?? "Spark"}/_workitems/edit/${item.id}`;
        return <CopyIdLink id={item.id} url={url} />;
      }
      default: return null;
    }
  }

  // Total row width for horizontal scroll
  const totalWidth = effectiveColOrder.reduce((s, k) => s + widths[k], 0);

  return (
    <div ref={containerRef} className="flex-1 overflow-auto" style={{ cursor: isResizing ? "col-resize" : undefined }}>
      <div style={{ minWidth: totalWidth }}>
        {/* Header */}
        <div
          className="flex items-center border-b border-border-subtle bg-surface-app sticky top-0 z-10 select-none"
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
        >
          {/* Add column spacer */}
          <div className="w-6 flex-shrink-0" />
          {effectiveColOrder.map((key, idx) => {
            const meta = COL_META[key];
            const showLeftLine = dropCol === key && dropSide === "left" && dragCol !== key;
            const showRightLine = dropCol === key && dropSide === "right" && dragCol !== key;
            return (
              <div
                key={key}
                draggable={!isResizing}
                onDragStart={e => { setDragCol(key); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", key); }}
                onDragOver={e => {
                  e.preventDefault();
                  if (!dragCol || dragCol === key) return;
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const side = (e.clientX - rect.left) < rect.width / 2 ? "left" : "right";
                  setDropCol(key);
                  setDropSide(side);
                }}
                onDrop={e => {
                  e.preventDefault();
                  if (!dragCol || dragCol === key) return;
                  setColOrder(prev => {
                    const n = prev.filter(c => c !== dragCol);
                    const targetIdx = n.indexOf(key);
                    const insertIdx = dropSide === "left" ? targetIdx : targetIdx + 1;
                    n.splice(insertIdx, 0, dragCol);
                    return n;
                  });
                  setDragCol(null); setDropCol(null);
                }}
                onDragEnd={() => { setDragCol(null); setDropCol(null); }}
                className={`relative flex items-center px-2 py-2 text-[10px] text-text-muted uppercase tracking-wider transition-colors ${
                  isResizing ? "" : "cursor-grab active:cursor-grabbing hover:bg-surface-header/60"
                } ${dragCol === key ? "opacity-40" : ""}`}
                style={{
                  width: widths[key],
                  flexShrink: 0,
                  justifyContent: meta.align === "right" ? "flex-end" : meta.align === "center" ? "center" : "flex-start",
                }}
              >
                {/* Drop insertion line — left */}
                {showLeftLine && <div className="absolute left-0 top-1 bottom-1 w-[2px] bg-blue-500 rounded-full z-20" />}
                {/* Drop insertion line — right */}
                {showRightLine && <div className="absolute right-0 top-1 bottom-1 w-[2px] bg-blue-500 rounded-full z-20" />}
                {meta.label}
                {/* Resize handle — right edge */}
                <div
                  className="absolute right-[-4px] top-0 bottom-0 w-[9px] z-30 flex items-center justify-center cursor-col-resize group/rh"
                  onPointerDown={e => onResizePointerDown(e, key)}
                  style={{ touchAction: "none" }}
                >
                  <div className="w-[2px] h-4 rounded-full bg-transparent group-hover/rh:bg-blue-500 transition-colors" />
                </div>
              </div>
            );
          })}
        </div>

        {/* Rows */}
        {rows.map(node => {
          const { item, depth, children } = node;
          const hasChildren = children.length > 0 || SUMMARY_TYPES.has(item.workItemType);
          const isCollapsed = collapsed.has(item.id);
          const isDragging = dragId === item.id;
          const isDropTarget = dropTargetId === item.id;

          return (
            <div
              key={item.id}
              draggable
              onDragStart={e => handleRowDragStart(e, item)}
              onDragOver={e => handleRowDragOver(e, item.id)}
              onDragLeave={() => { if (dropTargetId === item.id) { setDropTargetId(null); setDropPosition(null); } }}
              onDrop={handleRowDrop}
              onDragEnd={handleRowDragEnd}
              className={`relative flex items-center border-b border-border-subtle/50 hover:bg-surface-header/40 transition-colors cursor-default group ${
                isDragging ? "opacity-30" : ""
              } ${isDropTarget && dropPosition === "inside" ? "bg-blue-500/10 ring-1 ring-inset ring-blue-500/30" : ""}`}
            >
              {isDropTarget && dropPosition === "above" && <div className="absolute left-0 right-0 top-0 h-0.5 bg-blue-500 z-10" />}
              {isDropTarget && dropPosition === "below" && <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-blue-500 z-10" />}

              {/* Add child button */}
              <div className="w-6 flex-shrink-0 flex items-center justify-center">
                {onCreateItem && CHILD_TYPE_MAP[item.workItemType] && (
                  <button
                    onClick={e => { e.stopPropagation(); onCreateItem(item.id, CHILD_TYPE_MAP[item.workItemType]); }}
                    className="w-4 h-4 flex items-center justify-center rounded text-text-muted/0 group-hover:text-text-muted hover:text-blue-400 hover:bg-blue-500/10 transition-all cursor-pointer"
                    title={`New ${CHILD_TYPE_MAP[item.workItemType] === "Product Backlog Item" ? "PBI" : CHILD_TYPE_MAP[item.workItemType]}`}
                  >
                    <Plus size={10} weight="bold" />
                  </button>
                )}
              </div>

              {effectiveColOrder.map(key => {
                const meta = COL_META[key];
                if (key === "title") {
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-1.5 py-1.5 pr-2 min-w-0 overflow-hidden"
                      style={{ width: widths[key], flexShrink: 0, paddingLeft: 12 + depth * 20 }}
                    >
                      <button
                        onClick={e => { e.stopPropagation(); if (hasChildren) toggle(item.id); }}
                        className="w-4 h-4 flex items-center justify-center text-text-muted flex-shrink-0 cursor-pointer"
                      >
                        {hasChildren ? (isCollapsed ? <CaretRight size={10} /> : <CaretDown size={10} />) : <DotOutline size={8} className="text-border-default" />}
                      </button>
                      <span className="flex-shrink-0">{TypeIcon(item.workItemType)}</span>
                      <div
                        className="flex-1 min-w-0 truncate text-xs text-text-primary cursor-pointer hover:text-blue-400 transition-colors"
                        onClick={() => onItemClick(item)}
                        onContextMenu={e => { if (onContextMenu) { e.preventDefault(); onContextMenu(item, e.clientX, e.clientY); } }}
                      >
                        <span className={SUMMARY_TYPES.has(item.workItemType) ? "font-semibold" : ""}>{item.title}</span>
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={key}
                    className="flex items-center py-1.5 px-2 overflow-hidden"
                    style={{
                      width: widths[key],
                      flexShrink: 0,
                      justifyContent: meta.align === "right" ? "flex-end" : meta.align === "center" ? "center" : "flex-start",
                    }}
                  >
                    {renderCell(key, item)}
                  </div>
                );
              })}

              {pendingIds?.has(item.id) && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0 mr-2" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}


function CopyIdLink({ id, url }: { id: number; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex items-center gap-1">
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
        className="text-[10px] text-text-muted hover:text-blue-400 transition-colors">#{id}</a>
      <button
        onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="text-text-muted/60 hover:text-blue-400 transition-colors"
        title="Copy link"
      >
        {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
      </button>
    </span>
  );
}
