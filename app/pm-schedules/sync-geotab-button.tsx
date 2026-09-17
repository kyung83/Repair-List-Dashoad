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
  missingAssignedDevices?: number;
};

type DeviceSuggestion = {
  deviceId: string;
  name: string;
  serialNumber: string;
  vin: string;
  assignedEquipmentId: number | null;
  assignedUnit: string;
};

type SkippedAssignment = {
  equipmentId: number;
  unit: string;
  vin: string;
  currentMileage: number | null;
  mileageUpdatedAt: string | null;
  staleDeviceId: string;
  staleDeviceName: string;
  staleSerialNumber: string;
  lastSeenAt: string | null;
  reason: string;
  activeVinCandidates: number;
  unassignedVinCandidates: number;
  suggestion: DeviceSuggestion | null;
};

type SyncPayload = {
  ok?: boolean;
  error?: string;
  message?: string;
  fleet?: FleetSync;
  skippedAssignments?: SkippedAssignment[];
  canRepairAssignments?: boolean;
};

const RESULT_KEY = "pm-geotab-sync-result-v2";

function syncSummary(payload?: SyncPayload | null) {
  const fleet = payload?.fleet;
  if (!fleet) return "";
  const requested = Number(fleet.odometerRequested ?? 0);
  const received = Number(fleet.mileageReceived ?? 0);
  const updated = Number(fleet.mileageUpdates ?? 0);
  const missing = Number(fleet.odometerStillMissing ?? 0);
  const rejected = Number(fleet.mileageAnomalies ?? 0);
  const skipped = Number(fleet.missingAssignedDevices ?? payload?.skippedAssignments?.length ?? 0);
  const recovered = Math.max(0, Number(fleet.odometerTargetedRecovered ?? 0) - Number(fleet.odometerFirstPassReceived ?? 0));
  const broad = Number(fleet.odometerBroadFallbackRecovered ?? 0);

  return `Mileage sync: ${updated} updated of ${requested} tracked vehicle(s). ${received} reading(s) received. ${recovered + broad} recovered by fallback. ${missing} still returned no odometer. ${rejected} reading(s) were rejected by the mileage safety check. ${skipped} assigned vehicle(s) were skipped because their assigned Geotab device is not currently active.`;
}

function readStoredResult(): SyncPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RESULT_KEY);
    return raw ? JSON.parse(raw) as SyncPayload : null;
  } catch {
    return null;
  }
}

function storeResult(payload: SyncPayload) {
  if (typeof window !== "undefined") window.sessionStorage.setItem(RESULT_KEY, JSON.stringify(payload));
}

function mileage(value: number | null) {
  return value == null ? "—" : `${Math.round(value).toLocaleString()} mi`;
}

function when(value: string | null) {
  if (!value) return "never";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function SyncGeotabButton() {
  const [syncing, setSyncing] = useState(false);
  const [repairing, setRepairing] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<SyncPayload | null>(() => readStoredResult());

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/pm-schedules/geotab-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as SyncPayload;
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Geotab sync could not be completed.");
    return payload;
  }

  async function syncNow() {
    setSyncing(true);
    setError("");
    setResult(null);
    if (typeof window !== "undefined") window.sessionStorage.removeItem(RESULT_KEY);
    try {
      const payload = await post({ action: "sync" });
      storeResult(payload);
      window.location.reload();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Geotab sync could not be completed.");
      setSyncing(false);
    }
  }

  async function repairAssignment(row: SkippedAssignment) {
    if (!row.suggestion) return;
    const replacement = row.suggestion;
    const current = row.staleDeviceName || row.staleDeviceId;
    if (!window.confirm(
      `Replace the inactive Geotab device for ${row.unit}?\n\nCurrent: ${current}\nReplacement: ${replacement.name || replacement.deviceId}\nVIN: ${row.vin}\n\nThe old device assignment will stay in history. Mileage will be synced immediately and still has to pass the mileage safety check.`,
    )) return;

    setRepairing(row.unit);
    setError("");
    try {
      const payload = await post({
        action: "repairExactVinAssignment",
        equipmentId: row.equipmentId,
        staleDeviceId: row.staleDeviceId,
        replacementDeviceId: replacement.deviceId,
      });
      storeResult(payload);
      window.location.reload();
    } catch (repairError) {
      setError(repairError instanceof Error ? repairError.message : "Geotab device assignment could not be repaired.");
      setRepairing("");
    }
  }

  const skipped = result?.skippedAssignments || [];
  const summary = syncSummary(result);

  return (
    <div className="pm-sync-toolbar" style={{alignItems:"stretch",maxWidth:1180}}>
      {error && <div className="pm-sync-error">{error}</div>}
      {result?.message && <div style={{padding:"9px 11px",border:"1px solid #b7d4bf",background:"#f2fbf4",borderRadius:8,fontSize:12,fontWeight:800}}>{result.message}</div>}
      {summary && <div className="pm-sync-result">{summary}</div>}

      {skipped.length > 0 && (
        <details open style={{border:"1px solid #d9e1e7",borderRadius:10,background:"#fff",padding:10}}>
          <summary style={{cursor:"pointer",fontWeight:900,fontSize:13}}>
            {skipped.length} unit(s) did not refresh mileage because the assigned Geotab device is inactive
          </summary>
          <div style={{marginTop:9,fontSize:12,color:"#5b6874",lineHeight:1.45}}>
            These are the exact units skipped by this sync. An automatic replacement is offered only when there is exactly one active, unassigned Geotab device with the same 17-character VIN.
          </div>
          <div style={{display:"grid",gap:8,marginTop:10,maxHeight:480,overflow:"auto",paddingRight:3}}>
            {skipped.map((row) => (
              <div key={`${row.equipmentId}-${row.staleDeviceId}`} style={{border:"1px solid #e0e6ea",borderRadius:9,padding:10,display:"grid",gap:6,background:"#fbfcfd"}}>
                <div style={{display:"flex",gap:10,justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap"}}>
                  <div>
                    <strong style={{fontSize:14}}>{row.unit}</strong>
                    <div style={{fontSize:11,color:"#6b7883",marginTop:2}}>
                      Stored mileage {mileage(row.currentMileage)} · last mileage update {when(row.mileageUpdatedAt)}
                    </div>
                  </div>
                  <div style={{fontSize:11,fontWeight:800,color:"#8b541a"}}>MILEAGE NOT REFRESHED</div>
                </div>
                <div style={{fontSize:11,color:"#53616d"}}>
                  Inactive assignment: <strong>{row.staleDeviceName || "Geotab device"}</strong> · {row.staleDeviceId}
                  {row.staleSerialNumber ? ` · serial ${row.staleSerialNumber}` : ""} · last seen {when(row.lastSeenAt)}
                </div>
                <div style={{fontSize:11,color:"#6b7883"}}>{row.reason}</div>

                {row.suggestion ? (
                  <div style={{display:"flex",gap:10,justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",padding:"8px 9px",borderRadius:8,background:"#f3f8fb",border:"1px solid #d8e6ee"}}>
                    <div style={{fontSize:11}}>
                      <strong>Exact VIN replacement found:</strong> {row.suggestion.name || row.suggestion.deviceId}
                      {row.suggestion.serialNumber ? ` · serial ${row.suggestion.serialNumber}` : ""}
                    </div>
                    {result?.canRepairAssignments ? (
                      <button
                        type="button"
                        disabled={Boolean(repairing) || syncing}
                        onClick={() => void repairAssignment(row)}
                      >
                        {repairing === row.unit ? "Fixing…" : "Fix Assignment"}
                      </button>
                    ) : (
                      <span style={{fontSize:10,fontWeight:850,color:"#6d7882"}}>Admin approval required</span>
                    )}
                  </div>
                ) : (
                  <div style={{fontSize:11,fontWeight:750,color:"#6e4e2f"}}>No safe one-click replacement was found. This assignment needs manual review.</div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      <button type="button" disabled={syncing || Boolean(repairing)} onClick={() => void syncNow()}>
        {syncing ? "Syncing Geotab…" : "Sync Geotab"}
      </button>
    </div>
  );
}
