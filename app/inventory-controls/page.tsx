"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import ModuleTabs from "../module-tabs";

type Issue = {
  id: number;
  part_number: string;
  description: string;
  warehouse_code: string;
  warehouse_name: string;
  expected_quantity: number;
  counted_quantity: number;
  difference_quantity: number;
  reason: string;
  created_at: string;
};

type CoreObligation = {
  id: number;
  repair_id: number | null;
  quantity: number;
  issued_part_number: string;
  issued_description: string;
  core_part_number: string | null;
  core_description: string | null;
  unit: string;
  opened_at: string;
};

type RecoveredTire = {
  id: number;
  repair_id: number | null;
  part_number: string | null;
  description: string | null;
  warehouse_code: string;
  warehouse_name: string;
  position_code: string | null;
  condition_note: string | null;
  source_unit: string;
  recovered_at: string;
};

type Part = {
  id: number;
  part_number: string;
  description: string;
  core_return_part_id: number | null;
  core_return_quantity: number;
};

type Warehouse = { id: number; code: string; name: string };

type ControlsData = {
  ok: boolean;
  issues: Issue[];
  coreObligations: CoreObligation[];
  recoveredTires: RecoveredTire[];
  parts: Part[];
  warehouses: Warehouse[];
};

const tirePositions = ["A1L", "A1R", "A1LO", "A1LI", "A1RI", "A1RO", "A2LO", "A2LI", "A2RI", "A2RO", "A3LO", "A3LI", "A3RI", "A3RO"];

export default function InventoryControlsPage() {
  const [data, setData] = useState<ControlsData | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [issuedPartId, setIssuedPartId] = useState("");
  const [corePartId, setCorePartId] = useState("");
  const [coreQuantity, setCoreQuantity] = useState("1");
  const [sourceRepairId, setSourceRepairId] = useState("");
  const [tireWarehouse, setTireWarehouse] = useState("");
  const [tirePosition, setTirePosition] = useState("");
  const [tirePartId, setTirePartId] = useState("");
  const [tireNote, setTireNote] = useState("");

  async function load() {
    const response = await fetch("/api/inventory-controls", { cache: "no-store" });
    const payload = await response.json() as ControlsData & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Inventory controls could not be loaded.");
    setData(payload);
    if (!tireWarehouse && payload.warehouses.length) setTireWarehouse(payload.warehouses[0].code);
  }

  useEffect(() => {
    void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Inventory controls could not be loaded."));
  }, []);

  useEffect(() => {
    if (!data || !issuedPartId) return;
    const selected = data.parts.find((part) => part.id === Number(issuedPartId));
    if (!selected) return;
    setCorePartId(selected.core_return_part_id == null ? "" : String(selected.core_return_part_id));
    setCoreQuantity(selected.core_return_part_id == null ? "1" : String(selected.core_return_quantity || 1));
  }, [data, issuedPartId]);

  async function post(action: string, body: Record<string, unknown>, success: string) {
    setBusy(action);
    setMessage("");
    try {
      const response = await fetch("/api/inventory-controls", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `${action}:${crypto.randomUUID()}` },
        body: JSON.stringify({ action, ...body }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Inventory control action failed.");
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Inventory control action failed.");
    } finally {
      setBusy("");
    }
  }

  async function configureCore(event: FormEvent) {
    event.preventDefault();
    if (!issuedPartId) return setMessage("Choose the part that creates the core obligation.");
    await post("configureCore", {
      partId: Number(issuedPartId),
      corePartId: corePartId ? Number(corePartId) : null,
      coreReturnQuantity: corePartId ? Number(coreQuantity) : 0,
    }, corePartId ? "Core-return rule saved." : "Core-return rule removed.");
  }

  async function recoverTire(event: FormEvent) {
    event.preventDefault();
    await post("recoverUsedTire", {
      repairId: Number(sourceRepairId),
      warehouseCode: tireWarehouse,
      positionCode: tirePosition,
      partId: tirePartId ? Number(tirePartId) : null,
      conditionNote: tireNote,
    }, "Recovered tire recorded separately from new inventory.");
    setSourceRepairId("");
    setTirePosition("");
    setTirePartId("");
    setTireNote("");
  }

  const selectedIssuedPart = useMemo(() => data?.parts.find((part) => part.id === Number(issuedPartId)) ?? null, [data, issuedPartId]);

  const cardStyle = { background: "white", border: "1px solid #dce2e7", borderRadius: 12, padding: 18 } as const;
  const inputStyle = { padding: "10px 11px", border: "1px solid #cfd7de", borderRadius: 8, background: "white", width: "100%", boxSizing: "border-box" as const };
  const buttonStyle = { border: 0, borderRadius: 8, padding: "9px 13px", background: "#0d1b2b", color: "white", fontWeight: 800, cursor: "pointer" } as const;

  return (
    <main style={{ minHeight: "100vh", background: "#f3f5f7", padding: 42, color: "#182331" }}>
      <ModuleTabs module="parts" />
      <header>
        <p style={{ margin: 0, color: "#f47b20", fontSize: 12, fontWeight: 800, letterSpacing: ".16em" }}>PARTS OPERATIONS</p>
        <h1 style={{ margin: "8px 0 0", color: "#0d1b2b", fontSize: 34 }}>Inventory Controls</h1>
        <p style={{ margin: "8px 0 0", color: "#6c7886", maxWidth: 850 }}>Manager review for physical-count discrepancies, core obligations, and recovered used tires. These controls do not silently change saleable stock.</p>
      </header>

      {message && <div style={{ marginTop: 18, padding: 12, borderRadius: 9, background: "#fff8e6", border: "1px solid #f2c66d" }}>{message}</div>}

      <section style={{ marginTop: 22, ...cardStyle }}>
        <h2 style={{ margin: 0 }}>Physical-count discrepancies</h2>
        <p style={{ color: "#6c7886", fontSize: 13 }}>A count mismatch stays pending until a manager applies the counted quantity. Resolution rechecks the stock version first.</p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
            <thead><tr>{["Part", "Warehouse", "System", "Counted", "Difference", "Reason", "Action"].map((label) => <th key={label} style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e4e8eb", fontSize: 11, color: "#657383" }}>{label}</th>)}</tr></thead>
            <tbody>
              {(data?.issues ?? []).map((issue) => <tr key={issue.id}>
                <td style={{ padding: 10, borderBottom: "1px solid #edf0f2" }}><b>{issue.part_number}</b><small style={{ display: "block", color: "#6c7886" }}>{issue.description}</small></td>
                <td style={{ padding: 10, borderBottom: "1px solid #edf0f2" }}>{issue.warehouse_name}</td>
                <td style={{ padding: 10, borderBottom: "1px solid #edf0f2" }}>{issue.expected_quantity}</td>
                <td style={{ padding: 10, borderBottom: "1px solid #edf0f2" }}><b>{issue.counted_quantity}</b></td>
                <td style={{ padding: 10, borderBottom: "1px solid #edf0f2", color: issue.difference_quantity < 0 ? "#b42318" : "#126c39", fontWeight: 800 }}>{issue.difference_quantity > 0 ? "+" : ""}{issue.difference_quantity}</td>
                <td style={{ padding: 10, borderBottom: "1px solid #edf0f2" }}>{issue.reason}</td>
                <td style={{ padding: 10, borderBottom: "1px solid #edf0f2" }}><button disabled={!!busy} onClick={() => void post("resolvePhysicalCount", { issueId: issue.id, note: "Manager approved physical count" }, "Physical count applied and discrepancy closed.")} style={buttonStyle}>Apply count</button></td>
              </tr>)}
              {!data?.issues.length && <tr><td colSpan={7} style={{ padding: 18, color: "#6c7886" }}>No open physical-count discrepancies.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: 18, display: "grid", gridTemplateColumns: "minmax(320px, .8fr) minmax(420px, 1.2fr)", gap: 18, alignItems: "start" }}>
        <form onSubmit={configureCore} style={cardStyle}>
          <h2 style={{ margin: 0 }}>Core-return rules</h2>
          <p style={{ color: "#6c7886", fontSize: 13 }}>Configure which issued stocked parts create a core obligation. The returned core is an obligation record, not normal on-hand inventory.</p>
          <label style={{ display: "grid", gap: 6, marginTop: 12, fontSize: 12, fontWeight: 800 }}>ISSUED PART
            <select value={issuedPartId} onChange={(event) => setIssuedPartId(event.target.value)} style={inputStyle}><option value="">Choose part…</option>{(data?.parts ?? []).map((part) => <option key={part.id} value={part.id}>{part.part_number} — {part.description}</option>)}</select>
          </label>
          <label style={{ display: "grid", gap: 6, marginTop: 12, fontSize: 12, fontWeight: 800 }}>RETURNED CORE PART
            <select value={corePartId} onChange={(event) => setCorePartId(event.target.value)} style={inputStyle}><option value="">No core obligation</option>{(data?.parts ?? []).filter((part) => part.id !== Number(issuedPartId)).map((part) => <option key={part.id} value={part.id}>{part.part_number} — {part.description}</option>)}</select>
          </label>
          <label style={{ display: "grid", gap: 6, marginTop: 12, fontSize: 12, fontWeight: 800 }}>CORES REQUIRED PER ISSUED UNIT
            <input type="number" min="0.01" step="any" disabled={!corePartId} value={coreQuantity} onChange={(event) => setCoreQuantity(event.target.value)} style={inputStyle} />
          </label>
          {selectedIssuedPart?.core_return_part_id != null && <p style={{ fontSize: 12, color: "#6c7886" }}>Current rule: {selectedIssuedPart.core_return_quantity} core(s) per issued unit.</p>}
          <button disabled={!!busy || !issuedPartId} type="submit" style={{ ...buttonStyle, marginTop: 14 }}>{corePartId ? "Save core rule" : "Remove core rule"}</button>
        </form>

        <article style={cardStyle}>
          <h2 style={{ margin: 0 }}>Open core obligations</h2>
          <p style={{ color: "#6c7886", fontSize: 13 }}>These were opened automatically when a configured part was issued.</p>
          <div style={{ display: "grid", gap: 10 }}>
            {(data?.coreObligations ?? []).map((core) => <div key={core.id} style={{ border: "1px solid #e2e7eb", borderRadius: 9, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div><b>{core.quantity} × {core.core_part_number || "Core"}</b><small style={{ display: "block", color: "#6c7886" }}>{core.unit ? `Unit ${core.unit} · ` : ""}Repair {core.repair_id ?? "—"} · issued {core.issued_part_number}</small></div>
                <div style={{ display: "flex", gap: 7 }}>
                  <button disabled={!!busy} onClick={() => void post("closeCore", { obligationId: core.id, disposition: "returned", note: "Core physically returned" }, "Core obligation marked returned.")} style={buttonStyle}>Returned</button>
                  <button disabled={!!busy} onClick={() => { const note = window.prompt("Reason for waiving this core obligation?") ?? ""; if (note.trim()) void post("closeCore", { obligationId: core.id, disposition: "waived", note }, "Core obligation waived with manager note."); }} style={{ ...buttonStyle, background: "#6d4c1f" }}>Waive</button>
                </div>
              </div>
            </div>)}
            {!data?.coreObligations.length && <span style={{ color: "#6c7886" }}>No open core obligations.</span>}
          </div>
        </article>
      </section>

      <section style={{ marginTop: 18, display: "grid", gridTemplateColumns: "minmax(320px, .8fr) minmax(420px, 1.2fr)", gap: 18, alignItems: "start" }}>
        <form onSubmit={recoverTire} style={cardStyle}>
          <h2 style={{ margin: 0 }}>Recover a used tire</h2>
          <p style={{ color: "#6c7886", fontSize: 13 }}>Record a usable tire removed during a repair. It is segregated from new/saleable tire inventory.</p>
          <label style={{ display: "grid", gap: 6, marginTop: 12, fontSize: 12, fontWeight: 800 }}>SOURCE REPAIR ID<input required type="number" min="1" value={sourceRepairId} onChange={(event) => setSourceRepairId(event.target.value)} style={inputStyle} /></label>
          <label style={{ display: "grid", gap: 6, marginTop: 12, fontSize: 12, fontWeight: 800 }}>WAREHOUSE<select required value={tireWarehouse} onChange={(event) => setTireWarehouse(event.target.value)} style={inputStyle}>{(data?.warehouses ?? []).map((warehouse) => <option key={warehouse.code} value={warehouse.code}>{warehouse.name}</option>)}</select></label>
          <label style={{ display: "grid", gap: 6, marginTop: 12, fontSize: 12, fontWeight: 800 }}>REMOVED POSITION<select required value={tirePosition} onChange={(event) => setTirePosition(event.target.value)} style={inputStyle}><option value="">Choose position…</option>{tirePositions.map((position) => <option key={position} value={position}>{position}</option>)}</select></label>
          <label style={{ display: "grid", gap: 6, marginTop: 12, fontSize: 12, fontWeight: 800 }}>CATALOG TIRE (OPTIONAL)<select value={tirePartId} onChange={(event) => setTirePartId(event.target.value)} style={inputStyle}><option value="">Unknown / not linked</option>{(data?.parts ?? []).map((part) => <option key={part.id} value={part.id}>{part.part_number} — {part.description}</option>)}</select></label>
          <label style={{ display: "grid", gap: 6, marginTop: 12, fontSize: 12, fontWeight: 800 }}>CONDITION NOTE<textarea required rows={3} value={tireNote} onChange={(event) => setTireNote(event.target.value)} style={inputStyle} /></label>
          <button disabled={!!busy} type="submit" style={{ ...buttonStyle, marginTop: 14 }}>Record recovered tire</button>
        </form>

        <article style={cardStyle}>
          <h2 style={{ margin: 0 }}>Recovered tires available</h2>
          <p style={{ color: "#6c7886", fontSize: 13 }}>Reuse consumes the recovered-tire record only; it does not decrement new tire stock. Scrap closes the record permanently.</p>
          <div style={{ display: "grid", gap: 10 }}>
            {(data?.recoveredTires ?? []).map((tire) => <div key={tire.id} style={{ border: "1px solid #e2e7eb", borderRadius: 9, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div><b>{tire.position_code || "Unknown position"} · {tire.part_number || "Uncataloged tire"}</b><small style={{ display: "block", color: "#6c7886" }}>{tire.source_unit ? `Unit ${tire.source_unit} · ` : ""}Repair {tire.repair_id ?? "—"} · {tire.warehouse_name}</small><small style={{ display: "block", color: "#6c7886", marginTop: 3 }}>{tire.condition_note || "No condition note"}</small></div>
                <div style={{ display: "flex", gap: 7 }}>
                  <button disabled={!!busy} onClick={() => { const value = window.prompt("Destination repair ID for this reused tire?") ?? ""; const repairId = Number(value); if (Number.isInteger(repairId) && repairId > 0) void post("disposeUsedTire", { tireId: tire.id, disposition: "reused", destinationRepairId: repairId, note: "Recovered tire reused" }, "Recovered tire assigned as reused."); }} style={buttonStyle}>Reuse</button>
                  <button disabled={!!busy} onClick={() => { if (window.confirm("Scrap this recovered tire?")) void post("disposeUsedTire", { tireId: tire.id, disposition: "scrapped", note: "Recovered tire scrapped" }, "Recovered tire marked scrapped."); }} style={{ ...buttonStyle, background: "#8a2a20" }}>Scrap</button>
                </div>
              </div>
            </div>)}
            {!data?.recoveredTires.length && <span style={{ color: "#6c7886" }}>No recovered tires are waiting for disposition.</span>}
          </div>
        </article>
      </section>
    </main>
  );
}
