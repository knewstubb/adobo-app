"use client";

import { useState, useEffect, useCallback } from "react";
import { hasCredentials } from "@/lib/credential-store";
import {
  getAllWorkItems,
  getAllIterations,
  getAllTeamMembers,
  getSavedViews,
  getAllTags,
  getSyncMetadata,
} from "@/lib/idb-cache";
import {
  startSyncEngine,
  stopSyncEngine,
  onSyncComplete,
} from "@/lib/client-sync-engine";
import { SetupFlow } from "@/components/SetupFlow";
import { AppLayout } from "@/components/AppLayout";
import type { WorkItem, Iteration, TeamMember, SavedView, SyncMetadata } from "@/lib/types";

interface AppData {
  workItems: WorkItem[];
  iterations: Iteration[];
  teamMembers: TeamMember[];
  savedViews: SavedView[];
  allTags: string[];
  syncMetadata: SyncMetadata | null;
}

export default function Home() {
  const [hasSetup, setHasSetup] = useState<boolean | null>(null); // null = checking
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AppData | null>(null);

  const loadDataFromIDB = useCallback(async () => {
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
    setLoading(false);
  }, []);

  // Check credentials on mount
  useEffect(() => {
    if (!hasCredentials()) {
      setHasSetup(false);
      setLoading(false);
      return;
    }

    setHasSetup(true);
    loadDataFromIDB();

    // Start sync engine
    startSyncEngine();

    // Refresh data from IndexedDB after each sync completes
    const unsubscribe = onSyncComplete(() => {
      loadDataFromIDB();
    });

    return () => {
      unsubscribe();
      stopSyncEngine();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Setup complete handler — credentials just saved, start loading
  function handleSetupComplete() {
    setHasSetup(true);
    setLoading(true);

    // Start sync engine (will perform initial sync)
    startSyncEngine();

    // Register callback to load data once first sync finishes
    const unsubscribe = onSyncComplete(() => {
      loadDataFromIDB();
    });

    // Also load whatever is in IDB now (may be empty, will refresh after sync)
    loadDataFromIDB();

    // Store unsubscribe for cleanup — but since we're now in the "has setup" state,
    // the main useEffect won't re-run. We keep this listener alive.
    // On unmount the main cleanup will call stopSyncEngine.
    return () => unsubscribe();
  }

  // Not yet determined
  if (hasSetup === null || (hasSetup && loading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-app">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <p className="text-sm text-text-muted">Loading…</p>
        </div>
      </div>
    );
  }

  // No credentials — show setup
  if (!hasSetup) {
    return <SetupFlow onComplete={handleSetupComplete} />;
  }

  // Data loaded — render app
  if (data) {
    return <AppLayout initial={data} />;
  }

  return null;
}
