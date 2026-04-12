"use client";

import { useState, useEffect, useRef } from "react";
import type {
  WorkItem,
  Iteration,
  TeamMember,
  SavedView,
  FilterState,
  GroupingDimension,
  SyncMetadata,
} from "@/lib/types";
import { applyFilters, applyDoneFilter, extractFilterOptions, getFilterCounts } from "@/lib/filter-logic";
import { computeTimelineRange, computeIterationMarkers } from "@/lib/timeline-positioning";
import { SavedViewTabs } from "./SavedViewTabs";
import { FilterBar } from "./FilterBar";
import { GroupingSelector } from "./GroupingSelector";
import { DoneToggle } from "./DoneToggle";
import { SyncStatus } from "./SyncStatus";
import { IterationViewToggle } from "./IterationViewToggle";
import { TimeRangeSelector } from "./TimeRangeSelector";
import { TimelineView } from "./TimelineView";
import { KanbanBoard } from "./KanbanBoard";
import { ListView } from "./ListView";
import { DetailModal } from "./DetailModal";
import { VisibilityModal } from "./VisibilityModal";
import { ContextMenu } from "./ContextMenu";
import { RemoveConfirmModal } from "./RemoveConfirmModal";
import { Eye, ArrowsClockwise, GearSix, WifiSlash } from "@phosphor-icons/react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { CredentialSettings } from "./CredentialSettings";
import {
  updateField as clientUpdateField,
  updateTags as clientUpdateTags,
  moveToIteration as clientMoveToIteration,
  updateSchedule as clientUpdateSchedule,
  reorderItem as clientReorderItem,
  createItem as clientCreateItem,
  removeItems as clientRemoveItems,
  updateDescription as clientUpdateDescription,
  updateAcceptanceCriteria as clientUpdateAcceptanceCriteria,
  updatePriority as clientUpdatePriority,
  updateTitle as clientUpdateTitle,
} from "@/lib/client-write-back";
import {
  createSavedView,
  updateSavedView,
  deleteSavedView,
  getHiddenItems,
  hideItems,
  showItems,
  getSyncAreaPaths,
  getAllWorkItems,
  getAllIterations,
  getAllTeamMembers,
  getSavedViews,
  getAllTags,
  getSyncMetadata,
  updateWorkItemField as idbUpdateField,
} from "@/lib/idb-cache";
import { performSync } from "@/lib/client-sync-engine";

interface AppData {
  workItems: WorkItem[];
  iterations: Iteration[];
  teamMembers: TeamMember[];
  savedViews: SavedView[];
  allTags: string[];
  syncMetadata: SyncMetadata | null;
}

export function AppLayout({ initial }: { initial: AppData }) {
  const [data, setData] = useState(initial);
  const [filters, setFilters] = useState<FilterState>({});
  const [grouping, setGrouping] = useState<GroupingDimension | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [iterationViewActive, setIterationViewActive] = useState(false);
  const [selectedIterationPath, setSelectedIterationPath] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(
    initial.savedViews.find((v) => v.isDefault)?.id ?? null
  );
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [visibleSprintCount, setVisibleSprintCount] = useState(2);
  const [showWeekends, setShowWeekends] = useState(false);
  const [viewMode, setViewMode] = useState<"timeline" | "kanban" | "list">("timeline");
  const scrollToTodayRef = useRef<(() => void) | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [showOrphans, setShowOrphans] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const [darkMode, setDarkMode] = useState(true);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [showVisibilityModal, setShowVisibilityModal] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());
  const [syncAreaPaths, setSyncAreaPaths] = useState<string[]>([]);
  const [selectedAreaPath, setSelectedAreaPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ item: WorkItem; x: number; y: number } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<WorkItem | null>(null);
  const [showCredentialSettings, setShowCredentialSettings] = useState(false);

  // Online/offline status
  const isOnline = useOnlineStatus();

  // Load area paths on mount
  useEffect(() => {
    getSyncAreaPaths().then(setSyncAreaPaths);
  }, []);

  // Load hidden items when active view changes
  useEffect(() => {
    if (activeViewId) {
      getHiddenItems(activeViewId).then(ids => setHiddenIds(new Set(ids)));
    } else {
      setHiddenIds(new Set());
    }
  }, [activeViewId]);

  const reorderingRef = useRef(false);

  // Refresh data from IndexedDB periodically (paused during reorder)
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!reorderingRef.current) await refreshData();
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  // Close settings menu on click outside
  useEffect(() => {
    if (!showSettings) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSettings]);

  // Close view menu on click outside
  useEffect(() => {
    if (!showViewMenu) return;
    const handler = (e: MouseEvent) => {
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target as Node)) {
        setShowViewMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showViewMenu]);

  async function refreshData() {
    const [workItems, iterations, teamMembers, savedViews, allTags, syncMetadata] =
      await Promise.all([
        getAllWorkItems(),
        getAllIterations(),
        getAllTeamMembers(),
        getSavedViews(),
        getAllTags(),
        getSyncMetadata(),
      ]);

    setData({ workItems, iterations, teamMembers, savedViews, allTags, syncMetadata });
  }

  // Apply filters and done toggle
  let visibleItems = applyDoneFilter(data.workItems, showDone);
  if (iterationViewActive && selectedIterationPath) {
    visibleItems = visibleItems.filter(
      (i) => i.iterationPath === selectedIterationPath
    );
  }
  visibleItems = applyFilters(visibleItems, filters);

  // Apply visibility filter — hide items and their descendants
  if (hiddenIds.size > 0) {
    const allHidden = new Set(hiddenIds);
    // Also hide children of hidden parents
    for (const item of visibleItems) {
      let parentId = item.parentId;
      while (parentId) {
        if (allHidden.has(parentId)) { allHidden.add(item.id); break; }
        const parent = data.workItems.find(i => i.id === parentId);
        parentId = parent?.parentId ?? null;
      }
    }
    visibleItems = visibleItems.filter(i => !allHidden.has(i.id));
  }

  // Ensure parent items are included if any of their descendants are visible
  // This prevents orphaned children from appearing at root level
  {
    // First, remove items whose ancestors are Removed
    const allItemsMap = new Map(data.workItems.map(i => [i.id, i]));
    const removedAncestorCache = new Map<number, boolean>();
    function hasRemovedAncestor(id: number): boolean {
      if (removedAncestorCache.has(id)) return removedAncestorCache.get(id)!;
      const item = allItemsMap.get(id);
      if (!item) { removedAncestorCache.set(id, false); return false; }
      if (item.state === "Removed") { removedAncestorCache.set(id, true); return true; }
      const result = item.parentId ? hasRemovedAncestor(item.parentId) : false;
      removedAncestorCache.set(id, result);
      return result;
    }
    visibleItems = visibleItems.filter(i => !hasRemovedAncestor(i.id));

    // Then, add missing ancestors for remaining visible items
    const visibleIds = new Set(visibleItems.map(i => i.id));
    for (const item of [...visibleItems]) {
      let parentId = item.parentId;
      while (parentId && !visibleIds.has(parentId)) {
        const parent = allItemsMap.get(parentId);
        if (!parent || parent.state === "Removed") break;
        visibleItems.push(parent);
        visibleIds.add(parent.id);
        parentId = parent.parentId;
      }
    }
  }

  // Hide orphans if toggle is off — orphans are root items that aren't summary types
  if (!showOrphans) {
    const SUMMARY_TYPES = new Set(["Initiative", "Epic", "Feature"]);
    visibleItems = visibleItems.filter(i => i.parentId !== null || SUMMARY_TYPES.has(i.workItemType));
  }

  // Hide tasks if toggle is off
  if (!showTasks) {
    visibleItems = visibleItems.filter(i => i.workItemType !== "Task");
  }

  const filterOptions = extractFilterOptions(data.workItems);
  const counts = getFilterCounts(data.workItems, visibleItems);

  // All iterations sorted by date — scoped to FY26 under Spark\Sprints
  const sortedIterations = [...data.iterations]
    .filter((i) => i.startDate && i.endDate && i.path.startsWith("Spark\\Sprints\\FY26\\"))
    .sort((a, b) => a.startDate!.getTime() - b.startDate!.getTime());

  // Use ALL iterations for the timeline range
  const range = computeTimelineRange(sortedIterations);
  const markers = range ? computeIterationMarkers(sortedIterations, range, showWeekends) : [];

  // Zoom: visibleSprintCount controls how many sprints fit in the viewport
  // If we have 3 sprints and zoom is 1, content is 300% wide (each sprint = full viewport)
  // If zoom is 3, content is 100% (all 3 fit in viewport)
  const totalSprints = Math.max(1, sortedIterations.length);
  const zoomWidth = Math.max(100, (totalSprints / Math.max(1, visibleSprintCount)) * 100);

  // Check if current settings differ from active saved view
  const activeView = data.savedViews.find((v) => v.id === activeViewId);
  const isDirty =
    activeView != null &&
    (JSON.stringify(filters) !== JSON.stringify(activeView.filterState) ||
      grouping !== activeView.grouping ||
      showDone !== activeView.showDone);

  // Handlers
  function handleViewSelect(view: SavedView) {
    setActiveViewId(view.id);
    setFilters(view.filterState);
    setGrouping(view.grouping);
    setShowDone(view.showDone);
    setIterationViewActive(view.iterationViewMode);
    setSelectedIterationPath(view.selectedIterationPath);
  }

  async function handleViewCreate(name: string) {
    const views = await getSavedViews();
    const view = await createSavedView({
      name,
      filterState: filters,
      grouping,
      showDone,
      iterationViewMode: iterationViewActive,
      selectedIterationPath,
      sortOrder: views.length,
      isDefault: false,
    });
    setData((d) => ({ ...d, savedViews: [...d.savedViews, view] }));
    setActiveViewId(view.id);
  }

  async function handleViewUpdate(id: string) {
    const updated = await updateSavedView(id, {
      filterState: filters,
      grouping,
      showDone,
      iterationViewMode: iterationViewActive,
      selectedIterationPath,
    });
    setData((d) => ({
      ...d,
      savedViews: d.savedViews.map((v) => (v.id === id ? updated : v)),
    }));
  }

  async function handleViewRename(id: string, name: string) {
    const updated = await updateSavedView(id, { name });
    setData((d) => ({
      ...d,
      savedViews: d.savedViews.map((v) => (v.id === id ? updated : v)),
    }));
  }

  async function handleViewDelete(id: string) {
    await deleteSavedView(id);
    setData((d) => ({
      ...d,
      savedViews: d.savedViews.filter((v) => v.id !== id),
    }));
    if (activeViewId === id) {
      const defaultView = data.savedViews.find((v) => v.isDefault);
      if (defaultView) handleViewSelect(defaultView);
    }
  }

  async function handleStateChange(newState: string) {
    if (!selectedItem) return;
    setPendingIds((s) => new Set(s).add(selectedItem.id));
    const result = await clientUpdateField(selectedItem.id, "state", newState, selectedItem.state);
    setPendingIds((s) => { const n = new Set(s); n.delete(selectedItem.id); return n; });
    if (result.success) {
      setSelectedItem({ ...selectedItem, state: newState });
      await refreshData();
    }
  }

  async function handleAssigneeChange(newAssignee: string | null) {
    if (!selectedItem) return;
    setPendingIds((s) => new Set(s).add(selectedItem.id));
    const result = await clientUpdateField(selectedItem.id, "assignedTo", newAssignee, selectedItem.assignedTo);
    setPendingIds((s) => { const n = new Set(s); n.delete(selectedItem.id); return n; });
    if (result.success) {
      setSelectedItem({ ...selectedItem, assignedTo: newAssignee });
      await refreshData();
    }
  }

  async function handleTagsChange(newTags: string[]) {
    if (!selectedItem) return;
    setPendingIds((s) => new Set(s).add(selectedItem.id));
    const result = await clientUpdateTags(selectedItem.id, newTags, selectedItem.tags);
    setPendingIds((s) => { const n = new Set(s); n.delete(selectedItem.id); return n; });
    if (result.success) {
      setSelectedItem({ ...selectedItem, tags: newTags });
      await refreshData();
    }
  }

  async function handleIterationChange(newIterationPath: string) {
    if (!selectedItem) return;
    setPendingIds((s) => new Set(s).add(selectedItem.id));
    const result = await clientMoveToIteration(selectedItem.id, newIterationPath, selectedItem.iterationPath ?? "");
    setPendingIds((s) => { const n = new Set(s); n.delete(selectedItem.id); return n; });
    if (result.success) {
      setSelectedItem({ ...selectedItem, iterationPath: newIterationPath });
      await refreshData();
    }
  }

  async function handleReorder(itemId: number, newParentId: number | null, newSortOrder: number, previousSiblingId: number = 0, nextSiblingId: number = 0) {
    reorderingRef.current = true;
    const renumbered = new Map<number, number>();
    setData(d => {
      // Get visible siblings at the target parent level (excluding the dragged item)
      const visibleIds = new Set(visibleItems.map(i => i.id));
      visibleIds.add(itemId);
      const siblings = d.workItems
        .filter(i => i.parentId === newParentId && visibleIds.has(i.id) && i.id !== itemId)
        .sort((a, b) => a.localSortOrder - b.localSortOrder || a.id - b.id);

      // Find the insert position based on previousSiblingId/nextSiblingId
      let insertIdx: number;
      if (previousSiblingId && nextSiblingId) {
        // Between two siblings: insert after previousSibling
        const prevIdx = siblings.findIndex(s => s.id === previousSiblingId);
        insertIdx = prevIdx >= 0 ? prevIdx + 1 : siblings.length;
      } else if (previousSiblingId) {
        // After a sibling (at end)
        const prevIdx = siblings.findIndex(s => s.id === previousSiblingId);
        insertIdx = prevIdx >= 0 ? prevIdx + 1 : siblings.length;
      } else if (nextSiblingId) {
        // Before a sibling (at start)
        const nextIdx = siblings.findIndex(s => s.id === nextSiblingId);
        insertIdx = nextIdx >= 0 ? nextIdx : 0;
      } else {
        insertIdx = siblings.length; // append at end
      }

      // Insert dragged item at the correct position
      const draggedItem = d.workItems.find(i => i.id === itemId)!;
      const ordered = [...siblings];
      ordered.splice(insertIdx, 0, { ...draggedItem, parentId: newParentId });

      // Assign sequential sort orders
      ordered.forEach((s, idx) => renumbered.set(s.id, (idx + 1) * 100));

      return {
        ...d,
        workItems: d.workItems.map(i => {
          if (i.id === itemId) return { ...i, parentId: newParentId, localSortOrder: renumbered.get(i.id)! };
          if (renumbered.has(i.id)) return { ...i, localSortOrder: renumbered.get(i.id)! };
          return i;
        }),
      };
    });

    // Persist to cache in parallel
    await Promise.all(
      Array.from(renumbered.entries()).map(([id, order]) =>
        idbUpdateField(id, "localSortOrder", order)
      )
    );

    setPendingIds((s) => new Set(s).add(itemId));
    const item = data.workItems.find((i) => i.id === itemId);
    const prevParentId = item?.parentId ?? null;
    const result = await clientReorderItem(itemId, newParentId, newSortOrder, prevParentId, previousSiblingId, nextSiblingId);
    setPendingIds((s) => { const n = new Set(s); n.delete(itemId); return n; });
    if (!result.success) await refreshData();
    reorderingRef.current = false;
  }

  async function handleToggleVisibility(itemId: number, visible: boolean) {
    if (!activeViewId) return;
    if (visible) {
      setHiddenIds(prev => { const n = new Set(prev); n.delete(itemId); return n; });
      await showItems(activeViewId, [itemId]);
    } else {
      setHiddenIds(prev => new Set(prev).add(itemId));
      await hideItems(activeViewId, [itemId]);
    }
  }

  async function handleToggleBranch(itemId: number, visible: boolean) {
    if (!activeViewId) return;
    // Find all descendants
    const descendants: number[] = [itemId];
    function findDescendants(parentId: number) {
      for (const item of data.workItems) {
        if (item.parentId === parentId) {
          descendants.push(item.id);
          findDescendants(item.id);
        }
      }
    }
    findDescendants(itemId);

    if (visible) {
      // Show this item and cascade up to root
      const toShow = [...descendants];
      let current = data.workItems.find(i => i.id === itemId);
      while (current?.parentId) {
        toShow.push(current.parentId);
        current = data.workItems.find(i => i.id === current!.parentId);
      }
      setHiddenIds(prev => { const n = new Set(prev); for (const id of toShow) n.delete(id); return n; });
      await showItems(activeViewId, toShow);
    } else {
      // Hide this item and all descendants
      setHiddenIds(prev => { const n = new Set(prev); for (const id of descendants) n.add(id); return n; });
      await hideItems(activeViewId, descendants);
    }
  }

  async function handleCreateItem(parentId: number, workItemType: string) {
    const shortType = workItemType === "Product Backlog Item" ? "PBI" : workItemType;
    const title = prompt("Enter title for new " + shortType + ":");
    if (!title?.trim()) return;
    const nowMs = Date.now();
    const currentIter = sortedIterations.find(
      i => i.startDate && i.endDate && i.startDate.getTime() <= nowMs && i.endDate.getTime() >= nowMs
    );
    const result = await clientCreateItem(parentId, workItemType, title.trim(), currentIter?.path);
    if (result.success && result.id) {
      // Optimistically add to local state immediately
      const newItem: WorkItem = {
        id: result.id,
        title: title.trim(),
        state: "New",
        assignedTo: null,
        iterationPath: currentIter?.path ?? null,
        areaPath: "Spark\\Tribes\\No Tribe\\UbiQuity Teams\\CX-AI Team",
        workItemType,
        description: null,
        acceptanceCriteria: null,
        parentId,
        initiativeId: null,
        epicId: null,
        featureId: null,
        tags: [],
        stackRank: null,
        adoChangedDate: new Date(),
        cachedAt: new Date(),
        localSortOrder: Math.max(0, ...data.workItems.filter(i => i.parentId === parentId).map(i => i.localSortOrder)) + 100,
        localStartDate: null,
        localEndDate: null,
        effort: null,
        priority: null,
      };
      setData(d => ({ ...d, workItems: [...d.workItems, newItem] }));
      // Insert into local IndexedDB cache so the 10-second poll doesn't lose it
      try {
        const { upsertWorkItems } = await import("@/lib/idb-cache");
        await upsertWorkItems([newItem]);
      } catch { /* non-critical */ }
    }
  }

  async function handleDescriptionChange(newDesc: string) {
    if (!selectedItem) return;
    const prev = selectedItem.description ?? "";
    setSelectedItem({ ...selectedItem, description: newDesc });
    await clientUpdateDescription(selectedItem.id, newDesc, prev);
  }

  async function handlePriorityChange(newPriority: number) {
    if (!selectedItem) return;
    setPendingIds((s) => new Set(s).add(selectedItem.id));
    const result = await clientUpdatePriority(selectedItem.id, newPriority, selectedItem.priority);
    setPendingIds((s) => { const n = new Set(s); n.delete(selectedItem.id); return n; });
    if (result.success) {
      setSelectedItem({ ...selectedItem, priority: newPriority });
      await refreshData();
    }
  }

  async function handleAcceptanceCriteriaChange(newAC: string) {
    if (!selectedItem) return;
    const prev = selectedItem.acceptanceCriteria ?? "";
    setSelectedItem({ ...selectedItem, acceptanceCriteria: newAC });
    await clientUpdateAcceptanceCriteria(selectedItem.id, newAC, prev);
  }

  async function handleRemoveItems(itemIds: number[]) {
    const prevStates: Record<number, string> = {};
    for (const id of itemIds) {
      const wi = data.workItems.find(i => i.id === id);
      if (wi) prevStates[id] = wi.state;
    }
    // Optimistic update
    setData(d => ({
      ...d,
      workItems: d.workItems.map(i => itemIds.includes(i.id) ? { ...i, state: "Removed" } : i),
    }));
    setRemoveTarget(null);
    const result = await clientRemoveItems(itemIds, prevStates);
    if (!result.success) await refreshData();
    else await refreshData();
  }

  function handleContextMenu(item: WorkItem, x: number, y: number) {
    setContextMenu({ item, x, y });
  }

  async function handleScheduleChange(itemId: number, startDate: Date, endDate: Date, iterationPath: string) {
    // Optimistically update local state immediately (no snap-back)
    setData(d => ({
      ...d,
      workItems: d.workItems.map(i => i.id === itemId ? {
        ...i,
        localStartDate: startDate,
        localEndDate: endDate,
        iterationPath: iterationPath || i.iterationPath,
      } : i),
    }));
    setPendingIds((s) => new Set(s).add(itemId));
    const item = data.workItems.find((i) => i.id === itemId);
    const prevIterPath = item?.iterationPath ?? "";
    const startStr = startDate.toISOString().split("T")[0];
    const endStr = endDate.toISOString().split("T")[0];
    const result = await clientUpdateSchedule(itemId, startStr, endStr, iterationPath, prevIterPath);
    setPendingIds((s) => { const n = new Set(s); n.delete(itemId); return n; });
    if (!result.success) await refreshData(); // Only refresh on failure to revert
  }

  return (
    <div className="flex flex-col h-screen bg-surface-app text-text-primary">
      {/* Offline Banner */}
      {!isOnline && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/15 border-b border-amber-500/30 text-amber-300 text-xs">
          <WifiSlash size={14} weight="bold" />
          <span>You&apos;re offline. Changes cannot be saved until connectivity is restored.</span>
        </div>
      )}

      {/* Saved View Tabs */}
      <SavedViewTabs
        views={data.savedViews}
        activeViewId={activeViewId}
        isDirty={isDirty}
        onSelect={handleViewSelect}
        onCreate={handleViewCreate}
        onUpdate={handleViewUpdate}
        onRename={handleViewRename}
        onDelete={handleViewDelete}
      />

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border-default bg-surface-sidebar flex-wrap">
        {/* View mode toggle */}
        <div className="flex items-center rounded-md border border-border-focus overflow-hidden">
          <button
            onClick={() => setViewMode("timeline")}
            className={`text-xs px-2.5 py-1 transition-colors ${viewMode === "timeline" ? "bg-blue-500/15 text-blue-400" : "text-text-muted hover:text-text-secondary"}`}
          >
            Timeline
          </button>
          <button
            onClick={() => {
              setViewMode("kanban");
              // Set default board filters if no status filter is active
              if (!filters.states?.length) {
                setFilters(f => ({ ...f, states: ["New", "Under Assessment", "Approved", "Ready"] }));
              }
            }}
            className={`text-xs px-2.5 py-1 transition-colors ${viewMode === "kanban" ? "bg-blue-500/15 text-blue-400" : "text-text-muted hover:text-text-secondary"}`}
          >
            Board
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`text-xs px-2.5 py-1 transition-colors ${viewMode === "list" ? "bg-blue-500/15 text-blue-400" : "text-text-muted hover:text-text-secondary"}`}
          >
            List
          </button>
        </div>
        <FilterBar
          filters={filters}
          onChange={setFilters}
          options={filterOptions}
          visibleCount={counts.visible}
          totalCount={counts.total}
        />
        <div className="flex items-center gap-2 ml-auto">
          {viewMode === "timeline" && (
            <>
              <TimeRangeSelector
                value={visibleSprintCount}
                onChange={setVisibleSprintCount}
                maxIterations={sortedIterations.length}
              />
              <button
                onClick={() => scrollToTodayRef.current?.()}
                className="text-xs px-2 py-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-button linear-btn"
              >
                Today
              </button>
            </>
          )}
          <div ref={viewMenuRef} className="relative">
            <button
              onClick={() => setShowViewMenu(v => !v)}
              className="text-xs px-2 py-1 rounded border border-border-focus text-text-muted hover:border-border-button linear-btn"
            >
              View
            </button>
            {showViewMenu && (
              <div className="absolute z-50 mt-1 bg-surface-elevated border border-border-modal rounded-lg shadow-[0px_4px_24px_0px_rgba(0,0,0,0.2)] py-2 px-3 min-w-[180px]">
                <div className="flex items-center justify-between gap-4 py-1.5">
                  <span className="text-xs text-text-secondary">Weekends</span>
                  <button onClick={() => setShowWeekends(v => !v)}
                    className={`relative w-8 h-4 rounded-full transition-colors ${showWeekends ? "bg-blue-600" : "bg-surface-button"}`}>
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${showWeekends ? "left-4" : "left-0.5"}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-4 py-1.5">
                  <span className="text-xs text-text-secondary">Show Done</span>
                  <button onClick={() => setShowDone(v => !v)}
                    className={`relative w-8 h-4 rounded-full transition-colors ${showDone ? "bg-blue-600" : "bg-surface-button"}`}>
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${showDone ? "left-4" : "left-0.5"}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-4 py-1.5">
                  <span className="text-xs text-text-secondary">Show Orphans</span>
                  <button onClick={() => setShowOrphans(v => !v)}
                    className={`relative w-8 h-4 rounded-full transition-colors ${showOrphans ? "bg-blue-600" : "bg-surface-button"}`}>
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${showOrphans ? "left-4" : "left-0.5"}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-4 py-1.5">
                  <span className="text-xs text-text-secondary">Show Tasks</span>
                  <button onClick={() => setShowTasks(v => !v)}
                    className={`relative w-8 h-4 rounded-full transition-colors ${showTasks ? "bg-blue-600" : "bg-surface-button"}`}>
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${showTasks ? "left-4" : "left-0.5"}`} />
                  </button>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => setShowVisibilityModal(true)}
            className="text-xs px-2 py-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-button linear-btn flex items-center gap-1"
            title="Configure which items are visible"
          >
            <Eye size={14} /> Visibility
          </button>
          <SyncStatus metadata={data.syncMetadata} disabled={!isOnline} onSyncComplete={refreshData} />
          <div ref={settingsRef} className="relative border-l border-border-default pl-2 ml-1">
            <button
              onClick={() => setShowSettings(s => !s)}
              className="text-text-muted hover:text-text-primary p-1 rounded hover:bg-surface-button linear-btn"
              title="Settings"
            >
              <GearSix size={16} />
            </button>
            {showSettings && (
              <div className="absolute right-0 top-full mt-1 bg-surface-elevated border border-border-modal rounded-lg shadow-xl py-2 px-3 z-50 min-w-[180px]">
                <button
                  onClick={() => { setShowSettings(false); setShowCredentialSettings(true); }}
                  className="w-full text-left text-xs text-text-secondary hover:text-text-primary py-1.5 rounded hover:bg-surface-button px-1 linear-btn"
                >
                  ADO Connection…
                </button>
                <div className="border-t border-border-default my-1.5" />
                <div className="flex items-center justify-between gap-4">
                  <span className="text-xs text-text-secondary">Dark mode</span>
                  <button
                    onClick={() => setDarkMode(d => !d)}
                    className={`relative w-8 h-4 rounded-full transition-colors ${darkMode ? "bg-blue-600" : "bg-surface-button"}`}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${darkMode ? "left-4" : "left-0.5"}`} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Timeline / Kanban / List */}
      {viewMode === "timeline" && (
        <TimelineView
          items={visibleItems}
          iterations={sortedIterations}
          markers={markers}
          range={range}
          grouping={grouping}
          onItemClick={setSelectedItem}
          onScheduleChange={handleScheduleChange}
          onReorder={handleReorder}
          onCreateItem={handleCreateItem}
          onContextMenu={handleContextMenu}
          pendingIds={pendingIds}
          showWeekends={showWeekends}
          zoomWidth={zoomWidth}
          onScrollToTodayRef={scrollToTodayRef}
          onZoom={(delta) => setVisibleSprintCount(v => Math.max(1, Math.min(sortedIterations.length, v + delta)))}
        />
      )}

      {viewMode === "kanban" && (
        <KanbanBoard
          items={(() => {
            let boardItems = applyFilters(applyDoneFilter(data.workItems, showDone), filters);
            // Apply visibility filter — hide items and their descendants
            if (hiddenIds.size > 0) {
              const allHidden = new Set(hiddenIds);
              for (const item of boardItems) {
                let parentId = item.parentId;
                while (parentId) {
                  if (allHidden.has(parentId)) { allHidden.add(item.id); break; }
                  const parent = data.workItems.find(i => i.id === parentId);
                  parentId = parent?.parentId ?? null;
                }
              }
              boardItems = boardItems.filter(i => !allHidden.has(i.id));
            }
            if (!showTasks) boardItems = boardItems.filter(i => i.workItemType !== "Task");
            return boardItems;
          })()}
          allItems={data.workItems}
          showDone={showDone}
          filteredStates={filters.states}
          onItemClick={setSelectedItem}
          onContextMenu={handleContextMenu}
          onStateChange={async (itemId, newState, prevState) => {
            setPendingIds(s => new Set(s).add(itemId));
            const result = await clientUpdateField(itemId, "state", newState, prevState);
            setPendingIds(s => { const n = new Set(s); n.delete(itemId); return n; });
            if (result.success) await refreshData();
          }}
          onReorder={async (itemId, newSortOrder) => {
            // Update local state immediately
            setData(d => ({
              ...d,
              workItems: d.workItems.map(i => i.id === itemId ? { ...i, localSortOrder: newSortOrder } : i),
            }));
            // Persist to local IndexedDB cache
            await idbUpdateField(itemId, "localSortOrder", newSortOrder);
          }}
          pendingIds={pendingIds}
        />
      )}

      {viewMode === "list" && (
        <ListView
          items={(() => {
            let listItems = applyFilters(applyDoneFilter(data.workItems, showDone), filters);
            if (!showTasks) listItems = listItems.filter(i => i.workItemType !== "Task");
            if (hiddenIds.size > 0) {
              const allHidden = new Set(hiddenIds);
              for (const item of listItems) {
                let parentId = item.parentId;
                while (parentId) {
                  if (allHidden.has(parentId)) { allHidden.add(item.id); break; }
                  const parent = data.workItems.find(i => i.id === parentId);
                  parentId = parent?.parentId ?? null;
                }
              }
              listItems = listItems.filter(i => !allHidden.has(i.id));
            }
            // Add missing ancestors so the tree is complete
            const allItemsMap = new Map(data.workItems.map(i => [i.id, i]));
            const listIds = new Set(listItems.map(i => i.id));
            for (const item of [...listItems]) {
              let parentId = item.parentId;
              while (parentId && !listIds.has(parentId)) {
                const parent = allItemsMap.get(parentId);
                if (!parent || parent.state === "Removed") break;
                listItems.push(parent);
                listIds.add(parent.id);
                parentId = parent.parentId;
              }
            }
            return listItems;
          })()}
          allItems={data.workItems}
          showOrphans={showOrphans}
          onItemClick={setSelectedItem}
          onReorder={async (itemId, newParentId, newSortOrder) => {
            setData(d => ({
              ...d,
              workItems: d.workItems.map(i => i.id === itemId ? { ...i, parentId: newParentId, localSortOrder: newSortOrder } : i),
            }));
            await idbUpdateField(itemId, "parentId", newParentId);
            await idbUpdateField(itemId, "localSortOrder", newSortOrder);
            // Write parent change to ADO
            if (newParentId !== data.workItems.find(i => i.id === itemId)?.parentId) {
              const prevParentId = data.workItems.find(i => i.id === itemId)?.parentId ?? null;
              await clientReorderItem(itemId, newParentId, newSortOrder, prevParentId, 0, 0);
            }
          }}
          onCreateItem={handleCreateItem}
          onContextMenu={handleContextMenu}
          pendingIds={pendingIds}
        />
      )}

      {/* Visibility Modal */}
      {showVisibilityModal && (
        <VisibilityModal
          items={data.workItems}
          hiddenIds={hiddenIds}
          onToggle={handleToggleVisibility}
          onToggleBranch={handleToggleBranch}
          onClose={() => setShowVisibilityModal(false)}
          areaPaths={syncAreaPaths}
          selectedAreaPath={selectedAreaPath}
          onAreaPathChange={setSelectedAreaPath}
        />
      )}

      {/* Detail Modal */}
      <DetailModal
        item={selectedItem}
        allItems={data.workItems}
        iterations={data.iterations}
        teamMembers={data.teamMembers}
        allTags={data.allTags}
        onClose={() => setSelectedItem(null)}
        onStateChange={handleStateChange}
        onAssigneeChange={handleAssigneeChange}
        onTagsChange={handleTagsChange}
        onDescriptionChange={handleDescriptionChange}
        onAcceptanceCriteriaChange={handleAcceptanceCriteriaChange}
        onIterationChange={handleIterationChange}
        onTitleChange={async (newTitle) => {
          if (!selectedItem) return;
          const prev = selectedItem.title;
          setSelectedItem({ ...selectedItem, title: newTitle });
          setData(d => ({ ...d, workItems: d.workItems.map(i => i.id === selectedItem.id ? { ...i, title: newTitle } : i) }));
          await clientUpdateTitle(selectedItem.id, newTitle, prev);
        }}
        onNavigate={setSelectedItem}
        onPriorityChange={handlePriorityChange}
      />

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          item={contextMenu.item}
          x={contextMenu.x}
          y={contextMenu.y}
          showTasks={showTasks}
          onClose={() => setContextMenu(null)}
          onCreateChild={handleCreateItem}
          onRemove={item => { setContextMenu(null); setRemoveTarget(item); }}
        />
      )}

      {/* Remove Confirmation Modal */}
      {removeTarget && (
        <RemoveConfirmModal
          item={removeTarget}
          allItems={data.workItems}
          onConfirm={handleRemoveItems}
          onCancel={() => setRemoveTarget(null)}
        />
      )}

      {/* Credential Settings Modal */}
      {showCredentialSettings && (
        <CredentialSettings
          onDisconnect={() => {
            setShowCredentialSettings(false);
            // Parent page.tsx should handle re-rendering SetupFlow
            window.location.reload();
          }}
          onClose={() => setShowCredentialSettings(false)}
        />
      )}
    </div>
  );
}
