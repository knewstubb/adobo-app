"use client";

import { useState, useRef } from "react";
import type { WorkItem } from "@/lib/types";
import { STATE_COLOURS } from "@/lib/types";
import { getStatesForType } from "@/lib/types";
import { CaretDown, CaretRight, User, Copy, Check } from "@phosphor-icons/react";

const COLUMNS = ["New", "Under Assessment", "Approved", "Ready", "Committed", "Done"];

interface KanbanBoardProps {
  items: WorkItem[];
  allItems: WorkItem[];
  onItemClick: (item: WorkItem) => void;
  onContextMenu?: (item: WorkItem, x: number, y: number) => void;
  onStateChange: (itemId: number, newState: string, previousState: string) => void;
  onReorder?: (itemId: number, newSortOrder: number) => void;
  pendingIds?: Set<number>;
  showDone?: boolean;
  filteredStates?: string[];
}

interface DragState {
  itemId: number;
  fromState: string;
}

export function KanbanBoard({ items, allItems, onItemClick, onContextMenu, onStateChange, onReorder, pendingIds, showDone = false, filteredStates }: KanbanBoardProps) {
  const [collapsedLanes, setCollapsedLanes] = useState<Set<number>>(new Set());
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dropBeforeId, setDropBeforeId] = useState<number | null>(null);

  // Only PBIs (not Initiatives, Epics, Features)
  const pbis = items.filter(i => i.workItemType === "Product Backlog Item" || i.workItemType === "Bug" || i.workItemType === "Task");

  // Determine visible columns: only show states that are in the active filter (or all if no filter)
  const columns = COLUMNS
    .filter(c => !showDone ? c !== "Done" : true)
    .filter(c => !filteredStates?.length || filteredStates.includes(c));

  // Build initiative lookup
  const initiativeMap = new Map<number, WorkItem>();
  for (const item of allItems) {
    if (item.workItemType === "Initiative") initiativeMap.set(item.id, item);
  }

  // Build epic lookup
  const epicMap = new Map<number, WorkItem>();
  for (const item of allItems) {
    if (item.workItemType === "Epic") epicMap.set(item.id, item);
  }

  // Build feature lookup for path display
  const featureMap = new Map<number, WorkItem>();
  for (const item of allItems) {
    if (item.workItemType === "Feature") featureMap.set(item.id, item);
  }

  // Group PBIs by initiative → epic
  type EpicGroup = { epicId: number | null; items: WorkItem[] };
  type InitiativeGroup = { initiativeId: number | null; epics: Map<number | null, WorkItem[]> };
  const initiativeGroups = new Map<number | null, InitiativeGroup>();

  for (const pbi of pbis) {
    const initId = pbi.initiativeId ?? null;
    const epicId = pbi.epicId ?? null;
    if (!initiativeGroups.has(initId)) {
      initiativeGroups.set(initId, { initiativeId: initId, epics: new Map() });
    }
    const group = initiativeGroups.get(initId)!;
    if (!group.epics.has(epicId)) group.epics.set(epicId, []);
    group.epics.get(epicId)!.push(pbi);
  }

  // Sort initiatives: named first, then null
  const sortedInitIds = [...initiativeGroups.keys()].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    const nameA = initiativeMap.get(a)?.title ?? "";
    const nameB = initiativeMap.get(b)?.title ?? "";
    return nameA.localeCompare(nameB);
  });

  function toggleLane(key: string) {
    setCollapsedLanes(prev => {
      const next = new Set(prev);
      const numKey = parseInt(key) || -1;
      if (next.has(numKey)) next.delete(numKey); else next.add(numKey);
      return next;
    });
  }

  function handleDragStart(e: React.DragEvent, item: WorkItem) {
    setDragState({ itemId: item.id, fromState: item.state });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(item.id));
  }

  function handleDragOver(e: React.DragEvent, dropKey: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(dropKey);
  }

  function handleCardDragOver(e: React.DragEvent, cardId: number) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropBeforeId(cardId);
  }

  function handleDragLeave() {
    setDropTarget(null);
    setDropBeforeId(null);
  }

  function handleDrop(e: React.DragEvent, newState: string, columnItems: WorkItem[]) {
    e.preventDefault();
    setDropTarget(null);
    if (!dragState) return;

    // State change if different column — only if the target state is valid for this item type
    if (dragState.fromState !== newState) {
      const draggedItem = pbis.find(i => i.id === dragState.itemId);
      const validStates = draggedItem ? getStatesForType(draggedItem.workItemType) : [];
      if (validStates.includes(newState)) {
        onStateChange(dragState.itemId, newState, dragState.fromState);
      }
    }

    // Reorder within same column/epic
    if (onReorder && dropBeforeId !== null && dropBeforeId !== dragState.itemId) {
      const targetItem = columnItems.find(i => i.id === dropBeforeId);
      if (targetItem) {
        // Place before the target item
        const targetIdx = columnItems.findIndex(i => i.id === dropBeforeId);
        const prevOrder = targetIdx > 0 ? columnItems[targetIdx - 1].localSortOrder : targetItem.localSortOrder - 100;
        const newOrder = Math.floor((prevOrder + targetItem.localSortOrder) / 2);
        onReorder(dragState.itemId, newOrder);
      }
    }

    setDragState(null);
    setDropBeforeId(null);
  }

  function handleDragEnd() {
    setDragState(null);
    setDropTarget(null);
    setDropBeforeId(null);
  }

  let isFirstLane = true;

  return (
    <div className="flex-1 overflow-auto px-4 pb-4">
      {/* Column headers — sticky at top */}
      <div className="flex gap-3 mb-2 sticky top-0 z-10 bg-surface-app py-2 -mx-4 px-4 border-b border-border-subtle">
        <div className="w-0" /> {/* spacer for alignment */}
        {columns.map(state => {
          const colColor = STATE_COLOURS[state] ?? "#6C757D";
          return (
            <div key={state} className="flex-1 min-w-[180px] flex items-center gap-2 px-3 py-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colColor }} />
              <span className="text-[11px] font-medium text-text-muted">{state}</span>
              <span className="text-[10px] text-text-muted ml-auto">
                {pbis.filter(i => i.state === state).length}
              </span>
            </div>
          );
        })}
      </div>

      {sortedInitIds.map(initId => {
        const initiative = initId !== null ? initiativeMap.get(initId) : null;
        const initName = initiative?.title ?? "No Initiative";
        const initKey = `init-${initId ?? "none"}`;
        const initCollapsed = collapsedLanes.has(initId ?? -1);
        const group = initiativeGroups.get(initId)!;
        const initItemCount = [...group.epics.values()].reduce((sum, arr) => sum + arr.length, 0);

        // Sort epics within this initiative
        const sortedEpicIds = [...group.epics.keys()].sort((a, b) => {
          if (a === null) return 1;
          if (b === null) return -1;
          return (epicMap.get(a)?.title ?? "").localeCompare(epicMap.get(b)?.title ?? "");
        });

        return (
          <div key={initKey} className="mb-3">
            {/* Initiative header */}
            <button
              onClick={() => toggleLane(String(initId ?? -1))}
              className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-text-muted hover:text-text-secondary w-full text-left"
            >
              {initCollapsed ? <CaretRight size={11} /> : <CaretDown size={11} />}
              <span className="text-blue-400/80">{initName}</span>
              <span className="text-text-muted font-normal">({initItemCount})</span>
            </button>

            {!initCollapsed && sortedEpicIds.map(epicId => {
              const epic = epicId !== null ? epicMap.get(epicId) : null;
              const epicName = epic?.title ?? "No Epic";
              const epicKey = `epic-${initId ?? "none"}-${epicId ?? "none"}`;
              const epicNumKey = (initId ?? -1) * 100000 + (epicId ?? -2);
              const epicCollapsed = collapsedLanes.has(epicNumKey);
              const epicItems = group.epics.get(epicId) ?? [];

              return (
                <div key={epicKey} className="ml-4 mb-2">
                  {/* Epic header */}
                  <button
                    onClick={() => {
                      setCollapsedLanes(prev => {
                        const next = new Set(prev);
                        if (next.has(epicNumKey)) next.delete(epicNumKey); else next.add(epicNumKey);
                        return next;
                      });
                    }}
                    className="flex items-center gap-2 px-2 py-1 text-xs text-text-muted hover:text-text-secondary w-full text-left"
                  >
                    {epicCollapsed ? <CaretRight size={10} /> : <CaretDown size={10} />}
                    <span className="text-orange-400/70">{epicName}</span>
                    <span className="text-text-muted/60 text-[10px]">({epicItems.length})</span>
                  </button>

                  {!epicCollapsed && (
                    <div className="flex gap-3 pb-1">
                      {columns.map(state => {
                        const columnItems = epicItems
                          .filter(i => i.state === state)
                          .sort((a, b) => a.localSortOrder - b.localSortOrder);
                        const dropKey = `${epicNumKey}-${state}`;
                        const isDropping = dropTarget === dropKey;

                        return (
                          <div
                            key={state}
                            className={`flex-1 min-w-[180px] rounded-lg transition-colors ${
                              isDropping ? "bg-blue-500/10 ring-1 ring-blue-500/30" : "bg-surface-sidebar/30"
                            }`}
                            onDragOver={e => handleDragOver(e, dropKey)}
                            onDragLeave={handleDragLeave}
                            onDrop={e => { setDropTarget(null); setDropBeforeId(null); handleDrop(e, state, columnItems); }}
                          >
                            <div className="px-1.5 py-1 space-y-0 min-h-[32px]">
                              {columnItems.map(item => (
                                <div key={item.id}>
                                  {/* Drop indicator line */}
                                  {dropBeforeId === item.id && dragState?.itemId !== item.id && (
                                    <div className="h-0.5 bg-blue-500 rounded-full mx-1 my-1" />
                                  )}
                                  <div
                                    className="py-0.5"
                                    onDragOver={e => handleCardDragOver(e, item.id)}
                                  >
                                    <KanbanCard
                                      key={item.id}
                                      item={item}
                                      feature={item.featureId ? featureMap.get(item.featureId) : undefined}
                                      isPending={pendingIds?.has(item.id)}
                                      isDragging={dragState?.itemId === item.id}
                                      onClick={() => onItemClick(item)}
                                      onContextMenu={onContextMenu ? (e: React.MouseEvent) => { e.preventDefault(); onContextMenu(item, e.clientX, e.clientY); } : undefined}
                                      onDragStart={e => handleDragStart(e, item)}
                                      onDragEnd={handleDragEnd}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({ item, feature, isPending, isDragging, onClick, onContextMenu, onDragStart, onDragEnd }: {
  item: WorkItem;
  feature?: WorkItem;
  isPending?: boolean;
  isDragging?: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const bg = STATE_COLOURS[item.state] ?? "#6C757D";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`bg-surface-elevated border border-border-subtle rounded-md p-2.5 cursor-pointer hover:border-border-button transition-all group ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      {/* Top row: feature path + effort */}
      <div className="flex items-start justify-between gap-1 mb-1">
        {feature ? (
          <div className="text-[10px] text-purple-400/70 truncate">{feature.title}</div>
        ) : <div />}
        <span className={`flex-shrink-0 rounded-full flex items-center justify-center text-[11px] font-medium leading-none ${
          item.effort != null ? "bg-blue-500/20 text-blue-400" : "bg-surface-button text-text-muted"
        }`} style={{ width: 22, height: 22 }}>
          {item.effort != null ? item.effort : "–"}
        </span>
      </div>

      {/* Title */}
      <div className="text-xs text-text-primary leading-snug mb-2 line-clamp-2">{item.title}</div>

      {/* Footer: assignee + tags + id */}
      <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
        {item.assignedTo ? (
          <span className="flex items-center gap-1 truncate max-w-[100px]">
            <User size={10} weight="fill" />
            <span className="truncate">{item.assignedTo.split(" ")[0]}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-text-muted">
            <User size={10} />
            <span>Unassigned</span>
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 text-text-muted/60">
          <a
            href={`https://dev.azure.com/${process.env.NEXT_PUBLIC_ADO_ORG ?? "sparknz"}/${process.env.NEXT_PUBLIC_ADO_PROJECT ?? "Spark"}/_workitems/edit/${item.id}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="hover:text-blue-400 transition-colors"
          >#{item.id}</a>
          <KanbanCopyBtn id={item.id} />
        </span>
        {isPending && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />}
      </div>

      {/* Tags */}
      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {item.tags.slice(0, 2).map(tag => (
            <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400/70">{tag}</span>
          ))}
          {item.tags.length > 2 && <span className="text-[9px] text-text-muted">+{item.tags.length - 2}</span>}
        </div>
      )}
    </div>
  );
}


function KanbanCopyBtn({ id }: { id: number }) {
  const [copied, setCopied] = useState(false);
  const url = `https://dev.azure.com/${process.env.NEXT_PUBLIC_ADO_ORG ?? "sparknz"}/${process.env.NEXT_PUBLIC_ADO_PROJECT ?? "Spark"}/_workitems/edit/${id}`;
  return (
    <button
      onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-text-muted/60 hover:text-blue-400 transition-colors"
      title="Copy link"
    >
      {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
    </button>
  );
}
