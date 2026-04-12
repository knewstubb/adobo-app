"use client";

import { useState, useRef, useEffect } from "react";
import type { FilterState } from "@/lib/types";
import { STATE_COLOURS } from "@/lib/types";
import { Funnel, CaretRight, Check, X } from "@phosphor-icons/react";

interface FilterBarProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  options: { states: string[]; iterationPaths: string[]; assignees: string[] };
  visibleCount: number;
  totalCount: number;
}

type FilterCategory = "states" | "iterationPaths" | "assignedTo";

const CATEGORIES: { key: FilterCategory; label: string; filterKey: keyof FilterState }[] = [
  { key: "states", label: "Status", filterKey: "states" },
  { key: "iterationPaths", label: "Iteration", filterKey: "iterationPaths" },
  { key: "assignedTo", label: "Person", filterKey: "assignedTo" },
];

export function FilterBar({ filters, onChange, options, visibleCount, totalCount }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<FilterCategory | null>(null);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const activeCount = (filters.states?.length ?? 0) + (filters.iterationPaths?.length ?? 0) + (filters.assignedTo?.length ?? 0);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveCategory(null);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function toggle(key: keyof FilterState, value: string) {
    const arr = (filters[key] as string[] | undefined) ?? [];
    const next = arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
    onChange({ ...filters, [key]: next.length > 0 ? next : undefined });
  }

  function getOptions(cat: FilterCategory): { label: string; value: string }[] {
    if (cat === "states") return options.states.map(s => ({ label: s, value: s }));
    if (cat === "iterationPaths") return options.iterationPaths.map(p => ({ label: p.split("\\").pop() ?? p, value: p }));
    return options.assignees.map(a => ({ label: a, value: a }));
  }

  function getSelected(cat: FilterCategory): string[] {
    if (cat === "states") return filters.states ?? [];
    if (cat === "iterationPaths") return filters.iterationPaths ?? [];
    return filters.assignedTo ?? [];
  }

  function getCategoryCount(cat: FilterCategory): number {
    return getSelected(cat).length;
  }

  // Active filter pills
  const activePills: { key: keyof FilterState; label: string; value: string }[] = [];
  if (filters.states) filters.states.forEach(v => activePills.push({ key: "states", label: v, value: v }));
  if (filters.iterationPaths) filters.iterationPaths.forEach(v => activePills.push({ key: "iterationPaths", label: v.split("\\").pop() ?? v, value: v }));
  if (filters.assignedTo) filters.assignedTo.forEach(v => activePills.push({ key: "assignedTo", label: v, value: v }));

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div ref={ref} className="relative">
        <button
          onClick={() => { setOpen(o => !o); setActiveCategory(null); setSearch(""); }}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
            activeCount > 0
              ? "border-blue-500/40 text-blue-400 bg-blue-500/10 hover:bg-blue-500/15"
              : "border-border-focus text-text-muted hover:border-border-button hover:text-text-secondary"
          }`}
        >
          <Funnel size={13} weight={activeCount > 0 ? "fill" : "regular"} />
          Filter
          {activeCount > 0 && <span className="text-[10px] bg-blue-500/20 px-1.5 rounded-full">{activeCount}</span>}
        </button>

        {open && (
          <div className="absolute z-50 mt-1 left-0 bg-surface-elevated border border-border-modal rounded-lg shadow-[0px_8px_30px_0px_rgba(0,0,0,0.35)] overflow-hidden" style={{ minWidth: 220 }}>
            {!activeCategory ? (
              /* Category list */
              <div className="py-1">
                <div className="px-3 py-1.5 text-[10px] text-text-muted uppercase tracking-wider">Filter by</div>
                {CATEGORIES.map(cat => {
                  const count = getCategoryCount(cat.key);
                  return (
                    <button
                      key={cat.key}
                      onClick={() => { setActiveCategory(cat.key); setSearch(""); }}
                      className="flex items-center justify-between w-full px-3 py-2 text-xs text-text-secondary hover:bg-surface-button transition-colors"
                    >
                      <span>{cat.label}</span>
                      <span className="flex items-center gap-1">
                        {count > 0 && <span className="text-[10px] text-blue-400 bg-blue-500/15 px-1.5 rounded-full">{count}</span>}
                        <CaretRight size={10} className="text-text-muted" />
                      </span>
                    </button>
                  );
                })}
                {activeCount > 0 && (
                  <>
                    <div className="border-t border-border-subtle mx-2 my-1" />
                    <button
                      onClick={() => { onChange({}); setOpen(false); }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text-muted hover:text-red-400 hover:bg-surface-button transition-colors"
                    >
                      <X size={11} />
                      Clear all filters
                    </button>
                  </>
                )}
              </div>
            ) : (
              /* Option list for selected category */
              <div>
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
                  <button onClick={() => { setActiveCategory(null); setSearch(""); }} className="text-text-muted hover:text-text-secondary">
                    <CaretRight size={10} className="rotate-180" />
                  </button>
                  <input
                    autoFocus
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={`Search ${CATEGORIES.find(c => c.key === activeCategory)?.label.toLowerCase()}...`}
                    className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none"
                  />
                </div>
                <div className="max-h-52 overflow-y-auto py-1">
                  {activeCategory === "states" ? (
                    /* Status pills - Linear style */
                    <div className="flex flex-wrap gap-1.5 px-3 py-2">
                      {getOptions(activeCategory)
                        .filter(opt => !search || opt.label.toLowerCase().includes(search.toLowerCase()))
                        .map(opt => {
                          const selected = getSelected(activeCategory).includes(opt.value);
                          const color = STATE_COLOURS[opt.value] ?? "#6C757D";
                          return (
                            <button
                              key={opt.value}
                              onClick={() => toggle("states", opt.value)}
                              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs transition-colors ${
                                selected
                                  ? "border-blue-500/50 bg-blue-500/10 text-text-primary"
                                  : "border-border-subtle text-text-muted hover:border-border-button hover:text-text-secondary"
                              }`}
                            >
                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                              {opt.label}
                            </button>
                          );
                        })}
                    </div>
                  ) : (
                    /* Standard checkbox list for other categories */
                    getOptions(activeCategory)
                      .filter(opt => !search || opt.label.toLowerCase().includes(search.toLowerCase()))
                      .map(opt => {
                        const selected = getSelected(activeCategory).includes(opt.value);
                        return (
                          <button
                            key={opt.value}
                            onClick={() => toggle(activeCategory === "iterationPaths" ? "iterationPaths" : "assignedTo", opt.value)}
                            className="flex items-center gap-2.5 w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-button transition-colors"
                          >
                            <span className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-colors ${
                              selected ? "bg-blue-500 border-blue-500" : "border-border-default"
                            }`}>
                              {selected && <Check size={9} weight="bold" className="text-white" />}
                            </span>
                            <span className="truncate">{opt.label}</span>
                          </button>
                        );
                      })
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <span className="text-xs text-text-muted ml-auto">{visibleCount} / {totalCount}</span>
    </div>
  );
}
