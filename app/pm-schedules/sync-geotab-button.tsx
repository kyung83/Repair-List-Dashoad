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
    <div style={{ position: "fixed", right: 18, bottom: 18, zIndex: 45, display: "grid", justifyItems: "end", gap: 7 }}>
      {error && (
        <div style={{ maxWidth: 360, padding: "9px 11px", borderRadius: 8, background: "#fff8e6", border: "1px solid #f2c66d", color: "#7c4a03", fontSize: 12 }}>
          {error}
        </div>
      )}
      <button
        type="button"
        disabled={syncing}
        onClick={() => void syncNow()}
        style={{ padding: "10px 14px", border: 0, borderRadius: 9, background: "#0d1b2b", color: "white", fontWeight: 900, boxShadow: "0 6px 18px rgba(15,23,42,.2)", cursor: syncing ? "wait" : "pointer" }}
      >
        {syncing ? "Syncing Geotab…" : "Sync Geotab now"}
      </button>
    </div>
  );
}
