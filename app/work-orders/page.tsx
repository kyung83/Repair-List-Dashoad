"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Technician = { id: number; name: string; email: string; phone: string };
type Part = { id: number; partNumber: string; description: string; quantityOnHand: number; location: string };
type UsedPart = { partId: number; partNumber: string; description: string; quantity: number };
type Repair = {
  id: string;
  unit: string;
  issue: string;
  status: string;
  partsText: string;
  assignedTo: string;
  technicianId: number | null;
  location: string;
  relatedGeotabDefectId: string;
  usedParts: UsedPart[];
};
type WorkOrderData = { repairs: Repair[]; technicians: Technician[]; parts: Part[]; updatedAt: string };

type RowSelection = { partId: string; quantity: number };

const blankRepair = { unit: "", issue: "", status: "New", location: "" };
const blankTechnician = { name: "", email: "", phone: "" };
const blankPart = { partNumber: "", description: "", quantityOnHand: 0, reorderLevel: 0, location: "" };

export default function WorkOrdersPage() {
  const [data, setData] = useState<WorkOrderData | null>(null);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [repair, setRepair] = useState(blankRepair);
  const [technician, setTechnician] = useState(blankTechnician);
  const [part, setPart] = useState(blankPart);
  const [selections, setSelections] = useState<Record<string, RowSelection>>({});
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/work-orders", { cache: "no-store" });
    const payload = (await response.json()) as WorkOrderData & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Unable to load work orders");
    setData(payload);
  }

  useEffect(() => {
    void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to load work orders"));
  }, []);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Work-order action failed");
      setMessage("");
      await load();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Work-order action failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createRepair(event: FormEvent) {
    event.preventDefault();
    if (await post({ action: "saveRepair", ...repair })) setRepair(blankRepair);
  }

  async function createTechnician(event: FormEvent) {
    event.preventDefault();
    if (await post({ action: "saveTechnician", ...technician })) setTechnician(blankTechnician);
  }

  async function createPart(event: FormEvent) {
    event.preventDefault();
    if (await post({ action: "savePart", ...part })) setPart(blankPart);
  }

  function selectionFor(repairId: string): RowSelection {
    return selections[repairId] ?? { partId: "", quantity: 1 };
  }

  function updateSelection(repairId: string, patch: Partial<RowSelection>) {
    setSelections((current) => ({
      ...current,
      [repairId]: { ...selectionFor(repairId), ...patch },
    }));
  }

  async function usePart(repairId: string) {
    const selection = selectionFor(repairId);
    if (!selection.partId) return setMessage("Choose a part first.");
    const ok = await post({
      action: "usePart",
      repairId,
      partId: Number(selection.partId),
      quantity: selection.quantity,
    });
    if (ok) updateSelection(repairId, { partId: "", quantity: 1 });
  }

  const visibleRepairs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.repairs ?? []).filter((item) =>
      [item.unit, item.issue, item.status, item.assignedTo, item.partsText, item.location]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [data, query]);

  const openCount = (data?.repairs ?? []).filter((item) => !item.status.toLowerCase().includes("complete")).length;

  return (
    <main style={{ minHeight: "100vh", background: "#f3f5f7", padding: "42px", color: "#182331" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 24, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#f47b20", fontSize: 12, fontWeight: 800, letterSpacing: ".16em" }}>SHOP OPERATIONS</p>
          <h1 style={{ margin: "8px 0 0", color: "#0d1b2b", fontSize: 34 }}>Work orders</h1>
          <p style={{ margin: "8px 0 0", color: "#6c7886" }}>Other repairs, technician assignments, and parts used on each repair.</p>
        </div>
        <div style={{ textAlign: "right", color: "#6c7886" }}>
          <strong style={{ display: "block", color: "#0d1b2b", fontSize: 28 }}>{openCount}</strong>
          open work orders
        </div>
      </header>

      {message && <div style={{ marginTop: 18, padding: 12, background: "#fff8e6", border: "1px solid #f2c66d", borderRadius: 9 }}>{message}</div>}

      <section style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(3, minmax(260px, 1fr))", gap: 16 }}>
        <form onSubmit={createRepair} style={formStyle}>
          <h2 style={formTitleStyle}>Add repair</h2>
          <input required placeholder="Unit" value={repair.unit} onChange={(event) => setRepair({ ...repair, unit: event.target.value })} style={inputStyle} />
          <input required placeholder="Repair needed" value={repair.issue} onChange={(event) => setRepair({ ...repair, issue: event.target.value })} style={inputStyle} />
          <input placeholder="Location" value={repair.location} onChange={(event) => setRepair({ ...repair, location: event.target.value })} style={inputStyle} />
          <button disabled={busy} type="submit" style={primaryButtonStyle}>Add repair</button>
        </form>

        <form onSubmit={createTechnician} style={formStyle}>
          <h2 style={formTitleStyle}>Add technician</h2>
          <input required placeholder="Technician name" value={technician.name} onChange={(event) => setTechnician({ ...technician, name: event.target.value })} style={inputStyle} />
          <input type="email" placeholder="Email" value={technician.email} onChange={(event) => setTechnician({ ...technician, email: event.target.value })} style={inputStyle} />
          <input placeholder="Phone" value={technician.phone} onChange={(event) => setTechnician({ ...technician, phone: event.target.value })} style={inputStyle} />
          <button disabled={busy} type="submit" style={primaryButtonStyle}>Add technician</button>
        </form>

        <form onSubmit={createPart} style={formStyle}>
          <h2 style={formTitleStyle}>Add part</h2>
          <input required placeholder="Part number" value={part.partNumber} onChange={(event) => setPart({ ...part, partNumber: event.target.value })} style={inputStyle} />
          <input required placeholder="Description" value={part.description} onChange={(event) => setPart({ ...part, description: event.target.value })} style={inputStyle} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input type="number" min="0" step="any" placeholder="On hand" value={part.quantityOnHand} onChange={(event) => setPart({ ...part, quantityOnHand: Number(event.target.value) })} style={inputStyle} />
            <input type="number" min="0" step="any" placeholder="Reorder" value={part.reorderLevel} onChange={(event) => setPart({ ...part, reorderLevel: Number(event.target.value) })} style={inputStyle} />
          </div>
          <input placeholder="Bin / location" value={part.location} onChange={(event) => setPart({ ...part, location: event.target.value })} style={inputStyle} />
          <button disabled={busy} type="submit" style={primaryButtonStyle}>Add part</button>
        </form>
      </section>

      <section style={{ marginTop: 24, background: "white", border: "1px solid #dce2e7", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 18, borderBottom: "1px solid #dce2e7", display: "flex", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search unit, repair, technician, part…" style={{ ...inputStyle, width: "min(540px, 100%)" }} />
          <span style={{ color: "#6c7886", alignSelf: "center" }}>{visibleRepairs.length} work orders</span>
        </div>

        <div style={{ display: "grid", gap: 12, padding: 16 }}>
          {visibleRepairs.map((item) => {
            const selection = selectionFor(item.id);
            const complete = item.status.toLowerCase().includes("complete");
            return (
              <article key={item.id} style={{ border: "1px solid #e0e5e9", borderRadius: 12, padding: 18, background: complete ? "#f7f9fa" : "white" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div>
                    <span style={{ color: "#f47b20", fontSize: 12, fontWeight: 800 }}>UNIT {item.unit || "—"}</span>
                    <h3 style={{ margin: "5px 0 4px", fontSize: 20 }}>{item.issue}</h3>
                    <span style={{ color: "#6c7886", fontSize: 13 }}>{item.location || "No location"} · {item.status}</span>
                  </div>
                  {!complete && <button disabled={busy} onClick={() => void post({ action: "completeRepair", id: item.id })} style={secondaryButtonStyle}>Complete</button>}
                </div>

                <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(260px, 1.4fr)", gap: 14 }}>
                  <label style={labelStyle}>
                    Technician
                    <select
                      value={item.technicianId ?? ""}
                      onChange={(event) => void post({ action: "assignTechnician", repairId: item.id, technicianId: event.target.value ? Number(event.target.value) : 0 })}
                      style={inputStyle}
                      disabled={busy || complete}
                    >
                      <option value="">Unassigned</option>
                      {(data?.technicians ?? []).map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}
                    </select>
                  </label>

                  <div>
                    <span style={{ ...labelStyle, display: "block" }}>Parts used</span>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 90px auto", gap: 8 }}>
                      <select value={selection.partId} onChange={(event) => updateSelection(item.id, { partId: event.target.value })} style={inputStyle} disabled={busy || complete}>
                        <option value="">Choose part</option>
                        {(data?.parts ?? []).map((availablePart) => (
                          <option key={availablePart.id} value={availablePart.id} disabled={availablePart.quantityOnHand <= 0}>
                            {availablePart.partNumber} — {availablePart.description} ({availablePart.quantityOnHand} on hand)
                          </option>
                        ))}
                      </select>
                      <input type="number" min="0.01" step="any" value={selection.quantity} onChange={(event) => updateSelection(item.id, { quantity: Number(event.target.value) })} style={inputStyle} disabled={busy || complete} />
                      <button disabled={busy || complete} onClick={() => void usePart(item.id)} style={secondaryButtonStyle}>Use part</button>
                    </div>
                    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {item.usedParts.map((used, index) => (
                        <span key={`${used.partId}-${index}`} style={{ padding: "5px 8px", borderRadius: 999, background: "#eef2f5", fontSize: 12 }}>
                          {used.partNumber} × {used.quantity}
                        </span>
                      ))}
                      {!item.usedParts.length && <span style={{ color: "#88939e", fontSize: 12 }}>No inventory parts attached yet.</span>}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
          {!visibleRepairs.length && <div style={{ padding: 30, textAlign: "center", color: "#6c7886" }}>No work orders found.</div>}
        </div>
      </section>
    </main>
  );
}

const formStyle = { background: "white", border: "1px solid #dce2e7", borderRadius: 12, padding: 18, display: "grid", gap: 9 } as const;
const formTitleStyle = { margin: "0 0 3px", color: "#0d1b2b", fontSize: 18 } as const;
const inputStyle = { width: "100%", boxSizing: "border-box", padding: "10px 11px", border: "1px solid #ccd4db", borderRadius: 8, background: "white", color: "#182331" } as const;
const primaryButtonStyle = { border: 0, borderRadius: 8, padding: "11px 14px", background: "#f47b20", color: "white", fontWeight: 800, cursor: "pointer" } as const;
const secondaryButtonStyle = { border: "1px solid #cbd3da", borderRadius: 8, padding: "9px 12px", background: "#f7f9fa", color: "#182331", fontWeight: 700, cursor: "pointer" } as const;
const labelStyle = { color: "#596674", fontSize: 12, fontWeight: 800 } as const;
