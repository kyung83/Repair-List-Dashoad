"use client";

import { useEffect, useMemo, useState } from "react";

type Repair = {
  id: string;
  unit: string;
  issue: string;
  parts: string;
  status: string;
  driver: string;
  location: string;
};
type Dvir = {
  id: string;
  asset: string;
  driver: string;
  defect: string;
  comments: string;
  photos: string;
  repaired: boolean;
  logId: string;
  defectId: string;
};
type Pm = {
  unit: string;
  pmType: string;
  status: string;
  driver: string;
  location: string;
};
type Equipment = {
  unit: string;
  serviceDate: string;
  annualDate: string;
  notes: string;
  type: "Truck" | "Trailer";
};
type DashboardData = {
  repairs: Repair[];
  dvir: Dvir[];
  pm: Pm[];
  equipment: Equipment[];
  updatedAt: string;
  preview?: boolean;
};
type PmTruckRow = Pm & {
  annualDate: string;
  hasPmRecord: boolean;
};

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
const emptyRepair: Repair = {
  id: "",
  unit: "",
  issue: "",
  parts: "",
  status: "New",
  driver: "",
  location: "",
};

function statusClass(status: string) {
  const s = status.toLowerCase();
  if (s.includes("overdue") || s.includes("oos")) return "danger";
  if (s.includes("waiting") || s.includes("ordered") || s.includes("due in")) return "warning";
  if (s.includes("complete") || s.includes("repaired")) return "success";
  return "neutral";
}

function unitKey(unit: string) {
  return unit.trim().toLowerCase();
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("Repairs");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<DashboardData>(previewData);
  const [loading, setLoading] = useState(true);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [editingRepair, setEditingRepair] = useState<Repair | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedPmUnits, setSelectedPmUnits] = useState<string[]>([]);

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
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function markRepaired(defect: Dvir) {
    if (data.preview) {
      setConnectionMessage("Deploy the included Google Apps Script connector before updating live repairs.");
      return;
    }
    const response = await fetch("/api/repairs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "markRepaired",
        logId: defect.logId,
        defectId: defect.defectId,
        id: defect.id,
      }),
    });
    if (!response.ok) {
      setConnectionMessage("The repair could not be updated. Please try again.");
      return;
    }
    await loadData();
  }

  async function repairAction(action: "saveRepair" | "completeRepair", repair: Repair) {
    setSaving(true);
    try {
      const response = await fetch("/api/repairs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...repair }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "The repair could not be saved.");
      setEditingRepair(null);
      await loadData();
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : "The repair could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => ({
      repairs: data.repairs.filter((r) => Object.values(r).join(" ").toLowerCase().includes(q)),
      dvir: data.dvir.filter((r) => Object.values(r).join(" ").toLowerCase().includes(q)),
      equipment: data.equipment.filter((r) => Object.values(r).join(" ").toLowerCase().includes(q)),
    }),
    [data, q],
  );

  const pmTruckRows = useMemo<PmTruckRow[]>(() => {
    const pmByUnit = new Map<string, Pm>();
    data.pm.forEach((pm) => {
      const key = unitKey(pm.unit);
      if (key && !pmByUnit.has(key)) pmByUnit.set(key, pm);
    });

    const rows: PmTruckRow[] = data.equipment
      .filter((equipment) => equipment.type === "Truck" && equipment.unit.trim())
      .map((equipment) => {
        const pm = pmByUnit.get(unitKey(equipment.unit));
        return {
          unit: equipment.unit,
          pmType: pm?.pmType || "—",
          status: pm?.status || "No PM record",
          driver: pm?.driver || "",
          location: pm?.location || "",
          annualDate: equipment.annualDate || "",
          hasPmRecord: Boolean(pm),
        };
      });

    const listedUnits = new Set(rows.map((row) => unitKey(row.unit)));
    data.pm.forEach((pm) => {
      const key = unitKey(pm.unit);
      if (!key || listedUnits.has(key)) return;
      rows.push({ ...pm, annualDate: "", hasPmRecord: true });
      listedUnits.add(key);
    });

    return rows.sort((a, b) => a.unit.localeCompare(b.unit, undefined, { numeric: true, sensitivity: "base" }));
  }, [data.equipment, data.pm]);

  const filteredPmTrucks = useMemo(
    () => pmTruckRows.filter((row) => Object.values(row).join(" ").toLowerCase().includes(q)),
    [pmTruckRows, q],
  );

  useEffect(() => {
    const availableUnits = new Set(pmTruckRows.map((row) => row.unit));
    setSelectedPmUnits((current) => current.filter((unit) => availableUnits.has(unit)));
  }, [pmTruckRows]);

  const selectedPmUnitSet = useMemo(() => new Set(selectedPmUnits), [selectedPmUnits]);
  const allVisiblePmTrucksSelected =
    filteredPmTrucks.length > 0 && filteredPmTrucks.every((row) => selectedPmUnitSet.has(row.unit));

  function togglePmUnit(unit: string) {
    setSelectedPmUnits((current) =>
      current.includes(unit) ? current.filter((item) => item !== unit) : [...current, unit],
    );
  }

  function toggleAllVisiblePmTrucks() {
    const visibleUnits = filteredPmTrucks.map((row) => row.unit);
    const visibleSet = new Set(visibleUnits);
    setSelectedPmUnits((current) => {
      if (allVisiblePmTrucksSelected) return current.filter((unit) => !visibleSet.has(unit));
      return Array.from(new Set([...current, ...visibleUnits]));
    });
  }

  const overdue = data.pm.filter((p) => p.status.toLowerCase().includes("overdue")).length;
  const photoCount = data.dvir.filter((d) => d.photos && d.photos !== "None").length;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">N</div>
        <div className="brand-copy">
          <strong>NORLOWORLD</strong>
          <span>Fleet maintenance</span>
        </div>
        <nav aria-label="Repair dashboard sections">
          {tabs.map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? "nav-button active" : "nav-button"}
              onClick={() => setActiveTab(tab)}
            >
              <span className="nav-dot" />
              {tab}
              <span className="nav-count">
                {tab === "Repairs"
                  ? data.repairs.length
                  : tab === "DVIR Defects"
                    ? data.dvir.length
                    : tab === "PM Status"
                      ? pmTruckRows.length
                      : data.equipment.length}
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className={data.preview ? "status-light preview" : "status-light"} />
          {data.preview ? "Preview data" : "Sheet connected"}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">REPAIR OPERATIONS</p>
            <h1>Fleet repair dashboard</h1>
          </div>
          <div className="topbar-actions">
            <label className="search">
              <span>⌕</span>
              <input
                aria-label="Search all repair records"
                placeholder="Search unit, driver, issue…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <button className="refresh" onClick={() => void loadData()} disabled={loading}>
              {loading ? "Loading…" : "Refresh data"}
            </button>
            <button
              className="primary-action"
              onClick={() => {
                setActiveTab("Repairs");
                setEditingRepair({ ...emptyRepair });
              }}
            >
              + New repair
            </button>
          </div>
        </header>

        {connectionMessage && (
          <div className="connection-banner">
            <strong>Preview mode:</strong> {connectionMessage}
          </div>
        )}

        <section className="metrics" aria-label="Fleet repair summary">
          <article>
            <span className="metric-label">OPEN REPAIRS</span>
            <strong>{data.repairs.length}</strong>
            <small>Current shop list</small>
          </article>
          <article>
            <span className="metric-label">DVIR DEFECTS</span>
            <strong>{data.dvir.filter((d) => !d.repaired).length}</strong>
            <small>{photoCount} with photos</small>
          </article>
          <article>
            <span className="metric-label">PM TRUCKS</span>
            <strong>{pmTruckRows.length}</strong>
            <small>{overdue} overdue</small>
          </article>
          <article>
            <span className="metric-label">EQUIPMENT</span>
            <strong>{data.equipment.length}</strong>
            <small>Trucks and trailers</small>
          </article>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">LIVE WORK QUEUE</p>
              <h2>{activeTab}</h2>
            </div>
            <span suppressHydrationWarning>Updated {new Date(data.updatedAt).toLocaleString()}</span>
          </div>

          {activeTab === "Repairs" && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>Repair needed</th>
                    <th>Parts</th>
                    <th>Status</th>
                    <th>Driver</th>
                    <th>Location</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.repairs.map((r) => (
                    <tr key={r.id}>
                      <td className="unit">{r.unit}</td>
                      <td>{r.issue}</td>
                      <td>{r.parts || "—"}</td>
                      <td>
                        <span className={`pill ${statusClass(r.status)}`}>{r.status || "Open"}</span>
                      </td>
                      <td>{r.driver || "—"}</td>
                      <td>{r.location || "—"}</td>
                      <td>
                        <div className="row-actions">
                          <button onClick={() => setEditingRepair({ ...r })}>Edit</button>
                          {!r.status.toLowerCase().includes("complete") && (
                            <button className="complete" onClick={() => void repairAction("completeRepair", r)}>
                              Complete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "DVIR Defects" && (
            <div className="card-grid">
              {filtered.dvir.map((d) => (
                <article className="defect-card" key={d.id}>
                  <div className="defect-head">
                    <div>
                      <span className="asset">{d.asset}</span>
                      <h3>{d.defect}</h3>
                    </div>
                    <span className={`pill ${d.repaired ? "success" : "danger"}`}>
                      {d.repaired ? "Repaired" : "Needs repair"}
                    </span>
                  </div>
                  <p>{d.comments || "No driver comments"}</p>
                  <div className="defect-meta">
                    <span>Driver: {d.driver || "Unknown"}</span>
                    {d.photos && d.photos !== "None" ? (
                      <a href={d.photos} target="_blank" rel="noreferrer">
                        View photos
                      </a>
                    ) : (
                      <span>No photos</span>
                    )}
                  </div>
                  {!d.repaired && (
                    <button className="repair-button" onClick={() => void markRepaired(d)}>
                      Mark repaired
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}

          {activeTab === "PM Status" && (
            <div>
              <div
                style={{
                  minHeight: 58,
                  padding: "11px 17px",
                  borderBottom: "1px solid #eef1f3",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                  flexWrap: "wrap",
                  background: "#fbfcfd",
                }}
              >
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 9,
                    color: "#27394a",
                    fontSize: 13,
                    fontWeight: 750,
                    cursor: filteredPmTrucks.length ? "pointer" : "default",
                  }}
                >
                  <input
                    type="checkbox"
                    aria-label="Select all visible trucks"
                    checked={allVisiblePmTrucksSelected}
                    disabled={!filteredPmTrucks.length}
                    onChange={toggleAllVisiblePmTrucks}
                    style={{ width: 17, height: 17, accentColor: "#f47b20" }}
                  />
                  Select all visible trucks
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <strong style={{ color: "#0d1b2b", fontSize: 13 }}>
                    {selectedPmUnits.length} selected
                  </strong>
                  <button
                    type="button"
                    disabled={!selectedPmUnits.length}
                    onClick={() => setSelectedPmUnits([])}
                    style={{
                      minHeight: 32,
                      border: "1px solid #dce2e7",
                      borderRadius: 7,
                      padding: "0 11px",
                      background: "white",
                      color: "#415264",
                      fontSize: 12,
                      fontWeight: 750,
                      opacity: selectedPmUnits.length ? 1 : 0.55,
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Select</th>
                      <th>Unit</th>
                      <th>PM type</th>
                      <th>Status / mileage</th>
                      <th>Annual date</th>
                      <th>Driver</th>
                      <th>Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPmTrucks.map((truck) => {
                      const selected = selectedPmUnitSet.has(truck.unit);
                      return (
                        <tr key={truck.unit} style={selected ? { background: "#fff8f1" } : undefined}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select truck ${truck.unit}`}
                              checked={selected}
                              onChange={() => togglePmUnit(truck.unit)}
                              style={{ width: 18, height: 18, accentColor: "#f47b20" }}
                            />
                          </td>
                          <td className="unit">{truck.unit}</td>
                          <td>{truck.pmType}</td>
                          <td>
                            <span className={`pill ${statusClass(truck.status)}`}>
                              {truck.status || "Current"}
                            </span>
                          </td>
                          <td>{truck.annualDate || "—"}</td>
                          <td>{truck.driver || "—"}</td>
                          <td>{truck.location || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "Equipment" && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>Type</th>
                    <th>Last service</th>
                    <th>Annual date</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.equipment.map((e, i) => (
                    <tr key={`${e.unit}-${i}`}>
                      <td className="unit">{e.unit}</td>
                      <td>{e.type}</td>
                      <td>{e.serviceDate || "—"}</td>
                      <td>{e.annualDate || "—"}</td>
                      <td>{e.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {((activeTab === "Repairs" && !filtered.repairs.length) ||
            (activeTab === "DVIR Defects" && !filtered.dvir.length) ||
            (activeTab === "PM Status" && !filteredPmTrucks.length) ||
            (activeTab === "Equipment" && !filtered.equipment.length)) && (
            <div className="empty-state">
              <strong>No matching records</strong>
              <span>Try a different search.</span>
            </div>
          )}
        </section>
      </section>

      {editingRepair && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setEditingRepair(null);
          }}
        >
          <form
            className="repair-modal"
            onSubmit={(e) => {
              e.preventDefault();
              void repairAction("saveRepair", editingRepair);
            }}
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">REPAIR RECORD</p>
                <h2>{editingRepair.id ? "Edit repair" : "Add a new repair"}</h2>
              </div>
              <button
                type="button"
                className="close-modal"
                aria-label="Close"
                onClick={() => setEditingRepair(null)}
              >
                ×
              </button>
            </div>
            <div className="form-grid">
              <label>
                Unit number
                <input
                  required
                  value={editingRepair.unit}
                  onChange={(e) => setEditingRepair({ ...editingRepair, unit: e.target.value })}
                />
              </label>
              <label>
                Status
                <select
                  value={editingRepair.status}
                  onChange={(e) => setEditingRepair({ ...editingRepair, status: e.target.value })}
                >
                  <option>New</option>
                  <option>Assigned</option>
                  <option>Waiting for Parts</option>
                  <option>In Progress</option>
                  <option>Completed</option>
                </select>
              </label>
              <label className="wide">
                Repair needed
                <textarea
                  required
                  rows={3}
                  value={editingRepair.issue}
                  onChange={(e) => setEditingRepair({ ...editingRepair, issue: e.target.value })}
                />
              </label>
              <label className="wide">
                Parts needed
                <input
                  value={editingRepair.parts}
                  onChange={(e) => setEditingRepair({ ...editingRepair, parts: e.target.value })}
                />
              </label>
              <label>
                Assigned mechanic / driver
                <input
                  value={editingRepair.driver}
                  onChange={(e) => setEditingRepair({ ...editingRepair, driver: e.target.value })}
                />
              </label>
              <label>
                Location
                <input
                  value={editingRepair.location}
                  onChange={(e) => setEditingRepair({ ...editingRepair, location: e.target.value })}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setEditingRepair(null)}>
                Cancel
              </button>
              <button className="primary-action" disabled={saving}>
                {saving ? "Saving…" : "Save repair"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
