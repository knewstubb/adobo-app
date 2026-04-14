"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";

/**
 * Detects when a new service worker is waiting to activate (i.e. a new
 * deployment has landed) and shows a small toast prompting the user to
 * refresh. Also polls for updates every 60 seconds.
 */
export function UpdateNotification() {
  const [showUpdate, setShowUpdate] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    // Check for a waiting worker on existing registrations
    navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) return;

      // If there's already a waiting worker, show the toast
      if (reg.waiting) {
        setWaitingWorker(reg.waiting);
        setShowUpdate(true);
        return;
      }

      // Listen for new service workers that enter the waiting state
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            setWaitingWorker(newWorker);
            setShowUpdate(true);
          }
        });
      });

      // Poll for updates every 60 seconds
      const interval = setInterval(() => {
        reg.update().catch(() => {});
      }, 60_000);

      return () => clearInterval(interval);
    });
  }, []);

  const handleUpdate = useCallback(() => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
      // Reload once the new worker takes over
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.location.reload();
      });
    } else {
      window.location.reload();
    }
  }, [waitingWorker]);

  if (!showUpdate) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex items-center gap-3 px-4 py-2.5 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-300 text-xs shadow-lg animate-in fade-in zoom-in-95">
      <ArrowsClockwise size={14} weight="bold" />
      <span>A new version is available</span>
      <button
        onClick={handleUpdate}
        className="px-2.5 py-1 rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 font-medium transition-colors"
      >
        Refresh
      </button>
      <button
        onClick={() => setShowUpdate(false)}
        className="text-blue-400/60 hover:text-blue-300 ml-1"
      >
        ✕
      </button>
    </div>
  );
}
