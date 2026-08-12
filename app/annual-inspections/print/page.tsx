"use client";

import { useEffect, useState } from "react";

type CorrectiveRepair = { id: string; title: string; description: string; status: string; completedAt: string };
type AnnualItem = {
  number: number;
  section: string;
  text: string;
  result: "pass" | "na" | "pending" | "fail";
  notes: string;
  correctiveRepair: CorrectiveRepair | null;
};
type AnnualReport = {
  reportNumber: string;
  runId: number;
  repairId: string;
  carrierName: string;
  inspectionDate: string;
  completedAt: string;
  certifiedAt: string;
  inspector: string;
  vehicle: {
    unit: string;
    vin: string;
    plate: string;
    plateState: string;
    modelYear: number | null;
    make: string;
    model: string;
    location: string;
    mileage: number | null;
  };
  items: AnnualItem[];
  certification: string;
};

function dateText(value: string) {
  if (!value) return "—";
  const dateOnly = value.slice(0, 10);
  const parsed = new Date(`${dateOnly}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function dateTimeText(value: string) {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function resultText(value: AnnualItem["result"]) {
  if (value === "na") return "N/A";
  if (value === "pass") return "PASS";
  if (value === "fail") return "FAIL";
  return "PENDING";
}

export default function AnnualInspectionPrintPage() {
  const [report, setReport] = useState<AnnualReport | null>(null);
  const [message, setMessage] = useState("Loading Annual inspection…");

  useEffect(() => {
    const repairId = new URLSearchParams(window.location.search).get("repairId") || "";
    if (!repairId) {
      setMessage("Annual inspection was not specified.");
      return;
    }
    void fetch(`/api/annual-inspections?repairId=${encodeURIComponent(repairId)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as AnnualReport & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Annual inspection could not be loaded.");
        setReport(payload);
        setMessage("");
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Annual inspection could not be loaded."));
  }, []);

  if (!report) return <main style={{ padding: 36, fontFamily: "Arial, sans-serif" }}>{message}</main>;

  const vehicleDescription = [report.vehicle.modelYear, report.vehicle.make, report.vehicle.model].filter(Boolean).join(" ");
  return (
    <>
      <style>{`
        @page { size: letter portrait; margin: 0.42in; }
        @media print {
          .app-topnav, .print-controls { display: none !important; }
          html, body { background: #fff !important; }
          body { margin: 0 !important; }
          .annual-print-sheet { width: auto !important; margin: 0 !important; padding: 0 !important; box-shadow: none !important; border: 0 !important; }
          .annual-table thead { display: table-header-group; }
          .annual-table tr { break-inside: avoid; page-break-inside: avoid; }
          a { color: inherit !important; text-decoration: none !important; }
        }
      `}</style>
      <div className="print-controls" style={controlsStyle}>
        <a href="/annual-inspections" style={backButton}>Annual Forms</a>
        <button onClick={() => window.print()} style={printButton}>Print / Save PDF</button>
      </div>

      <main className="annual-print-sheet" style={sheetStyle}>
        <header style={reportHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <img src="/northern-logistics-logo-exact.svg?v=1" alt="Northern Logistics Worldwide" style={{ width: 150, maxHeight: 52, objectFit: "contain" }} />
            <div>
              <h1 style={{ margin: 0, fontSize: 21, letterSpacing: ".02em" }}>Annual / Periodic Vehicle Inspection Report</h1>
              <div style={{ marginTop: 3, fontSize: 11, color: "#4b5563" }}>49 CFR 396.17 / 396.21 inspection record</div>
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: 10.5 }}>
            <strong style={{ display: "block", fontSize: 12 }}>{report.reportNumber}</strong>
            <span>Inspection date: {dateText(report.inspectionDate)}</span>
          </div>
        </header>

        <section style={identityGrid}>
          <Field label="Motor Carrier" value={report.carrierName} />
          <Field label="Unit / Company No." value={report.vehicle.unit || "—"} />
          <Field label="VIN" value={report.vehicle.vin || "—"} />
          <Field label="Plate" value={[report.vehicle.plate, report.vehicle.plateState].filter(Boolean).join(" / ") || "—"} />
          <Field label="Vehicle" value={vehicleDescription || "—"} />
          <Field label="Inspection Location" value={report.vehicle.location || "—"} />
          <Field label="Inspector" value={report.inspector || "—"} />
          <Field label="Mileage" value={report.vehicle.mileage == null ? "—" : `${report.vehicle.mileage.toLocaleString()} mi`} />
        </section>

        <table className="annual-table" style={tableStyle}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 34 }}>#</th>
              <th style={{ ...thStyle, width: 104 }}>Component</th>
              <th style={thStyle}>Inspection scope</th>
              <th style={{ ...thStyle, width: 58 }}>Result</th>
              <th style={{ ...thStyle, width: 195 }}>Notes / corrections</th>
            </tr>
          </thead>
          <tbody>
            {report.items.map((item) => {
              const correction = item.correctiveRepair
                ? [item.correctiveRepair.description || item.correctiveRepair.title, item.correctiveRepair.status ? `Repair ${item.correctiveRepair.status}` : ""].filter(Boolean).join(" · ")
                : "";
              const note = [item.notes, correction].filter(Boolean).join(" — ");
              return (
                <tr key={item.number}>
                  <td style={tdStyle}>{item.number}</td>
                  <td style={{ ...tdStyle, fontWeight: 700 }}>{item.section}</td>
                  <td style={tdStyle}>{item.text}</td>
                  <td style={{ ...tdStyle, textAlign: "center", fontWeight: 800 }}>{resultText(item.result)}</td>
                  <td style={tdStyle}>{note || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <section style={certStyle}>
          <strong style={{ display: "block", marginBottom: 5, fontSize: 12 }}>Inspector Certification</strong>
          <div style={{ lineHeight: 1.45 }}>{report.certification}</div>
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <div><span style={labelStyle}>Electronically certified by</span><strong style={{ display: "block", marginTop: 3 }}>{report.inspector || "—"}</strong></div>
            <div><span style={labelStyle}>Certification timestamp</span><strong style={{ display: "block", marginTop: 3 }}>{dateTimeText(report.certifiedAt)}</strong></div>
          </div>
        </section>

        <footer style={footerStyle}>
          <div><strong>Vehicle copy:</strong> Keep current periodic-inspection documentation on the vehicle. The electronic inspection record remains stored in Northern Logistics Fleet Operations for reprint.</div>
          <div style={{ marginTop: 4 }}>Completed: {dateTimeText(report.completedAt)} · Work order: {report.repairId} · Checklist record: {report.runId}</div>
        </footer>
      </main>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div style={fieldStyle}><span style={labelStyle}>{label}</span><strong style={{ display: "block", marginTop: 2, fontSize: 11 }}>{value}</strong></div>;
}

const controlsStyle = { maxWidth: 960, margin: "18px auto 10px", padding: "0 18px", display: "flex", justifyContent: "space-between", gap: 10 } as const;
const printButton = { border: 0, borderRadius: 8, padding: "10px 14px", background: "#f47b20", color: "white", fontWeight: 900, cursor: "pointer" } as const;
const backButton = { textDecoration: "none", border: "1px solid #cbd5e1", borderRadius: 8, padding: "9px 12px", background: "white", color: "#172033", fontWeight: 800 } as const;
const sheetStyle = { maxWidth: 900, margin: "0 auto 40px", padding: 26, background: "white", border: "1px solid #d9e0e5", boxShadow: "0 8px 28px #10203012", color: "#111827", fontFamily: "Arial, Helvetica, sans-serif", fontSize: 10.5 } as const;
const reportHeader = { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", paddingBottom: 12, borderBottom: "2px solid #111827" } as const;
const identityGrid = { marginTop: 11, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderTop: "1px solid #9ca3af", borderLeft: "1px solid #9ca3af" } as const;
const fieldStyle = { minHeight: 42, padding: "7px 8px", borderRight: "1px solid #9ca3af", borderBottom: "1px solid #9ca3af", boxSizing: "border-box" as const } as const;
const labelStyle = { textTransform: "uppercase" as const, letterSpacing: ".05em", fontSize: 8, color: "#4b5563", fontWeight: 800 } as const;
const tableStyle = { width: "100%", borderCollapse: "collapse" as const, marginTop: 12, fontSize: 9.5 } as const;
const thStyle = { padding: "6px 6px", textAlign: "left" as const, verticalAlign: "bottom" as const, border: "1px solid #6b7280", background: "#f3f4f6", fontSize: 9, textTransform: "uppercase" as const, letterSpacing: ".03em" } as const;
const tdStyle = { padding: "6px 6px", verticalAlign: "top" as const, border: "1px solid #9ca3af", lineHeight: 1.35 } as const;
const certStyle = { marginTop: 12, border: "1.5px solid #111827", padding: 10, fontSize: 10 } as const;
const footerStyle = { marginTop: 10, paddingTop: 8, borderTop: "1px solid #9ca3af", color: "#4b5563", fontSize: 8.5, lineHeight: 1.4 } as const;
