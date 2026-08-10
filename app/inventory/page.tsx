"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Part = {
  id: number;
  partNumber: string;
  description: string;
  quantityOnHand: number;
  reorderLevel: number;
  unitCost: number | null;
  location: string;
  preferredVendorId: number | null;
  vendorName: string;
  lowStock: boolean;
};

type Vendor = { id: number; name: string; phone: string; email: string; notes: string };
type VendorLink = { id: number; name: string; preferred: boolean };
type InventoryData = {
  parts: Part[];
  vendors: Vendor[];
  summary: { partCount: number; lowStockCount: number; totalUnits: number; inventoryValue: number };
  updatedAt: string;
};

type PartForm = {
  id: number;
  partNumber: string;
  description: string;
  quantityOnHand: number;
  reorderLevel: number;
  unitCost: string;
  location: string;
  preferredVendorId: string;
  vendorIds: number[];
};

const blankPart: PartForm = {
  id: 0,
  partNumber: "",
  description: "",
  quantityOnHand: 0,
  reorderLevel: 0,
  unitCost: "",
  location: "",
  preferredVendorId: "",
  vendorIds: [],
};

export default function InventoryPage() {
  const [data, setData] = useState<InventoryData | null>(null);
  const [vendorLinks, setVendorLinks] = useState<Record<string, VendorLink[]>>({});
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [part, setPart] = useState<PartForm>(blankPart);
  const [showPartForm, setShowPartForm] = useState(false);

  async function load() {
    const [inventoryResponse, linksResponse] = await Promise.all([
      fetch("/api/inventory", { cache: "no-store" }),
      fetch("/api/inventory/part-vendors", { cache: "no-store" }),
    ]);
    if (!inventoryResponse.ok) throw new Error("Unable to load inventory");
    if (!linksResponse.ok) throw new Error("Unable to load part vendors");
    const [inventory, links] = await Promise.all([inventoryResponse.json(), linksResponse.json()]);
    setData(inventory as InventoryData);
    setVendorLinks((links as { byPart?: Record<string, VendorLink[]> }).byPart ?? {});
  }

  useEffect(() => {
    void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to load inventory"));
  }, []);

  function vendorsForPart(item: Part) {
    const linked = vendorLinks[String(item.id)] ?? [];
    if (linked.length) return linked;
    return item.vendorName ? [{ id: item.preferredVendorId ?? 0, name: item.vendorName, preferred: true }] : [];
  }

  const visibleParts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.parts ?? []).filter((item) => {
      const vendorNames = (vendorLinks[String(item.id)] ?? []).map((vendor) => vendor.name).join(" ");
      return [item.partNumber, item.description, item.location, item.vendorName, vendorNames].join(" ").toLowerCase().includes(q);
    });
  }, [data, query, vendorLinks]);

  async function savePart(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const preferredVendorId = part.preferredVendorId ? Number(part.preferredVendorId) : null;
    const vendorIds = [...new Set(part.vendorIds.concat(preferredVendorId ? [preferredVendorId] : []))];
    const response = await fetch("/api/inventory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "savePart", ...part, preferredVendorId }),
    });
    const result = (await response.json()) as { id?: number; error?: string };
    if (!response.ok || !result.id) return setMessage(result.error || "Part could not be saved");

    const vendorResponse = await fetch("/api/inventory/part-vendors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ partId: result.id, vendorIds, preferredVendorId }),
    });
    const vendorResult = (await vendorResponse.json()) as { error?: string };
    if (!vendorResponse.ok) return setMessage(vendorResult.error || "Part saved, but vendors could not be saved");

    setPart(blankPart);
    setShowPartForm(false);
    setMessage("Part and vendors saved.");
    await load();
  }

  async function adjustStock(id: number, delta: number) {
    const response = await fetch("/api/inventory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "adjustStock", id, delta }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) return setMessage(result.error || "Stock could not be adjusted");
    await load();
  }

  function editPart(item: Part) {
    const links = vendorsForPart(item);
    setPart({
      id: item.id,
      partNumber: item.partNumber,
      description: item.description,
      quantityOnHand: item.quantityOnHand,
      reorderLevel: item.reorderLevel,
      unitCost: item.unitCost == null ? "" : String(item.unitCost),
      location: item.location,
      preferredVendorId: item.preferredVendorId == null ? "" : String(item.preferredVendorId),
      vendorIds: links.map((vendor) => vendor.id).filter((id) => id > 0),
    });
    setShowPartForm(true);
  }

  function toggleVendor(vendorId: number) {
    setPart((current) => {
      const selected = current.vendorIds.includes(vendorId)
        ? current.vendorIds.filter((id) => id !== vendorId)
        : [...current.vendorIds, vendorId];
      const preferred = current.preferredVendorId && selected.includes(Number(current.preferredVendorId))
        ? current.preferredVendorId
        : "";
      return { ...current, vendorIds: selected, preferredVendorId: preferred };
    });
  }

  const summary = data?.summary ?? { partCount: 0, lowStockCount: 0, totalUnits: 0, inventoryValue: 0 };
  const selectedVendors = (data?.vendors ?? []).filter((vendor) => part.vendorIds.includes(vendor.id));

  return (
    <main style={{ minHeight: "100vh", background: "#f3f5f7", padding: "42px", color: "#182331" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 24, alignItems: "flex-end" }}>
        <div>
          <p style={{ margin: 0, color: "#f47b20", fontSize: 12, fontWeight: 800, letterSpacing: ".16em" }}>PARTS OPERATIONS</p>
          <h1 style={{ margin: "8px 0 0", color: "#0d1b2b", fontSize: 34 }}>Inventory</h1>
          <p style={{ margin: "8px 0 0", color: "#6c7886" }}>Parts, stock levels, reorder thresholds, multiple vendors, and repair usage.</p>
        </div>
        <button onClick={() => { setPart(blankPart); setShowPartForm(true); }} style={{ border: 0, borderRadius: 9, padding: "13px 18px", background: "#0d1b2b", color: "white", fontWeight: 800 }}>+ Add part</button>
      </header>

      {message && <div style={{ marginTop: 20, padding: 12, background: "#fff8e6", border: "1px solid #f2c66d", borderRadius: 9 }}>{message}</div>}

      <section style={{ marginTop: 26, display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 14 }}>
        {[
          ["ACTIVE PARTS", summary.partCount.toLocaleString()],
          ["LOW STOCK", summary.lowStockCount.toLocaleString()],
          ["UNITS ON HAND", summary.totalUnits.toLocaleString()],
          ["INVENTORY VALUE", summary.inventoryValue.toLocaleString(undefined, { style: "currency", currency: "USD" })],
        ].map(([label, value]) => (
          <article key={label} style={{ padding: 20, borderRadius: 12, background: "white", border: "1px solid #dce2e7" }}>
            <span style={{ color: "#778491", fontSize: 10, fontWeight: 800, letterSpacing: ".13em" }}>{label}</span>
            <strong style={{ display: "block", marginTop: 9, color: "#0d1b2b", fontSize: 30 }}>{value}</strong>
          </article>
        ))}
      </section>

      <section style={{ marginTop: 22, background: "white", border: "1px solid #dce2e7", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 18, borderBottom: "1px solid #dce2e7", display: "flex", justifyContent: "space-between", gap: 18 }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search part, description, bin, vendor…" style={{ width: "min(520px, 100%)", padding: "11px 13px", border: "1px solid #dce2e7", borderRadius: 9 }} />
          <span style={{ color: "#6c7886", fontSize: 13 }}>{visibleParts.length} visible</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
            <thead><tr>{["Part #", "Description", "On hand", "Reorder", "Location", "Vendors", "Unit cost", "Actions"].map((heading) => <th key={heading} style={{ padding: 13, textAlign: "left", background: "#f7f9fa", color: "#657383", fontSize: 11 }}>{heading}</th>)}</tr></thead>
            <tbody>
              {visibleParts.map((item) => {
                const links = vendorsForPart(item);
                return (
                  <tr key={item.id} style={{ borderTop: "1px solid #edf0f2", background: item.lowStock ? "#fff8e6" : "white" }}>
                    <td style={{ padding: 13, fontWeight: 800 }}>{item.partNumber}</td>
                    <td style={{ padding: 13 }}>{item.description}</td>
                    <td style={{ padding: 13 }}><strong style={{ color: item.lowStock ? "#a85b00" : "#182331" }}>{item.quantityOnHand}</strong></td>
                    <td style={{ padding: 13 }}>{item.reorderLevel}</td>
                    <td style={{ padding: 13 }}>{item.location || "—"}</td>
                    <td style={{ padding: 13 }}>{links.length ? links.map((vendor) => `${vendor.name}${vendor.preferred ? " ★" : ""}`).join(", ") : "—"}</td>
                    <td style={{ padding: 13 }}>{item.unitCost == null ? "—" : item.unitCost.toLocaleString(undefined, { style: "currency", currency: "USD" })}</td>
                    <td style={{ padding: 13, whiteSpace: "nowrap" }}>
                      <button onClick={() => void adjustStock(item.id, 1)} style={{ marginRight: 6 }}>+1</button>
                      <button onClick={() => void adjustStock(item.id, -1)} style={{ marginRight: 6 }}>−1</button>
                      <button onClick={() => editPart(item)}>Edit</button>
                    </td>
                  </tr>
                );
              })}
              {!visibleParts.length && <tr><td colSpan={8} style={{ padding: 30, textAlign: "center", color: "#6c7886" }}>No inventory records yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {showPartForm && (
        <div style={{ position: "fixed", inset: 0, background: "#07111db8", display: "grid", placeItems: "center", padding: 20, zIndex: 50, overflowY: "auto" }}>
          <form onSubmit={savePart} style={{ width: "min(720px,100%)", background: "white", borderRadius: 14, padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <h2 style={{ gridColumn: "1 / -1", margin: 0 }}>{part.id ? "Edit part" : "Add part"}</h2>
            <input required placeholder="Part number" value={part.partNumber} onChange={(event) => setPart({ ...part, partNumber: event.target.value })} style={{ padding: 11 }} />
            <input required placeholder="Description" value={part.description} onChange={(event) => setPart({ ...part, description: event.target.value })} style={{ padding: 11 }} />
            <input type="number" step="any" placeholder="Quantity on hand" value={part.quantityOnHand} onChange={(event) => setPart({ ...part, quantityOnHand: Number(event.target.value) })} style={{ padding: 11 }} />
            <input type="number" step="any" placeholder="Reorder level" value={part.reorderLevel} onChange={(event) => setPart({ ...part, reorderLevel: Number(event.target.value) })} style={{ padding: 11 }} />
            <input type="number" step="0.01" placeholder="Unit cost" value={part.unitCost} onChange={(event) => setPart({ ...part, unitCost: event.target.value })} style={{ padding: 11 }} />
            <input placeholder="Location / bin" value={part.location} onChange={(event) => setPart({ ...part, location: event.target.value })} style={{ padding: 11 }} />

            <fieldset style={{ gridColumn: "1 / -1", border: "1px solid #dce2e7", borderRadius: 10, padding: 14 }}>
              <legend style={{ fontWeight: 800, padding: "0 6px" }}>Suppliers</legend>
              <p style={{ margin: "0 0 10px", color: "#6c7886", fontSize: 13 }}>Select every vendor that can supply this part.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 8, maxHeight: 210, overflowY: "auto" }}>
                {(data?.vendors ?? []).map((vendor) => (
                  <label key={vendor.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: 8, border: "1px solid #edf0f2", borderRadius: 8 }}>
                    <input type="checkbox" checked={part.vendorIds.includes(vendor.id)} onChange={() => toggleVendor(vendor.id)} />
                    <span>{vendor.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label style={{ gridColumn: "1 / -1", display: "grid", gap: 6, fontWeight: 700 }}>Preferred vendor
              <select value={part.preferredVendorId} onChange={(event) => setPart({ ...part, preferredVendorId: event.target.value })} style={{ padding: 11 }}>
                <option value="">No preferred vendor</option>
                {selectedVendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
              </select>
            </label>

            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" onClick={() => { setShowPartForm(false); setPart(blankPart); }} style={{ padding: "11px 16px" }}>Cancel</button>
              <button type="submit" style={{ border: 0, borderRadius: 8, padding: "11px 18px", background: "#f47b20", color: "white", fontWeight: 800 }}>Save part</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
