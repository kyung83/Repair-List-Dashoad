"use client";

import { useEffect, useMemo, useState } from "react";
import ModuleTabs from "../../module-tabs";

type Filters = {
  start: string;
  end: string;
  unit: string;
  category: string;
  equipmentType: string;
  make: string;
  model: string;
  repairStatus: string;
  technician: string;
  repairSource: string;
  repairLocation: string;
  maintenanceType: string;
  pmType: string;
  maintenanceSource: string;
  expenseCategory: string;
  expenseSource: string;
  q: string;
};

type Data = {
  range: { startDate: string; endDate: string };
  summary: {
    unitsInScope: number;
    repairCount: number;
    currentRepairCount: number;
    historicalRepairCount: number;
    partsCost: number;
    laborCost: number;
    outsideCost: number;
    repairCost: number;
    maintenanceEvents: number;
    expenseCount: number;
    expenseCost: number;
    operatingCost: number;
  };
  equipment: Array<{ id: number; unit: string; category: string; equipmentType: string; modelYear: number | null; make: string; model: string }>;
  repairs: Array<{ id: number; kind: string; equipmentId: number | null; unit: string; category: string; equipmentType: string; modelYear: number | null; make: string; model: string; date: string; repair: string; status: string; technician: string; source: string; location: string; partsCost: number; laborHours: number; laborCost: number; outsideCost: number; totalCost: number }>;
  maintenance: Array<{ id: number; equipmentId: number; unit: string; date: string; type: string; pmType: string; mileage: number | null; source: string; notes: string }>;
  expenses: Array<{ id: number; equipmentId: number; unit: string; date: string; category: string; amount: number; vendor: string; description: string; source: string }>;
  parts: Array<{ partNumber: string; description: string; quantity: number; repairCount: number; unitCount: number; cost: number }>;
  truncated: { repairs: boolean; maintenance: boolean; expenses: boolean };
  filterOptions: {
    categories: string[];
    equipmentTypes: string[];
    makes: string[];
    models: string[];
    repairStatuses: string[];
    technicians: string[];
    repairSources: string[];
    repairLocations: string[];
    maintenanceTypes: string[];
    pmTypes: string[];
    maintenanceSources: string[];
    expenseCategories: string[];
    expenseSources: string[];
  };
  updatedAt: string;
};

const panel = { background: "white", border: "1px solid #dce2e7", borderRadius: 14, padding: 18 } as const;
const input = { width: "100%", boxSizing: "border-box", padding: "10px 11px", border: "1px solid #cbd5e1", borderRadius: 8, background: "white" } as const;
const button = { padding: "10px 14px", border: 0, borderRadius: 8, background: "#0d1b2b", color: "white", fontWeight: 850, cursor: "pointer" } as const;
const lightButton = { ...button, background: "#e8edf2", color: "#172033" } as const;
const label = { display: "grid", gap: 5, fontWeight: 750, fontSize: 13 } as const;
const th = { textAlign: "left", padding: 8, borderBottom: "1px solid #dce2e7", whiteSpace: "nowrap", fontSize: 12 } as const;
const td = { padding: 8, borderBottom: "1px solid #eef2f5", verticalAlign: "top" } as const;

function ymd(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function rangeFor(preset: string) {
  const todayDate = new Date();
  const today = ymd(todayDate);
  const year = todayDate.getFullYear();
  if (preset === "today") return { start: today, end: today };
  if (preset === "yesterday") { const value = ymd(addDays(todayDate, -1)); return { start: value, end: value }; }
  if (preset === "this_week") return { start: ymd(addDays(todayDate, -todayDate.getDay())), end: today };
  if (preset === "last_7") return { start: ymd(addDays(todayDate, -6)), end: today };
  if (preset === "this_month") return { start: ymd(new Date(year, todayDate.getMonth(), 1)), end: today };
  if (preset === "last_30") return { start: ymd(addDays(todayDate, -29)), end: today };
  if (preset === "last_90") return { start: ymd(addDays(todayDate, -89)), end: today };
  if (preset === "this_quarter") { const month = Math.floor(todayDate.getMonth() / 3) * 3; return { start: ymd(new Date(year, month, 1)), end: today }; }
  if (preset === "ytd") return { start: `${year}-01-01`, end: today };
  if (preset === "this_year") return { start: `${year}-01-01`, end: `${year}-12-31` };
  if (preset === "last_year") return { start: `${year - 1}-01-01`, end: `${year - 1}-12-31` };
  if (preset === "all") return { start: "1900-01-01", end: today };
  return { start: `${year}-01-01`, end: today };
}

function money(value: number) {
  return Number(value || 0).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function num(value: number | null | undefined, digits = 0) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const content = [headers.map(csvCell).join(","), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function SelectFilter({ title, value, values, onChange }: { title: string; value: string; values: string[]; onChange: (value: string) => void }) {
  return <label style={label}>{title}<select style={input} value={value} onChange={(event) => onChange(event.target.value)}><option value="">All</option>{values.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>;
}

const initialRange = rangeFor("ytd");
const blankFilters: Filters = {
  start: initialRange.start,
  end: initialRange.end,
  unit: "",
  category: "",
  equipmentType: "",
  make: "",
  model: "",
  repairStatus: "",
  technician: "",
  repairSource: "",
  repairLocation: "",
  maintenanceType: "",
  pmType: "",
  maintenanceSource: "",
  expenseCategory: "",
  expenseSource: "",
  q: "",
};

export default function ReportSearchPage() {
  const [data, setData] = useState<Data | null>(null);
  const [filters, setFilters] = useState<Filters>(blankFilters);
  const [preset, setPreset] = useState("ytd");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load(next = filters) {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ start: next.start, end: next.end });
      const pairs: Array<[string, string]> = [
        ["unit", next.unit], ["category", next.category], ["equipmentType", next.equipmentType], ["make", next.make], ["model", next.model],
        ["repairStatus", next.repairStatus], ["technician", next.technician], ["repairSource", next.repairSource], ["repairLocation", next.repairLocation],
        ["maintenanceType", next.maintenanceType], ["pmType", next.pmType], ["maintenanceSource", next.maintenanceSource],
        ["expenseCategory", next.expenseCategory], ["expenseSource", next.expenseSource], ["q", next.q],
      ];
      for (const [key, value] of pairs) if (value) params.set(key, value);
      const response = await fetch(`/api/reports/search?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Report search could not be loaded.");
      setData(payload);
      setFilters((current) => ({ ...current, start: payload.range.startDate, end: payload.range.endDate }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Report search could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(blankFilters); }, []);

  const modelOptions = useMemo(() => {
    if (!data) return [];
    const rows = data.equipment.filter((row) => (!filters.make || row.make === filters.make) && (!filters.equipmentType || row.equipmentType === filters.equipmentType));
    return [...new Set(rows.map((row) => row.model).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [data, filters.make, filters.equipmentType]);

  const unitOptions = useMemo(() => {
    if (!data) return [];
    return data.equipment.filter((row) => (!filters.category || row.category === filters.category) && (!filters.equipmentType || row.equipmentType === filters.equipmentType) && (!filters.make || row.make === filters.make) && (!filters.model || row.model === filters.model));
  }, [data, filters.category, filters.equipmentType, filters.make, filters.model]);

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function applyPreset(value: string) {
    setPreset(value);
    if (value === "custom") return;
    const range = rangeFor(value);
    const next = { ...filters, ...range };
    setFilters(next);
    void load(next);
  }

  function clearAll() {
    const range = rangeFor("ytd");
    const next = { ...blankFilters, ...range };
    setPreset("ytd");
    setFilters(next);
    void load(next);
  }

  if (!data && loading) return <main style={{ minHeight: "100vh", padding: 36, background: "#f3f5f7" }}>Loading report search…</main>;
  if (!data) return <main style={{ minHeight: "100vh", padding: 36, background: "#f3f5f7" }}>{message || "Report search is unavailable."}</main>;

  const rangeSlug = `${data.range.startDate}-to-${data.range.endDate}`;
  const anyTruncated = data.truncated.repairs || data.truncated.maintenance || data.truncated.expenses;

  return (
    <main style={{ minHeight: "100vh", background: "#f3f5f7", color: "#172033", padding: "34px 34px 110px" }}>
      <ModuleTabs module="reports" />
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#6d28d9", fontWeight: 900, letterSpacing: ".14em", fontSize: 12 }}>REPORT SEARCH</p>
          <h1 style={{ margin: "7px 0 0", fontSize: 34 }}>Search Every Report Range</h1>
          <p style={{ margin: "8px 0 0", color: "#64748b", maxWidth: 900 }}>Choose any date range, then drill into units, equipment, repairs, technicians, sources, locations, PM/annual records, expenses and parts usage.</p>
        </div>
        <button style={button} onClick={() => void load()} disabled={loading}>{loading ? "Running…" : "Run Report"}</button>
      </header>

      {message && <div style={{ ...panel, marginTop: 16, borderColor: "#f2c66d", background: "#fff8e6" }}>{message}</div>}

      <section style={{ ...panel, marginTop: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(185px,1fr))", gap: 10 }}>
          <label style={label}>Date preset
            <select style={input} value={preset} onChange={(event) => applyPreset(event.target.value)}>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="this_week">This week</option>
              <option value="last_7">Last 7 days</option>
              <option value="this_month">This month</option>
              <option value="last_30">Last 30 days</option>
              <option value="last_90">Last 90 days</option>
              <option value="this_quarter">This quarter</option>
              <option value="ytd">Year to date</option>
              <option value="this_year">This calendar year</option>
              <option value="last_year">Last calendar year</option>
              <option value="all">All history</option>
              <option value="custom">Custom dates</option>
            </select>
          </label>
          <label style={label}>Start date<input type="date" style={input} value={filters.start} onChange={(event) => { setPreset("custom"); set("start", event.target.value); }} /></label>
          <label style={label}>End date<input type="date" style={input} value={filters.end} onChange={(event) => { setPreset("custom"); set("end", event.target.value); }} /></label>
          <label style={label}>Unit<select style={input} value={filters.unit} onChange={(event) => set("unit", event.target.value)}><option value="">All units</option>{unitOptions.map((row) => <option key={row.id} value={row.id}>{row.unit} — {row.category}</option>)}</select></label>
          <SelectFilter title="Fleet category" value={filters.category} values={data.filterOptions.categories} onChange={(value) => { set("category", value); set("unit", ""); }} />
          <SelectFilter title="Equipment type" value={filters.equipmentType} values={data.filterOptions.equipmentTypes} onChange={(value) => { set("equipmentType", value); set("unit", ""); }} />
          <SelectFilter title="Make" value={filters.make} values={data.filterOptions.makes} onChange={(value) => { set("make", value); set("model", ""); set("unit", ""); }} />
          <SelectFilter title="Model" value={filters.model} values={modelOptions} onChange={(value) => { set("model", value); set("unit", ""); }} />
        </div>

        <details style={{ marginTop: 14 }} open>
          <summary style={{ fontWeight: 850, cursor: "pointer" }}>Repair filters</summary>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(185px,1fr))", gap: 10, marginTop: 10 }}>
            <SelectFilter title="Repair status" value={filters.repairStatus} values={data.filterOptions.repairStatuses} onChange={(value) => set("repairStatus", value)} />
            <SelectFilter title="Technician" value={filters.technician} values={data.filterOptions.technicians} onChange={(value) => set("technician", value)} />
            <SelectFilter title="Repair source" value={filters.repairSource} values={data.filterOptions.repairSources} onChange={(value) => set("repairSource", value)} />
            <SelectFilter title="Repair location" value={filters.repairLocation} values={data.filterOptions.repairLocations} onChange={(value) => set("repairLocation", value)} />
          </div>
        </details>

        <details style={{ marginTop: 14 }}>
          <summary style={{ fontWeight: 850, cursor: "pointer" }}>PM / annual filters</summary>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(185px,1fr))", gap: 10, marginTop: 10 }}>
            <SelectFilter title="Maintenance type" value={filters.maintenanceType} values={data.filterOptions.maintenanceTypes} onChange={(value) => set("maintenanceType", value)} />
            <SelectFilter title="PM type" value={filters.pmType} values={data.filterOptions.pmTypes} onChange={(value) => set("pmType", value)} />
            <SelectFilter title="Maintenance source" value={filters.maintenanceSource} values={data.filterOptions.maintenanceSources} onChange={(value) => set("maintenanceSource", value)} />
          </div>
        </details>

        <details style={{ marginTop: 14 }}>
          <summary style={{ fontWeight: 850, cursor: "pointer" }}>Expense filters</summary>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(185px,1fr))", gap: 10, marginTop: 10 }}>
            <SelectFilter title="Expense category" value={filters.expenseCategory} values={data.filterOptions.expenseCategories} onChange={(value) => set("expenseCategory", value)} />
            <SelectFilter title="Expense source" value={filters.expenseSource} values={data.filterOptions.expenseSources} onChange={(value) => set("expenseSource", value)} />
          </div>
        </details>

        <label style={{ ...label, marginTop: 14 }}>Search everything
          <input style={input} value={filters.q} onChange={(event) => set("q", event.target.value)} placeholder="Unit, repair, RO, source, technician, location, PM, vendor, description…" onKeyDown={(event) => { if (event.key === "Enter") void load(); }} />
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <button style={button} onClick={() => void load()} disabled={loading}>{loading ? "Running…" : "Apply All Filters"}</button>
          <button style={lightButton} onClick={clearAll} disabled={loading}>Reset</button>
          <a href="/reports/history" style={{ ...lightButton, textDecoration: "none" }}>Historical RO Category Drill-Down</a>
        </div>
      </section>

      <div style={{ marginTop: 14, color: "#64748b", fontSize: 13 }}>Showing {data.range.startDate} through {data.range.endDate}. Date and equipment filters scope every section; repair, maintenance and expense filters apply to their matching report sections.</div>

      <section style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
        {[
          ["UNITS IN SCOPE", num(data.summary.unitsInScope)],
          ["REPAIRS / ROs", num(data.summary.repairCount)],
          ["PARTS", money(data.summary.partsCost)],
          ["LABOR", money(data.summary.laborCost)],
          ["OUTSIDE / SUBLET", money(data.summary.outsideCost)],
          ["REPAIR COST", money(data.summary.repairCost)],
          ["PM / ANNUAL EVENTS", num(data.summary.maintenanceEvents)],
          ["OTHER EXPENSES", money(data.summary.expenseCost)],
          ["OPERATING COST", money(data.summary.operatingCost)],
        ].map(([name, value]) => <article key={String(name)} style={panel}><small style={{ color: "#64748b", fontWeight: 850 }}>{name}</small><strong style={{ display: "block", fontSize: 23, marginTop: 7 }}>{value}</strong></article>)}
      </section>

      {anyTruncated && <div style={{ ...panel, marginTop: 18, borderColor: "#f2c66d", background: "#fff8e6" }}>More than 5,000 rows match at least one section. Totals remain calculated across the full match; narrow the filters to inspect every individual row.</div>}

      <section style={{ ...panel, marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}><div><h2 style={{ margin: 0 }}>Repair & RO History</h2><small style={{ color: "#64748b" }}>{data.summary.currentRepairCount} software repairs + {data.summary.historicalRepairCount} imported historical ROs</small></div><button style={button} onClick={() => downloadCsv(`repairs-${rangeSlug}.csv`, data.repairs)}>Export CSV</button></div>
        <div style={{ overflowX: "auto", marginTop: 12 }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1450 }}><thead><tr>{["Date","Unit","Type","Repair / RO","Status","Technician","Source","Location","Parts","Labor","Outside","Total"].map((head) => <th key={head} style={th}>{head}</th>)}</tr></thead><tbody>{data.repairs.map((row) => <tr key={`${row.kind}-${row.id}`}><td style={td}>{row.date}</td><td style={{ ...td, fontWeight: 850 }}>{row.unit}</td><td style={td}>{row.kind}</td><td style={td}>{row.repair}</td><td style={td}>{row.status}</td><td style={td}>{row.technician}</td><td style={td}>{row.source}</td><td style={td}>{row.location || "—"}</td><td style={td}>{money(row.partsCost)}</td><td style={td}>{money(row.laborCost)}</td><td style={td}>{money(row.outsideCost)}</td><td style={{ ...td, fontWeight: 850 }}>{money(row.totalCost)}</td></tr>)}</tbody></table></div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(420px,1fr))", gap: 18, marginTop: 18 }}>
        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><h2 style={{ margin: 0 }}>PM & Annual History</h2><button style={button} onClick={() => downloadCsv(`maintenance-${rangeSlug}.csv`, data.maintenance)}>Export CSV</button></div>
          <div style={{ overflowX: "auto", marginTop: 12 }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}><thead><tr>{["Date","Unit","Type","PM","Mileage","Source","Notes"].map((head) => <th key={head} style={th}>{head}</th>)}</tr></thead><tbody>{data.maintenance.map((row) => <tr key={row.id}><td style={td}>{row.date}</td><td style={{ ...td, fontWeight: 850 }}>{row.unit}</td><td style={td}>{row.type}</td><td style={td}>{row.pmType || "—"}</td><td style={td}>{num(row.mileage)}</td><td style={td}>{row.source}</td><td style={td}>{row.notes || "—"}</td></tr>)}</tbody></table></div>
        </div>
        <div style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><h2 style={{ margin: 0 }}>Ownership / Operating Expenses</h2><button style={button} onClick={() => downloadCsv(`expenses-${rangeSlug}.csv`, data.expenses)}>Export CSV</button></div>
          <div style={{ overflowX: "auto", marginTop: 12 }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}><thead><tr>{["Date","Unit","Category","Vendor","Description","Source","Amount"].map((head) => <th key={head} style={th}>{head}</th>)}</tr></thead><tbody>{data.expenses.map((row) => <tr key={row.id}><td style={td}>{row.date}</td><td style={{ ...td, fontWeight: 850 }}>{row.unit}</td><td style={td}>{row.category}</td><td style={td}>{row.vendor || "—"}</td><td style={td}>{row.description || "—"}</td><td style={td}>{row.source}</td><td style={{ ...td, fontWeight: 850 }}>{money(row.amount)}</td></tr>)}</tbody></table></div>
        </div>
      </section>

      <section style={{ ...panel, marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}><div><h2 style={{ margin: 0 }}>Parts Usage</h2><small style={{ color: "#64748b" }}>Current software repair part lines matching the selected repair scope.</small></div><button style={button} onClick={() => downloadCsv(`parts-${rangeSlug}.csv`, data.parts)}>Export CSV</button></div>
        <div style={{ overflowX: "auto", marginTop: 12 }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}><thead><tr>{["Part","Description","Qty","Repairs","Units","Cost"].map((head) => <th key={head} style={th}>{head}</th>)}</tr></thead><tbody>{data.parts.map((row) => <tr key={row.partNumber}><td style={{ ...td, fontWeight: 850 }}>{row.partNumber}</td><td style={td}>{row.description}</td><td style={td}>{num(row.quantity, 2)}</td><td style={td}>{row.repairCount}</td><td style={td}>{row.unitCount}</td><td style={{ ...td, fontWeight: 850 }}>{money(row.cost)}</td></tr>)}</tbody></table></div>
      </section>
    </main>
  );
}
