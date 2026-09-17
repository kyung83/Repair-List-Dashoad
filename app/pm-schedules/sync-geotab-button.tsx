"use client";

import { useState } from "react";

type FleetSync = {
  odometerRequested?: number;
  odometerFirstPassReceived?: number;
  odometerTargetedRecovered?: number;
  odometerBroadFallbackRecovered?: number;
  odometerStillMissing?: number;
  mileageReceived?: number;
  mileageUpdates?: number;
  mileageAnomalies?: number;
};

type SyncPayload = {
  ok?: boolean;
  error?: string;
  fleet?: FleetSync;
};

const RESULT_KEY = "pm-geotab-sync-result";

function syncSummary(fleet?: FleetSync) {
  if (!fleet) return "Geotab sync finished.";
  const requested = Number(fleet.odometerRequested ?? 0);
  const received = Number(fleet.mileageReceived ?? 0);
  const updated = Number(fleet.mileageUpdates ?? 0);
  const missing = Number(fleet.odometerStillMissing ?? 0);
  const rejected = Number(fleet.mileageAnomalies ?? 0);
  const recovered = Math.max(0, Number(fleet.odometerTargetedRecovered ?? 0) - Number(fleet.odometerFirstPassReceived ?? 0));
  const broad = Number(fleet.odometerBroadFallbackRecovered ?? 0);

  return `Mileage sync: ${updated} updated of ${requested} tracked vehicle(s). ${received} reading(s) received. ${recovered + broad} recovered by fallback. ${missing} still returned no odometer. ${rejected} reading(s) were rejected by the mileage safety check.`;
}

export default function SyncGeotabButton() {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem(RESULT_KEY) || "";
  });

  async function syncNow() {
    setSyncing(true);
    setError("");
    setResult("");
    if (typeof window !== "undefined") window.sessionStorage.removeItem(RESULT_KEY);
    try {
      const response = await fetch("/api/maintenance-setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "syncGeotab" }),
      });
      const payload = await response.json() as SyncPayload;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Geotab sync could not be completed.");
      const summary = syncSummary(payload.fleet);
      if (typeof window !== "undefined") window.sessionStorage.setItem(RESULT_KEY, summary);
      window.location.reload();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Geotab sync could not be completed.");
      setSyncing(false);
    }
  }

  return (
    <div className="pm-sync-toolbar">
      {error && <div className="pm-sync-error">{error}</div>}
      {result && <div className="pm-sync-result">{result}</div>}
      <button type="button" disabled={syncing} onClick={() => void syncNow()}>
        {syncing ? "Syncing Geotab…" : "Sync Geotab"}
      </button>
    </div>
  );
}
