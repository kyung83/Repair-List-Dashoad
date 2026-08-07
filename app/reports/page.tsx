"use client";

import { useEffect, useMemo, useState } from "react";

type Summary = {
  activeUnits: number;
  repairsInYear: number;
  completedRepairsInYear: number;
  openRepairs: number;
  partsSpend: number;
  laborSpend: number;
  outsideRepairSpend: number;
  repairSpend: number;
  ownershipExpenseSpend: number;
  purchaseSpend: number;
  operatingCost: number;
  totalCost: number;
  averageRepairCost: number;
  averageRepairCycleHours: number | null;
  fleetLifetimeOperatingCost: number;
  fleetLifetimeOwnershipCost: number;
};

type UnitCost = {
  equipmentId: number;
  unit: string;
  category: string;
  equipmentType: string;
  modelYear: number | null;
  make: string;
  model: string;
  currentMileage: number | null;
  purchaseDate: string;
  purchasePrice: number | null;
  inServiceDate: string;
  acquisitionMileage: number | null;
  expectedResidualValue: number | null;
  retiredDate: string;
  repairCountYear: number;
  lifetimeRepairCount: number;
  openRepairs: number;
  yearPartsCost: number;
  yearLaborCost: number;
  yearOutsideCost: number;
  yearRepairCost: number;
  yearExpenseCost: number;
  purchaseCostYear: number;
  yearOperatingCost: number;
  yearTotalCost: number;
  lifetimeRepairCost: number;
  lifetimeExpenseCost: number;
  lifetimeOperatingCost: number;
  lifetimeOwnershipCost: number;
  netLifecycleCost: number;
  milesOwned: number | null;
  recordedCostPerMile: number | null;
  averageRepairCycleHours: number | null;
  pmEvents: number;
  annualEvents: number;
  ownershipDataComplete: boolean;
};

type RepairHistory = {
  id: number;
  equipmentId: number | null;
  unit: string;
  category: string;
  title: string;
  status: string;
  source: string;
  openedAt: string;
  completedAt: string;
  year: number | null;
  technician: string;
  location: string;
  partsCost: number;
  laborHours: number;
  laborRate: number;
  laborCost: number;
  outsideCost: number;
  totalCost: number;
  repairCycleHours: number | null;
};

type Expense = {
  id: number;
  equipmentId: number;
  unit: string;
  expenseDate: string;
  year: number | null;
  category: string;
  amount: number;
  vendor: string;
  description: string;
  source: string;
};

type MaintenanceHistory = {
  id: number;
  equipmentId: number;
  unit: string;
  eventType: string;
  pmType: string;
  eventDate: string;
  year: number | null;
  mileage: number | null;
  notes: string;
  source: string;
};

type ReportingData = {
  years: number[];
  selectedYear: number;
  summary: Summary;
  unitCosts: UnitCost[];
  categoryCosts: Array<{ category: string; units: number; repairCost: number; expenseCost: number; purchaseCost: number; operatingCost: number; totalCost: number }>;
  yearlyTrend: Array<{ year: number; repairCount: number; repairCost: number; expenseCost: number; purchaseCost: number; operatingCost: number; totalCost: number }>;
  repairHistory: RepairHistory[];
  partsUsage: Array<{ partNumber: string; description: string; quantity: number; repairCount: number; unitCount: number; units: string[]; cost: number }>;
  issueAnalysis: Array<{ issue: string; repairCount: number; unitCount: number; totalCost: number; averageCost: number }>;
  technicianAnalysis: Array<{ technician: string; repairCount: number; completedCount: number; totalCost: number; averageRepairCycleHours: number | null }>;
  maintenanceHistory: MaintenanceHistory[];
  expenses: Expense[];
  expenseCategories: string[];
  dataQuality: { totalUnits: number; unitsWithPurchasePrice: number; totalRepairs: number; repairsWithLaborEntry: number; totalPartLines: number; pricedPartLines: number; snapshotPartLines: number; ownershipExpenseEntries: number };
  updatedAt: string;
};

type User = { role: "viewer" | "mechanic" | "manager" | "admin" };

const panel = { background: "white", border: "1px solid #dce2e7", borderRadius: 14, padding: 18 } as const;
const inputStyle = { padding: "10px 11px", border: "1px solid #cbd5e1", borderRadius: 8, background: "white" } as const;
const buttonStyle = { padding: "10px 14px", border: 0, borderRadius: 8, background: "#0d1b2b", color: "white", fontWeight: 850, cursor: "pointer" } as const;

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function num(value: number | null | undefined, digits = 0) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function shortDate(value: string) {
  if (!value) return "—";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function pct(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Record<string, string | number | null | undefined>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.map(csvCell).join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function Section({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ ...panel, marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 21 }}>{title}</h2>
          {subtitle && <p style={{ margin: "5px 0 0", color: "#64748b", fontSize: 13 }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return <div style={{ overflowX: "auto" }}>{children}</div>;
}

export default function ReportsPage() {
  const currentYear = new Date().getFullYear();
  const [data, setData] = useState<ReportingData | null>(null);
  const [year, setYear] = useState(String(currentYear));
  const [unitId, setUnitId] = useState("all");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [financial, setFinancial] = useState({ purchaseDate: "", purchasePrice: "", inServiceDate: "", acquisitionMileage: "", expectedResidualValue: "", retiredDate: "" });
  const [expense, setExpense] = useState({ expenseDate: new Date().toISOString().slice(0, 10), category: "Fuel", amount: "", vendor: "", description: "" });
  const [repairId, setRepairId] = useState("");
  const [repairCost, setRepairCost] = useState({ laborHours: "", laborRate: "", outsideCost: "" });

  async function load(requestedYear = year) {
    setLoading(true);
    try {
      const response = await fetch(`/api/reports?year=${encodeURIComponent(requestedYear)}`, { cache: "no-store" });
      const payload = await response.json() as ReportingData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Reports could not be loaded.");
      setData(payload);
      setYear(String(payload.selectedYear));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reports could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(String(currentYear));
    void fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => response.ok ? (await response.json() as { user: User }).user : null)
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  const canEdit = user?.role === "manager" || user?.role === "admin";
  const selectedUnit = useMemo(() => data?.unitCosts.find((unit) => String(unit.equipmentId) === unitId) ?? null, [data, unitId]);

  useEffect(() => {
    if (!selectedUnit) {
      setFinancial({ purchaseDate: "", purchasePrice: "", inServiceDate: "", acquisitionMileage: "", expectedResidualValue: "", retiredDate: "" });
      return;
    }
    setFinancial({
      purchaseDate: selectedUnit.purchaseDate,
      purchasePrice: selectedUnit.purchasePrice == null ? "" : String(selectedUnit.purchasePrice),
      inServiceDate: selectedUnit.inServiceDate,
      acquisitionMileage: selectedUnit.acquisitionMileage == null ? "" : String(selectedUnit.acquisitionMileage),
      expectedResidualValue: selectedUnit.expectedResidualValue == null ? "" : String(selectedUnit.expectedResidualValue),
      retiredDate: selectedUnit.retiredDate,
    });
  }, [selectedUnit?.equipmentId, data?.updatedAt]);

  const selectedRepair = useMemo(() => data?.repairHistory.find((repair) => String(repair.id) === repairId) ?? null, [data, repairId]);
  useEffect(() => {
    if (!selectedRepair) {
      setRepairCost({ laborHours: "", laborRate: "", outsideCost: "" });
      return;
    }
    setRepairCost({
      laborHours: selectedRepair.laborHours ? String(selectedRepair.laborHours) : "",
      laborRate: selectedRepair.laborRate ? String(selectedRepair.laborRate) : "",
      outsideCost: selectedRepair.outsideCost ? String(selectedRepair.outsideCost) : "",
    });
  }, [selectedRepair?.id, data?.updatedAt]);

  async function post(body: Record<string, unknown>, success: string) {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The report data could not be updated.");
      await load(year);
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The report data could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const visibleUnits = useMemo(() => (data?.unitCosts ?? []).filter((unit) => {
    if (unitId !== "all" && String(unit.equipmentId) !== unitId) return false;
    if (!needle) return true;
    return [unit.unit, unit.category, unit.make, unit.model, unit.modelYear].join(" ").toLowerCase().includes(needle);
  }), [data, needle, unitId]);

  const visibleRepairs = useMemo(() => (data?.repairHistory ?? []).filter((repair) => {
    if (unitId !== "all") return String(repair.equipmentId) === unitId && (!needle || [repair.unit, repair.title, repair.technician, repair.status].join(" ").toLowerCase().includes(needle));
    return repair.year === data?.selectedYear && (!needle || [repair.unit, repair.title, repair.technician, repair.status].join(" ").toLowerCase().includes(needle));
  }), [data, needle, unitId]);

  const visibleMaintenance = useMemo(() => (data?.maintenanceHistory ?? []).filter((event) => {
    if (unitId !== "all") return String(event.equipmentId) === unitId;
    return event.year === data?.selectedYear;
  }), [data, unitId]);

  const visibleExpenses = useMemo(() => (data?.expenses ?? []).filter((item) => {
    if (unitId !== "all") return String(item.equipmentId) === unitId;
    return item.year === data?.selectedYear;
  }), [data, unitId]);

  const visibleParts = useMemo(() => (data?.partsUsage ?? []).filter((part) => unitId === "all" || (selectedUnit ? part.units.includes(selectedUnit.unit) : true)), [data, selectedUnit, unitId]);
  const maxCategoryCost = Math.max(1, ...(data?.categoryCosts ?? []).map((item) => item.totalCost));

  if (!data && loading) return <main style={{ minHeight: "100vh", padding: 36, background: "#f3f5f7" }}>Loading reports…</main>;
  if (!data) return <main style={{ minHeight: "100vh", padding: 36, background: "#f3f5f7" }}>{message || "Reports are unavailable."}</main>;

  return (
    <main style={{ minHeight: "100vh", background: "#f3f5f7", color: "#172033", padding: "34px 34px 110px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 18, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#6d28d9", fontWeight: 900, letterSpacing: ".14em", fontSize: 12 }}>FLEET INTELLIGENCE</p>
          <h1 style={{ margin: "7px 0 0", fontSize: 34 }}>Reporting & Cost Analysis</h1>
          <p style={{ margin: "8px 0 0", color: "#64748b", maxWidth: 820 }}>Repair history, parts and labor cost, unit-by-unit yearly and lifetime cost, ownership expenses, PM/annual history, common failures, technician workload, and CSV exports.</p>
        </div>
        <button style={buttonStyle} onClick={() => void load(year)} disabled={loading}>{loading ? "Refreshing…" : "Refresh reports"}</button>
      </header>

      {message && <div style={{ marginTop: 16, padding: 12, border: "1px solid #f2c66d", background: "#fff8e6", borderRadius: 10 }}>{message}</div>}

      <section style={{ ...panel, marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
        <label style={{ display: "grid", gap: 5, fontWeight: 750 }}>Report year
          <select value={year} onChange={(event) => { const next = event.target.value; setYear(next); void load(next); }} style={inputStyle}>
            {data.years.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 5, fontWeight: 750 }}>Unit
          <select value={unitId} onChange={(event) => setUnitId(event.target.value)} style={inputStyle}>
            <option value="all">All units</option>
            {[...data.unitCosts].sort((a, b) => a.unit.localeCompare(b.unit, undefined, { numeric: true })).map((unit) => <option key={unit.equipmentId} value={unit.equipmentId}>{unit.unit} — {unit.category}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 5, fontWeight: 750 }}>Search reports
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Unit, repair, technician…" style={inputStyle} />
        </label>
      </section>

      <section style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
        {[
          ["OPERATING COST", money(data.summary.operatingCost), `${data.selectedYear} repairs + ownership expenses`],
          ["REPAIR COST", money(data.summary.repairSpend), `${data.summary.repairsInYear} repair records`],
          ["PARTS COST", money(data.summary.partsSpend), "Parts issued to repairs"],
          ["LABOR COST", money(data.summary.laborSpend), "Entered labor hours × rate"],
          ["OUTSIDE REPAIR", money(data.summary.outsideRepairSpend), "Vendor / outside shop charges"],
          ["OTHER OWNERSHIP", money(data.summary.ownershipExpenseSpend), "Fuel, insurance, fees, etc."],
          ["AVG REPAIR", money(data.summary.averageRepairCost), "Average recorded repair cost"],
          ["LIFETIME RECORDED", money(data.summary.fleetLifetimeOwnershipCost), "Purchase + recorded operating cost"],
        ].map(([label, value, note]) => (
          <article key={label} style={panel}>
            <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: ".11em", color: "#64748b" }}>{label}</span>
            <strong style={{ display: "block", marginTop: 8, fontSize: 23 }}>{value}</strong>
            <small style={{ color: "#64748b" }}>{note}</small>
          </article>
        ))}
      </section>

      <Section title="Data coverage" subtitle="These indicators show which costs are real historical entries and which categories still need data.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
          <div><strong>{pct(data.dataQuality.unitsWithPurchasePrice, data.dataQuality.totalUnits)}%</strong><div style={{ color: "#64748b" }}>units with purchase price ({data.dataQuality.unitsWithPurchasePrice}/{data.dataQuality.totalUnits})</div></div>
          <div><strong>{pct(data.dataQuality.repairsWithLaborEntry, data.dataQuality.totalRepairs)}%</strong><div style={{ color: "#64748b" }}>repairs with labor entered ({data.dataQuality.repairsWithLaborEntry}/{data.dataQuality.totalRepairs})</div></div>
          <div><strong>{pct(data.dataQuality.snapshotPartLines, data.dataQuality.totalPartLines)}%</strong><div style={{ color: "#64748b" }}>part lines with historical cost snapshot</div></div>
          <div><strong>{data.dataQuality.ownershipExpenseEntries}</strong><div style={{ color: "#64748b" }}>ownership expense ledger entries</div></div>
        </div>
      </Section>

      <Section
        title={`Unit Cost Analysis — ${data.selectedYear}`}
        subtitle="Year cost separates parts, labor/outside charges and other ownership expenses. Lifetime ownership adds purchase price when it has been entered."
        action={<button style={buttonStyle} onClick={() => downloadCsv(`unit-cost-${data.selectedYear}.csv`, visibleUnits.map((unit) => ({ Unit: unit.unit, Category: unit.category, RepairCost: unit.yearRepairCost, OtherExpenses: unit.yearExpenseCost, YearOperatingCost: unit.yearOperatingCost, LifetimeRepairCost: unit.lifetimeRepairCost, LifetimeOtherExpenses: unit.lifetimeExpenseCost, PurchasePrice: unit.purchasePrice, LifetimeOwnershipCost: unit.lifetimeOwnershipCost, NetLifecycleCost: unit.netLifecycleCost, CostPerMile: unit.recordedCostPerMile, RepairsThisYear: unit.repairCountYear, LifetimeRepairs: unit.lifetimeRepairCount })))}>Export CSV</button>}
      >
        <TableWrap>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1450 }}>
            <thead><tr>{["Unit","Category","Year repairs","Parts","Labor","Outside","Other expenses","Year operating","Lifetime repairs","Lifetime other","Purchase","Lifetime ownership","Net lifecycle","Recorded $/mi","Repair count"].map((head) => <th key={head} style={{ textAlign: "left", padding: 9, borderBottom: "1px solid #dce2e7", fontSize: 12 }}>{head}</th>)}</tr></thead>
            <tbody>{visibleUnits.map((unit) => <tr key={unit.equipmentId}>
              <td style={{ padding: 9, borderBottom: "1px solid #eef2f5", fontWeight: 850 }}>{unit.unit}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{unit.category}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{unit.repairCountYear}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{money(unit.yearPartsCost)}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{money(unit.yearLaborCost)}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{money(unit.yearOutsideCost)}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{money(unit.yearExpenseCost)}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #eef2f5", fontWeight: 800 }}>{money(unit.yearOperatingCost)}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{money(unit.lifetimeRepairCost)}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{money(unit.lifetimeExpenseCost)}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{money(unit.purchasePrice)}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #eef2f5", fontWeight: 800 }}>{money(unit.lifetimeOwnershipCost)}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{unit.purchasePrice == null ? "Need purchase price" : money(unit.netLifecycleCost)}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{money(unit.recordedCostPerMile)}</td>
              <td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{unit.repairCountYear} / {unit.lifetimeRepairCount} life</td>
            </tr>)}</tbody>
          </table>
        </TableWrap>
      </Section>

      <section style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(380px,1fr))", gap: 18 }}>
        <div style={panel}>
          <h2 style={{ margin: 0, fontSize: 21 }}>Cost by Category — {data.selectedYear}</h2>
          <p style={{ color: "#64748b", fontSize: 13 }}>Compare tractors, shuttle trucks, trailers and the rest of the fleet.</p>
          <div style={{ display: "grid", gap: 12 }}>
            {data.categoryCosts.map((item) => <div key={item.category}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><strong>{item.category}</strong><span>{money(item.totalCost)}</span></div>
              <div style={{ height: 9, background: "#eef2f5", borderRadius: 999, overflow: "hidden", marginTop: 5 }}><div style={{ width: `${Math.max(2, (item.totalCost / maxCategoryCost) * 100)}%`, height: "100%", background: "#6d28d9" }} /></div>
              <small style={{ color: "#64748b" }}>{item.units} units · repairs {money(item.repairCost)} · other {money(item.expenseCost)}</small>
            </div>)}
          </div>
        </div>
        <div style={panel}>
          <h2 style={{ margin: 0, fontSize: 21 }}>Year-over-Year Fleet Cost</h2>
          <p style={{ color: "#64748b", fontSize: 13 }}>Recorded repair and ownership spending by calendar year.</p>
          <TableWrap><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["Year","Repairs","Repair cost","Other expenses","Purchases","Total"].map((head) => <th key={head} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #dce2e7" }}>{head}</th>)}</tr></thead><tbody>{[...data.yearlyTrend].reverse().map((item) => <tr key={item.year}><td style={{ padding: 8 }}>{item.year}</td><td style={{ padding: 8 }}>{item.repairCount}</td><td style={{ padding: 8 }}>{money(item.repairCost)}</td><td style={{ padding: 8 }}>{money(item.expenseCost)}</td><td style={{ padding: 8 }}>{money(item.purchaseCost)}</td><td style={{ padding: 8, fontWeight: 800 }}>{money(item.totalCost)}</td></tr>)}</tbody></table></TableWrap>
        </div>
      </section>

      <Section
        title={unitId === "all" ? `Repair History — ${data.selectedYear}` : `Lifetime Repair History — ${selectedUnit?.unit ?? "Unit"}`}
        subtitle="Parts are costed from the historical repair-part snapshot when available; labor and outside charges can be entered below."
        action={<button style={buttonStyle} onClick={() => downloadCsv(`repair-history-${unitId === "all" ? data.selectedYear : selectedUnit?.unit ?? "unit"}.csv`, visibleRepairs.map((repair) => ({ Date: repair.openedAt.slice(0,10), Unit: repair.unit, Repair: repair.title, Status: repair.status, Technician: repair.technician, PartsCost: repair.partsCost, LaborHours: repair.laborHours, LaborRate: repair.laborRate, LaborCost: repair.laborCost, OutsideCost: repair.outsideCost, TotalCost: repair.totalCost, RepairCycleHours: repair.repairCycleHours })))}>Export CSV</button>}
      >
        <TableWrap><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1250 }}><thead><tr>{["Date","Unit","Repair","Status","Technician","Parts","Labor","Outside","Total","Cycle hours"].map((head) => <th key={head} style={{ textAlign: "left", padding: 9, borderBottom: "1px solid #dce2e7" }}>{head}</th>)}</tr></thead><tbody>{visibleRepairs.map((repair) => <tr key={repair.id}><td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{shortDate(repair.openedAt)}</td><td style={{ padding: 9, fontWeight: 850, borderBottom: "1px solid #eef2f5" }}>{repair.unit}</td><td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{repair.title}</td><td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{repair.status}</td><td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{repair.technician}</td><td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{money(repair.partsCost)}</td><td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{money(repair.laborCost)}</td><td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{money(repair.outsideCost)}</td><td style={{ padding: 9, fontWeight: 850, borderBottom: "1px solid #eef2f5" }}>{money(repair.totalCost)}</td><td style={{ padding: 9, borderBottom: "1px solid #eef2f5" }}>{num(repair.repairCycleHours, 1)}</td></tr>)}</tbody></table></TableWrap>
      </Section>

      <section style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(420px,1fr))", gap: 18 }}>
        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><h2 style={{ margin: 0, fontSize: 21 }}>Parts Usage — {data.selectedYear}</h2><button style={buttonStyle} onClick={() => downloadCsv(`parts-usage-${data.selectedYear}.csv`, visibleParts.map((part) => ({ PartNumber: part.partNumber, Description: part.description, Quantity: part.quantity, Repairs: part.repairCount, Units: part.unitCount, Cost: part.cost })))}>Export CSV</button></div>
          <TableWrap><table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}><thead><tr>{["Part","Description","Qty","Repairs","Units","Cost"].map((head) => <th key={head} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #dce2e7" }}>{head}</th>)}</tr></thead><tbody>{visibleParts.slice(0, 100).map((part) => <tr key={part.partNumber}><td style={{ padding: 8, fontWeight: 800 }}>{part.partNumber}</td><td style={{ padding: 8 }}>{part.description}</td><td style={{ padding: 8 }}>{num(part.quantity, 2)}</td><td style={{ padding: 8 }}>{part.repairCount}</td><td style={{ padding: 8 }}>{part.unitCount}</td><td style={{ padding: 8 }}>{money(part.cost)}</td></tr>)}</tbody></table></TableWrap>
        </div>
        <div style={panel}>
          <h2 style={{ margin: 0, fontSize: 21 }}>Common Repairs / Failure Analysis</h2>
          <p style={{ color: "#64748b", fontSize: 13 }}>Which repair descriptions occur most often and cost the most in {data.selectedYear}.</p>
          <TableWrap><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["Repair / issue","Count","Units","Total cost","Avg cost"].map((head) => <th key={head} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #dce2e7" }}>{head}</th>)}</tr></thead><tbody>{data.issueAnalysis.slice(0, 75).map((item) => <tr key={item.issue}><td style={{ padding: 8 }}>{item.issue}</td><td style={{ padding: 8 }}>{item.repairCount}</td><td style={{ padding: 8 }}>{item.unitCount}</td><td style={{ padding: 8 }}>{money(item.totalCost)}</td><td style={{ padding: 8 }}>{money(item.averageCost)}</td></tr>)}</tbody></table></TableWrap>
        </div>
      </section>

      <section style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(420px,1fr))", gap: 18 }}>
        <div style={panel}>
          <h2 style={{ margin: 0, fontSize: 21 }}>Technician / Workload Report</h2>
          <p style={{ color: "#64748b", fontSize: 13 }}>Repair counts, completed work and average repair-cycle time.</p>
          <TableWrap><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["Technician","Repairs","Completed","Repair cost","Avg cycle hrs"].map((head) => <th key={head} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #dce2e7" }}>{head}</th>)}</tr></thead><tbody>{data.technicianAnalysis.map((item) => <tr key={item.technician}><td style={{ padding: 8 }}>{item.technician}</td><td style={{ padding: 8 }}>{item.repairCount}</td><td style={{ padding: 8 }}>{item.completedCount}</td><td style={{ padding: 8 }}>{money(item.totalCost)}</td><td style={{ padding: 8 }}>{num(item.averageRepairCycleHours, 1)}</td></tr>)}</tbody></table></TableWrap>
        </div>
        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><h2 style={{ margin: 0, fontSize: 21 }}>PM & Annual History</h2><button style={buttonStyle} onClick={() => downloadCsv(`maintenance-history-${unitId === "all" ? data.selectedYear : selectedUnit?.unit ?? "unit"}.csv`, visibleMaintenance.map((event) => ({ Date: event.eventDate, Unit: event.unit, Type: event.eventType, PMType: event.pmType, Mileage: event.mileage, Source: event.source, Notes: event.notes })))}>Export CSV</button></div>
          <TableWrap><table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}><thead><tr>{["Date","Unit","Type","PM","Mileage","Source"].map((head) => <th key={head} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #dce2e7" }}>{head}</th>)}</tr></thead><tbody>{visibleMaintenance.slice(0, 150).map((event) => <tr key={event.id}><td style={{ padding: 8 }}>{shortDate(event.eventDate)}</td><td style={{ padding: 8, fontWeight: 800 }}>{event.unit}</td><td style={{ padding: 8 }}>{event.eventType}</td><td style={{ padding: 8 }}>{event.pmType || "—"}</td><td style={{ padding: 8 }}>{num(event.mileage)}</td><td style={{ padding: 8 }}>{event.source}</td></tr>)}</tbody></table></TableWrap>
        </div>
      </section>

      <Section
        title="Ownership Expense Ledger"
        subtitle="Use this for fuel, insurance, registration, lease payments, towing, taxes and other unit-specific costs that are not already attached to a repair."
        action={<button style={buttonStyle} onClick={() => downloadCsv(`ownership-expenses-${unitId === "all" ? data.selectedYear : selectedUnit?.unit ?? "unit"}.csv`, visibleExpenses.map((item) => ({ Date: item.expenseDate, Unit: item.unit, Category: item.category, Vendor: item.vendor, Description: item.description, Amount: item.amount })))}>Export CSV</button>}
      >
        <TableWrap><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["Date","Unit","Category","Vendor","Description","Amount"].map((head) => <th key={head} style={{ textAlign: "left", padding: 9, borderBottom: "1px solid #dce2e7" }}>{head}</th>)}</tr></thead><tbody>{visibleExpenses.map((item) => <tr key={item.id}><td style={{ padding: 9 }}>{shortDate(item.expenseDate)}</td><td style={{ padding: 9, fontWeight: 800 }}>{item.unit}</td><td style={{ padding: 9 }}>{item.category}</td><td style={{ padding: 9 }}>{item.vendor || "—"}</td><td style={{ padding: 9 }}>{item.description || "—"}</td><td style={{ padding: 9 }}>{money(item.amount)}</td></tr>)}</tbody></table></TableWrap>
      </Section>

      {canEdit && (
        <Section title="Cost Data Entry" subtitle="Managers/admins can fill missing financial information here. These entries immediately feed the reports above.">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(330px,1fr))", gap: 16 }}>
            <form style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, display: "grid", gap: 10 }} onSubmit={(event) => { event.preventDefault(); if (!selectedUnit) return setMessage("Choose a unit first."); void post({ action: "saveUnitFinancials", equipmentId: selectedUnit.equipmentId, ...financial }, `Ownership information saved for ${selectedUnit.unit}.`); }}>
              <strong>Unit ownership information</strong>
              <small style={{ color: "#64748b" }}>Choose a specific unit in the filter above, then enter purchase and mileage baseline information.</small>
              <input type="date" aria-label="Purchase date" value={financial.purchaseDate} onChange={(event) => setFinancial({ ...financial, purchaseDate: event.target.value })} style={inputStyle} disabled={!selectedUnit} />
              <input type="number" min="0" step="0.01" placeholder="Purchase price" value={financial.purchasePrice} onChange={(event) => setFinancial({ ...financial, purchasePrice: event.target.value })} style={inputStyle} disabled={!selectedUnit} />
              <input type="date" aria-label="In-service date" value={financial.inServiceDate} onChange={(event) => setFinancial({ ...financial, inServiceDate: event.target.value })} style={inputStyle} disabled={!selectedUnit} />
              <input type="number" min="0" step="1" placeholder="Mileage when acquired" value={financial.acquisitionMileage} onChange={(event) => setFinancial({ ...financial, acquisitionMileage: event.target.value })} style={inputStyle} disabled={!selectedUnit} />
              <input type="number" min="0" step="0.01" placeholder="Expected residual / resale value" value={financial.expectedResidualValue} onChange={(event) => setFinancial({ ...financial, expectedResidualValue: event.target.value })} style={inputStyle} disabled={!selectedUnit} />
              <input type="date" aria-label="Retired date" value={financial.retiredDate} onChange={(event) => setFinancial({ ...financial, retiredDate: event.target.value })} style={inputStyle} disabled={!selectedUnit} />
              <button style={buttonStyle} disabled={!selectedUnit || saving}>{saving ? "Saving…" : "Save unit financials"}</button>
            </form>

            <form style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, display: "grid", gap: 10 }} onSubmit={(event) => { event.preventDefault(); if (!selectedUnit) return setMessage("Choose a unit first."); void post({ action: "addExpense", equipmentId: selectedUnit.equipmentId, ...expense }, `Expense added to ${selectedUnit.unit}.`); }}>
              <strong>Add ownership / operating expense</strong>
              <small style={{ color: "#64748b" }}>For costs that are not already captured by repair parts, labor or outside repair charge.</small>
              <input type="date" value={expense.expenseDate} onChange={(event) => setExpense({ ...expense, expenseDate: event.target.value })} style={inputStyle} disabled={!selectedUnit} />
              <select value={expense.category} onChange={(event) => setExpense({ ...expense, category: event.target.value })} style={inputStyle} disabled={!selectedUnit}>{data.expenseCategories.map((item) => <option key={item}>{item}</option>)}</select>
              <input type="number" min="0.01" step="0.01" placeholder="Amount" value={expense.amount} onChange={(event) => setExpense({ ...expense, amount: event.target.value })} style={inputStyle} disabled={!selectedUnit} />
              <input placeholder="Vendor / payee" value={expense.vendor} onChange={(event) => setExpense({ ...expense, vendor: event.target.value })} style={inputStyle} disabled={!selectedUnit} />
              <input placeholder="Description" value={expense.description} onChange={(event) => setExpense({ ...expense, description: event.target.value })} style={inputStyle} disabled={!selectedUnit} />
              <button style={buttonStyle} disabled={!selectedUnit || saving}>{saving ? "Saving…" : "Add expense"}</button>
            </form>

            <form style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, display: "grid", gap: 10 }} onSubmit={(event) => { event.preventDefault(); if (!selectedRepair) return setMessage("Choose a repair first."); void post({ action: "saveRepairCost", repairId: selectedRepair.id, ...repairCost }, `Labor / outside cost saved for repair ${selectedRepair.id}.`); }}>
              <strong>Add labor / outside cost to repair</strong>
              <select value={repairId} onChange={(event) => setRepairId(event.target.value)} style={inputStyle}>
                <option value="">Choose repair</option>
                {data.repairHistory.filter((repair) => unitId === "all" || String(repair.equipmentId) === unitId).slice(0, 300).map((repair) => <option key={repair.id} value={repair.id}>{repair.unit} · {repair.openedAt.slice(0,10)} · {repair.title}</option>)}
              </select>
              <input type="number" min="0" step="0.01" placeholder="Labor hours" value={repairCost.laborHours} onChange={(event) => setRepairCost({ ...repairCost, laborHours: event.target.value })} style={inputStyle} disabled={!selectedRepair} />
              <input type="number" min="0" step="0.01" placeholder="Hourly labor rate" value={repairCost.laborRate} onChange={(event) => setRepairCost({ ...repairCost, laborRate: event.target.value })} style={inputStyle} disabled={!selectedRepair} />
              <input type="number" min="0" step="0.01" placeholder="Outside/vendor repair cost" value={repairCost.outsideCost} onChange={(event) => setRepairCost({ ...repairCost, outsideCost: event.target.value })} style={inputStyle} disabled={!selectedRepair} />
              <button style={buttonStyle} disabled={!selectedRepair || saving}>{saving ? "Saving…" : "Save repair cost"}</button>
            </form>
          </div>
        </Section>
      )}

      <div style={{ marginTop: 18, color: "#64748b", fontSize: 12 }}>
        Lifetime ownership cost = recorded purchase price + repair cost + ownership expense ledger. Net lifecycle subtracts the expected residual value. Fuel/insurance/lease/etc. are only included after they are entered or imported into the expense ledger.
      </div>
    </main>
  );
}
