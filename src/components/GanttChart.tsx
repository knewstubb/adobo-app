"use client";
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import type { MutableRefObject } from "react";
import type { WorkItem, Iteration } from "@/lib/types";
import { STATE_COLOURS } from "@/lib/types";
import type { IterationMarker, TimelineRange, DayMarker } from "@/lib/timeline-positioning";
import { computeDayMarkers, computeTodayPercent, findIterationForDate } from "@/lib/timeline-positioning";
import { buildGanttTree, flattenGanttTree, type GanttRow, type FlatRow, type AddRow } from "@/lib/gantt-tree";
import { CaretRight, CaretDown, DotOutline, Asterisk, CrownSimple, Trophy, ListChecks, ClipboardText, DotsSixVertical, Plus, Bug } from "@phosphor-icons/react";
import { computeDropTarget, canDrop, type DropTarget } from "@/lib/reorder-logic";

const ROW_H = 36, HDR_H = 52, L_DEF = 340, L_MIN = 200, L_MAX = 600, IND = 20, HW = 6;
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

export function GanttChart({ items, iterations, markers, range, onItemClick, onScheduleChange, onReorder, onCreateItem, onContextMenu, pendingIds, showWeekends = false, zoomWidth = 100, onScrollToTodayRef, onZoom }: GanttChartProps) {
  const [col, setCol] = useState<Set<number>>(new Set());
  const [lw, setLw] = useState(L_DEF);
  const pr = useRef<{ sx: number; sw: number } | null>(null);
  const br = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportH, setViewportH] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dOff, setDOff] = useState(0);
  const [dOffY, setDOffY] = useState(0);
  const [highlightDayIdx, setHighlightDayIdx] = useState<number | null>(null);
  const [vDragId, setVDragId] = useState<number | null>(null);
  const [vDragY, setVDragY] = useState(0);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
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

  const tog = useCallback((id: number) => {
    setCol(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const onPD = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); pr.current = { sx: e.clientX, sw: lw };
    const mv = (ev: MouseEvent) => { if (!pr.current) return; setLw(Math.max(L_MIN, Math.min(L_MAX, pr.current.sw + ev.clientX - pr.current.sx))); };
    const up = () => { pr.current = null; document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
  }, [lw]);

  // Vertical drag for reordering rows
  const onVDragStart = useCallback((e: React.MouseEvent, itemId: number) => {
    e.preventDefault(); e.stopPropagation();
    const startY = e.clientY;
    setVDragId(itemId);
    setVDragY(0);

    const fr = rows.find(r => r.type === 'item' && r.row.item.id === itemId);
    const draggedRow = fr?.type === 'item' ? fr.row : undefined;
    if (!draggedRow) return;

    const mv = (ev: MouseEvent) => {
      const deltaY = ev.clientY - startY;
      setVDragY(deltaY);

      // Compute drop target
      const leftPanel = leftScrollRef.current;
      if (leftPanel) {
        const rect = leftPanel.getBoundingClientRect();
        const cursorY = ev.clientY - rect.top;
        // Map cursor Y to the flat row index (which includes add rows)
        const adjustedY = cursorY + leftPanel.scrollTop;
        let flatIdx = Math.floor(adjustedY / ROW_H);
        // Clamp to valid range — if above all rows, target the first row
        if (flatIdx < 0) flatIdx = 0;
        if (flatIdx >= rows.length) flatIdx = rows.length - 1;
        const flatRow = rows[flatIdx];
        // Resolve to the nearest item row
        let targetRow: GanttRow | null = null;
        if (flatRow?.type === 'item') {
          targetRow = flatRow.row;
        } else if (flatRow?.type === 'add') {
          // Dropping on an add row = drop inside that parent
          const parentFr = rows.find(r => r.type === 'item' && r.row.item.id === flatRow.parentId);
          targetRow = parentFr?.type === 'item' ? parentFr.row : null;
        }

        if (targetRow && targetRow.item.id !== draggedRow.item.id) {
          const rowTop = flatIdx * ROW_H;
          const relY = (adjustedY - rowTop) / ROW_H;

          let position: "before" | "after" | "inside";
          // If cursor is above all rows, force "before"
          if (adjustedY < 0) {
            position = "before";
          } else if (flatRow?.type === 'add') {
            position = "inside";
          } else if (targetRow.isSummary) {
            position = relY < 0.15 ? "before" : relY > 0.85 ? "after" : "inside";
          } else {
            position = relY < 0.5 ? "before" : "after";
          }

          // Validate and try alternatives
          if (!canDrop(draggedRow, targetRow, position)) {
            const alternatives: ("before" | "after" | "inside")[] =
              position === "inside" ? ["after", "before"] :
              position === "before" ? ["inside", "after"] :
              ["inside", "before"];
            let found = false;
            for (const alt of alternatives) {
              if (canDrop(draggedRow, targetRow, alt)) { position = alt; found = true; break; }
            }
            if (!found) { dropTargetRef.current = null; setDropTarget(null); return; }
          }

          // Compute new parent and sort order
          const itemRows = rows.filter((r): r is { type: 'item'; row: GanttRow } => r.type === 'item').map(r => r.row);
          // Get siblings in display order and assign sequential sort values
          const siblings = itemRows.filter(r => r.item.parentId === (position === "inside" ? targetRow!.item.id : targetRow!.item.parentId) && r.item.id !== draggedRow.item.id);
          let newParentId: number | null;
          let newSortOrder: number;
          let previousSiblingId = 0;
          let nextSiblingId = 0;

          if (position === "inside") {
            newParentId = targetRow.item.id;
            const lastChild = targetRow.children[targetRow.children.length - 1];
            newSortOrder = lastChild ? lastChild.item.localSortOrder + 100 : 100;
            previousSiblingId = lastChild ? lastChild.item.id : 0;
          } else if (position === "before") {
            newParentId = targetRow.item.parentId;
            const sibIdx = siblings.findIndex(r => r.item.id === targetRow!.item.id);
            const prevSib = sibIdx > 0 ? siblings[sibIdx - 1] : null;
            // Place between previous sibling and target using display index
            newSortOrder = prevSib
              ? ((sibIdx - 1) * 100 + sibIdx * 100) / 2
              : (sibIdx * 100) - 50;
            previousSiblingId = prevSib ? prevSib.item.id : 0;
            nextSiblingId = targetRow.item.id;
          } else {
            newParentId = targetRow.item.parentId;
            const sibIdx = siblings.findIndex(r => r.item.id === targetRow!.item.id);
            const nextSib = sibIdx < siblings.length - 1 ? siblings[sibIdx + 1] : null;
            newSortOrder = nextSib
              ? ((sibIdx + 1) * 100 + (sibIdx + 2) * 100) / 2
              : (sibIdx + 1) * 100 + 50;
            previousSiblingId = targetRow.item.id;
            nextSiblingId = nextSib ? nextSib.item.id : 0;
          }

          const indicatorY = position === "before" ? flatIdx * ROW_H : (flatIdx + 1) * ROW_H;
          // Ensure sort order is never exactly 0 to avoid no-op reorders
          if (newSortOrder === 0) newSortOrder = position === "before" ? -50 : 50;
          const target: DropTarget = { targetRow, position, newParentId, newSortOrder, indicatorY, previousSiblingId, nextSiblingId };
          dropTargetRef.current = target;
          setDropTarget(target);
        } else {
          dropTargetRef.current = null;
          setDropTarget(null);
        }
      }
    };

    const up = () => {
      document.removeEventListener("mousemove", mv);
      document.removeEventListener("mouseup", up);

      const currentTarget = dropTargetRef.current;
      // Save scroll position before the reorder changes the tree
      const savedScrollTop = leftScrollRef.current?.scrollTop ?? 0;
      const savedRightScrollTop = scrollRef.current?.scrollTop ?? 0;

      setVDragId(null);
      setVDragY(0);
      setDropTarget(null);
      dropTargetRef.current = null;

      if (currentTarget && onReorder) {
        // If dropping inside a collapsed parent, keep it collapsed (item won't be visible)
        // The col set already handles this since the parent ID is in it
        onReorder(itemId, currentTarget.newParentId, currentTarget.newSortOrder, currentTarget.previousSiblingId, currentTarget.nextSiblingId);

        // Restore scroll position after React re-renders
        requestAnimationFrame(() => {
          if (leftScrollRef.current) leftScrollRef.current.scrollTop = savedScrollTop;
          if (scrollRef.current) scrollRef.current.scrollTop = savedRightScrollTop;
        });
      }
    };

    document.addEventListener("mousemove", mv);
    document.addEventListener("mouseup", up);
  }, [rows, onReorder]);

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
            } else if (targetFlatRow?.type === "add") {
              // Dropping on an add row = drop inside that parent
              const parentFr = rows.find(r => r.type === "item" && r.row.item.id === targetFlatRow.parentId);
              targetRow = parentFr?.type === "item" ? parentFr.row : null;
            }

            if (targetRow && targetRow.item.id !== draggedRow.item.id) {
              const relY = (cursorY - flatIdx * ROW_H) / ROW_H;
              
              // Determine drop position
              let position: "before" | "after" | "inside";
              if (targetFlatRow?.type === "add") {
                // Dropping on an add row always means "inside" the parent
                position = "inside";
              } else if (targetRow.isSummary) {
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
      <div className="flex-none border-r border-border-default flex flex-col" style={{ width: lw }}>
        <div className="flex items-end justify-between px-3 pb-1 border-b border-border-default bg-surface-sidebar text-xs text-text-muted font-medium" style={{ height: HDR_H }}>
          <span>Tasks</span>
          <div className="flex items-center gap-1 pb-0.5">
            <button onClick={() => {
              // Expand one level: find shallowest collapsed depth and expand those
              const allSummaryIds = new Map<number, number>(); // id -> depth
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
              // Collapse one level: find deepest expanded summary depth and collapse those
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
        <div ref={leftScrollRef} className="flex-1 overflow-y-auto overflow-x-hidden relative scrollbar-hide" onScroll={() => syncScroll("left")}>
          {dropTarget && dropTarget.position !== "inside" && <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: dropTarget.indicatorY - 1 }}><div className="h-0.5 bg-blue-500" /></div>}
          {rows.map((fr, i) => fr.type === "add" ? (
            <AddRowBtn key={`add-${fr.parentId}-${fr.childType}`} row={fr} onCreate={onCreateItem} />
          ) : (
            <LRow key={fr.row.item.id} row={fr.row} c={col.has(fr.row.item.id)} onT={tog} onC={onItemClick} p={pendingIds?.has(fr.row.item.id)} onVD={onReorder ? onVDragStart : undefined} isVDragging={vDragId === fr.row.item.id} vDragDelta={vDragId === fr.row.item.id ? vDragY : 0} isDropTarget={dropTarget?.position === "inside" && dropTarget?.targetRow.item.id === fr.row.item.id} isHovered={hoveredRow === i} isSummaryBg={fr.row.isSummary} onHover={() => setHoveredRow(i)} onLeave={() => setHoveredRow(null)} onContextMenu={onContextMenu} />
          ))}
        </div>
      </div>
      <div className="w-1 cursor-col-resize bg-surface-header hover:bg-blue-500 transition-colors flex-none" onMouseDown={onPD} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div ref={scrollRef} className="flex-1 overflow-auto" onScroll={() => { syncScroll("right"); }}>
        <div style={{ width: `${zoomWidth}%`, minWidth: 800 }}>
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
          <div ref={br} className="relative cursor-grab active:cursor-grabbing" style={{ height: th }} onMouseDown={onPanStart}>
            {/* Layer 0: Current sprint highlight — 1px border lines + per-row tint applied in Layer 1 */}
            {currentSprintMarker && <>
              <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${currentSprintMarker.leftPercent}%`, width: 1, backgroundColor: "rgba(59, 130, 246, 0.25)" }} />
              <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${currentSprintMarker.leftPercent + currentSprintMarker.widthPercent}%`, width: 1, backgroundColor: "rgba(59, 130, 246, 0.25)" }} />
            </>}
            {/* Layer 1: Row backgrounds (bottom) */}
            {rows.map((fr, i) => {
              const isSummary = fr.type === "item" && fr.row.isSummary;
              const isHov = hoveredRow === i;
              return <div key={fr.type === "add" ? `bg-add-${fr.parentId}` : fr.row.item.id}
                className={`absolute w-full transition-colors duration-75 ${isHov ? "bg-surface-header/60" : isSummary ? "bg-surface-sidebar" : ""}`}
                style={{ top: i * ROW_H, height: ROW_H }}
                onMouseEnter={() => setHoveredRow(i)} onMouseLeave={() => setHoveredRow(null)} />;
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
            {rows.map((fr, i) => fr.type === "item" ? <BRow key={fr.row.item.id} row={fr.row} top={i * ROW_H} onC={onItemClick} p={pendingIds?.has(fr.row.item.id)} dp={gDP(fr.row)} iD={drag?.id === fr.row.item.id} wasDragged={drag?.id === fr.row.item.id && !!drag?.moved} onDS={onBD} cD={!!onScheduleChange && !fr.row.isSummary} isRowHovered={hoveredRow === i} onHover={() => setHoveredRow(i)} onLeave={() => setHoveredRow(null)} /> : null)}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

// Type icons handled inline with Phosphor

function LRow({ row, c, onT, onC, p, onVD, isVDragging, vDragDelta, isDropTarget, isHovered, isSummaryBg, onHover, onLeave, onContextMenu }: { row: GanttRow; c: boolean; onT: (id: number) => void; onC: (i: WorkItem) => void; p?: boolean; onVD?: (e: React.MouseEvent, id: number) => void; isVDragging?: boolean; vDragDelta?: number; isDropTarget?: boolean; isHovered?: boolean; isSummaryBg?: boolean; onHover?: () => void; onLeave?: () => void; onContextMenu?: (item: WorkItem, x: number, y: number) => void }) {
  const showCaret = row.isSummary || row.children.length > 0, bg = STATE_COLOURS[row.item.state] ?? "#6C757D";
  return (
    <div className={`flex items-center transition-colors duration-75 group ${isVDragging ? "opacity-50 bg-surface-header z-30 relative" : ""} ${isDropTarget ? "bg-blue-500/15 ring-1 ring-inset ring-blue-500/40" : isHovered ? "bg-surface-header/60" : isSummaryBg ? "bg-surface-sidebar" : ""}`} style={{ height: ROW_H, paddingLeft: row.depth * IND, transform: isVDragging && vDragDelta ? `translateY(${vDragDelta}px)` : undefined }} onMouseEnter={onHover} onMouseLeave={onLeave}>
      {onVD && <div className={`w-4 h-5 flex items-center justify-center cursor-grab active:cursor-grabbing text-text-muted hover:text-text-secondary flex-shrink-0 transition-opacity ${isHovered ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`} onMouseDown={e => onVD(e, row.item.id)}><span className="text-[8px]">=</span></div>}
      <button onClick={e => { e.stopPropagation(); if (showCaret) onT(row.item.id); }} className="w-5 h-5 flex items-center justify-center text-text-muted flex-shrink-0">
        {showCaret ? (c ? <CaretRight size={10} /> : <CaretDown size={10} />) : <DotOutline size={10} className="text-border-default" />}
      </button>
      {<span className="mr-1 flex-shrink-0">
        {row.item.workItemType === "Initiative" ? <Asterisk size={12} weight="bold" className="text-blue-500" /> : row.item.workItemType === "Epic" ? <CrownSimple size={12} weight="fill" className="text-orange-400" /> : row.item.workItemType === "Feature" ? <Trophy size={12} weight="fill" className="text-purple-400" /> : row.item.workItemType === "Task" ? <ClipboardText size={12} weight="fill" className="text-yellow-400" /> : row.item.workItemType === "Bug" ? <Bug size={12} weight="fill" className="text-red-500" /> : <ListChecks size={12} className="text-blue-400" />}
      </span>}

      <button onClick={() => onC(row.item)} onContextMenu={onContextMenu ? (e => { e.preventDefault(); onContextMenu(row.item, e.clientX, e.clientY); }) : undefined} className={`truncate text-left text-xs flex-1 min-w-0 cursor-pointer ${row.isSummary ? "font-semibold text-text-primary" : isHovered ? "text-text-primary" : "text-text-secondary hover:text-text-primary"}`} title={row.item.title}>{row.item.title}</button>
      <span className={`text-[9px] px-1 rounded mr-2 flex-shrink-0 transition-opacity ${isHovered ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`} style={{ backgroundColor: `${bg}33`, color: bg }}>{row.item.state}</span>
      {p && <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse mr-2 flex-shrink-0" />}
    </div>
  );
}

function BRow({ row, top, onC, p, dp, iD, wasDragged, onDS, cD, isRowHovered, onHover, onLeave }: {
  row: GanttRow; top: number; onC: (i: WorkItem) => void; p?: boolean;
  dp: { left: number; width: number; yOffset?: number } | null; iD: boolean; wasDragged?: boolean;
  onDS: (e: React.MouseEvent, id: number, m: DragMode, l: number, w: number) => void; cD: boolean;
  isRowHovered?: boolean; onHover?: () => void; onLeave?: () => void;
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
      <button data-bar onClick={() => onC(row.item)} className="absolute cursor-pointer hover:opacity-80 transition-all"
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
    <div data-bar className={`absolute rounded-full flex items-center group/bar shadow-sm transition-all cursor-pointer ${iD ? "opacity-80 z-20" : ""}`}
      style={{ ...barStyle, filter: isRowHovered ? "brightness(1.15)" : undefined }}
      onMouseEnter={onHover} onMouseLeave={onLeave}>
      {cD && <div className="absolute left-0 top-0 bottom-0 cursor-ew-resize z-10 opacity-0 group-hover/bar:opacity-100 transition-opacity rounded-l-full"
        style={{ width: HW, backgroundColor: "rgba(255,255,255,0.15)" }}
        onMouseDown={e => onDS(e, row.item.id, "resize-left", row.barLeft!, row.barWidth!)} />}
      <div className={`flex-1 h-full flex items-center px-3 truncate text-xs ${iD ? "cursor-grabbing" : "cursor-pointer"}`}
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

function AddRowBtn({ row, onCreate }: { row: AddRow; onCreate?: (parentId: number, type: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleCreate() {
    if (title.trim() && onCreate) {
      onCreate(row.parentId, row.childType);
      // For now just trigger with a default title - we'll enhance this
    }
    setEditing(false);
    setTitle("");
  }

  if (editing) {
    return (
      <div className="flex items-center border-b border-transparent" style={{ height: ROW_H, paddingLeft: row.depth * IND }}>
        <div className="w-5" />
        <input
          ref={inputRef}
          autoFocus
          className="flex-1 linear-input text-xs mr-2"
          placeholder={`Enter ${row.childType === "Product Backlog Item" ? "PBI" : row.childType.toLowerCase()} title...`}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && title.trim() && onCreate) {
              onCreate(row.parentId, row.childType);
              setEditing(false);
              setTitle("");
            }
            if (e.key === "Escape") { setEditing(false); setTitle(""); }
          }}
          onBlur={() => { setEditing(false); setTitle(""); }}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center group" style={{ height: ROW_H, paddingLeft: row.depth * IND }}>
      <div className="w-5" />
      <button
        onClick={() => onCreate?.(row.parentId, row.childType)}
        className="text-[11px] text-text-muted hover:text-blue-400 transition-colors flex items-center gap-1 linear-btn"
      >
        <Plus size={10} weight="bold" />{row.label.replace("+ ", "")}
      </button>
    </div>
  );
}

function fmtR(s: Date | null, e: Date | null): string {
  if (!s) return "";
  const f = (d: Date) => `${d.getDate()} ${d.toLocaleDateString("en-US", { month: "short" })}`;
  return e ? `${f(s)} - ${f(e)}` : f(s);
}
