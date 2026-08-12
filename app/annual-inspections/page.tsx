"use client";

import { useEffect, useMemo, useState } from "react";

type AnnualForm = {
  reportNumber: string;
  runId: number;
  repairId: string;
  inspectionDate: string;
  completedAt: string;
  certifiedAt: string;
  unit: string;
  vin: string;
  plate: string;
  modelYear: number | null;
  make: string;
  model: string;
  location: string;
  inspector: string;
  mileage: number | null;
  printUrl: string;
};
type Payload = { forms: AnnualForm[]; updatedAt: string; error?: string };

function shortDate(value: string) {
  if (!value) return "—";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

export default function AnnualInspectionsPage() {
  const [forms, setForms] = useState<AnnualForm[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/annual-inspections", { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error || "Annual forms could not be loaded.");
      setForms(payload.forms);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Annual forms could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return forms;
    return forms.filter((form) => [
      form.reportNumber, form.unit, form.vin, form.plate, form.make, form.model,
      form.location, form.inspector, form.inspectionDate,
    ].join(" ").toLowerCase().includes(needle));
  }, [forms, query]);

  return (
    <main style={{ minHeight: "100vh", background: "#f3f5f7", color: "#172033", padding: "34px 34px 110px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 18, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#f47b20", fontWeight: 900, letterSpacing: ".14em", fontSize: 12 }}>PERIODIC INSPECTION RECORDS</p>
          <h1 style={{ margin: "7px 0 4px", fontSize: 34 }}>Annual Forms</h1>
          <p style={{ margin: 0, maxWidth: 850, color: "#64748b", lineHeight: 1.5 }}>
            Completed Annual inspection forms are kept here for the truck copy and later reprints. Print the newest form after the Annual closes; if the paper copy is lost, search the unit and print the same stored inspection again.
          </p>
        </div>
        <button onClick={() => void load()} disabled={loading} style={buttonStyle}>{loading ? "Refreshing…" : "Refresh"}</button>
      </header>

      {message && <div style={noticeStyle}>{message}</div>}

      <section style={searchCard}>
        <label style={{ display: "grid", gap: 5, fontWeight: 800, maxWidth: 620 }}>
          Find an Annual form
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Unit, VIN, plate, inspector, report number…"
            style={inputStyle}
          />
        </label>
        <div style={{ color: "#64748b", fontSize: 12 }}>{visible.length} completed form{visible.length === 1 ? "" : "s"}</div>
      </section>

      <section style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {visible.map((form) => (
          <article key={form.runId} style={formCard}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", gap: 9, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 20, color: "#0d1b2b" }}>Unit {form.unit || "—"}</strong>
                <span style={reportBadge}>{form.reportNumber}</span>
              </div>
              <div style={{ marginTop: 5, color: "#52616c", lineHeight: 1.55 }}>
                <b>{shortDate(form.inspectionDate)}</b>
                {form.inspector ? ` · Inspector: ${form.inspector}` : ""}
                {form.vin ? ` · VIN ${form.vin}` : ""}
                {form.plate ? ` · Plate ${form.plate}` : ""}
              </div>
              <div style={{ marginTop: 2, color: "#77838d", fontSize: 12 }}>
                {[form.modelYear, form.make, form.model].filter(Boolean).join(" ") || "Vehicle details not entered"}
                {form.location ? ` · ${form.location}` : ""}
                {form.mileage != null ? ` · ${form.mileage.toLocaleString()} mi` : ""}
              </div>
            </div>
            <a href={form.printUrl} target="_blank" rel="noopener noreferrer" style={printButton}>Print / Save PDF</a>
          </article>
        ))}
        {!loading && !visible.length && (
          <div style={emptyStyle}>{forms.length ? "No Annual forms match that search." : "No completed Annual checklist forms are stored yet."}</div>
        )}
      </section>
    </main>
  );
}

const buttonStyle = { border: 0, borderRadius: 8, padding: "10px 14px", background: "#0d1b2b", color: "white", fontWeight: 900, cursor: "pointer" } as const;
const printButton = { display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none", borderRadius: 8, padding: "10px 13px", background: "#f47b20", color: "white", fontWeight: 900, whiteSpace: "nowrap" as const } as const;
const inputStyle = { width: "100%", boxSizing: "border-box" as const, padding: "10px 11px", border: "1px solid #cbd5e1", borderRadius: 8, background: "white", color: "#172033" } as const;
const searchCard = { marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 14, flexWrap: "wrap" as const, background: "white", border: "1px solid #dce2e7", borderRadius: 12, padding: 15 } as const;
const formCard = { background: "white", border: "1px solid #dce2e7", borderRadius: 12, padding: 15, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" as const, boxShadow: "0 4px 18px #12202f0a" } as const;
const reportBadge = { display: "inline-flex", padding: "4px 7px", borderRadius: 999, background: "#eef2f5", color: "#52616c", fontSize: 10, fontWeight: 900 } as const;
const noticeStyle = { marginTop: 16, padding: 12, borderRadius: 9, border: "1px solid #f2c66d", background: "#fff8e6" } as const;
const emptyStyle = { padding: 28, border: "1px dashed #cbd5dc", borderRadius: 10, textAlign: "center" as const, color: "#75828d", background: "white" } as const;
