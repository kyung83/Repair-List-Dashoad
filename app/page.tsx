"use client";

import { useEffect, useMemo, useState } from "react";

type Repair = { id: string; unit: string; issue: string; parts: string; status: string; driver: string; location: string };
type Dvir = { id: string; asset: string; driver: string; defect: string; comments: string; photos: string; repaired: boolean; logId: string; defectId: string };
type Pm = { unit: string; pmType: string; status: string; driver: string; location: string };
type Equipment = { unit: string; serviceDate: string; annualDate: string; notes: string; type: "Truck" | "Trailer" };
type DashboardData = { repairs: Repair[]; dvir: Dvir[]; pm: Pm[]; equipment: Equipment[]; updatedAt: string; preview?: boolean };

const previewData: DashboardData = {
  preview: true,
  updatedAt: new Date().toISOString(),
  repairs: [],
  dvir: [],
  pm: [],
  equipment: [],
};

const tabs = ["Repairs", "DVIR Defects", "PM Status", "Equipment"] as const;
type Tab = (typeof tabs)[number];

function statusClass(status: string) {
  const s = status.toLowerCase();
  if (s.includes("overdue") || s.includes("oos")) return "danger";
  if (s.includes("waiting") || s.includes("ordered") || s.includes("due in")) return "warning";
  if (s.includes("complete") || s.includes("repaired")) return "success";
  return "neutral";
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("Repairs");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<DashboardData>(previewData);
  const [loading, setLoading] = useState(true);
  const [connectionMessage, setConnectionMessage] = useState("");

  async function loadData() {
    setLoading(true);
    try {
      const response = await fetch("/api/repairs", { cache: "no-store" });
      if (!response.ok) throw new Error("The Google Sheet connector has not been deployed yet.");
      const fresh = (await response.json()) as DashboardData;
      setData(fresh);
      setConnectionMessage("");
    } catch (error) {
      setData(previewData);
      setConnectionMessage(error instanceof Error ? error.message : "Unable to reach the Google Sheet.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/repairs", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("The Google Sheet connector has not been deployed yet.");
        return response.json() as Promise<DashboardData>;
      })
      .then((fresh) => {
        if (!cancelled) {
          setData(fresh);
          setConnectionMessage("");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setData(previewData);
          setConnectionMessage(error instanceof Error ? error.message : "Unable to reach the Google Sheet.");
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function markRepaired(defect: Dvir) {
    if (data.preview) {
      setConnectionMessage("Deploy the included Google Apps Script connector before updating live repairs.");
      return;
    }
    const response = await fetch("/api/repairs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "markRepaired", logId: defect.logId, defectId: defect.defectId, id: defect.id }),
    });
    if (!response.ok) {
      setConnectionMessage("The repair could not be updated. Please try again.");
      return;
    }
    await loadData();
  }

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => ({
    repairs: data.repairs.filter((r) => Object.values(r).join(" ").toLowerCase().includes(q)),
    dvir: data.dvir.filter((r) => Object.values(r).join(" ").toLowerCase().includes(q)),
    pm: data.pm.filter((r) => Object.values(r).join(" ").toLowerCase().includes(q)),
    equipment: data.equipment.filter((r) => Object.values(r).join(" ").toLowerCase().includes(q)),
  }), [data, q]);

  const overdue = data.pm.filter((p) => p.status.toLowerCase().includes("overdue")).length;
  const photoCount = data.dvir.filter((d) => d.photos && d.photos !== "None").length;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">N</div>
        <div className="brand-copy"><strong>NORLOWORLD</strong><span>Fleet maintenance</span></div>
        <nav aria-label="Repair dashboard sections">
          {tabs.map((tab) => (
            <button key={tab} className={activeTab === tab ? "nav-button active" : "nav-button"} onClick={() => setActiveTab(tab)}>
              <span className="nav-dot" />{tab}
              <span className="nav-count">{tab === "Repairs" ? data.repairs.length : tab === "DVIR Defects" ? data.dvir.length : tab === "PM Status" ? data.pm.length : data.equipment.length}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot"><span className={data.preview ? "status-light preview" : "status-light"} />{data.preview ? "Preview data" : "Sheet connected"}</div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">REPAIR OPERATIONS</p><h1>Fleet repair dashboard</h1></div>
          <div className="topbar-actions">
            <label className="search"><span>⌕</span><input aria-label="Search all repair records" placeholder="Search unit, driver, issue…" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
            <button className="refresh" onClick={() => void loadData()} disabled={loading}>{loading ? "Loading…" : "Refresh data"}</button>
          </div>
        </header>

        {connectionMessage && <div className="connection-banner"><strong>Preview mode:</strong> {connectionMessage}</div>}

        <section className="metrics" aria-label="Fleet repair summary">
          <article><span className="metric-label">OPEN REPAIRS</span><strong>{data.repairs.length}</strong><small>Current shop list</small></article>
          <article><span className="metric-label">DVIR DEFECTS</span><strong>{data.dvir.filter((d) => !d.repaired).length}</strong><small>{photoCount} with photos</small></article>
          <article><span className="metric-label">PM ITEMS</span><strong>{data.pm.length}</strong><small>{overdue} overdue</small></article>
          <article><span className="metric-label">EQUIPMENT</span><strong>{data.equipment.length}</strong><small>Trucks and trailers</small></article>
        </section>

        <section className="panel">
          <div className="panel-heading"><div><p className="eyebrow">LIVE WORK QUEUE</p><h2>{activeTab}</h2></div><span>Updated {new Date(data.updatedAt).toLocaleString()}</span></div>

          {activeTab === "Repairs" && <div className="table-wrap"><table><thead><tr><th>Unit</th><th>Repair needed</th><th>Parts</th><th>Status</th><th>Driver</th><th>Location</th></tr></thead><tbody>{filtered.repairs.map((r) => <tr key={r.id}><td className="unit">{r.unit}</td><td>{r.issue}</td><td>{r.parts || "—"}</td><td><span className={`pill ${statusClass(r.status)}`}>{r.status || "Open"}</span></td><td>{r.driver || "—"}</td><td>{r.location || "—"}</td></tr>)}</tbody></table></div>}

          {activeTab === "DVIR Defects" && <div className="card-grid">{filtered.dvir.map((d) => <article className="defect-card" key={d.id}><div className="defect-head"><div><span className="asset">{d.asset}</span><h3>{d.defect}</h3></div><span className={`pill ${d.repaired ? "success" : "danger"}`}>{d.repaired ? "Repaired" : "Needs repair"}</span></div><p>{d.comments || "No driver comments"}</p><div className="defect-meta"><span>Driver: {d.driver || "Unknown"}</span>{d.photos && d.photos !== "None" ? <a href={d.photos} target="_blank" rel="noreferrer">View photos</a> : <span>No photos</span>}</div>{!d.repaired && <button className="repair-button" onClick={() => void markRepaired(d)}>Mark repaired</button>}</article>)}</div>}

          {activeTab === "PM Status" && <div className="table-wrap"><table><thead><tr><th>Unit</th><th>PM type</th><th>Status / mileage</th><th>Driver</th><th>Location</th></tr></thead><tbody>{filtered.pm.map((p, i) => <tr key={`${p.unit}-${i}`}><td className="unit">{p.unit}</td><td>{p.pmType}</td><td><span className={`pill ${statusClass(p.status)}`}>{p.status || "Current"}</span></td><td>{p.driver || "—"}</td><td>{p.location || "—"}</td></tr>)}</tbody></table></div>}

          {activeTab === "Equipment" && <div className="table-wrap"><table><thead><tr><th>Unit</th><th>Type</th><th>Last service</th><th>Annual date</th><th>Notes</th></tr></thead><tbody>{filtered.equipment.map((e, i) => <tr key={`${e.unit}-${i}`}><td className="unit">{e.unit}</td><td>{e.type}</td><td>{e.serviceDate || "—"}</td><td>{e.annualDate || "—"}</td><td>{e.notes || "—"}</td></tr>)}</tbody></table></div>}

          {((activeTab === "Repairs" && !filtered.repairs.length) || (activeTab === "DVIR Defects" && !filtered.dvir.length) || (activeTab === "PM Status" && !filtered.pm.length) || (activeTab === "Equipment" && !filtered.equipment.length)) && <div className="empty-state"><strong>No matching records</strong><span>Try a different search.</span></div>}
        </section>
      </section>
    </main>
  );
}
