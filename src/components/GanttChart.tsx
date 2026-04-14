"use client";
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import type { MutableRefObject } from "react";
import type { WorkItem, Iteration } from "@/lib/types";
import { STATE_COLOURS } from "@/lib/types";
import type { IterationMarker, TimelineRange, DayMarker } from "@/lib/timeline-positioning";
import { computeDayMarkers, computeTodayPercent, findIterationForDate } from "@/lib/timeline-positioning";
import { buildGanttTree, flattenGanttTree, type GanttRow, type FlatRow } from "@/lib/gantt-tree";
import { CaretRight, CaretDown, DotOutline, Asterisk, CrownSimple, Trophy, ListChecks, ClipboardText, Bug, Plus } from "@phosphor-icons/react";
import { SUMMARY_TYPES, getChildType } from "@/lib/hierarchy";
import { computeDropTarget, canDrop, type DropTarget } from "@/lib/reorder-logic";
import type { ColKey } from "./ColumnsMenu";
import { COL_LABELS } from "./ColumnsMenu";

const ROW_H = 36, HDR_H = 52, L_DEF = 340, L_MIN = 200, L_MAX = 9999, IND = 20, HW = 6;

/** Min widths for Gantt sidebar columns */
const GANTT_COL_MIN: Record<ColKey, number> = {
  title: 120, order: 40, status: 60, assignee: 60, effort: 40, tags: 60, iteration: 60, id: 50,
};

/** Default pixel widths for Gantt sidebar columns */
const GANTT_COL_INITIAL: Record<ColKey, number> = {
  title: 320, order: 55, status: 100, assignee: 90, effort: 45, tags: 90, iteration: 85, id: 60,
};

const GANTT_COL_INITIAL_ORDER: ColKey[] = ["title", "order", "status", "assignee", "effort", "tags", "iteration", "id"];

const GANTT_WIDTHS_KEY = "gantt-sidebar-col-widths";
const GANTT_ORDER_KEY = "gantt-sidebar-col-order";
const GANTT_PANEL_KEY = "gantt-panel-width";
type DragMode = "move" | "resize-left" | "resize-right";
interface DragState { id: number; m: DragMode; sx: number; sy: number; ol: number; ow: number; cw: number; moved: boolean }

interface GanttChartProps {
  items: WorkItem[];
  iterations: Iteration[];
  markers: IterationMarker[];
  range: TimelineRange | null;
  onItemClick: (item: WorkItem) => void;
  onScheduleChange?: (itemId: number, startDate: Date, endDate: Date, iterationPath: string) => void;
  onReorder?: (itemId: number, newParentId: number | null, newSortOrder: number, previousSiblingId?: number, nextSiblingId?: number) => void;
  onCreateItem?: (parentId: number, workItemType: string) => void;
  onContextMenu?: (item: WorkItem, x: number, y: number) => void;
  pendingIds?: Set<number>;
  showWeekends?: boolean;
  zoomWidth?: number;
  onScrollToTodayRef?: MutableRefObject<(() => void) | null>;
  onZoom?: (delta: number) => void;
  visibleColumns?: ColKey[];
}

/** Find which day column a percent position falls in */
function findDayAtPercent(days: DayMarker[], pct: number): DayMarker | null {
  for (const d of days) {
    if (pct >= d.leftPercent && pct < d.leftPercent + d.widthPercent) return d;
  }
  // Snap to nearest
  let best: DayMarker | null = null;
  let bestDist = Infinity;
  for (const d of days) {
    const center = d.leftPercent + d.widthPercent / 2;
    const dist = Math.abs(pct - center);
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  return best;
}

export function GanttChart({ items, iterations, markers, range, onItemClick, onScheduleChange, onReorder, onCreateItem, onContextMenu, pendingIds, showWeekends = false, zoomWidth = 100, onScrollToTodayRef, onZoom, visibleColumns }: GanttChartProps) {
  const [col, setCol] = useState<Set<number>>(new Set());
  const [lw, setLw] = useState(() => {
    if (typeof window !== "undefined") {
      try { const s = localStorage.getItem(GANTT_PANEL_KEY); if (s) { const v = JSON.parse(s); if (typeof v === "number" && v >= L_MIN) return v; } } catch {}
    }
    return L_DEF;
  });
  const pr = useRef<{ sx: number; sw: number } | null>(null);
  const br = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportH, setViewportH] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dOff, setDOff] = useState(0);
  const [dOffY, setDOffY] = useState(0);
  const [highlightDayIdx, setHighlightDayIdx] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [hoveredItemId, setHoveredItemId] = useState<number | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);

  // Sidebar row drag-and-drop state (mirrors ListView pattern)
  const [sidebarDragId, setSidebarDragId] = useState<number | null>(null);
  const [sidebarDropTargetId, setSidebarDropTargetId] = useState<number | null>(null);
  const [sidebarDropPosition, setSidebarDropPosition] = useState<"above" | "below" | "inside" | null>(null);
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  // Sync vertical scroll between left sidebar and right timeline
  const syncScroll = useCallback((source: "left" | "right") => {
    if (syncing.current) return;
    syncing.current = true;
    const left = leftScrollRef.current;
    const right = scrollRef.current;
    if (left && right) {
      if (source === "left") right.scrollTop = left.scrollTop;
      else left.scrollTop = right.scrollTop;
    }
    syncing.current = false;
  }, []);

  // Track scroll container viewport height so columns fill the screen
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setViewportH(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tree = useMemo(() => buildGanttTree(items, iterations, range, showWeekends), [items, iterations, range, showWeekends]);
  const rows = useMemo(() => flattenGanttTree(tree, col), [tree, col]);
  const days = useMemo(() => range ? computeDayMarkers(range, showWeekends) : [], [range, showWeekends]);
  const todayPct = useMemo(() => range ? computeTodayPercent(range, showWeekends) : null, [range, showWeekends]);

  // Extra sidebar columns (beyond title) from visibleColumns prop
  const extraCols = useMemo(() => (visibleColumns ?? ["title"]).filter(c => c !== "title"), [visibleColumns]);

  // --- Sidebar column widths & order (resizable + reorderable, persisted to localStorage) ---
  const [sideColWidths, setSideColWidths] = useState<Record<ColKey, number>>(() => {
    if (typeof window !== "undefined") {
      try {
        const s = localStorage.getItem(GANTT_WIDTHS_KEY);
        if (s) {
          const parsed = JSON.parse(s);
          // Reset if title width is unreasonably small (stale from previous version)
          if (parsed.title && parsed.title < GANTT_COL_MIN.title) parsed.title = GANTT_COL_INITIAL.title;
          return parsed;
        }
      } catch {}
    }
    return GANTT_COL_INITIAL;
  });
  const [sideColOrder, setSideColOrder] = useState<ColKey[]>(() => {
    if (typeof window !== "undefined") {
      try { const s = localStorage.getItem(GANTT_ORDER_KEY); if (s) return JSON.parse(s); } catch {}
    }
    return GANTT_COL_INITIAL_ORDER;
  });
  const [isSideResizing, setIsSideResizing] = useState(false);

  // Persist widths & order
  useEffect(() => { try { localStorage.setItem(GANTT_WIDTHS_KEY, JSON.stringify(sideColWidths)); } catch {} }, [sideColWidths]);
  useEffect(() => { try { localStorage.setItem(GANTT_ORDER_KEY, JSON.stringify(sideColOrder)); } catch {} }, [sideColOrder]);
  useEffect(() => { try { localStorage.setItem(GANTT_PANEL_KEY, JSON.stringify(lw)); } catch {} }, [lw]);

  // Effective column order: only columns that are in extraCols (visible), in the user's preferred order
  const effectiveExtraCols = useMemo(() => sideColOrder.filter(k => k !== "title" && extraCols.includes(k)), [sideColOrder, extraCols]);

  // Column resize handlers
  const sideResizeRef = useRef<{ col: ColKey; startX: number; startW: number } | null>(null);

  const onSideResizeDown = useCallback((e: React.PointerEvent, c: ColKey) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    sideResizeRef.current = { col: c, startX: e.clientX, startW: sideColWidths[c] };
    setIsSideResizing(true);
  }, [sideColWidths]);

  const onSideResizeMove = useCallback((e: React.PointerEvent) => {
    if (!sideResizeRef.current) return;
    const { col: c, startX, startW } = sideResizeRef.current;
    const delta = e.clientX - startX;
    setSideColWidths(prev => ({ ...prev, [c]: Math.max(GANTT_COL_MIN[c], startW + delta) }));
  }, []);

  const onSideResizeUp = useCallback(() => { sideResizeRef.current = null; setIsSideResizing(false); }, []);

  // Column drag-reorder state
  const [sideDragCol, setSideDragCol] = useState<ColKey | null>(null);
  const [sideDropCol, setSideDropCol] = useState<ColKey | null>(null);
  const [sideDropSide, setSideDropSide] = useState<"left" | "right">("left");

  // Find the current sprint marker
  const currentSprintMarker = useMemo(() => {
    const now = Date.now();
    return markers.find(m => {
      if (!range) return false;
      const s = new Date(range.start.getTime() + (m.leftPercent / 100) * range.totalMs);
      const e = new Date(range.start.getTime() + ((m.leftPercent + m.widthPercent) / 100) * range.totalMs);
      return now >= s.getTime() && now <= e.getTime();
    }) ?? null;
  }, [markers, range]);

  // Scroll to current sprint on initial mount (left-aligned)
  const hasScrolledRef = useRef(false);
  useEffect(() => {
    if (hasScrolledRef.current || !currentSprintMarker) return;
    const container = scrollRef.current;
    if (!container || container.scrollWidth <= 0) return;
    const targetX = (currentSprintMarker.leftPercent / 100) * container.scrollWidth;
    container.scrollLeft = Math.max(0, targetX);
    hasScrolledRef.current = true;
  }, [currentSprintMarker, zoomWidth]);

  // Preserve scroll center when zoom changes
  const prevZoomRef = useRef(zoomWidth);
  const centerPctRef = useRef(0);

  // Capture center percentage before render with new zoom
  if (zoomWidth !== prevZoomRef.current) {
    const container = scrollRef.current;
    if (container && container.scrollWidth > 0) {
      const centerX = container.scrollLeft + container.clientWidth / 2;
      centerPctRef.current = centerX / container.scrollWidth;
    }
  }

  useEffect(() => {
    if (zoomWidth !== prevZoomRef.current) {
      const container = scrollRef.current;
      if (container && container.scrollWidth > 0) {
        const newScrollLeft = centerPctRef.current * container.scrollWidth - container.clientWidth / 2;
        container.scrollLeft = Math.max(0, newScrollLeft);
      }
      prevZoomRef.current = zoomWidth;
    }
  }, [zoomWidth]);

  // Register scroll-to-today on the parent ref
  const scrollToToday = useCallback(() => {
    const container = scrollRef.current;
    if (!container || todayPct === null) return;
    const contentWidth = container.scrollWidth;
    const viewportWidth = container.clientWidth;
    const targetX = (todayPct / 100) * contentWidth - viewportWidth / 2;
    container.scrollTo({ left: Math.max(0, targetX), behavior: "smooth" });
  }, [todayPct]);

  useEffect(() => {
    if (onScrollToTodayRef) onScrollToTodayRef.current = scrollToToday;
  }, [onScrollToTodayRef, scrollToToday]);

  // Cmd+scroll to zoom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !onZoom) return;
    const handler = (e: WheelEvent) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        onZoom(e.deltaY > 0 ? 1 : -1);
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [onZoom]);

  // Pan-drag: click and drag on empty space to scroll horizontally
  const onPanStart = useCallback((e: React.MouseEvent) => {
    // Don't pan if clicking on a bar (bars have role="button" or are buttons)
    const target = e.target as HTMLElement;
    if (target.closest("[data-bar]") || target.closest("button")) return;
    e.preventDefault();
    const container = scrollRef.current;
    if (!container) return;
    const startX = e.clientX;
    const startScroll = container.scrollLeft;
    document.body.style.cursor = "grabbing";

    const mv = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      container.scrollLeft = startScroll - delta;
    };
    const up = () => {
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", mv);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", mv);
    document.addEventListener("mouseup", up);
  }, []);

  // --- Sidebar row drag-and-drop handlers (same pattern as ListView) ---
  const HIERARCHY_LEVEL: Record<string, number> = { Initiative: 0, Epic: 1, Feature: 2, "Product Backlog Item": 3, Bug: 3, Task: 3 };
  const getHLevel = (type: string) => HIERARCHY_LEVEL[type] ?? 3;
  const canBeDirectChildOf = (dragType: string, targetType: string) => getHLevel(targetType) === getHLevel(dragType) - 1;

  function handleSidebarDragStart(e: React.DragEvent, item: WorkItem) {
    setSidebarDragId(item.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(item.id));
  }

  function handleSidebarDragOver(e: React.DragEvent, targetId: number) {
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top, h = rect.height;
    const t = items.find(i => i.id === targetId);
    const dragItem = sidebarDragId ? items.find(i => i.id === sidebarDragId) : null;
    if (!t || !dragItem || dragItem.id === t.id) {
      setSidebarDropTargetId(null); setSidebarDropPosition(null); return;
    }
    const sameParent = dragItem.parentId === t.parentId;
    const canNest = SUMMARY_TYPES.has(t.workItemType) && canBeDirectChildOf(dragItem.workItemType, t.workItemType);
    let pos: "above" | "below" | "inside" | null = null;
    if (y < h * 0.25 && sameParent) pos = "above";
    else if (y > h * 0.75 && sameParent) pos = "below";
    else if (canNest) pos = "inside";
    else if (sameParent) pos = y < h * 0.5 ? "above" : "below";
    if (pos) {
      e.dataTransfer.dropEffect = "move";
      setSidebarDropPosition(pos);
      setSidebarDropTargetId(targetId);
    } else {
      e.dataTransfer.dropEffect = "none";
      setSidebarDropPosition(null);
      setSidebarDropTargetId(null);
    }
  }

  function handleSidebarDrop(e: React.DragEvent) {
    e.preventDefault();
    if (!sidebarDragId || !sidebarDropTargetId || !onReorder || !sidebarDropPosition) return;
    const t = items.find(i => i.id === sidebarDropTargetId);
    const dragItem = items.find(i => i.id === sidebarDragId);
    if (!t || !dragItem) return;
    if (sidebarDropPosition === "inside") {
      if (!canBeDirectChildOf(dragItem.workItemType, t.workItemType)) return;
      const sibs = items.filter(i => i.parentId === sidebarDropTargetId).sort((a, b) => a.localSortOrder - b.localSortOrder);
      const lastSib = sibs[sibs.length - 1];
      onReorder(sidebarDragId, sidebarDropTargetId, lastSib ? lastSib.localSortOrder + 100 : 100, lastSib ? lastSib.id : 0, 0);
    } else {
      if (dragItem.parentId !== t.parentId) return;
      const pid = t.parentId;
      const sibs = items.filter(i => i.parentId === pid && i.id !== sidebarDragId).sort((a, b) => a.localSortOrder - b.localSortOrder);
      const ti = sibs.findIndex(s => s.id === sidebarDropTargetId);
      if (sidebarDropPosition === "above") {
        const prevSib = ti > 0 ? sibs[ti - 1] : null;
        const prev = prevSib ? prevSib.localSortOrder : 0;
        const next = t.localSortOrder;
        onReorder(sidebarDragId, pid, Math.floor((prev + next) / 2), prevSib ? prevSib.id : 0, t.id);
      } else {
        const nextSib = ti < sibs.length - 1 ? sibs[ti + 1] : null;
        const prev = t.localSortOrder;
        const next = nextSib ? nextSib.localSortOrder : prev + 200;
        onReorder(sidebarDragId, pid, Math.floor((prev + next) / 2), t.id, nextSib ? nextSib.id : 0);
      }
    }
    setSidebarDragId(null); setSidebarDropTargetId(null); setSidebarDropPosition(null);
  }

  function handleSidebarDragEnd() { setSidebarDragId(null); setSidebarDropTargetId(null); setSidebarDropPosition(null); }

  const tog = useCallback((id: number) => {
    setCol(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const onPD = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); pr.current = { sx: e.clientX, sw: lw };
    const mv = (ev: MouseEvent) => { if (!pr.current) return; setLw(Math.max(L_MIN, Math.min(L_MAX, pr.current.sw + ev.clientX - pr.current.sx))); };
    const up = () => { pr.current = null; document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
  }, [lw]);

  // The key insight: on drag, find which day column the cursor is over using hit-testing.
  // No percent-to-date math needed. The day marker's date IS the answer.
  const onBD = useCallback((e: React.MouseEvent, id: number, mode: DragMode, l: number, w: number) => {
    e.preventDefault(); e.stopPropagation();
    const cw = br.current?.clientWidth ?? 800;
    const st: DragState = { id, m: mode, sx: e.clientX, sy: e.clientY, ol: l, ow: w, cw, moved: false };
    setDrag(st); setDOff(0); setDOffY(0);

    const mv = (ev: MouseEvent) => {
      const deltaX = ev.clientX - st.sx;
      const deltaY = ev.clientY - st.sy;
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) st.moved = true;
      setDOff(deltaX);
      if (st.m === "move") setDOffY(deltaY);

      // Highlight the day column the cursor is over
      const rect = br.current?.getBoundingClientRect();
      if (rect) {
        const cursorPct = ((ev.clientX - rect.left) / rect.width) * 100;
        const dayIdx = days.findIndex(d => cursorPct >= d.leftPercent && cursorPct < d.leftPercent + d.widthPercent);
        setHighlightDayIdx(dayIdx >= 0 ? dayIdx : null);

        // For move mode, compute vertical drop target
        if (st.m === "move" && Math.abs(deltaY) > ROW_H / 3) {
          const cursorY = ev.clientY - rect.top;
          const fr = rows.find(r => r.type === "item" && r.row.item.id === st.id);
          const draggedRow = fr?.type === "item" ? fr.row : undefined;
          if (draggedRow) {
            // Find which flat row the cursor is over
            const flatIdx = Math.max(0, Math.min(Math.floor(cursorY / ROW_H), rows.length - 1));
            const targetFlatRow = rows[flatIdx];
            
            // Resolve to a GanttRow
            let targetRow: GanttRow | null = null;
            if (targetFlatRow?.type === "item") {
              targetRow = targetFlatRow.row;
            }

            if (targetRow && targetRow.item.id !== draggedRow.item.id) {
              const relY = (cursorY - flatIdx * ROW_H) / ROW_H;
              
              // Determine drop position
              let position: "before" | "after" | "inside";
              if (targetRow.isSummary) {
                position = relY < 0.15 ? "before" : relY > 0.85 ? "after" : "inside";
              } else {
                position = relY < 0.5 ? "before" : "after";
              }

              if (canDrop(draggedRow, targetRow, position)) {
                // Build drop target with sibling info
                const siblings = rows
                  .filter((r): r is { type: "item"; row: GanttRow } => r.type === "item")
                  .map(r => r.row)
                  .filter(r => r.item.parentId === (position === "inside" ? targetRow!.item.id : targetRow!.item.parentId) && r.item.id !== draggedRow.item.id);

                let newParentId: number | null;
                let newSortOrder: number;
                let previousSiblingId = 0;
                let nextSiblingId = 0;

                if (position === "inside") {
                  newParentId = targetRow.item.id;
                  const lastChild = siblings[siblings.length - 1];
                  newSortOrder = lastChild ? lastChild.item.localSortOrder + 100 : 100;
                  previousSiblingId = lastChild ? lastChild.item.id : 0;
                } else if (position === "before") {
                  newParentId = targetRow.item.parentId;
                  newSortOrder = targetRow.item.localSortOrder - 50;
                  const targetSibIdx = siblings.findIndex(r => r.item.id === targetRow!.item.id);
                  previousSiblingId = targetSibIdx > 0 ? siblings[targetSibIdx - 1].item.id : 0;
                  nextSiblingId = targetRow.item.id;
                } else {
                  newParentId = targetRow.item.parentId;
                  const targetSibIdx = siblings.findIndex(r => r.item.id === targetRow!.item.id);
                  const nextSib = targetSibIdx < siblings.length - 1 ? siblings[targetSibIdx + 1] : null;
                  newSortOrder = nextSib ? (targetRow.item.localSortOrder + nextSib.item.localSortOrder) / 2 : targetRow.item.localSortOrder + 100;
                  previousSiblingId = targetRow.item.id;
                  nextSiblingId = nextSib ? nextSib.item.id : 0;
                }

                const indicatorY = position === "before" ? flatIdx * ROW_H : (flatIdx + 1) * ROW_H;

                const target: DropTarget = {
                  targetRow,
                  position,
                  newParentId,
                  newSortOrder,
                  indicatorY,
                  previousSiblingId,
                  nextSiblingId,
                };
                dropTargetRef.current = target;
                setDropTarget(target);
              } else {
                dropTargetRef.current = null;
                setDropTarget(null);
              }
            } else {
              dropTargetRef.current = null;
              setDropTarget(null);
            }
          }
        } else if (st.m === "move") {
          dropTargetRef.current = null;
          setDropTarget(null);
        }
      }
    };

    const up = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", mv);
      document.removeEventListener("mouseup", up);
      setHighlightDayIdx(null);

      if (!st.moved) {
        setDrag(null); setDOff(0);
        const it = items.find(i => i.id === st.id);
        if (it) onItemClick(it);
        return;
      }

      setDrag(null); setDOff(0); setDOffY(0);

      // Handle vertical reorder if we moved vertically during a "move" drag
      const vTarget = dropTargetRef.current;
      dropTargetRef.current = null;
      setDropTarget(null);

      if (st.m === "move" && vTarget && onReorder) {
        onReorder(st.id, vTarget.newParentId, vTarget.newSortOrder, vTarget.previousSiblingId, vTarget.nextSiblingId);
      }

      if (!range || !onScheduleChange) return;
      const it = items.find(i => i.id === st.id);
      if (!it) return;

      // Find which day the cursor landed on
      const rect = br.current?.getBoundingClientRect();
      if (!rect) return;
      const cursorPct = ((ev.clientX - rect.left) / rect.width) * 100;
      const targetDay = findDayAtPercent(days, cursorPct);
      if (!targetDay) return;

      // Also find the day at the other edge of the bar
      const dp = ((ev.clientX - st.sx) / st.cw) * 100;

      if (st.m === "resize-right") {
        // End date = the highlighted day (inclusive — last day the bar covers)
        const newEnd = new Date(targetDay.date);
        // Start stays the same — find it from the bar's left edge
        const startDay = findDayAtPercent(days, st.ol);
        const newStart = startDay ? new Date(startDay.date) : new Date(targetDay.date);
        console.log("[DRAG DEBUG resize-right]", {
          cursorPct: ((ev.clientX - rect!.left) / rect!.width) * 100,
          targetDayDate: targetDay.date.toISOString().split("T")[0],
          targetDayLeft: targetDay.leftPercent,
          targetDayWidth: targetDay.widthPercent,
          barOrigLeft: st.ol,
          barOrigWidth: st.ow,
          barOrigRight: st.ol + st.ow,
          startDayDate: startDay?.date.toISOString().split("T")[0],
          newStartDate: newStart.toISOString().split("T")[0],
          newEndDate: newEnd.toISOString().split("T")[0],
        });
        if (newEnd < newStart) return; // invalid
        const iter = findIterationForDate(newStart, iterations);
        onScheduleChange(it.id, newStart, newEnd, iter?.path ?? it.iterationPath ?? "");
      } else if (st.m === "resize-left") {
        // Start date = the highlighted day
        const newStart = new Date(targetDay.date);
        // End stays the same — find it from the bar's right edge
        const endDay = findDayAtPercent(days, st.ol + st.ow - 0.1);
        const newEnd = endDay ? new Date(endDay.date) : new Date(targetDay.date);
        if (newEnd < newStart) return;
        const iter = findIterationForDate(newStart, iterations);
        onScheduleChange(it.id, newStart, newEnd, iter?.path ?? it.iterationPath ?? "");
      } else {
        // Move: find the original start day and shift by the drag delta
        const origStartDay = findDayAtPercent(days, st.ol);
        // End day: use a small inset from the right edge to land on the correct last day
        const origEndDay = findDayAtPercent(days, st.ol + st.ow - 0.1);
        if (!origStartDay || !origEndDay) return;

        const origStartIdx = days.indexOf(origStartDay);
        const origEndIdx = days.indexOf(origEndDay);
        const barDaySpan = origEndIdx - origStartIdx; // exact day count

        // Find where the bar's left edge landed
        const newLeftPct = st.ol + dp;
        const newStartDay = findDayAtPercent(days, newLeftPct);
        if (!newStartDay) return;
        const newStartIdx = Math.max(0, days.indexOf(newStartDay));
        const newEndIdx = Math.min(days.length - 1, newStartIdx + barDaySpan);

        const newStart = new Date(days[newStartIdx].date);
        const newEnd = new Date(days[newEndIdx].date);
        const iter = findIterationForDate(newStart, iterations);
        onScheduleChange(it.id, newStart, newEnd, iter?.path ?? it.iterationPath ?? "");
      }
    };
    document.addEventListener("mousemove", mv);
    document.addEventListener("mouseup", up);
  }, [range, items, iterations, onScheduleChange, onItemClick, showWeekends, days]);

  function gDP(r: GanttRow) {
    if (!drag || drag.id !== r.item.id || r.barLeft === null || r.barWidth === null) return null;
    const dp = (dOff / drag.cw) * 100;
    let l = r.barLeft, w = r.barWidth;
    if (drag.m === "move") l += dp;
    else if (drag.m === "resize-left") { l += dp; w -= dp; }
    else w += dp;
    return { left: Math.max(0, l), width: Math.max(0.5, w), yOffset: drag.m === "move" ? dOffY : 0 };
  }

  const th = Math.max(rows.length * ROW_H, viewportH - HDR_H);
  const sH = 32, dayH = HDR_H - sH;
  // Hide day labels when zoomed out too far (days would be < ~20px wide)
  const showDayLabels = days.length > 0 && (100 / days.length) * (zoomWidth / 100) > 1.2;

  return (
    <div className="flex-1 flex overflow-hidden bg-surface-app">
      <div className="flex-none border-r border-border-default flex flex-col" style={{ width: lw, cursor: isSideResizing ? "col-resize" : undefined }}>
        <div className="flex items-end border-b border-border-default bg-surface-sidebar text-xs text-text-muted font-medium select-none" style={{ height: HDR_H }} onPointerMove={onSideResizeMove} onPointerUp={onSideResizeUp}>
          {/* w-6 spacer to match the plus-button column in rows */}
          <div className="w-6 flex-shrink-0" />
          {/* Title column header — takes remaining space */}
          <div className="flex items-end justify-between flex-1 min-w-0 pb-1 px-1">
            <span className="truncate">Tasks</span>
            <div className="flex items-center gap-1 pb-0.5 flex-shrink-0">
              <button onClick={() => {
                const allSummaryIds = new Map<number, number>();
                function walkTree(r: GanttRow) { if (r.isSummary) allSummaryIds.set(r.item.id, r.depth); r.children.forEach(walkTree); }
                tree.forEach(r => walkTree(r));
                const collapsedDepths = [...allSummaryIds.entries()].filter(([id]) => col.has(id)).map(([, d]) => d);
                if (collapsedDepths.length === 0) return;
                const minDepth = Math.min(...collapsedDepths);
                setCol(prev => { const n = new Set(prev); for (const [id, d] of allSummaryIds) { if (d === minDepth) n.delete(id); } return n; });
              }} className="text-zinc-500 hover:text-zinc-300 px-1" title="Expand one level">
                <CaretDown size={10} />
              </button>
              <button onClick={() => {
                const allSummaryIds = new Map<number, number>();
                function walkTree(r: GanttRow) { if (r.isSummary) allSummaryIds.set(r.item.id, r.depth); r.children.forEach(walkTree); }
                tree.forEach(r => walkTree(r));
                const expandedDepths = [...allSummaryIds.entries()].filter(([id]) => !col.has(id)).map(([, d]) => d);
                if (expandedDepths.length === 0) return;
                const maxDepth = Math.max(...expandedDepths);
                setCol(prev => { const n = new Set(prev); for (const [id, d] of allSummaryIds) { if (d === maxDepth) n.add(id); } return n; });
              }} className="text-zinc-500 hover:text-zinc-300 px-1" title="Collapse one level">
                <CaretRight size={10} />
              </button>
            </div>
          </div>
          {/* Extra column headers — resizable + reorderable */}
          {effectiveExtraCols.map(key => {
            const showLeftLine = sideDropCol === key && sideDropSide === "left" && sideDragCol !== key;
            const showRightLine = sideDropCol === key && sideDropSide === "right" && sideDragCol !== key;
            return (
              <div
                key={key}
                draggable={!isSideResizing}
                onDragStart={e => { setSideDragCol(key); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", key); }}
                onDragOver={e => {
                  e.preventDefault();
                  if (!sideDragCol || sideDragCol === key) return;
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setSideDropCol(key);
                  setSideDropSide((e.clientX - rect.left) < rect.width / 2 ? "left" : "right");
                }}
                onDrop={e => {
                  e.preventDefault();
                  if (!sideDragCol || sideDragCol === key) return;
                  setSideColOrder(prev => {
                    const n = prev.filter(c => c !== sideDragCol);
                    const targetIdx = n.indexOf(key);
                    n.splice(sideDropSide === "left" ? targetIdx : targetIdx + 1, 0, sideDragCol);
                    return n;
                  });
                  setSideDragCol(null); setSideDropCol(null);
                }}
                onDragEnd={() => { setSideDragCol(null); setSideDropCol(null); }}
                className={`relative flex items-end pb-1 px-1 flex-shrink-0 text-[10px] uppercase tracking-wider transition-colors ${
                  isSideResizing ? "" : "cursor-grab active:cursor-grabbing hover:bg-surface-header/60"
                } ${sideDragCol === key ? "opacity-40" : ""}`}
                style={{ width: sideColWidths[key] }}
              >
                {showLeftLine && <div className="absolute left-0 top-1 bottom-1 w-[2px] bg-blue-500 rounded-full z-20" />}
                {showRightLine && <div className="absolute right-0 top-1 bottom-1 w-[2px] bg-blue-500 rounded-full z-20" />}
                {COL_LABELS[key]}
                {/* Resize handle */}
                <div
                  className="absolute right-[-4px] top-0 bottom-0 w-[9px] z-30 flex items-center justify-center cursor-col-resize group/rh"
                  onPointerDown={e => onSideResizeDown(e, key)}
                  style={{ touchAction: "none" }}
                >
                  <div className="w-[2px] h-4 rounded-full bg-transparent group-hover/rh:bg-blue-500 transition-colors" />
                </div>
              </div>
            );
          })}
        </div>
        <div ref={leftScrollRef} className="flex-1 overflow-y-auto overflow-x-auto relative scrollbar-hide" onScroll={() => syncScroll("left")}>
          {dropTarget && dropTarget.position !== "inside" && <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: dropTarget.indicatorY - 1 }}><div className="h-0.5 bg-blue-500" /></div>}
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-4 py-12 text-center">
              <p className="text-sm text-text-muted">No items to display.</p>
              <p className="text-xs text-text-muted mt-1">Use the <span className="font-semibold text-text-secondary">+</span> button on a parent row or right-click for the context menu to create items.</p>
            </div>
          ) : rows.map((fr) => (
            <LRow key={fr.row.item.id} row={fr.row} c={col.has(fr.row.item.id)} onT={tog} onC={(item) => { setSelectedItemId(item.id); onItemClick(item); }} p={pendingIds?.has(fr.row.item.id)} isDropTarget={dropTarget?.position === "inside" && dropTarget?.targetRow.item.id === fr.row.item.id} isHovered={hoveredItemId === fr.row.item.id} isSelected={selectedItemId === fr.row.item.id} isSummaryBg={fr.row.isSummary} onHover={() => setHoveredItemId(fr.row.item.id)} onLeave={() => setHoveredItemId(null)} onContextMenu={onContextMenu} onCreateItem={onCreateItem} extraCols={effectiveExtraCols} colWidths={sideColWidths}
              isDragging={sidebarDragId === fr.row.item.id}
              isRowDropTarget={sidebarDropTargetId === fr.row.item.id}
              rowDropPosition={sidebarDropTargetId === fr.row.item.id ? sidebarDropPosition : null}
              onDragStart={handleSidebarDragStart}
              onDragOver={handleSidebarDragOver}
              onDragLeave={() => { if (sidebarDropTargetId === fr.row.item.id) { setSidebarDropTargetId(null); setSidebarDropPosition(null); } }}
              onDrop={handleSidebarDrop}
              onDragEnd={handleSidebarDragEnd}
            />
          ))}
        </div>
      </div>
      <div className="w-1 cursor-col-resize bg-surface-header hover:bg-blue-500 transition-colors flex-none" onMouseDown={onPD} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div ref={scrollRef} className="flex-1 overflow-auto" onScroll={() => { syncScroll("right"); }}>
        <div style={{ width: `${zoomWidth}%`, minWidth: 400 }}>
          {/* Sticky header inside scroll container for pixel-perfect alignment */}
          <div className="sticky top-0 z-10 bg-surface-sidebar border-b border-border-default" style={{ height: HDR_H }}>
            {markers.map(m => {
              const s = range ? new Date(range.start.getTime() + (m.leftPercent / 100) * range.totalMs) : null;
              const e = range ? new Date(range.start.getTime() + ((m.leftPercent + m.widthPercent) / 100) * range.totalMs) : null;
              const isCurrent = currentSprintMarker?.path === m.path;
              return showDayLabels ? (
                <div key={m.path} className="absolute px-2 flex items-center justify-center gap-1.5"
                  style={{ left: `${m.leftPercent}%`, width: `${m.widthPercent}%`, top: 0, height: sH, borderRight: "1px solid rgba(44, 45, 60, 0.7)", backgroundColor: isCurrent ? "rgba(59, 130, 246, 0.08)" : undefined }}>
                  <span className={`text-xs truncate font-medium ${isCurrent ? "text-blue-400" : "text-text-muted"}`}>{m.name}</span>
                  <span className="text-[10px] text-text-muted truncate">{s ? fmtR(s, e) : ""}</span>
                </div>
              ) : (
                <div key={m.path} className="absolute px-2 flex flex-col items-center justify-center"
                  style={{ left: `${m.leftPercent}%`, width: `${m.widthPercent}%`, top: 0, height: HDR_H, borderRight: "1px solid rgba(44, 45, 60, 0.7)", backgroundColor: isCurrent ? "rgba(59, 130, 246, 0.08)" : undefined }}>
                  <span className={`text-xs truncate font-medium ${isCurrent ? "text-blue-400" : "text-text-muted"}`}>{m.name}</span>
                  <span className="text-[10px] text-text-muted truncate">{s ? fmtR(s, e) : ""}</span>
                </div>
              );
            })}
            {showDayLabels && days.map((d, i) => (
              <div key={d.date.toISOString()}
                className="absolute flex items-center justify-center border-l"
                style={{ left: `${d.leftPercent}%`, width: `${d.widthPercent}%`, top: sH, height: dayH, borderLeftColor: "rgba(33, 34, 52, 0.25)" }}>
                <span className="text-[9px] text-text-muted">
                  {showWeekends ? ["S","M","T","W","T","F","S"][d.dayOfWeek] : ["","M","T","W","T","F"][d.dayOfWeek]}
                </span>
              </div>
            ))}
          </div>
          <div ref={br} className="relative cursor-grab active:cursor-grabbing" style={{ height: th }} onMouseDown={onPanStart} onClick={(e) => { const target = e.target as HTMLElement; if (!target.closest("[data-bar]") && !target.closest("button")) setSelectedItemId(null); }}>
            {/* Empty state overlay for timeline area */}
            {rows.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-sm text-text-muted/50">No items scheduled</p>
              </div>
            )}
            {/* Layer 0: Current sprint highlight — 1px border lines + per-row tint applied in Layer 1 */}
            {currentSprintMarker && <>
              <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${currentSprintMarker.leftPercent}%`, width: 1, backgroundColor: "rgba(59, 130, 246, 0.25)" }} />
              <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${currentSprintMarker.leftPercent + currentSprintMarker.widthPercent}%`, width: 1, backgroundColor: "rgba(59, 130, 246, 0.25)" }} />
            </>}
            {/* Layer 1: Row backgrounds (bottom) */}
            {rows.map((fr, i) => {
              const isSummary = fr.row.isSummary;
              const isHov = hoveredItemId === fr.row.item.id;
              const isSel = selectedItemId === fr.row.item.id;
              return <div key={fr.row.item.id}
                className={`absolute w-full transition-colors duration-75 cursor-default ${isSel ? "bg-blue-500/10" : isHov ? "bg-surface-header/60" : isSummary ? "bg-surface-sidebar" : ""}`}
                style={{ top: i * ROW_H, height: ROW_H }}
                onMouseEnter={() => setHoveredItemId(fr.row.item.id)} onMouseLeave={() => setHoveredItemId(null)}
                onClick={(e) => { e.stopPropagation(); setSelectedItemId(fr.row.item.id); }} />;
            })}
            {/* Layer 1b: Current sprint column tint — full height */}
            {currentSprintMarker && <div className="absolute top-0 pointer-events-none"
              style={{ left: `${currentSprintMarker.leftPercent}%`, width: `${currentSprintMarker.widthPercent}%`, height: th, backgroundColor: "rgba(59, 130, 246, 0.05)" }} />}
            {/* Layer 2: Day column lines (only when zoomed in enough) */}
            {showDayLabels && days.map((d, i) => {
              const isSprintBoundary = markers.some(m => {
                const endPct = m.leftPercent + m.widthPercent;
                return Math.abs(d.leftPercent - endPct) < 0.01;
              });
              return <div key={`day-${d.date.toISOString()}`} className="absolute top-0 bottom-0 pointer-events-none"
                style={{ left: `${d.leftPercent}%`, width: 1, backgroundColor: isSprintBoundary ? "rgba(44, 45, 60, 0.7)" : "rgba(33, 34, 52, 0.2)" }} />;
            })}
            {/* Sprint boundary lines (always visible) */}
            {!showDayLabels && markers.map(m => (
              <div key={`sprint-line-${m.path}`} className="absolute top-0 bottom-0 pointer-events-none"
                style={{ left: `${m.leftPercent + m.widthPercent}%`, width: 1, backgroundColor: "rgba(44, 45, 60, 0.7)" }} />
            ))}
            {/* Layer 3: Today line */}
            {todayPct !== null && <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${todayPct}%` }}><div className="w-0.5 h-full bg-red-500/70" /></div>}
            {/* Layer 4: Bars (top) */}
            {rows.map((fr, i) => <BRow key={fr.row.item.id} row={fr.row} top={i * ROW_H} onC={(item) => { setSelectedItemId(item.id); onItemClick(item); }} p={pendingIds?.has(fr.row.item.id)} dp={gDP(fr.row)} iD={drag?.id === fr.row.item.id} wasDragged={drag?.id === fr.row.item.id && !!drag?.moved} onDS={onBD} cD={!!onScheduleChange && !fr.row.isSummary} isRowHovered={hoveredItemId === fr.row.item.id} isSelected={selectedItemId === fr.row.item.id} onHover={() => setHoveredItemId(fr.row.item.id)} onLeave={() => setHoveredItemId(null)} onContextMenu={drag === null ? onContextMenu : undefined} />)}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

// Type icons handled inline with Phosphor

/** Render a single extra column value for the Gantt sidebar */
function renderGanttSidebarCol(col: ColKey, item: WorkItem, stateBg: string) {
  switch (col) {
    case "status": {
      const isOutline = item.state === "Ready";
      return (
        <span className="flex items-center gap-1 whitespace-nowrap">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={isOutline ? { border: `1.5px solid ${stateBg}`, backgroundColor: "transparent" } : { backgroundColor: stateBg }} />
          {item.state}
        </span>
      );
    }
    case "assignee":
      return item.assignedTo ? item.assignedTo.split(" ")[0] : "–";
    case "effort":
      return item.effort != null ? String(item.effort) : "–";
    case "tags":
      return item.tags.length > 0 ? item.tags.join(", ") : "–";
    case "iteration": {
      const name = item.iterationPath?.split("\\").pop();
      return name && name !== "Spark" ? name : "–";
    }
    case "order":
      return String(item.localSortOrder);
    case "id":
      return `#${item.id}`;
    default:
      return null;
  }
}

function LRow({ row, c, onT, onC, p, isDropTarget, isHovered, isSelected, isSummaryBg, onHover, onLeave, onContextMenu, onCreateItem, extraCols, colWidths, isDragging, isRowDropTarget, rowDropPosition, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd }: { row: GanttRow; c: boolean; onT: (id: number) => void; onC: (i: WorkItem) => void; p?: boolean; isDropTarget?: boolean; isHovered?: boolean; isSelected?: boolean; isSummaryBg?: boolean; onHover?: () => void; onLeave?: () => void; onContextMenu?: (item: WorkItem, x: number, y: number) => void; onCreateItem?: (parentId: number, workItemType: string) => void; extraCols?: ColKey[]; colWidths?: Record<ColKey, number>; isDragging?: boolean; isRowDropTarget?: boolean; rowDropPosition?: "above" | "below" | "inside" | null; onDragStart?: (e: React.DragEvent, item: WorkItem) => void; onDragOver?: (e: React.DragEvent, targetId: number) => void; onDragLeave?: () => void; onDrop?: (e: React.DragEvent) => void; onDragEnd?: () => void }) {
  const showCaret = row.isSummary || row.children.length > 0, bg = STATE_COLOURS[row.item.state] ?? "#6C757D";
  const childType = getChildType(row.item.workItemType);
  const showPlus = !!onCreateItem && !!childType;
  const childLabel = childType === "Product Backlog Item" ? "PBI" : childType;
  return (
    <div
      draggable
      onDragStart={onDragStart ? (e => onDragStart(e, row.item)) : undefined}
      onDragOver={onDragOver ? (e => onDragOver(e, row.item.id)) : undefined}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`relative flex items-center transition-colors duration-75 group cursor-default ${
        isDragging ? "opacity-30" : ""
      } ${isRowDropTarget && rowDropPosition === "inside" ? "bg-blue-500/10 ring-1 ring-inset ring-blue-500/30" : isDropTarget ? "bg-blue-500/15 ring-1 ring-inset ring-blue-500/40" : isSelected ? "bg-blue-500/10 ring-2 ring-inset ring-blue-500/50" : isHovered ? "bg-surface-header/60" : isSummaryBg ? "bg-surface-sidebar" : ""}`}
      style={{ height: ROW_H }}
      onMouseEnter={onHover} onMouseLeave={onLeave}
      onContextMenu={onContextMenu ? (e => { e.preventDefault(); onContextMenu(row.item, e.clientX, e.clientY); }) : undefined}
    >
      {/* Drop indicators */}
      {isRowDropTarget && rowDropPosition === "above" && <div className="absolute left-0 right-0 top-0 h-0.5 bg-blue-500 z-10" />}
      {isRowDropTarget && rowDropPosition === "below" && <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-blue-500 z-10" />}
      {/* Plus_Button — far left, visible on hover, matching ListView w-6 container */}
      <div className="w-6 flex-shrink-0 flex items-center justify-center">
        {showPlus && (
          <button
            onClick={e => { e.stopPropagation(); onCreateItem!(row.item.id, childType!); }}
            className="min-w-[24px] min-h-[24px] max-md:min-w-[32px] max-md:min-h-[32px] flex items-center justify-center rounded text-text-muted/0 group-hover:text-text-muted hover:!text-blue-400 hover:bg-blue-500/10 transition-all cursor-pointer"
            title={`New ${childLabel}`}
          >
            <Plus size={10} weight="bold" />
          </button>
        )}
      </div>

      {/* Title area — takes remaining space */}
      <div className="flex items-center gap-1 flex-1 min-w-0 pr-1" style={{ paddingLeft: row.depth * IND }}>
        <button onClick={e => { e.stopPropagation(); if (showCaret) onT(row.item.id); }} className="w-5 h-5 flex items-center justify-center text-text-muted flex-shrink-0 cursor-pointer">
          {showCaret ? (c ? <CaretRight size={10} /> : <CaretDown size={10} />) : <DotOutline size={10} className="text-border-default" />}
        </button>
        <span className="mr-1 flex-shrink-0">
          {row.item.workItemType === "Initiative" ? <Asterisk size={12} weight="bold" className="text-blue-500" /> : row.item.workItemType === "Epic" ? <CrownSimple size={12} weight="fill" className="text-orange-400" /> : row.item.workItemType === "Feature" ? <Trophy size={12} weight="fill" className="text-purple-400" /> : row.item.workItemType === "Task" ? <ClipboardText size={12} weight="fill" className="text-yellow-400" /> : row.item.workItemType === "Bug" ? <Bug size={12} weight="fill" className="text-red-500" /> : <ListChecks size={12} className="text-blue-400" />}
        </span>
        <button onClick={() => onC(row.item)} onContextMenu={onContextMenu ? (e => { e.preventDefault(); onContextMenu(row.item, e.clientX, e.clientY); }) : undefined} className={`truncate text-left text-xs min-w-0 flex-1 cursor-pointer ${row.isSummary ? "font-semibold text-text-primary" : isHovered ? "text-text-primary" : "text-text-secondary hover:text-text-primary"}`} title={row.item.title}>{row.item.title}</button>
      </div>

      {/* Extra columns — individual fixed-width columns with dynamic widths */}
      {extraCols && extraCols.map(col => (
        <div key={col} className="flex items-center px-1 overflow-hidden flex-shrink-0 text-[10px] text-text-muted" style={{ width: colWidths?.[col] ?? GANTT_COL_INITIAL[col] }}>
          {renderGanttSidebarCol(col, row.item, bg)}
        </div>
      ))}

      {p && <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse mr-2 flex-shrink-0" />}
    </div>
  );
}

function BRow({ row, top, onC, p, dp, iD, wasDragged, onDS, cD, isRowHovered, isSelected, onHover, onLeave, onContextMenu }: {
  row: GanttRow; top: number; onC: (i: WorkItem) => void; p?: boolean;
  dp: { left: number; width: number; yOffset?: number } | null; iD: boolean; wasDragged?: boolean;
  onDS: (e: React.MouseEvent, id: number, m: DragMode, l: number, w: number) => void; cD: boolean;
  isRowHovered?: boolean; isSelected?: boolean; onHover?: () => void; onLeave?: () => void;
  onContextMenu?: (item: WorkItem, x: number, y: number) => void;
}) {
  const l = dp?.left ?? row.barLeft, w = dp?.width ?? row.barWidth;
  if (l === null || w === null) return null;
  const bg = STATE_COLOURS[row.item.state] ?? "#6C757D", bt = top + 4 + (dp?.yOffset ?? 0), bh = ROW_H - 8;

  const TYPE_COLOURS: Record<string, string> = {
    Initiative: "#3B82F6",
    Epic: "#F59E0B",
    Feature: "#A855F7",
  };

  if (row.isSummary) {
    const tc = TYPE_COLOURS[row.item.workItemType] ?? bg;
    const midY = bt + bh / 2;
    return (
      <button data-bar onClick={() => onC(row.item)} onContextMenu={onContextMenu ? (e => { e.preventDefault(); onContextMenu(row.item, e.clientX, e.clientY); }) : undefined} className={`absolute cursor-pointer hover:opacity-80 transition-all ${isSelected ? "ring-2 ring-blue-500/50" : ""}`}
        style={{ left: `${l}%`, width: `${w}%`, top: midY - 1, height: 2, opacity: isRowHovered ? 0.9 : 0.6 }} title={`${row.item.workItemType}: ${row.item.title}`}
        onMouseEnter={onHover} onMouseLeave={onLeave}>
        {/* Thin line */}
        <div className="w-full h-full" style={{ backgroundColor: tc }} />
        {/* Title — inside bar if it fits, otherwise to the right */}
        <SummaryLabel title={row.item.title} color={tc} />
        {/* Left circle */}
        <div className="absolute rounded-full border-2" style={{ width: 12, height: 12, top: -5, left: -6, borderColor: tc, backgroundColor: "rgb(24, 25, 33)" }} />
        {/* Right circle */}
        <div className="absolute rounded-full border-2" style={{ width: 12, height: 12, top: -5, right: -6, borderColor: tc, backgroundColor: "rgb(24, 25, 33)" }} />
      </button>
    );
  }

  const isCommitted = row.item.state === "Committed";
  const barStyle: React.CSSProperties = isCommitted
    ? { left: `${l}%`, width: `${w}%`, top: bt, height: bh, backgroundColor: "#1e3a5f", border: "1.5px solid #3B82F6" }
    : { left: `${l}%`, width: `${w}%`, top: bt, height: bh, backgroundColor: bg };

  return (
    <div data-bar className={`absolute rounded-full flex items-center group/bar shadow-sm transition-all ${iD ? "opacity-80 z-20 cursor-grabbing" : cD ? "cursor-grab" : "cursor-pointer"} ${isSelected ? "ring-2 ring-blue-500/50" : ""}`}
      style={{ ...barStyle, filter: isRowHovered && !isSelected ? "brightness(1.15)" : undefined }}
      onMouseEnter={onHover} onMouseLeave={onLeave}
      onContextMenu={onContextMenu ? (e => { e.preventDefault(); onContextMenu(row.item, e.clientX, e.clientY); }) : undefined}>
      {cD && <div className="absolute left-0 top-0 bottom-0 cursor-ew-resize z-10 opacity-0 group-hover/bar:opacity-100 transition-opacity rounded-l-full"
        style={{ width: HW, backgroundColor: "rgba(255,255,255,0.15)" }}
        onMouseDown={e => onDS(e, row.item.id, "resize-left", row.barLeft!, row.barWidth!)} />}
      <div className={`flex-1 h-full flex items-center px-3 truncate text-xs ${iD ? "cursor-grabbing" : cD ? "cursor-grab" : "cursor-pointer"}`}
        onMouseDown={cD ? e => onDS(e, row.item.id, "move", row.barLeft!, row.barWidth!) : undefined}
        onClick={!cD ? () => onC(row.item) : undefined}
        title={`${row.item.title} (${row.item.state})${cD ? " \u2014 click to open, drag to move" : ""}`}>
        {p && <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse mr-1 flex-shrink-0" />}
        <span className="truncate text-white text-[11px] font-medium drop-shadow-sm">{row.item.title}</span>
      </div>
      {cD && <div className="absolute right-0 top-0 bottom-0 cursor-ew-resize z-10 opacity-0 group-hover/bar:opacity-100 transition-opacity rounded-r-full"
        style={{ width: HW, backgroundColor: "rgba(255,255,255,0.15)" }}
        onMouseDown={e => onDS(e, row.item.id, "resize-right", row.barLeft!, row.barWidth!)} />}
    </div>
  );
}

function SummaryLabel({ title, color }: { title: string; color: string }) {
  const measureRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLElement | null>(null);
  const [outside, setOutside] = useState(false);

  const check = useCallback(() => {
    const measure = measureRef.current;
    const bar = barRef.current;
    if (!measure || !bar) return;
    const textW = measure.offsetWidth;
    const barW = bar.offsetWidth;
    setOutside(textW + 40 > barW); // 40px = padding for both circles
  }, []);

  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    barRef.current = el.closest("[data-bar]") as HTMLElement | null;
    check();
    // Re-check on resize (zoom changes bar width)
    const bar = barRef.current;
    if (!bar) return;
    const ro = new ResizeObserver(check);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [title, check]);

  return (
    <>
      {/* Hidden measurement span */}
      <span ref={measureRef} className="absolute whitespace-nowrap text-[11px] font-medium pointer-events-none" style={{ top: -9999, left: -9999, visibility: "hidden" }}>{title}</span>
      {outside ? (
        <span className="absolute whitespace-nowrap text-[11px] font-medium pointer-events-none" style={{ top: -8, left: `calc(100% + 10px)`, color }}>{title}</span>
      ) : (
        <span className="absolute whitespace-nowrap text-[11px] font-medium pointer-events-none" style={{ top: -8, left: 16, right: 16, color, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis" }}>
          <span className="px-1" style={{ backgroundColor: "rgb(24, 25, 33)" }}>{title}</span>
        </span>
      )}
    </>
  );
}

function fmtR(s: Date | null, e: Date | null): string {
  if (!s) return "";
  const f = (d: Date) => `${d.getDate()} ${d.toLocaleDateString("en-US", { month: "short" })}`;
  return e ? `${f(s)} - ${f(e)}` : f(s);
}
