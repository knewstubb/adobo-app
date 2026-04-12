"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Check } from "@phosphor-icons/react";

export interface DropdownOption {
  value: string;
  label: string;
  color?: string;
  icon?: React.ReactNode;
}

export interface CustomDropdownProps {
  options: DropdownOption[];
  value: string | null;
  onChange: (value: string) => void;
  trigger: React.ReactNode;
  align?: "left" | "right";
  /** Controlled mode: parent manages open state */
  isOpen?: boolean;
  /** Controlled mode: called when dropdown wants to toggle */
  onToggle?: () => void;
}

export function CustomDropdown({
  options,
  value,
  onChange,
  trigger,
  align = "left",
  isOpen: controlledIsOpen,
  onToggle,
}: CustomDropdownProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isControlled = controlledIsOpen !== undefined;
  const isOpen = isControlled ? controlledIsOpen : internalIsOpen;
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    if (isControlled) {
      onToggle?.();
    } else {
      setInternalIsOpen(false);
    }
  }, [isControlled, onToggle]);

  function toggle() {
    if (isControlled) {
      onToggle?.();
    } else {
      setInternalIsOpen(prev => !prev);
    }
  }

  // Close on mousedown outside
  useEffect(() => {
    if (!isOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen, close]);

  // Close on Escape — stop propagation so parent modal doesn't also close
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        close();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, close]);

  function handleSelect(optionValue: string) {
    onChange(optionValue);
    close();
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <div
        onClick={toggle}
        className="cursor-pointer"
      >
        {trigger}
      </div>

      {isOpen && (
        <div
          className={`absolute z-[60] mt-1 min-w-[180px] rounded-md border border-border-modal bg-surface-elevated py-1 ${
            align === "right" ? "right-0" : "left-0"
          }`}
          style={{ boxShadow: "0px 4px 24px rgba(0,0,0,0.3)" }}
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                onClick={() => handleSelect(option.value)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-text-primary hover:bg-surface-button transition-colors"
              >
                {/* Checkmark column — fixed width so items align */}
                <span className="w-4 flex-shrink-0 flex items-center justify-center">
                  {isSelected && (
                    <Check size={14} weight="bold" className="text-blue-400" />
                  )}
                </span>

                {/* Optional color dot */}
                {option.color && (
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: option.color }}
                  />
                )}

                {/* Optional icon */}
                {option.icon && (
                  <span className="flex-shrink-0">{option.icon}</span>
                )}

                {/* Label */}
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
