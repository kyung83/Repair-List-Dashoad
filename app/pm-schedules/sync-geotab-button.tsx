"use client";

import { useState } from "react";

export default function SyncGeotabButton() {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  async function syncNow() {
    setSyncing(true);
    setError("");
    try {
      const response = await fetch("/api/maintenance-setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "syncGeotab" }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Geotab sync could not be completed.");
      window.location.reload();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Geotab sync could not be completed.");
      setSyncing(false);
    }
  }

  return (
    <div className="pm-sync-toolbar">
      {error && <div className="pm-sync-error">{error}</div>}
      <button type="button" disabled={syncing} onClick={() => void syncNow()}>
        {syncing ? "Syncing Geotab…" : "Sync Geotab"}
      </button>
    </div>
  );
}
