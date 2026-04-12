"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import type { WorkItem, Iteration, TeamMember } from "@/lib/types";
import { STATE_COLOURS, getStatesForType } from "@/lib/types";
import { TagManager } from "./TagManager";
import { CustomDropdown } from "./CustomDropdown";
import type { DropdownOption } from "./CustomDropdown";
import { X, Asterisk, CrownSimple, Trophy, ListChecks, ClipboardText, Bug, CaretRight, Copy, Check, Flag, ArrowSquareOut, ArrowLeft } from "@phosphor-icons/react";
import { getLinksForItem, addLink, removeLink } from "@/lib/idb-cache";
import { marked } from "marked";
import TurndownService from "turndown";

marked.setOptions({ gfm: true, breaks: true });

const PRIORITY_COLOURS: Record<number, string> = {
  1: "#EF4444",  // red
  2: "#F59E0B",  // amber
  3: "#3B82F6",  // blue
  4: "#858699",  // grey
};

const PRIORITY_LABELS: Record<number, string> = {
  1: "P1 — Critical",
  2: "P2 — High",
  3: "P3 — Medium",
  4: "P4 — Low",
};

interface DetailModalProps {
  item: WorkItem | null;
  allItems?: WorkItem[];
  iterations: Iteration[];
  teamMembers: TeamMember[];
  allTags: string[];
  onClose: () => void;
  onStateChange: (newState: string) => void;
  onAssigneeChange: (newAssignee: string | null) => void;
  onTagsChange: (newTags: string[]) => void;
  onDescriptionChange?: (newDescription: string) => void;
  onAcceptanceCriteriaChange?: (newAC: string) => void;
  onIterationChange?: (newIterationPath: string) => void;
  onTitleChange?: (newTitle: string) => void;
  onNavigate?: (item: WorkItem) => void;
  onPriorityChange?: (newPriority: number) => void;
}

export function DetailModal({
  item, iterations, teamMembers, allTags, allItems = [],
  onClose, onStateChange, onAssigneeChange, onTagsChange,
  onDescriptionChange, onAcceptanceCriteriaChange, onIterationChange,
  onTitleChange, onNavigate, onPriorityChange,
}: DetailModalProps) {

  // Track which dropdown is open — only one at a time
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // CustomDropdown handles its own Escape (capture phase, stopPropagation)
      // If title is being edited, cancel the edit instead of closing modal
      if (editingTitle) {
        setTitleDraft(item?.title ?? "");
        setEditingTitle(false);
        return;
      }
      // Otherwise close modal
      onClose();
    }
  }, [onClose, editingTitle, item?.title]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Children list state
  const [showAllChildren, setShowAllChildren] = useState(false);

  // Navigation stack state (session history for breadcrumb navigation)
  const [navigationStack, setNavigationStack] = useState<WorkItem[]>([]);

  function navigateToChild(child: WorkItem) {
    if (!item) return;
    setNavigationStack(prev => [...prev, item]);
    onNavigate?.(child);
  }

  function navigateBack() {
    const prev = navigationStack[navigationStack.length - 1];
    if (!prev) return;
    setNavigationStack(s => s.slice(0, -1));
    onNavigate?.(prev);
  }

  function navigateToBreadcrumb(index: number) {
    const target = navigationStack[index];
    if (!target) return;
    setNavigationStack(s => s.slice(0, index));
    onNavigate?.(target);
  }

  // Reset navigation stack when modal closes
  useEffect(() => {
    if (!item) setNavigationStack([]);
  }, [item]);

  // Predecessor/successor state
  const [predecessorIds, setPredecessorIds] = useState<number[]>([]);
  const [successorIds, setSuccessorIds] = useState<number[]>([]);
  const [linkInput, setLinkInput] = useState("");
  const [linkError, setLinkError] = useState("");
  const [linkSection, setLinkSection] = useState<"predecessor" | "successor">("predecessor");

  // Reset title editing and close dropdowns when item changes
  useEffect(() => {
    setEditingTitle(false);
    setOpenDropdown(null);
    setShowAllChildren(false);
    setLinkInput("");
    setLinkError("");
    if (item) setTitleDraft(item.title);
  }, [item?.id]);

  // Fetch predecessor/successor links when item changes
  useEffect(() => {
    if (!item) { setPredecessorIds([]); setSuccessorIds([]); return; }
    let cancelled = false;
    getLinksForItem(item.id).then(result => {
      if (cancelled) return;
      setPredecessorIds(result.predecessors);
      setSuccessorIds(result.successors);
    });
    return () => { cancelled = true; };
  }, [item?.id]);

  if (!item) return null;

  const iterName = item.iterationPath?.split("\\").pop() ?? "Unscheduled";
  const isUnscheduled = !item.iterationPath || item.iterationPath === "Spark";

  // Find iteration dates
  const currentIter = iterations.find(i => i.path === item.iterationPath);
  const iterStart = currentIter?.startDate;
  const iterEnd = currentIter?.endDate;
  const formatDate = (d: Date) => d.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });

  // Type icon and colour
  const TypeIcon = item.workItemType === "Initiative" ? Asterisk
    : item.workItemType === "Epic" ? CrownSimple
    : item.workItemType === "Feature" ? Trophy
    : item.workItemType === "Task" ? ClipboardText
    : item.workItemType === "Bug" ? Bug
    : ListChecks;

  const typeColor = item.workItemType === "Initiative" ? "text-blue-500"
    : item.workItemType === "Epic" ? "text-orange-400"
    : item.workItemType === "Feature" ? "text-purple-400"
    : item.workItemType === "Task" ? "text-yellow-400"
    : item.workItemType === "Bug" ? "text-red-500"
    : "text-blue-400";

  const shortType = item.workItemType === "Product Backlog Item" ? "PBI" : item.workItemType;

  // Priority
  const priority = item.priority ?? 4;
  const priorityColour = PRIORITY_COLOURS[priority] ?? PRIORITY_COLOURS[4];

  // Dropdown options
  const stateOptions: DropdownOption[] = getStatesForType(item.workItemType).map(s => ({
    value: s,
    label: s,
    color: STATE_COLOURS[s] ?? "#6C757D",
  }));

  const assigneeOptions: DropdownOption[] = [
    { value: "", label: "Unassigned" },
    ...teamMembers.map(m => ({ value: m.displayName, label: m.displayName })),
  ];

  const priorityOptions: DropdownOption[] = [1, 2, 3, 4].map(p => ({
    value: String(p),
    label: PRIORITY_LABELS[p],
    icon: <Flag size={14} weight="fill" style={{ color: PRIORITY_COLOURS[p] }} />,
  }));

  // Helper to toggle a specific dropdown (closes others)
  function toggleDropdown(name: string) {
    setOpenDropdown(prev => prev === name ? null : name);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-surface-elevated border border-border-modal rounded-lg shadow-[0px_16px_70px_0px_rgba(0,0,0,0.5)] w-[95vw] max-w-[1400px] h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">

        {/* ── ModalHeader: type icon, ID, breadcrumb, close ── */}
        <div className="flex items-center justify-between px-6 pt-5 pb-1">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            {/* Back arrow — visible when navigation stack has entries */}
            {navigationStack.length > 0 && (
              <button
                onClick={navigateBack}
                className="hover:text-blue-400 transition-colors mr-1"
                title="Go back"
              >
                <ArrowLeft size={14} />
              </button>
            )}
            <TypeIcon size={14} weight={item.workItemType === "Initiative" ? "bold" : "fill"} className={typeColor} />
            <span className="font-medium">{shortType}</span>
            <span className="text-border-default">|</span>
            <ModalCopyIdLink id={item.id} />
            {/* Session-history breadcrumb trail */}
            {navigationStack.length > 0 && (
              <>
                <span className="text-border-default">|</span>
                {navigationStack.map((crumb, i) => (
                  <span key={`${crumb.id}-${i}`} className="flex items-center gap-1">
                    {i > 0 && <CaretRight size={10} className="text-text-muted" />}
                    <button
                      onClick={() => navigateToBreadcrumb(i)}
                      className="hover:text-blue-400 transition-colors truncate max-w-[150px]"
                    >
                      {crumb.title}
                    </button>
                  </span>
                ))}
                <CaretRight size={10} className="text-text-muted" />
                <span className="text-text-primary truncate max-w-[150px]">{item.title}</span>
              </>
            )}
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* ── Title — 24px, click-to-edit ── */}
        <div className="px-6 pt-2 pb-3">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              autoFocus
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={() => {
                setEditingTitle(false);
                const trimmed = titleDraft.trim();
                if (trimmed && trimmed !== item.title && onTitleChange) onTitleChange(trimmed);
              }}
              onKeyDown={e => {
                if (e.key === "Enter" || ((e.metaKey || e.ctrlKey) && e.key === "Enter")) { (e.target as HTMLInputElement).blur(); }
                if (e.key === "Escape") { setTitleDraft(item.title); setEditingTitle(false); }
              }}
              className="w-full text-2xl font-medium text-text-primary leading-tight bg-transparent border border-border-subtle rounded-md px-2 py-1 -mx-2 -my-1 focus:outline-none focus:border-blue-500 transition-colors"
            />
          ) : (
            <h2
              onClick={() => { if (onTitleChange) { setTitleDraft(item.title); setEditingTitle(true); } }}
              className={`text-2xl font-medium text-text-primary leading-tight rounded-md px-2 py-1 -mx-2 -my-1 transition-colors ${onTitleChange ? "hover:bg-surface-header/40 cursor-text border border-transparent hover:border-border-subtle" : ""}`}
            >
              {item.title}
            </h2>
          )}
        </div>

        {/* ── HeaderRow — inline metadata, no labels ── */}
        <div className="flex items-center gap-4 px-6 pb-4 text-xs flex-wrap">
          {/* Status: coloured dot + text → CustomDropdown */}
          <CustomDropdown
            options={stateOptions}
            value={item.state}
            onChange={(val) => { onStateChange(val); setOpenDropdown(null); }}
            isOpen={openDropdown === "status"}
            onToggle={() => toggleDropdown("status")}
            trigger={
              <button
                className="flex items-center gap-1.5 hover:bg-surface-button/50 rounded px-1.5 py-1 -mx-1.5 transition-colors"
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: STATE_COLOURS[item.state] ?? "#6C757D" }} />
                <span className="text-text-primary">{item.state}</span>
              </button>
            }
          />

          {/* Assignee: name text → CustomDropdown */}
          <CustomDropdown
            options={assigneeOptions}
            value={item.assignedTo ?? ""}
            onChange={(val) => { onAssigneeChange(val || null); setOpenDropdown(null); }}
            isOpen={openDropdown === "assignee"}
            onToggle={() => toggleDropdown("assignee")}
            trigger={
              <button
                className="flex items-center gap-1.5 hover:bg-surface-button/50 rounded px-1.5 py-1 -mx-1.5 transition-colors"
              >
                <span className="text-text-primary">{item.assignedTo?.split(" ")[0] ?? "Unassigned"}</span>
              </button>
            }
          />

          {/* Priority: Flag icon coloured by priority → CustomDropdown */}
          <CustomDropdown
            options={priorityOptions}
            value={String(priority)}
            onChange={(val) => { onPriorityChange?.(Number(val)); setOpenDropdown(null); }}
            isOpen={openDropdown === "priority"}
            onToggle={() => toggleDropdown("priority")}
            trigger={
              <button
                className="flex items-center gap-1 hover:bg-surface-button/50 rounded px-1.5 py-1 -mx-1.5 transition-colors"
              >
                <Flag size={14} weight="fill" style={{ color: priorityColour }} />
                <span className="text-text-primary">{PRIORITY_LABELS[priority]?.split(" ")[0] ?? "P4"}</span>
              </button>
            }
          />

          {/* Effort: circle with number */}
          <span className={`inline-flex w-5 h-5 rounded-full items-center justify-center text-[10px] font-medium ${
            item.effort != null ? "bg-blue-500/20 text-blue-400" : "bg-surface-button text-text-muted"
          }`}>{item.effort ?? "–"}</span>

          {/* Tags: chips with remove + TagManager add */}
          <div className="flex items-center gap-1">
            {item.tags.map(tag => (
              <span key={tag} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-500/15 text-blue-400 border border-blue-500/20">
                {tag}
                <button onClick={() => onTagsChange(item.tags.filter(t => t !== tag))} className="hover:text-blue-300 ml-0.5">&times;</button>
              </span>
            ))}
            <TagManager tags={item.tags} allTags={allTags} onChange={(newTags) => onTagsChange(newTags)} />
          </div>
        </div>

        {/* ── TwoPanel: Left 65% / Right 35% ── */}
        <div className="flex-1 flex min-h-0">
          {/* Left Panel — Description + AC, scrolls independently */}
          <div className="w-[65%] overflow-y-auto px-6 pb-4 border-r border-border-subtle">
            <div className="flex flex-col gap-4" style={{ minHeight: 300 }}>
              <EditableHtmlField label="Description" value={item.description} onChange={onDescriptionChange} />
              <EditableHtmlField label="Acceptance Criteria" value={item.acceptanceCriteria} onChange={onAcceptanceCriteriaChange} />
            </div>
          </div>

          {/* Right Panel — metadata/relationships, scrolls independently */}
          <div className="w-[35%] overflow-y-auto px-5 pb-4">
            {/* Iteration */}
            <div className="mb-5">
              <h3 className="text-[10px] text-text-muted uppercase tracking-wider mb-2">Iteration</h3>
              {onIterationChange ? (
                <CustomDropdown
                  options={iterations
                    .filter(i => i.startDate && i.endDate && i.endDate >= new Date())
                    .sort((a, b) => a.startDate!.getTime() - b.startDate!.getTime())
                    .map(i => ({ value: i.path, label: i.name }))}
                  value={item.iterationPath ?? ""}
                  onChange={(val) => { onIterationChange(val); setOpenDropdown(null); }}
                  isOpen={openDropdown === "iteration"}
                  onToggle={() => toggleDropdown("iteration")}
                  trigger={
                    <button
                      className="text-sm text-text-primary hover:text-blue-400 transition-colors"
                    >
                      {isUnscheduled ? "--" : iterName}
                    </button>
                  }
                />
              ) : (
                <span className="text-sm text-text-primary">{isUnscheduled ? "--" : iterName}</span>
              )}
              {iterStart && iterEnd && (
                <p className="text-[11px] text-text-muted mt-1">{formatDate(iterStart)} → {formatDate(iterEnd)}</p>
              )}
            </div>

            {/* Children */}
            <div className="mb-5">
              <h3 className="text-[10px] text-text-muted uppercase tracking-wider mb-2">
                Children{(() => { const c = allItems.filter(i => i.parentId === item.id); return c.length > 0 ? ` (${c.length})` : ""; })()}
              </h3>
              {(() => {
                const children = allItems.filter(i => i.parentId === item.id);
                if (children.length === 0) return <p className="text-xs text-text-muted italic">No children</p>;
                const visible = showAllChildren ? children : children.slice(0, 5);
                return (
                  <div className="flex flex-col gap-1">
                    {visible.map(child => (
                      <button
                        key={child.id}
                        onClick={() => navigateToChild(child)}
                        className="flex items-center gap-2 text-xs text-text-secondary hover:text-blue-400 hover:bg-surface-button/30 rounded px-1.5 py-1 -mx-1.5 transition-colors text-left group"
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: STATE_COLOURS[child.state] ?? "#6C757D" }} />
                        <span className="truncate flex-1">{child.title}</span>
                        <span className="text-text-muted flex-shrink-0">#{child.id}</span>
                      </button>
                    ))}
                    {children.length > 5 && (
                      <button
                        onClick={() => setShowAllChildren(prev => !prev)}
                        className="text-[10px] text-blue-400 hover:text-blue-300 mt-1 text-left px-1.5 -mx-1.5"
                      >
                        {showAllChildren ? "Show less" : `Show ${children.length - 5} more`}
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Predecessors */}
            <div className="mb-5">
              <h3 className="text-[10px] text-text-muted uppercase tracking-wider mb-2">Predecessors</h3>
              {predecessorIds.length === 0 ? (
                <p className="text-xs text-text-muted italic">None</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {predecessorIds.map(pid => {
                    const linked = allItems.find(i => i.id === pid);
                    return (
                      <div key={pid} className="flex items-center gap-2 text-xs text-text-secondary group">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: linked ? (STATE_COLOURS[linked.state] ?? "#6C757D") : "#6C757D" }} />
                        <span className="truncate flex-1">{linked?.title ?? `Item ${pid}`}</span>
                        <span className="text-text-muted flex-shrink-0">#{pid}</span>
                        <button
                          onClick={async () => {
                            await removeLink(item.id, pid, "predecessor");
                            setPredecessorIds(prev => prev.filter(id => id !== pid));
                          }}
                          className="text-text-muted/60 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                          title="Remove predecessor"
                        >×</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Successors */}
            <div className="mb-5">
              <h3 className="text-[10px] text-text-muted uppercase tracking-wider mb-2">Successors</h3>
              {successorIds.length === 0 ? (
                <p className="text-xs text-text-muted italic">None</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {successorIds.map(sid => {
                    const linked = allItems.find(i => i.id === sid);
                    return (
                      <div key={sid} className="flex items-center gap-2 text-xs text-text-secondary group">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: linked ? (STATE_COLOURS[linked.state] ?? "#6C757D") : "#6C757D" }} />
                        <span className="truncate flex-1">{linked?.title ?? `Item ${sid}`}</span>
                        <span className="text-text-muted flex-shrink-0">#{sid}</span>
                        <button
                          onClick={async () => {
                            await removeLink(item.id, sid, "successor");
                            setSuccessorIds(prev => prev.filter(id => id !== sid));
                          }}
                          className="text-text-muted/60 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                          title="Remove successor"
                        >×</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Add link input */}
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-1.5">
                <button
                  onClick={() => { setLinkSection("predecessor"); setLinkError(""); }}
                  className={`text-[10px] uppercase tracking-wider transition-colors ${linkSection === "predecessor" ? "text-text-primary" : "text-text-muted hover:text-text-muted"}`}
                >Predecessor</button>
                <span className="text-text-muted/50">|</span>
                <button
                  onClick={() => { setLinkSection("successor"); setLinkError(""); }}
                  className={`text-[10px] uppercase tracking-wider transition-colors ${linkSection === "successor" ? "text-text-primary" : "text-text-muted hover:text-text-muted"}`}
                >Successor</button>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={linkInput}
                  onChange={e => { setLinkInput(e.target.value); setLinkError(""); }}
                  onKeyDown={async e => {
                    if (e.key !== "Enter" || !linkInput.trim()) return;
                    const targetId = parseInt(linkInput.trim(), 10);
                    if (isNaN(targetId)) { setLinkError("Enter a valid ID"); return; }
                    if (!allItems.find(i => i.id === targetId)) { setLinkError("Work item not found"); return; }
                    if (targetId === item.id) { setLinkError("Cannot link to self"); return; }
                    const result = await addLink(item.id, targetId, linkSection).then(() => ({ success: true as const })).catch((e: Error) => ({ success: false as const, error: e.message }));
                    if (!result.success) { setLinkError(result.error ?? "Failed to add link"); return; }
                    if (linkSection === "predecessor") {
                      setPredecessorIds(prev => prev.includes(targetId) ? prev : [...prev, targetId]);
                    } else {
                      setSuccessorIds(prev => prev.includes(targetId) ? prev : [...prev, targetId]);
                    }
                    setLinkInput("");
                    setLinkError("");
                  }}
                  placeholder={`Add ${linkSection} by ID`}
                  className="flex-1 bg-surface-app border border-border-subtle rounded px-2 py-1 text-xs text-text-secondary placeholder:text-text-muted focus:outline-none focus:border-border-button"
                />
              </div>
              {linkError && <p className="text-[10px] text-red-400 mt-1">{linkError}</p>}
            </div>

            {/* ADO Link */}
            <div className="mb-5">
              <h3 className="text-[10px] text-text-muted uppercase tracking-wider mb-2">ADO Link</h3>
              <a
                href={`https://dev.azure.com/${process.env.NEXT_PUBLIC_ADO_ORG ?? "sparknz"}/${process.env.NEXT_PUBLIC_ADO_PROJECT ?? "Spark"}/_workitems/edit/${item.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                Open in Azure DevOps
                <ArrowSquareOut size={12} />
              </a>
            </div>
          </div>
        </div>

        {/* ── Footer: timestamps ── */}
        <div className="flex items-center gap-6 px-6 py-3 border-t border-border-subtle text-[10px] text-text-muted">
          {item.assignedTo && <span>Assigned to {item.assignedTo.split(" ")[0]}</span>}
          {item.adoChangedDate && <span>Edited {formatDate(item.adoChangedDate)}</span>}
          {item.cachedAt && <span>Synced {formatDate(item.cachedAt)}</span>}
        </div>
      </div>
    </div>
  );
}


function ModalCopyIdLink({ id }: { id: number }) {
  const [copied, setCopied] = useState(false);
  const url = `https://dev.azure.com/${process.env.NEXT_PUBLIC_ADO_ORG ?? "sparknz"}/${process.env.NEXT_PUBLIC_ADO_PROJECT ?? "Spark"}/_workitems/edit/${id}`;
  return (
    <span className="flex items-center gap-1">
      <a href={url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition-colors">#{id}</a>
      <button
        onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="text-text-muted hover:text-blue-400 transition-colors"
        title="Copy link"
      >
        {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
      </button>
    </span>
  );
}

function EditableHtmlField({ label, value, onChange }: {
  label: string;
  value: string | null;
  onChange?: (newValue: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [renderedHtml, setRenderedHtml] = useState("");
  const mdRef = useRef<string>("");
  const hasLocalEdit = useRef(false);

  useEffect(() => {
    if (hasLocalEdit.current) return;
    if (!value) { setMarkdown(""); mdRef.current = ""; setRenderedHtml(""); return; }
    const isHtml = /<[a-z][\s\S]*>/i.test(value);
    let md: string;
    if (isHtml) {
      const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });
      td.addRule("taskListItem", {
        filter: (node) => node.nodeName === "LI" && node.querySelector("input[type=checkbox]") !== null,
        replacement: (_content, node) => {
          const el = node as HTMLElement;
          const cb = el.querySelector("input[type=checkbox]") as HTMLInputElement | null;
          const checked = cb?.checked || cb?.hasAttribute("checked") || false;
          const clone = el.cloneNode(true) as HTMLElement;
          clone.querySelector("input[type=checkbox]")?.remove();
          return `- [${checked ? "x" : " "}] ${clone.textContent?.trim() ?? ""}\n`;
        },
      });
      td.addRule("adoCheckbox", {
        filter: (node) => node.nodeName === "DIV" && node.querySelector("input[type=checkbox]") !== null,
        replacement: (_content, node) => {
          const el = node as HTMLElement;
          const cb = el.querySelector("input[type=checkbox]") as HTMLInputElement | null;
          const checked = cb?.checked || cb?.hasAttribute("checked") || false;
          const clone = el.cloneNode(true) as HTMLElement;
          clone.querySelector("input[type=checkbox]")?.remove();
          return `- [${checked ? "x" : " "}] ${clone.textContent?.trim() ?? ""}\n`;
        },
      });
      md = td.turndown(value);
    } else {
      md = value;
    }
    setMarkdown(md);
    mdRef.current = md;
    setRenderedHtml(marked.parse(md) as string);
  }, [value]);

  function handleSave() {
    const newMd = mdRef.current;
    setEditing(false);
    setMarkdown(newMd);
    hasLocalEdit.current = true;
    setRenderedHtml(marked.parse(newMd) as string);
    if (onChange) onChange(newMd);
  }

  function handleCheckboxToggle(idx: number) {
    if (!markdown || !onChange) return;
    const lines = markdown.split("\n");
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(\s*-\s*\[)([ x])(\].*)/);
      if (match) {
        if (count === idx) { lines[i] = match[1] + (match[2] === "x" ? " " : "x") + match[3]; break; }
        count++;
      }
    }
    const newMd = lines.join("\n");
    mdRef.current = newMd;
    setMarkdown(newMd);
    hasLocalEdit.current = true;
    setRenderedHtml(marked.parse(newMd) as string);
    onChange(newMd);
  }

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null);
  const [hasSelection, setHasSelection] = useState(false);

  function checkSelection() {
    const ta = textareaRef.current;
    if (!ta) return;
    if (ta.selectionStart !== ta.selectionEnd) {
      const text = ta.value.substring(0, ta.selectionStart);
      const lines = text.split("\n").length;
      setToolbarPos({ top: Math.max(0, lines * 20 - 35), left: (ta.getBoundingClientRect().width / 2) - 100 });
      setHasSelection(true);
    } else { setHasSelection(false); }
  }

  function insertMarkdown(prefix: string, suffix: string = "") {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value: t } = ta;
    const sel = t.substring(s, e);
    const rep = prefix + (sel || "text") + suffix;
    const newText = t.substring(0, s) + rep + t.substring(e);
    setMarkdown(newText); mdRef.current = newText; setHasSelection(false);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + prefix.length, s + prefix.length + (sel || "text").length); });
  }

  function insertLine(prefix: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: start, value: text } = ta;
    const ls = text.lastIndexOf("\n", start - 1) + 1;
    const le = text.indexOf("\n", start);
    const line = text.substring(ls, le === -1 ? text.length : le);
    const stripped = line.replace(/^(#{1,6}\s+|- \[[ x]\]\s+|- \s+|\d+\.\s+)/, "");
    const newLine = prefix + stripped;
    const newText = text.substring(0, ls) + newLine + text.substring(le === -1 ? text.length : le);
    setMarkdown(newText); mdRef.current = newText; setHasSelection(false);
    const pos = ls + prefix.length + stripped.length;
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(pos, pos); });
  }

  const buttons = [
    { label: "B", title: "Bold", action: () => insertMarkdown("**", "**") },
    { label: "I", title: "Italic", action: () => insertMarkdown("_", "_") },
    { label: "H1", title: "Heading 1", action: () => insertLine("# ") },
    { label: "H2", title: "Heading 2", action: () => insertLine("## ") },
    { label: "H3", title: "Heading 3", action: () => insertLine("### ") },
    { label: "\u2022", title: "Bullet", action: () => insertLine("- ") },
    { label: "\u2610", title: "Checkbox", action: () => insertLine("- [ ] ") },
    { label: "1.", title: "Numbered", action: () => insertLine("1. ") },
  ];

  if (editing) {
    return (
      <div className="flex flex-col">
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] text-text-muted uppercase tracking-wider">{label}</label>
          <button onMouseDown={e => { e.preventDefault(); handleSave(); }} className="text-[10px] text-blue-400 hover:text-blue-300">Save</button>
        </div>
        <div className="relative flex-1">
          {hasSelection && toolbarPos && (
            <div className="absolute z-50 flex items-center gap-0.5 bg-surface-elevated border border-border-modal rounded-lg shadow-lg px-1 py-0.5"
              style={{ top: toolbarPos.top, left: toolbarPos.left }}>
              {buttons.map(b => (
                <button key={b.title} title={b.title} onMouseDown={e => { e.preventDefault(); b.action(); }}
                  className="px-1.5 py-1 text-[11px] text-text-muted hover:text-text-primary hover:bg-surface-button rounded font-mono">{b.label}</button>
              ))}
            </div>
          )}
          <textarea ref={textareaRef} autoFocus value={markdown ?? ""}
            onChange={e => { setMarkdown(e.target.value); mdRef.current = e.target.value; }}
            onBlur={handleSave} onSelect={checkSelection} onKeyUp={checkSelection} onMouseUp={checkSelection}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
            className="w-full bg-surface-app border border-border-subtle rounded-md p-3 resize-none text-sm text-text-secondary font-mono focus:outline-none focus:border-border-button min-h-[300px]"
            placeholder={`Enter ${label.toLowerCase()} in markdown...`} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <label className="text-[10px] text-text-muted uppercase tracking-wider mb-1">{label}</label>
      <div className="flex-1 p-3 overflow-y-auto min-h-[120px] cursor-pointer rounded-md hover:bg-surface-header/20 transition-colors"
        onClick={e => {
          const target = e.target as HTMLElement;
          if (target.tagName === "INPUT" && (target as HTMLInputElement).type === "checkbox") {
            e.stopPropagation();
            const cbs = e.currentTarget.querySelectorAll("input[type=checkbox]");
            const idx = Array.from(cbs).indexOf(target as HTMLInputElement);
            if (idx >= 0) handleCheckboxToggle(idx);
            return;
          }
          if (onChange) setEditing(true);
        }}>
        {renderedHtml ? (
          <div className="text-sm text-text-secondary prose prose-invert prose-sm max-w-none [&_input[type=checkbox]]:cursor-pointer [&_input[type=checkbox]]:pointer-events-auto [&_p]:mb-3 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-text-primary [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-text-primary [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-4 [&_h3]:mb-2 [&_ul+p]:mt-4 [&_ol+p]:mt-4" dangerouslySetInnerHTML={{ __html: renderedHtml.replace(/disabled/g, "") }} />
        ) : (
          <p className="text-xs text-text-muted italic">Click to add {label.toLowerCase()}</p>
        )}
      </div>
    </div>
  );
}
