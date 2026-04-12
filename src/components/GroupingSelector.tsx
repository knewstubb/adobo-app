"use client";

import type { GroupingDimension } from "@/lib/types";

interface GroupingSelectorProps {
  value: GroupingDimension | null;
  onChange: (grouping: GroupingDimension | null) => void;
}

const OPTIONS: { label: string; value: GroupingDimension | null }[] = [
  { label: "None", value: null },
  { label: "Person", value: "person" },
  { label: "Feature", value: "feature" },
  { label: "Epic", value: "epic" },
];

export function GroupingSelector({ value, onChange }: GroupingSelectorProps) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) =>
        onChange((e.target.value || null) as GroupingDimension | null)
      }
      className="text-xs linear-input w-auto"
    >
      {OPTIONS.map((opt) => (
        <option key={opt.label} value={opt.value ?? ""}>
          Group: {opt.label}
        </option>
      ))}
    </select>
  );
}
