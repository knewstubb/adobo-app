/**
 * Timeline Positioning
 *
 * Two coordinate modes:
 * - Calendar mode (showWeekends=true): positions based on raw milliseconds
 * - Weekday mode (showWeekends=false): positions based on business day count,
 *   weekends are collapsed to zero width
 */

import type { WorkItem, Iteration } from "./types";

export interface TimelineRange {
  start: Date;
  end: Date;
  totalMs: number;
}

export interface BarPosition {
  workItemId: number;
  leftPercent: number;
  widthPercent: number;
}

export interface IterationMarker {
  path: string;
  name: string;
  leftPercent: number;
  widthPercent: number;
}

export interface DayMarker {
  date: Date;
  leftPercent: number;
  widthPercent: number;
  dayOfWeek: number;
  isWeekStart: boolean;
}

/* ── Core: count weekdays between two dates ── */

/** Count weekdays (Mon-Fri) from start of startDate to start of endDate */
export function countWeekdays(from: Date, to: Date): number {
  const a = new Date(from); a.setUTCHours(0, 0, 0, 0);
  const b = new Date(to); b.setUTCHours(0, 0, 0, 0);
  if (b <= a) return 0;
  let count = 0;
  const cur = new Date(a);
  while (cur < b) {
    const dow = cur.getUTCDay();
    if (dow >= 1 && dow <= 5) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/** Total weekdays in the range */
export function totalWeekdaysInRange(range: TimelineRange): number {
  return countWeekdays(range.start, range.end);
}

/* ── Date to percent conversion ── */

/** Convert a date to a percentage position on the timeline */
export function dateToPercent(date: Date, range: TimelineRange, showWeekends: boolean): number {
  if (showWeekends) {
    const ms = date.getTime() - range.start.getTime();
    return (ms / range.totalMs) * 100;
  }
  const totalDays = totalWeekdaysInRange(range);
  if (totalDays === 0) return 0;
  const daysBefore = countWeekdays(range.start, date);
  return (daysBefore / totalDays) * 100;
}

/** Convert a percentage back to a date */
export function percentToDate(pct: number, range: TimelineRange, showWeekends: boolean): Date {
  if (showWeekends) {
    return new Date(range.start.getTime() + (pct / 100) * range.totalMs);
  }
  const totalDays = totalWeekdaysInRange(range);
  if (totalDays === 0) return new Date(range.start);

  // Use floor to get the day boundary, not round (which causes off-by-one)
  const targetDay = Math.floor((pct / 100) * totalDays);
  const cur = new Date(range.start);
  cur.setUTCHours(0, 0, 0, 0);
  let weekdayCount = 0;

  while (weekdayCount < targetDay) {
    cur.setUTCDate(cur.getUTCDate() + 1);
    const dow = cur.getUTCDay();
    if (dow >= 1 && dow <= 5) weekdayCount++;
  }

  return cur;
}

/* ── Timeline range ── */

export function computeTimelineRange(iterations: Iteration[]): TimelineRange | null {
  const withDates = iterations.filter((i) => i.startDate && i.endDate);
  if (withDates.length === 0) return null;
  let earliest = withDates[0].startDate!;
  let latest = withDates[0].endDate!;
  for (const iter of withDates) {
    if (iter.startDate! < earliest) earliest = iter.startDate!;
    if (iter.endDate! > latest) latest = iter.endDate!;
  }
  // End date is inclusive, so extend by 1 day to include the last day fully
  const endPlusOne = new Date(latest);
  endPlusOne.setUTCDate(endPlusOne.getUTCDate() + 1);
  return { start: earliest, end: endPlusOne, totalMs: endPlusOne.getTime() - earliest.getTime() };
}

/* ── Iteration markers ── */

export function computeIterationMarkers(
  iterations: Iteration[], range: TimelineRange, showWeekends: boolean = true
): IterationMarker[] {
  return iterations
    .filter((i) => i.startDate && i.endDate)
    .map((iter) => {
      const left = dateToPercent(iter.startDate!, range, showWeekends);
      // End date is inclusive, so add 1 day to get the right edge
      const endPlusOne = new Date(iter.endDate!);
      endPlusOne.setUTCDate(endPlusOne.getUTCDate() + 1);
      const right = dateToPercent(endPlusOne, range, showWeekends);
      return { path: iter.path, name: iter.name, leftPercent: left, widthPercent: right - left };
    })
    .sort((a, b) => a.leftPercent - b.leftPercent);
}

/* ── Day markers ── */

export function computeDayMarkers(range: TimelineRange, showWeekends: boolean = true): DayMarker[] {
  const markers: DayMarker[] = [];
  const cur = new Date(range.start);
  cur.setUTCHours(0, 0, 0, 0);
  const endTime = range.end.getTime();
  const totalDays = showWeekends ? null : totalWeekdaysInRange(range);

  while (cur.getTime() <= endTime) {
    const dow = cur.getUTCDay();
    const isWeekday = dow >= 1 && dow <= 5;

    if (showWeekends || isWeekday) {
      const left = dateToPercent(cur, range, showWeekends);
      // Width = distance to next visible day
      const next = new Date(cur);
      next.setUTCDate(next.getUTCDate() + 1);
      if (!showWeekends) {
        while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next.setUTCDate(next.getUTCDate() + 1);
      }
      const right = next.getTime() <= endTime
        ? dateToPercent(next, range, showWeekends)
        : 100;
      const width = Math.min(right - left, 100 - left);

      markers.push({
        date: new Date(cur),
        leftPercent: left,
        widthPercent: Math.max(0.1, width),
        dayOfWeek: dow,
        isWeekStart: dow === 1,
      });
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return markers;
}

/* ── Today line ── */

export function computeTodayPercent(range: TimelineRange, showWeekends: boolean = true): number | null {
  const now = new Date();
  // Snap to the center of today's local day for a cleaner visual
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayMid = new Date(todayStart.getTime() + 12 * 60 * 60 * 1000); // noon local
  const pct = dateToPercent(todayMid, range, showWeekends);
  if (pct < 0 || pct > 100) return null;
  return pct;
}

/* ── Snap helpers ── */

/** Snap a date to the nearest weekday (backward: Sat->Fri, Sun->Mon) */
export function snapToWeekday(date: Date): Date {
  const d = new Date(date); d.setUTCHours(0, 0, 0, 0);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/** Snap forward to next weekday (for end dates: Sat->Mon, Sun->Mon) */
export function snapForward(date: Date): Date {
  const d = new Date(date); d.setUTCHours(0, 0, 0, 0);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  if (d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 2);
  return d;
}

/** Snap a date to the start of the nearest day */
export function snapToDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/* ── Iteration lookup ── */

export function findIterationForDate(date: Date, iterations: Iteration[]): Iteration | null {
  for (const iter of iterations) {
    if (iter.startDate && iter.endDate && date >= iter.startDate && date <= iter.endDate) return iter;
  }
  return null;
}

/* ── Bar position (used by gantt-tree) ── */

export function computeBarPosition(item: WorkItem, iterations: Iteration[], range: TimelineRange): BarPosition | null {
  if (!item.iterationPath) return null;
  const iteration = iterations.find((i) => i.path === item.iterationPath);
  if (!iteration?.startDate || !iteration?.endDate) return null;
  const startMs = iteration.startDate.getTime() - range.start.getTime();
  const endMs = iteration.endDate.getTime() - range.start.getTime();
  return { workItemId: item.id, leftPercent: (startMs / range.totalMs) * 100, widthPercent: ((endMs - startMs) / range.totalMs) * 100 };
}

/* ── Classify ── */

export function classifyItems(items: WorkItem[], iterations: Iteration[]): { scheduled: WorkItem[]; unscheduled: WorkItem[] } {
  const iterPaths = new Set(iterations.filter((i) => i.startDate && i.endDate).map((i) => i.path));
  const scheduled: WorkItem[] = [], unscheduled: WorkItem[] = [];
  for (const item of items) {
    if (item.iterationPath && iterPaths.has(item.iterationPath)) scheduled.push(item);
    else unscheduled.push(item);
  }
  return { scheduled, unscheduled };
}
