"use client";

import { useState } from "react";
import type { SyncMetadata } from "@/lib/types";
import { performSync } from "@/lib/client-sync-engine";

interface SyncStatusProps {
  metadata: SyncMetadata | null;
  disabled?: boolean;
  onSyncComplete?: () => void;
}

export function SyncStatus({ metadata, disabled, onSyncComplete }: SyncStatusProps) {
  const [syncing, setSyncing] = useState(false);

  async function handleRefresh() {
    if (disabled) return;
    setSyncing(true);
    try {
      await performSync();
      onSyncComplete?.();
    } finally {
      setSyncing(false);
    }
  }

  const statusColor =
    metadata?.status === "error"
      ? "text-red-400"
      : metadata?.status === "running" || syncing
        ? "text-amber-400"
        : "text-text-muted";

  const lastSync = metadata?.lastSyncAt
    ? formatTime(new Date(metadata.lastSyncAt))
    : "Never";

  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs ${statusColor}`}>
        {syncing || metadata?.status === "running"
          ? "Syncing..."
          : `Last sync: ${lastSync}`}
      </span>
      {metadata?.status === "error" && metadata.lastError && (
        <span className="text-[10px] text-red-400 truncate max-w-[200px]" title={metadata.lastError}>
          {metadata.lastError}
        </span>
      )}
      <button
        onClick={handleRefresh}
        disabled={syncing || disabled}
        className="text-xs text-text-muted hover:text-text-secondary disabled:opacity-50"
        title={disabled ? "Sync unavailable while offline" : "Refresh"}
      >
        ↻
      </button>
    </div>
  );
}


/** Stable 24h time format that won't cause hydration mismatches */
function formatTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  const s = date.getSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}
