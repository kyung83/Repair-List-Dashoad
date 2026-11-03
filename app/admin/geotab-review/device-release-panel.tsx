"use client";

import { useState, type FormEvent } from "react";

type Link = {
  equipmentId: number; unit: string; vin: string; archived: boolean;
  deviceId: string; serialNumber: string; legacyOnly: boolean;
  conflict: boolean; expectedVersion: string;
};

export default function GeotabDeviceReleasePanel({ onReleased }: { onReleased?: () => void }) {
  const [query, setQuery] = useState("");
  const [links, setLinks] = useState<Link[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) { setMessage("Enter the old unit number, VIN, or GPS device ID."); return; }
    setBusy(true); setMessage(""); setLinks([]);
    try {
      const response = await fetch(`/api/admin/geotab-release?q=${encodeURIComponent(query.trim())}`, { cache: "no-store" });
      const data = await response.json() as { links?: Link[]; error?: string };
      if (!response.ok) throw new Error(data.error || "GPS links could not be loaded.");
      setLinks(data.links || []);
      if (!data.links?.length) setMessage("No GPS link found. It may already be released. Refresh Geotab devices on the replacement unit; do not restore the sold truck.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "GPS links could not be loaded."); }
    finally { setBusy(false); }
  }

  async function release(link: Link) {
    if (!window.confirm(`Release GPS ${link.deviceId} from ${link.unit}?\n\nConfirm this GPS has been physically removed. Only its local software link will be removed. The truck stays in its current status, with its VIN, mileage, repairs, PMs and history unchanged. No other truck's assignment will be removed.`)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/geotab-release", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "release", equipmentId: link.equipmentId,
          geotabDeviceId: link.deviceId, expectedVersion: link.expectedVersion,
          confirmedRemoved: true, reason: "GPS physically removed for reuse" }),
      });
      const data = await response.json() as { ok?: boolean; message?: string; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "GPS could not be released.");
      setMessage(data.message || "GPS released.");
      setLinks(current => current.filter(item => item.equipmentId !== link.equipmentId));
      onReleased?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "GPS could not be released."); }
    finally { setBusy(false); }
  }

  return <section style={{ padding: "20px clamp(16px,4vw,46px)", background: "#f3f5f7", color: "#182331" }}>
    <div style={{ background: "white", border: "1px solid #cfd9e1", borderRadius: 14, padding: 18 }}>
      <h2 style={{ marginTop: 0 }}>Release a removed GPS for reuse</h2>
      <p>Search the old truck here, including sold and archived units. This also finds leftover device links that no longer have a current assignment. You do not need to reactivate the truck or edit its other details.</p>
      <form onSubmit={search} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label>Old unit, VIN or device ID<br /><input value={query} disabled={busy} onChange={event => setQuery(event.target.value)} placeholder="Example: 480(SC)" style={{ padding: 10, minWidth: 220 }} /></label>
        <button type="submit" disabled={busy} style={{ alignSelf: "end", padding: 10 }}>{busy ? "Working..." : "Find GPS link"}</button>
      </form>
      {message && <p role="status" style={{ background: "#fff9e8", border: "1px solid #d8c17b", padding: 12 }}>{message}</p>}
      {links.map(link => <article key={link.equipmentId} style={{ borderTop: "1px solid #dce3e8", marginTop: 14, paddingTop: 14 }}>
        <strong>{link.unit}</strong> - {link.archived ? "Archived / inactive" : "Active"}
        <p>GPS device: <code>{link.deviceId}</code>{link.serialNumber ? ` | Serial: ${link.serialNumber}` : ""}{link.vin ? ` | Truck VIN: ${link.vin}` : ""}</p>
        {link.legacyOnly && <p>The current assignment has already ended, but the old device link remains on this equipment record.</p>}
        {link.conflict && <p role="alert">This record has conflicting device links. Release is blocked to avoid removing the wrong GPS.</p>}
        <button type="button" disabled={busy || link.conflict} onClick={() => void release(link)} style={{ padding: "10px 14px" }}>Release GPS from {link.unit}</button>
      </article>)}
      <p style={{ fontSize: 13 }}>After releasing: open the replacement unit in <a href="/equipment">Master Equipment</a>, click <strong>Refresh Geotab devices</strong>, then select the GPS by its device ID or serial number. This action does not rename or reconfigure the device in MyGeotab.</p>
    </div>
  </section>;
}
