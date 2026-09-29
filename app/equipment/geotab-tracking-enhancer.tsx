"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type EquipmentRow = { id: number; unit: string; geotabDeviceId: string };
type EquipmentPayload = { equipment?: EquipmentRow[]; error?: string };
type DeviceOption = {
  id: string;
  name: string;
  serialNumber: string;
  vin: string;
  assignedEquipmentId: number | null;
  assignedUnit: string;
};
type DevicePayload = {
  configured?: boolean;
  devices?: DeviceOption[];
  error?: string;
  code?: string;
  requestId?: string;
};
type TrackingState = { enabled: boolean; deviceId: string; equipmentReady: boolean };

function findLabel(labelText: string) {
  return Array.from(document.querySelectorAll<HTMLLabelElement>(".master-modal label")).find((label) => {
    const span = label.querySelector("span");
    return (span?.textContent || "").trim() === labelText;
  }) || null;
}

export default function GeotabTrackingEnhancer() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [equipmentReady, setEquipmentReady] = useState(false);
  const [equipmentError, setEquipmentError] = useState("");
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [filter, setFilter] = useState("");
  const trackingRef = useRef<TrackingState>({ enabled: false, deviceId: "", equipmentReady: false });
  const initializedMountRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    trackingRef.current = { enabled, deviceId, equipmentReady: equipmentReady && Boolean(mount) && initializedMountRef.current === mount };
    const mileageInput = findLabel("Current mileage")?.querySelector<HTMLInputElement>('input[type="number"]');
    if (mileageInput) {
      mileageInput.disabled = enabled;
      mileageInput.title = enabled ? "Mileage is supplied by the explicitly selected Geotab device." : "";
    }
  }, [enabled, deviceId, equipmentReady, mount]);

  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    setLoading(true);
    setLoadError("");
    setEquipmentError("");

    // A failed equipment request must not hide a successful Geotab response (or vice versa).
    async function loadEquipment() {
      try {
        const response = await fetch("/api/equipment", { cache: "no-store", signal: controller.signal });
        if (response.status === 401) throw new Error("Your session expired. Sign in again before editing equipment.");
        const payload = await response.json() as EquipmentPayload;
        if (!response.ok || payload.error || !Array.isArray(payload.equipment)) {
          throw new Error(payload.error || "Equipment details could not be loaded. Refresh before saving.");
        }
        if (!stopped) { setEquipment(payload.equipment); setEquipmentReady(true); }
      } catch (error) {
        if (!stopped) {
          setEquipmentReady(false);
          setEquipmentError(controller.signal.aborted ? "Equipment loading timed out. Refresh before saving." : error instanceof Error ? error.message : "Equipment details could not be loaded.");
        }
      }
    }

    async function loadDevices() {
      try {
        const response = await fetch("/api/geotab-devices", { cache: "no-store", signal: controller.signal });
        if (response.status === 401) throw new Error("Your session expired. Sign in again, then refresh the Geotab list.");
        if (response.status === 403) throw new Error("Your account does not have access to the Geotab device list.");
        const payload = await response.json() as DevicePayload;
        if (!response.ok || payload.error) {
          const reference = payload.code ? ` [${payload.code}${payload.requestId ? ` / ${payload.requestId}` : ""}]` : "";
          throw new Error((payload.error || `Geotab lookup failed (HTTP ${response.status}).`) + reference);
        }
        if (payload.configured === false) throw new Error("Geotab is not configured. Check the saved Geotab connection in Diagnostics.");
        if (!Array.isArray(payload.devices)) throw new Error("The device lookup returned an unexpected response. Refresh or sign in again.");
        if (!stopped) setDevices(payload.devices);
      } catch (error) {
        if (!stopped) {
          setDevices([]);
          setLoadError(controller.signal.aborted ? "The Geotab device lookup timed out. Try Refresh Geotab devices." : error instanceof SyntaxError ? "The device lookup did not return data. Sign in again or refresh the list." : error instanceof Error ? error.message : "Geotab devices could not be loaded.");
        }
      } finally {
        if (!stopped) setLoading(false);
      }
    }

    void Promise.allSettled([loadEquipment(), loadDevices()]).then(() => window.clearTimeout(timeout));
    return () => { stopped = true; window.clearTimeout(timeout); controller.abort(); };
  }, [reloadKey]);

  useEffect(() => {
    function wireModal() {
      const modal = document.querySelector<HTMLElement>(".master-modal");
      const grid = modal?.querySelector<HTMLElement>(".equipment-form-grid");
      if (!modal || !grid) {
        initializedMountRef.current = null;
        trackingRef.current.equipmentReady = false;
        setMount(null);
        return;
      }
      const unitInput = findLabel("Unit number / asset name *")?.querySelector<HTMLInputElement>("input") || null;
      if (unitInput?.disabled) unitInput.disabled = false;
      const unit = unitInput?.value.trim() || "";
      const item = equipment.find((row) => row.unit === unit) || null;
      let target = grid.querySelector<HTMLElement>("[data-geotab-tracking-mount='1']");
      if (!target) {
        target = document.createElement("div");
        target.dataset.geotabTrackingMount = "1";
        target.className = "wide";
        target.style.gridColumn = "1 / -1";
        const acquisition = Array.from(grid.children).find((child) => child instanceof HTMLElement && child.textContent?.trim().startsWith("Acquisition"));
        grid.insertBefore(target, acquisition || null);
      }
      // Show loading/errors inside the modal, but do not initialize a link from an unloaded list.
      if (!equipmentReady) {
        trackingRef.current.equipmentReady = false;
        if (mount !== target) setMount(target);
        return;
      }
      if (initializedMountRef.current !== target || editingId !== (item?.id ?? null)) {
        initializedMountRef.current = target;
        trackingRef.current = { enabled: Boolean(item?.geotabDeviceId), deviceId: item?.geotabDeviceId || "", equipmentReady: true };
        setMount(target);
        setEditingId(item?.id ?? null);
        setEnabled(Boolean(item?.geotabDeviceId));
        setDeviceId(item?.geotabDeviceId || "");
        setFilter("");
        // Lookup errors persist when opening the modal; only a new lookup clears them.
      }
    }
    wireModal();
    const observer = new MutationObserver(wireModal);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    return () => observer.disconnect();
  }, [equipment, equipmentReady, mount, editingId]);

  useEffect(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/equipment") && (init?.method || "GET").toUpperCase() === "POST" && typeof init?.body === "string") {
        try {
          const body = JSON.parse(init.body) as Record<string, unknown>;
          if ((body.action || "save") === "save" && document.querySelector(".master-modal")) {
            if (!trackingRef.current.equipmentReady) {
              return Response.json({ ok: false, error: "Equipment details have not loaded. Reload the page before saving." }, { status: 400 });
            }
            if (document.querySelector(".master-modal [data-geotab-tracking-mount='1']")) {
              const tracking = trackingRef.current;
              if (tracking.enabled && !tracking.deviceId) {
                return Response.json({ ok: false, error: "Choose a matching Geotab device before saving. No equipment was created by this attempt." }, { status: 400 });
              }
              body.trackWithGeotab = tracking.enabled;
              body.geotabDeviceId = tracking.enabled ? tracking.deviceId : "";
              init = { ...init, body: JSON.stringify(body) };
            }
          }
        } catch {
          // Leave unrelated/non-JSON requests untouched.
        }
      }
      return nativeFetch(input, init);
    };
    return () => { window.fetch = nativeFetch; };
  }, []);

  const matchingDevices = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return devices.filter((device) => !needle || [device.id, device.name, device.serialNumber, device.vin, device.assignedUnit].join(" ").toLowerCase().includes(needle));
  }, [devices, filter]);
  const visibleDevices = useMemo(() => {
    const rows = matchingDevices.slice(0, 250);
    if (deviceId && !rows.some((device) => device.id === deviceId)) {
      const selected = devices.find((device) => device.id === deviceId);
      if (selected) rows.unshift(selected);
    }
    return rows;
  }, [devices, deviceId, matchingDevices]);

  if (!mount) {
    return equipmentError ? <div role="alert" style={{ padding: 12 }}>
      {equipmentError} <button type="button" onClick={() => setReloadKey((key) => key + 1)}>Retry lookup</button>
    </div> : null;
  }

  return createPortal(
    <div style={{ borderTop: "1px solid #dce3e8", paddingTop: 12, marginTop: 2, display: "grid", gap: 10 }}>
      <div>
        <strong style={{ display: "block", color: "#172536" }}>Geotab mileage tracking</strong>
        <span className="cell-muted">Master Equipment controls the unit. Geotab only supplies mileage after a device is explicitly linked.</span>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, color: "#27384a" }}>
        <input type="checkbox" checked={enabled} disabled={!equipmentReady} onChange={(event) => {
          const next = event.target.checked;
          trackingRef.current = { ...trackingRef.current, enabled: next, deviceId: next ? deviceId : "" };
          setEnabled(next);
          if (!next) setDeviceId("");
        }} />
        Track mileage with Geotab
      </label>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" disabled={loading} onClick={() => setReloadKey((key) => key + 1)}>{loading ? "Loading Geotab devices..." : "Refresh Geotab devices"}</button>
        {!loading && !loadError && <span className="cell-muted" role="status">{devices.length} active Geotab devices loaded.</span>}
      </div>
      {loadError && <div role="alert" style={{ color: "#9a3412", fontSize: 12, fontWeight: 700 }}>{loadError}</div>}
      {equipmentError && <div role="alert" style={{ color: "#9a3412", fontSize: 12, fontWeight: 700 }}>{equipmentError}</div>}
      {enabled && <div style={{ display: "grid", gap: 8 }}>
        <label style={{ display: "grid", gap: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 900, color: "#475a6c" }}>Find Geotab device</span>
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search unit, VIN, serial or assignment..." style={{ padding: "10px 11px", border: "1px solid #cbd5e1", borderRadius: 8 }} />
        </label>
        <label style={{ display: "grid", gap: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 900, color: "#475a6c" }}>Geotab device *</span>
          <select value={deviceId} disabled={loading || Boolean(loadError) || !equipmentReady} onChange={(event) => {
            trackingRef.current = { ...trackingRef.current, deviceId: event.target.value };
            setDeviceId(event.target.value);
          }} style={{ padding: "10px 11px", border: "1px solid #cbd5e1", borderRadius: 8, background: "white" }}>
            <option value="">{loading ? "Loading devices..." : loadError ? "Device lookup failed - see message above" : "Choose a Geotab device"}</option>
            {deviceId && !devices.some((device) => device.id === deviceId) && <option value={deviceId} disabled>Existing link: {deviceId} - not present in the loaded active list</option>}
            {visibleDevices.map((device) => {
              const assignedElsewhere = device.assignedEquipmentId != null && device.assignedEquipmentId !== editingId;
              const details = [device.name, device.vin, device.serialNumber].filter(Boolean).join(" - ");
              return <option key={device.id} value={device.id} disabled={assignedElsewhere}>{details}{assignedElsewhere ? ` - assigned to ${device.assignedUnit}` : ""}</option>;
            })}
          </select>
        </label>
        {!loading && !loadError && matchingDevices.length === 0 && <span className="cell-muted" role="status">
          {devices.length ? `No active Geotab device matches "${filter.trim()}". Try its VIN or serial number, or refresh the list.` : "The connected account returned no active devices. Check its asset access and the equipment's active status in Geotab."}
        </span>}
        {matchingDevices.length > 250 && <span className="cell-muted">Showing the first 250 matches. Type a unit, VIN or serial number to narrow the list.</span>}
        <span className="cell-muted">When linked, the normal Current mileage field is locked so a manual entry cannot fight the Geotab odometer.</span>
      </div>}
    </div>, mount,
  );
}
