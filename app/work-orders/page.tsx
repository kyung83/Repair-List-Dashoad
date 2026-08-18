"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import ModuleTabs from "../module-tabs";

type UsedPart = { partId: number; partNumber: string; description: string; quantity: number };
type LaborEntry = { id: number; technicianId: number | null; technician: string; laborDate: string; hours: number; rate: number; amount: number; notes: string };
type Dvir = { defectId: string; asset: string; driver: string; defect: string };
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
  laborEntries: LaborEntry[];
  laborHours: number;
  laborRate: number;
  laborCost: number;
  outsideCost: number;
};
type WorkOrderData = { repairs: Repair[]; dvir: Dvir[]; defaultLaborRate: number; updatedAt: string };
type StatusFilter = "all" | "open" | "completed";

function isComplete(item: Repair) {
  return item.status.toLowerCase().includes("complete");
}

function money(value: number) {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export default function WorkOrdersPage() {
  const [data, setData] = useState<WorkOrderData | null>(null);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  async function load() {
    const response = await fetch("/api/work-orders", { cache: "no-store" });
    const payload = await response.json() as WorkOrderData & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Unable to load work orders.");
    setData(payload);
  }

  useEffect(() => {
    void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to load work orders."));
  }, []);

  const visibleRepairs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.repairs ?? []).filter((item) => {
      if (statusFilter === "open" && isComplete(item)) return false;
      if (statusFilter === "completed" && !isComplete(item)) return false;
      const related = data?.dvir.find((row) => row.defectId === item.relatedGeotabDefectId);
      if (!needle) return true;
      return [item.unit, item.issue, item.status, item.assignedTo, item.partsText, item.location, related?.defect ?? "", ...item.usedParts.flatMap((part) => [part.partNumber, part.description])].join(" ").toLowerCase().includes(needle);
    });
  }, [data, query, statusFilter]);

  const totals = useMemo(() => {
    const repairs = data?.repairs ?? [];
    const open = repairs.filter((item) => !isComplete(item)).length;
    const completed = repairs.length - open;
    const laborHours = repairs.reduce((sum, item) => sum + Number(item.laborHours || 0), 0);
    const recordedCost = repairs.reduce((sum, item) => sum + Number(item.laborCost || 0) + Number(item.outsideCost || 0), 0);
    return { total: repairs.length, open, completed, laborHours, recordedCost };
  }, [data]);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f3f5f7", padding: "30px 34px 80px", color: "#182331" }}>
      <ModuleTabs module="shop" />
      <header style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#f47b20", fontSize: 11, fontWeight: 900, letterSpacing: ".14em" }}>WORK ORDER REVIEW</p>
          <h1 style={{ margin: "6px 0 0", fontSize: 31 }}>Review work orders</h1>
          <p style={{ margin: "7px 0 0", color: "#64748b", maxWidth: 850, fontSize: 13 }}>
            Read-only review. Technicians assign parts, record labor, and complete repairs from Shop Jobs as they work. This screen is only for reviewing the resulting work order record.
          </p>
        </div>
        <div style={{ display: "flex", gap: 7 }}>
          <a href="/repair-board" style={linkButtonStyle}>Repair Board</a>
          <button type="button" onClick={() => void load()} style={buttonStyle}>Refresh</button>
        </div>
      </header>

      {message && <div style={{ marginTop: 12, padding: 10, background: "#fff8e6", border: "1px solid #f2c66d", fontSize: 12 }}>{message}</div>}

      <section style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(5,minmax(120px,1fr))", border: "1px solid #cfd6db", background: "white" }}>
        <Metric label="Open" value={String(totals.open)} />
        <Metric label="Completed" value={String(totals.completed)} />
        <Metric label="Total records" value={String(totals.total)} />
        <Metric label="Labor hours" value={totals.laborHours.toFixed(2)} />
        <Metric label="Labor + outside" value={money(totals.recordedCost)} last />
      </section>

      <section style={{ marginTop: 12, border: "1px solid #cfd6db", background: "white" }}>
        <div style={{ padding: 10, borderBottom: "1px solid #dce2e7", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search unit, repair, technician, part, DVIR..." style={{ ...inputStyle, flex: 1, minWidth: 280 }} />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} style={{ ...inputStyle, width: 155 }}>
            <option value="all">All work orders</option>
            <option value="open">Open only</option>
            <option value="completed">Completed only</option>
          </select>
          <span style={{ color: "#6c7886", fontSize: 11, minWidth: 95, textAlign: "right" }}>{visibleRepairs.length} shown</span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1050 }}>
            <thead>
              <tr style={{ background: "#eef1f2", color: "#5b6770", fontSize: 9, letterSpacing: ".05em", textTransform: "uppercase", textAlign: "left" }}>
                <th style={thStyle}>Unit</th><th style={thStyle}>Repair</th><th style={thStyle}>Status</th><th style={thStyle}>Technician</th><th style={thStyle}>Location</th><th style={thStyle}>Parts</th><th style={thStyle}>Labor</th><th style={thStyle}>Cost</th><th style={thStyle}>Review</th>
              </tr>
            </thead>
            <tbody>
              {visibleRepairs.map((item) => {
                const complete = isComplete(item);
                const open = expanded.has(item.id);
                const related = data?.dvir.find((row) => row.defectId === item.relatedGeotabDefectId);
                return (
                  <Fragment key={item.id}>
                    <tr style={{ borderTop: "1px solid #e7ebee", background: complete ? "#f8faf9" : "white" }}>
                      <td style={{ ...tdStyle, fontWeight: 900, color: "#0d1b2b" }}>{item.unit || "—"}</td>
                      <td style={tdStyle}><strong style={{ color: "#263746" }}>{item.issue}</strong>{related && <small style={{ display: "block", marginTop: 2, color: "#8b5d09" }}>DVIR: {related.defect}</small>}</td>
                      <td style={tdStyle}><span style={{ display: "inline-flex", padding: "3px 7px", border: `1px solid ${complete ? "#9fcab4" : "#c7ced2"}`, background: complete ? "#e9f6ef" : "#f2f4f5", color: complete ? "#176440" : "#53616d", fontSize: 10, fontWeight: 900 }}>{item.status}</span></td>
                      <td style={tdStyle}>{item.assignedTo || "Unassigned"}</td>
                      <td style={tdStyle}>{item.location || "—"}</td>
                      <td style={tdStyle}>{item.usedParts.length ? `${item.usedParts.length} line${item.usedParts.length === 1 ? "" : "s"}` : item.partsText || "—"}</td>
                      <td style={tdStyle}>{item.laborHours.toFixed(2)} hr</td>
                      <td style={tdStyle}>{money(Number(item.laborCost || 0) + Number(item.outsideCost || 0))}</td>
                      <td style={tdStyle}><button type="button" onClick={() => toggle(item.id)} style={buttonStyle}>{open ? "Close" : "Review"}</button></td>
                    </tr>
                    {open && (
                      <tr style={{ borderTop: "1px solid #e7ebee", background: "#fafbfc" }}>
                        <td colSpan={9} style={{ padding: 12 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(160px,1fr))", gap: 10 }}>
                            <Detail label="Work order" value={item.id} />
                            <Detail label="Technician" value={item.assignedTo || "Unassigned"} />
                            <Detail label="Labor" value={`${item.laborHours.toFixed(2)} hr · ${money(item.laborCost)}`} />
                            <Detail label="Outside cost" value={money(item.outsideCost)} />
                            {related && <Detail label="Related DVIR" value={`${related.asset} · ${related.defect}`} />}
                            <Detail label="Parts summary" value={item.partsText || "No part summary"} />
                          </div>

                          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "minmax(280px,1fr) minmax(420px,2fr)", gap: 12 }}>
                            <div style={{ border: "1px solid #e0e5e8", background: "white" }}>
                              <div style={subheadStyle}>Parts used</div>
                              {item.usedParts.length ? item.usedParts.map((part, index) => <div key={`${part.partId}-${index}`} style={{ display: "grid", gridTemplateColumns: "100px 1fr auto", gap: 8, padding: "7px 9px", borderTop: "1px solid #edf0f2", fontSize: 11 }}><strong>{part.partNumber}</strong><span>{part.description}</span><span>× {part.quantity}</span></div>) : <div style={emptyStyle}>No parts recorded.</div>}
                            </div>
                            <div style={{ border: "1px solid #e0e5e8", background: "white" }}>
                              <div style={subheadStyle}>Labor entries</div>
                              {item.laborEntries.length ? item.laborEntries.map((entry) => <div key={entry.id} style={{ display: "grid", gridTemplateColumns: "95px 130px 80px 100px 1fr", gap: 8, padding: "7px 9px", borderTop: "1px solid #edf0f2", fontSize: 11 }}><span>{entry.laborDate}</span><strong>{entry.technician}</strong><span>{entry.hours} hr</span><span>{money(entry.amount)}</span><span style={{ color: "#64748b" }}>{entry.notes || "—"}</span></div>) : <div style={emptyStyle}>No labor entries recorded.</div>}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!visibleRepairs.length && <div style={{ padding: 24, color: "#64748b", textAlign: "center", fontSize: 12 }}>No work orders match this search/filter.</div>}
        </div>
      </section>

      <footer style={{ marginTop: 9, color: "#74808a", fontSize: 10, textAlign: "right" }}>{data ? `Read-only snapshot updated ${new Date(data.updatedAt).toLocaleString()}` : "Loading work order review..."}</footer>
    </main>
  );
}

function Metric({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return <article style={{ minHeight: 64, padding: "10px 12px", borderRight: last ? 0 : "1px solid #dce2e7" }}><span style={{ display: "block", color: "#6f7b84", fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</span><strong style={{ display: "block", marginTop: 4, color: "#0d1b2b", fontSize: 21 }}>{value}</strong></article>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><span style={{ display: "block", color: "#74808a", fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</span><strong style={{ display: "block", marginTop: 2, fontSize: 11, color: "#263746" }}>{value}</strong></div>;
}

const inputStyle = { minHeight: 34, padding: "6px 8px", border: "1px solid #c7ced3", borderRadius: 4, background: "white", color: "#263746" } as const;
const buttonStyle = { minHeight: 30, padding: "0 9px", border: "1px solid #bcc5cb", borderRadius: 4, background: "white", color: "#263746", fontSize: 10, fontWeight: 900 } as const;
const linkButtonStyle = { ...buttonStyle, display: "inline-flex", alignItems: "center", textDecoration: "none" } as const;
const thStyle = { padding: "7px 8px", borderRight: "1px solid #d7dde1" } as const;
const tdStyle = { padding: "8px", fontSize: 11, verticalAlign: "middle" } as const;
const subheadStyle = { padding: "7px 9px", background: "#eef1f2", color: "#59656e", fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".04em" } as const;
const emptyStyle = { padding: 10, borderTop: "1px solid #edf0f2", color: "#7a858d", fontSize: 11 } as const;
