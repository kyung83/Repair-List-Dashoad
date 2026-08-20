"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type EquipmentRow = {
  id: number;
  unit: string;
  geotabDeviceId: string;
};

type EquipmentPayload = {
  equipment: EquipmentRow[];
};

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
};

type TrackingState = {
  enabled: boolean;
  deviceId: string;
};

function findLabel(labelText: string) {
  return Array.from(document.querySelectorAll<HTMLLabelElement>(".master-modal label")).find((label) => {
    const span = label.querySelector("span");
    return (span?.textContent || "").trim() === labelText;
  }) || null;
}

export default function GeotabTrackingEnhancer() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [configured, setConfigured] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [filter, setFilter] = useState("");
  const [message, setMessage] = useState("");
  const trackingRef = useRef<TrackingState>({ enabled: false, deviceId: "" });

  useEffect(() => {
    trackingRef.current = { enabled, deviceId };
    const mileageLabel = findLabel("Current mileage");
    const mileageInput = mileageLabel?.querySelector<HTMLInputElement>('input[type="number"]');
    if (mileageInput) {
      mileageInput.disabled = enabled;
      mileageInput.title = enabled ? "Mileage is supplied by the explicitly selected Geotab device." : "";
    }
  }, [enabled, deviceId, mount]);

  useEffect(() => {
    let stopped = false;
    Promise.all([
      fetch("/api/equipment", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/geotab-devices", { cache: "no-store" }).then((response) => response.json()),
    ]).then(([equipmentPayload, devicePayload]: [EquipmentPayload, DevicePayload]) => {
      if (stopped) return;
      setEquipment(Array.isArray(equipmentPayload.equipment) ? equipmentPayload.equipment : []);
      setDevices(Array.isArray(devicePayload.devices) ? devicePayload.devices : []);
      setConfigured(devicePayload.configured !== false);
      if (devicePayload.error) setMessage(devicePayload.error);
    }).catch(() => {
      if (!stopped) setMessage("Geotab devices could not be loaded.");
    });
    return () => { stopped = true; };
  }, []);

  useEffect(() => {
    function wireModal() {
      const modal = document.querySelector<HTMLElement>(".master-modal");
      const grid = modal?.querySelector<HTMLElement>(".equipment-form-grid");
      if (!modal || !grid) {
        setMount(null);
        return;
      }

      const unitLabel = findLabel("Unit number / asset name *");
      const unitInput = unitLabel?.querySelector<HTMLInputElement>("input") || null;
      if (unitInput) unitInput.disabled = false;
      const unit = unitInput?.value.trim() || "";
      const item = equipment.find((row) => row.unit === unit) || null;

      let target = grid.querySelector<HTMLElement>("[data-geotab-tracking-mount='1']");
      if (!target) {
        target = document.createElement("div");
        target.dataset.geotabTrackingMount = "1";
        target.className = "wide";
        target.style.gridColumn = "1 / -1";
        const acquisition = Array.from(grid.children).find((child) =>
          child instanceof HTMLElement && child.textContent?.trim().startsWith("Acquisition"),
        );
        grid.insertBefore(target, acquisition || null);
      }

      if (mount !== target || editingId !== (item?.id ?? null)) {
        setMount(target);
        setEditingId(item?.id ?? null);
        setEnabled(Boolean(item?.geotabDeviceId));
        setDeviceId(item?.geotabDeviceId || "");
        setFilter("");
        setMessage("");
      }
    }

    wireModal();
    const observer = new MutationObserver(wireModal);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    return () => observer.disconnect();
  }, [equipment, mount, editingId]);

  useEffect(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/api/equipment") && (init?.method || "GET").toUpperCase() === "POST" && typeof init?.body === "string") {
        try {
          const body = JSON.parse(init.body) as Record<string, unknown>;
          if ((body.action || "save") === "save" && document.querySelector(".master-modal [data-geotab-tracking-mount='1']")) {
            body.trackWithGeotab = trackingRef.current.enabled;
            body.geotabDeviceId = trackingRef.current.enabled ? trackingRef.current.deviceId : "";
            init = { ...init, body: JSON.stringify(body) };
          }
        } catch {
          // Leave unrelated/non-JSON requests untouched.
        }
      }
      return nativeFetch(input, init);
    };
    return () => { window.fetch = nativeFetch; };
  }, []);

  const visibleDevices = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const rows = devices.filter((device) => {
      if (!needle) return true;
      return [device.name, device.serialNumber, device.vin, device.assignedUnit]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
    if (deviceId && !rows.some((device) => device.id === deviceId)) {
      const selected = devices.find((device) => device.id === deviceId);
      if (selected) rows.unshift(selected);
    }
    return rows.slice(0, 250);
  }, [devices, deviceId, filter]);

  if (!mount) return null;

  return createPortal(
    <div style={{ borderTop: "1px solid #dce3e8", paddingTop: 12, marginTop: 2, display: "grid", gap: 10 }}>
      <div>
        <strong style={{ display: "block", color: "#172536" }}>Geotab mileage tracking</strong>
        <span className="cell-muted">Master Equipment controls the unit. Geotab only supplies mileage after a device is explicitly linked.</span>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, color: "#27384a" }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            const next = event.target.checked;
            setEnabled(next);
            if (!next) setDeviceId("");
          }}
        />
        Track mileage with Geotab
      </label>

      {enabled && (
        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ display: "grid", gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 900, color: "#475a6c" }}>Find Geotab device</span>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search unit, VIN, serial or assignment…"
              style={{ padding: "10px 11px", border: "1px solid #cbd5e1", borderRadius: 8 }}
            />
          </label>
          <label style={{ display: "grid", gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 900, color: "#475a6c" }}>Geotab device *</span>
            <select
              value={deviceId}
              disabled={!configured}
              onChange={(event) => setDeviceId(event.target.value)}
              style={{ padding: "10px 11px", border: "1px solid #cbd5e1", borderRadius: 8, background: "white" }}
            >
              <option value="">Choose a Geotab device</option>
              {visibleDevices.map((device) => {
                const assignedElsewhere = device.assignedEquipmentId != null && device.assignedEquipmentId !== editingId;
                const details = [device.name, device.vin, device.serialNumber]
                  .filter(Boolean)
                  .join(" — ");
                return (
                  <option key={device.id} value={device.id} disabled={assignedElsewhere}>
                    {details}{assignedElsewhere ? ` — assigned to ${device.assignedUnit}` : ""}
                  </option>
                );
              })}
            </select>
          </label>
          <span className="cell-muted">When linked, the normal Current mileage field is locked so a manual entry cannot fight the Geotab odometer.</span>
        </div>
      )}

      {message && <span style={{ color: "#9a3412", fontSize: 11, fontWeight: 700 }}>{message}</span>}
    </div>,
    mount,
  );
}
