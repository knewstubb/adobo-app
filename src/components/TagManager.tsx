"use client";

import { useState, useRef } from "react";

interface TagManagerProps { tags: string[]; allTags: string[]; onChange: (newTags: string[]) => void; }

export function TagManager({ tags, allTags, onChange }: TagManagerProps) {
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = input.trim() ? allTags.filter(t => t.toLowerCase().includes(input.toLowerCase()) && !tags.includes(t)) : [];

  function addTag(tag: string) { const t = tag.trim(); if (!t || tags.includes(t)) return; onChange([...tags, t]); setInput(""); setShowSuggestions(false); inputRef.current?.focus(); }
  function removeTag(tag: string) { onChange(tags.filter(t => t !== tag)); }

  return (
    <div className="relative">
      <div className="flex flex-wrap gap-1 mb-1">
        {tags.map(tag => (
          <span key={tag} className="inline-flex items-center gap-1 bg-surface-button text-text-secondary text-xs rounded px-2 py-0.5">
            {tag}
            <button onClick={() => removeTag(tag)} className="text-text-muted hover:text-text-primary text-xs leading-none">&times;</button>
          </span>
        ))}
      </div>
      <input ref={inputRef} type="text" value={input}
        onChange={e => { setInput(e.target.value); setShowSuggestions(true); }}
        onKeyDown={e => { if (e.key === "Enter" && input.trim()) { e.preventDefault(); addTag(input); } }}
        onFocus={() => setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        placeholder="Add tag..."
        className="w-full linear-input" />
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-surface-elevated border border-border-modal rounded-lg shadow-lg max-h-32 overflow-y-auto">
          {suggestions.slice(0, 8).map(s => (
            <button key={s} onMouseDown={() => addTag(s)} className="block w-full text-left px-2 py-1 text-xs text-text-secondary hover:bg-surface-button">{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}
