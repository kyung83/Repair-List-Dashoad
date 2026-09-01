"use client";

import { useEffect, useMemo, useState } from "react";
import ModuleTabs from "../../module-tabs";

type BreakdownRow = {
  id: number;
  repairId: number;
  equipmentId: number;
  unit: string;
  equipmentType: string;
  driverName: string;
  category: string;
  repairNeeded: string;
  description: string;
  status: string;
  stage: number;
  serviceProvider: string;
  location: string;
  createdAt: string;
  claimedAt: string | null;
  arrivalAt: string | null;
  repairFinishedAt: string | null;
  rollingAt: string | null;
  completedAt: string | null;
  partsCost: number;
  laborCost: number;
  outsideCost: number;
  totalCost: number;
  claimMinutes: number | null;
  arrivalMinutes: number | null;
  repairMinutes: number | null;
  downtimeMinutes: number | null;
};

type GroupRow = { label: string; breakdownCount: number; totalCost: number; averageCost: number; averageArrivalMinutes: number | null; averageDowntimeMinutes: number | null };
type Data = {
  range: { startDate: string; endDate: string };
  summary: {
    breakdownCount: number;
    completedCount: number;
    openCount: number;
    unitsAffected: number;
    totalCost: number;
    averageCost: number;
    averageClaimMinutes: number | null;
    averageArrivalMinutes: number | null;
    averageRepairMinutes: number | null;
    averageDowntimeMinutes: number | null;
    totalDowntimeHours: number;
  };
  breakdowns: BreakdownRow[];
  byUnit: Array<{ equipmentId: number; unit: string; breakdownCount: number; totalCost: number; averageCost: number; downtimeHours: number }>;
  byCategory: GroupRow[];
  byProvider: GroupRow[];
  byLocation: GroupRow[];
  monthlyTrend: Array<GroupRow & { month: string }>;
  filterOptions: { equipment: Array<{ id: number; unit: string }>; categories: string[]; providers: string[]; statuses: string[]; locations: string[] };
  truncated: boolean;
  updatedAt: string;
};

type Filters = { start: string; end: string; unit: string; category: string; provider: string; status: string; location: string; q: string };
type SortKey = "createdAt" | "unit" | "category" | "serviceProvider" | "location" | "status" | "arrivalMinutes" | "downtimeMinutes" | "totalCost";

const panel = { background: "white", border: "1px solid #dce2e7", borderRadius: 14, padding: 18 } as const;
const input = { width: "100%", boxSizing: "border-box", padding: "10px 11px", border: "1px solid #cbd5e1", borderRadius: 8, background: "white" } as const;
const button = { padding: "10px 14px", border: 0, borderRadius: 8, background: "#0d1b2b", color: "white", fontWeight: 850, cursor: "pointer" } as const;
const lightButton = { ...button, background: "#e8edf2", color: "#172033" } as const;
const label = { display: "grid", gap: 5, fontWeight: 750, fontSize: 13 } as const;
const th = { textAlign: "left", padding: 8, borderBottom: "1px solid #dce2e7", whiteSpace: "nowrap", fontSize: 12 } as const;
const td = { padding: 8, borderBottom: "1px solid #eef2f5", verticalAlign: "top", fontSize: 13 } as const;

function ymd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function addDays(date: Date, days: number) { const next = new Date(date.getFullYear(), date.getMonth(), date.getDate()); next.setDate(next.getDate() + days); return next; }
function rangeFor(preset: string) {
  const now = new Date();
  const today = ymd(now);
  const year = now.getFullYear();
  if (preset === "today") return { start: today, end: today };
  if (preset === "last_7") return { start: ymd(addDays(now, -6)), end: today };
  if (preset === "this_month") return { start: ymd(new Date(year, now.getMonth(), 1)), end: today };
  if (preset === "last_30") return { start: ymd(addDays(now, -29)), end: today };
  if (preset === "last_90") return { start: ymd(addDays(now, -89)), end: today };
  if (preset === "ytd") return { start: `${year}-01-01`, end: today };
  if (preset === "last_year") return { start: `${year - 1}-01-01`, end: `${year - 1}-12-31` };
  if (preset === "all") return { start: "1900-01-01", end: today };
  return { start: `${year}-01-01`, end: today };
}
function money(value: number) { return Number(value || 0).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }); }
function num(value: number | null | undefined, digits = 0) { return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: digits }); }
function hoursFromMinutes(value: number | null | undefined) { return value == null ? "—" : `${num(value / 60, 1)} hr`; }
function shortDateTime(value: string | null) {
  if (!value) return "—";
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
function csvCell(value: unknown) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const content = [headers.map(csvCell).join(","), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

const initialRange = rangeFor("ytd");
const blank: Filters = { start: initialRange.start, end: initialRange.end, unit: "", category: "", provider: "", status: "", location: "", q: "" };

function Select({ title, value, values, onChange }: { title: string; value: string; values: string[]; onChange: (value: string) => void }) {
  return <label style={label}>{title}<select style={input} value={value} onChange={(event) => onChange(event.target.value)}><option value="">All</option>{values.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>;
}

export default function BreakdownReportsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [filters, setFilters] = useState<Filters>(blank);
  const [preset, setPreset] = useState("ytd");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  async function load(next = filters) {
    setLoading(true); setMessage("");
    try {
      const params = new URLSearchParams({ start: next.start, end: next.end });
      for (const [key, value] of Object.entries({ unit: next.unit, category: next.category, provider: next.provider, status: next.status, location: next.location, q: next.q })) if (value) params.set(key, value);
      const response = await fetch(`/api/reports/breakdowns?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Breakdown reports could not be loaded.");
      setData(payload);
      setFilters((current) => ({ ...current, start: payload.range.startDate, end: payload.range.endDate }));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Breakdown reports could not be loaded."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(blank); }, []);

  const sorted = useMemo(() => {
    const rows = [...(data?.breakdowns ?? [])];
    rows.sort((a, b) => {
      const left = a[sortKey] ?? "";
      const right = b[sortKey] ?? "";
      const result = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
      return sortDir === "asc" ? result : -result;
    });
    return rows;
  }, [data?.breakdowns, sortKey, sortDir]);

  function set<K extends keyof Filters>(key: K, value: Filters[K]) { setFilters((current) => ({ ...current, [key]: value })); }
  function applyPreset(value: string) {
    setPreset(value);
    if (value === "custom") return;
    const range = rangeFor(value); const next = { ...filters, ...range }; setFilters(next); void load(next);
  }
  function sort(key: SortKey) { if (sortKey === key) setSortDir((current) => current === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDir("asc"); } }
  function sortHead(title: string, key: SortKey) { return <button type="button" onClick={() => sort(key)} style={{ border: 0, background: "transparent", padding: 0, font: "inherit", fontWeight: 850, cursor: "pointer", whiteSpace: "nowrap" }}>{title}{sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</button>; }

  if (!data && loading) return <main style={{ minHeight: "100vh", padding: 36, background: "#f3f5f7" }}>Loading breakdown reports…</main>;
  if (!data) return <main style={{ minHeight: "100vh", padding: 36, background: "#f3f5f7" }}>{message || "Breakdown reports are unavailable."}</main>;

  const csvRows = sorted.map((row) => ({
    Breakdown: row.id, Date: row.createdAt, Unit: row.unit, Driver: row.driverName, Category: row.category, Provider: row.serviceProvider,
    Location: row.location, Status: row.status, "Arrival Minutes": row.arrivalMinutes, "Downtime Minutes": row.downtimeMinutes,
    Parts: row.partsCost, Labor: row.laborCost, Outside: row.outsideCost, Total: row.totalCost, Description: row.description,
  }));

  return (
    <main style={{ minHeight: "100vh", background: "#f3f5f7", color: "#172033", padding: "34px 34px 110px" }}>
      <ModuleTabs module="reports" />
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#b45309", fontWeight: 900, letterSpacing: ".14em", fontSize: 12 }}>BREAKDOWN REPORTS</p>
          <h1 style={{ margin: "7px 0 0", fontSize: 34 }}>Roadside Breakdown Cost & Performance</h1>
          <p style={{ margin: "8px 0 0", color: "#64748b", maxWidth: 960 }}>Breakdowns stay tied to the same repair and unit cost records used by the main Reports screens. This view isolates roadside activity for cost, frequency, provider, location and downtime analysis.</p>
        </div>
        <button style={button} onClick={() => downloadCsv(`breakdowns-${data.range.startDate}-to-${data.range.endDate}.csv`, csvRows)}>Export Breakdown CSV</button>
      </header>

      {message && <div style={{ ...panel, marginTop: 16, borderColor: "#f2c66d", background: "#fff8e6" }}>{message}</div>}
      <div style={{ ...panel, marginTop: 16, background: "#f8fafc" }}><strong>Unit-cost connection:</strong> Parts + labor + outside breakdown invoices shown here are the same repair costs already counted on that truck or trailer in Reports Summary and Search Reports.</div>

      <section style={{ ...panel, marginTop: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(185px,1fr))", gap: 10 }}>
          <label style={label}>Date preset<select style={input} value={preset} onChange={(event) => applyPreset(event.target.value)}><option value="today">Today</option><option value="last_7">Last 7 days</option><option value="this_month">This month</option><option value="last_30">Last 30 days</option><option value="last_90">Last 90 days</option><option value="ytd">Year to date</option><option value="last_year">Last calendar year</option><option value="all">All history</option><option value="custom">Custom dates</option></select></label>
          <label style={label}>Start date<input type="date" style={input} value={filters.start} onChange={(event) => { setPreset("custom"); set("start", event.target.value); }} /></label>
          <label style={label}>End date<input type="date" style={input} value={filters.end} onChange={(event) => { setPreset("custom"); set("end", event.target.value); }} /></label>
          <label style={label}>Unit<select style={input} value={filters.unit} onChange={(event) => set("unit", event.target.value)}><option value="">All units</option>{data.filterOptions.equipment.map((row) => <option key={row.id} value={row.id}>{row.unit}</option>)}</select></label>
          <Select title="Breakdown category" value={filters.category} values={data.filterOptions.categories} onChange={(value) => set("category", value)} />
          <Select title="Service provider" value={filters.provider} values={data.filterOptions.providers} onChange={(value) => set("provider", value)} />
          <Select title="Status" value={filters.status} values={data.filterOptions.statuses} onChange={(value) => set("status", value)} />
          <Select title="Location" value={filters.location} values={data.filterOptions.locations} onChange={(value) => set("location", value)} />
        </div>
        <label style={{ ...label, marginTop: 12 }}>Search breakdown data<input style={input} value={filters.q} onChange={(event) => set("q", event.target.value)} placeholder="Unit, driver, problem, provider, city, state…" onKeyDown={(event) => { if (event.key === "Enter") void load(); }} /></label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}><button style={button} onClick={() => void load()} disabled={loading}>{loading ? "Running…" : "Run Breakdown Report"}</button><button style={lightButton} onClick={() => { const next = { ...blank, ...rangeFor("ytd") }; setPreset("ytd"); setFilters(next); void load(next); }} disabled={loading}>Reset</button></div>
      </section>

      <section style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(165px,1fr))", gap: 12 }}>
        {[
          ["BREAKDOWNS", num(data.summary.breakdownCount)], ["UNITS AFFECTED", num(data.summary.unitsAffected)], ["OPEN", num(data.summary.openCount)], ["COMPLETED", num(data.summary.completedCount)],
          ["BREAKDOWN COST", money(data.summary.totalCost)], ["AVG COST", money(data.summary.averageCost)], ["AVG ARRIVAL", hoursFromMinutes(data.summary.averageArrivalMinutes)],
          ["AVG DOWNTIME", hoursFromMinutes(data.summary.averageDowntimeMinutes)], ["TOTAL DOWNTIME", `${num(data.summary.totalDowntimeHours, 1)} hr`],
        ].map(([name, value]) => <article key={String(name)} style={panel}><small style={{ color: "#64748b", fontWeight: 850 }}>{name}</small><strong style={{ display: "block", marginTop: 7, fontSize: 22 }}>{value}</strong></article>)}
      </section>

      {data.truncated && <div style={{ ...panel, marginTop: 18, borderColor: "#f2c66d", background: "#fff8e6" }}>More than 5,000 breakdowns match. Summary totals and analysis tables cover the full match; narrow the filters to inspect every individual breakdown row.</div>}

      <section style={{ ...panel, marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}><div><h2 style={{ margin: 0 }}>Breakdown Detail</h2><small style={{ color: "#64748b" }}>Click a column heading to sort this breakdown data on its own.</small></div><strong>{num(data.summary.breakdownCount)} breakdowns</strong></div>
        <div style={{ overflowX: "auto", marginTop: 12 }}><table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1700 }}><thead><tr>
          <th style={th}>{sortHead("Date", "createdAt")}</th><th style={th}>{sortHead("Unit", "unit")}</th><th style={th}>Driver</th><th style={th}>{sortHead("Category", "category")}</th><th style={th}>{sortHead("Provider", "serviceProvider")}</th><th style={th}>{sortHead("Location", "location")}</th><th style={th}>{sortHead("Status", "status")}</th><th style={th}>{sortHead("Arrival", "arrivalMinutes")}</th><th style={th}>{sortHead("Downtime", "downtimeMinutes")}</th><th style={th}>Parts</th><th style={th}>Labor</th><th style={th}>Outside</th><th style={th}>{sortHead("Total", "totalCost")}</th><th style={th}>Repair Needed / Description</th>
        </tr></thead><tbody>{sorted.map((row) => <tr key={row.id}><td style={td}>{shortDateTime(row.createdAt)}</td><td style={{ ...td, fontWeight: 850 }}>{row.unit}</td><td style={td}>{row.driverName || "—"}</td><td style={td}>{row.category || "—"}</td><td style={td}>{row.serviceProvider || "Unassigned"}</td><td style={td}>{row.location || "—"}</td><td style={td}>{row.status}</td><td style={td}>{hoursFromMinutes(row.arrivalMinutes)}</td><td style={td}>{hoursFromMinutes(row.downtimeMinutes)}</td><td style={td}>{money(row.partsCost)}</td><td style={td}>{money(row.laborCost)}</td><td style={td}>{money(row.outsideCost)}</td><td style={{ ...td, fontWeight: 850 }}>{money(row.totalCost)}</td><td style={{ ...td, minWidth: 300 }}>{row.repairNeeded || row.description || "—"}</td></tr>)}</tbody></table></div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(420px,1fr))", gap: 18, marginTop: 18 }}>
        <div style={panel}><h2 style={{ marginTop: 0 }}>Breakdown Cost by Unit</h2><div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["Unit","Breakdowns","Cost","Avg Cost","Downtime"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{data.byUnit.map((row) => <tr key={row.equipmentId}><td style={{ ...td, fontWeight: 850 }}>{row.unit}</td><td style={td}>{row.breakdownCount}</td><td style={td}>{money(row.totalCost)}</td><td style={td}>{money(row.averageCost)}</td><td style={td}>{num(row.downtimeHours, 1)} hr</td></tr>)}</tbody></table></div></div>
        <div style={panel}><h2 style={{ marginTop: 0 }}>Monthly Breakdown Trend</h2><div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["Month","Breakdowns","Cost","Avg Arrival","Avg Downtime"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{data.monthlyTrend.map((row) => <tr key={row.month}><td style={{ ...td, fontWeight: 850 }}>{row.month}</td><td style={td}>{row.breakdownCount}</td><td style={td}>{money(row.totalCost)}</td><td style={td}>{hoursFromMinutes(row.averageArrivalMinutes)}</td><td style={td}>{hoursFromMinutes(row.averageDowntimeMinutes)}</td></tr>)}</tbody></table></div></div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", gap: 18, marginTop: 18 }}>
        {[{ title: "By Breakdown Category", rows: data.byCategory }, { title: "By Service Provider", rows: data.byProvider }, { title: "By Location", rows: data.byLocation }].map((section) => <div key={section.title} style={panel}><h2 style={{ marginTop: 0 }}>{section.title}</h2><div style={{ overflowX: "auto", maxHeight: 520 }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{["Name","Count","Cost","Avg Arrival","Avg Downtime"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{section.rows.map((row) => <tr key={row.label}><td style={{ ...td, fontWeight: 850 }}>{row.label}</td><td style={td}>{row.breakdownCount}</td><td style={td}>{money(row.totalCost)}</td><td style={td}>{hoursFromMinutes(row.averageArrivalMinutes)}</td><td style={td}>{hoursFromMinutes(row.averageDowntimeMinutes)}</td></tr>)}</tbody></table></div></div>)}
      </section>
    </main>
  );
}
