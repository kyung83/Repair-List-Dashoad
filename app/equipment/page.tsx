"use client";

import { useEffect, useMemo, useState } from "react";

type EquipmentHistory = {
  repairs: number;
  maintenanceEvents: number;
  historicalRos: number;
  expenses: number;
  lastRepairDate: string;
};

type EquipmentItem = {
  id: number;
  unit: string;
  category: string;
  equipmentType: string;
  active: boolean;
  archived: boolean;
  archivedAt: string;
  archiveReason: string;
  source: "Geotab" | "Manual";
  geotabDeviceId: string;
  geotabTrailerId: string;
  currentMileage: number | null;
  mileageUpdatedAt: string;
  serviceDate: string;
  annualDate: string;
  notes: string;
  driver: string;
  location: string;
  vin: string;
  licensePlate: string;
  licenseState: string;
  modelYear: number | null;
  make: string;
  model: string;
  engine: string;
  history: EquipmentHistory;
};

type EquipmentPayload = {
  equipment: EquipmentItem[];
  categories: string[];
  equipmentTypes: string[];
  summary: { total: number; active: number; archived: number; geotab: number; manual: number };
  updatedAt: string;
};

type EquipmentDraft = {
  id: number | null;
  unit: string;
  category: string;
  equipmentType: string;
  currentMileage: string;
  vin: string;
  licensePlate: string;
  licenseState: string;
  modelYear: string;
  make: string;
  model: string;
  engine: string;
  driver: string;
  location: string;
  notes: string;
  source: "Geotab" | "Manual";
  archived: boolean;
};

const emptyDraft: EquipmentDraft = {
  id: null,
  unit: "",
  category: "Uncategorized",
  equipmentType: "truck",
  currentMileage: "",
  vin: "",
  licensePlate: "",
  licenseState: "",
  modelYear: "",
  make: "",
  model: "",
  engine: "",
  driver: "",
  location: "",
  notes: "",
  source: "Manual",
  archived: false,
};

const typeLabels: Record<string, string> = {
  truck: "Truck / tractor",
  trailer: "Trailer",
  vehicle: "Company vehicle",
  forklift: "Forklift",
  glider: "Glider",
  switcher: "Switcher",
  other: "Other equipment",
};

function labelType(value: string) {
  return typeLabels[value] || value;
}

function compactDate(value: string) {
  if (!value) return "—";
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function makeModel(item: EquipmentItem) {
  return [item.modelYear, item.make, item.model].filter(Boolean).join(" ") || "—";
}

function historyTotal(item: EquipmentItem) {
  return item.history.repairs + item.history.maintenanceEvents + item.history.historicalRos + item.history.expenses;
}

function draftFor(item: EquipmentItem): EquipmentDraft {
  return {
    id: item.id,
    unit: item.unit,
    category: item.category,
    equipmentType: item.equipmentType,
    currentMileage: item.currentMileage == null ? "" : String(item.currentMileage),
    vin: item.vin,
    licensePlate: item.licensePlate,
    licenseState: item.licenseState,
    modelYear: item.modelYear == null ? "" : String(item.modelYear),
    make: item.make,
    model: item.model,
    engine: item.engine,
    driver: item.driver,
    location: item.location,
    notes: item.notes,
    source: item.source,
    archived: item.archived,
  };
}

export default function EquipmentMasterPage() {
  const [data, setData] = useState<EquipmentPayload | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "archived" | "all">("active");
  const [typeFilter, setTypeFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [locationFilter, setLocationFilter] = useState("All");
  const [sort, setSort] = useState("unit");
  const [editing, setEditing] = useState<EquipmentDraft | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<EquipmentItem | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/equipment", { cache: "no-store" });
    const payload = await response.json() as EquipmentPayload & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Equipment master could not be loaded.");
    setData(payload);
  }

  useEffect(() => {
    void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Equipment master could not be loaded."));
  }, []);

  async function post(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/equipment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Equipment could not be saved.");
      await load();
      setMessage(success);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Equipment could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!editing) return;
    const current = editing;
    const ok = await post({
      action: "save",
      id: current.id,
      unit: current.unit,
      category: current.category,
      equipmentType: current.equipmentType,
      currentMileage: current.currentMileage || null,
      vin: current.vin,
      licensePlate: current.licensePlate,
      licenseState: current.licenseState,
      modelYear: current.modelYear || null,
      make: current.make,
      model: current.model,
      engine: current.engine,
      driver: current.driver,
      location: current.location,
      notes: current.notes,
    }, current.id ? `${current.unit} equipment record updated.` : `${current.unit} added as a manual equipment record.`);
    if (ok) setEditing(null);
  }

  async function archive() {
    if (!archiveTarget) return;
    const current = archiveTarget;
    const ok = await post({ action: "archive", id: current.id, reason: archiveReason }, `${current.unit} archived. Its repair and maintenance history was retained.`);
    if (ok) {
      setArchiveTarget(null);
      setArchiveReason("");
    }
  }

  async function restore(item: EquipmentItem) {
    await post({ action: "restore", id: item.id }, `${item.unit} restored to the active equipment list.`);
  }

  const locations = useMemo(() => {
    return [...new Set((data?.equipment ?? []).map((item) => item.location).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [data]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = (data?.equipment ?? []).filter((item) => {
      if (statusFilter === "active" && item.archived) return false;
      if (statusFilter === "archived" && !item.archived) return false;
      if (typeFilter !== "All" && item.equipmentType !== typeFilter) return false;
      if (categoryFilter !== "All" && item.category !== categoryFilter) return false;
      if (sourceFilter !== "All" && item.source !== sourceFilter) return false;
      if (locationFilter !== "All" && item.location !== locationFilter) return false;
      if (!needle) return true;
      return [
        item.unit,
        item.category,
        item.equipmentType,
        item.source,
        item.vin,
        item.licensePlate,
        item.licenseState,
        item.modelYear,
        item.make,
        item.model,
        item.engine,
        item.driver,
        item.location,
        item.notes,
        item.currentMileage,
      ].join(" ").toLowerCase().includes(needle);
    });

    rows.sort((a, b) => {
      if (sort === "year") return (b.modelYear ?? 0) - (a.modelYear ?? 0) || a.unit.localeCompare(b.unit, undefined, { numeric: true });
      if (sort === "make") return `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`) || a.unit.localeCompare(b.unit, undefined, { numeric: true });
      if (sort === "mileage-high") return (b.currentMileage ?? -1) - (a.currentMileage ?? -1);
      if (sort === "mileage-low") return (a.currentMileage ?? Number.MAX_SAFE_INTEGER) - (b.currentMileage ?? Number.MAX_SAFE_INTEGER);
      return a.unit.localeCompare(b.unit, undefined, { numeric: true, sensitivity: "base" });
    });
    return rows;
  }, [data, query, statusFilter, typeFilter, categoryFilter, sourceFilter, locationFilter, sort]);

  const summary = data?.summary ?? { total: 0, active: 0, archived: 0, geotab: 0, manual: 0 };

  return (
    <main className="module-page equipment-master-page">
      <header className="module-header">
        <div>
          <p className="module-eyebrow">FLEET MASTER</p>
          <h1>Master Equipment</h1>
          <p className="module-subtitle">One record for every powered unit, trailer and shop asset — Geotab or manual — with archive-safe history.</p>
        </div>
        <div className="module-actions">
          <button className="module-button secondary" type="button" disabled={busy} onClick={() => void load()}>{busy ? "Working…" : "Refresh"}</button>
          <button className="module-button primary" type="button" onClick={() => setEditing({ ...emptyDraft })}>+ Add equipment</button>
        </div>
      </header>

      {message && <div className="module-message">{message}</div>}

      <section className="summary-strip" aria-label="Equipment summary">
        <article><span>Active</span><strong>{summary.active}</strong></article>
        <article><span>Archived</span><strong>{summary.archived}</strong></article>
        <article><span>Geotab</span><strong>{summary.geotab}</strong></article>
        <article><span>Manual</span><strong>{summary.manual}</strong></article>
        <article><span>Total records</span><strong>{summary.total}</strong></article>
      </section>

      <section className="module-panel">
        <div className="filter-bar">
          <label className="filter-search">
            <span>Search</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Unit, VIN, plate, make, model, engine, driver, location…" />
          </label>
          <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "active" | "archived" | "all")}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All records</option></select></label>
          <label><span>Type</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option>All</option>{(data?.equipmentTypes ?? []).map((value) => <option key={value} value={value}>{labelType(value)}</option>)}</select></label>
          <label><span>PM / equipment group</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option>All</option><option>Uncategorized</option>{(data?.categories ?? []).map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Source</span><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option>All</option><option>Geotab</option><option>Manual</option></select></label>
          <label><span>Location</span><select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option>All</option>{locations.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="unit">Unit</option><option value="year">Newest year</option><option value="make">Make / model</option><option value="mileage-high">Mileage high → low</option><option value="mileage-low">Mileage low → high</option></select></label>
        </div>

        <div className="results-line">
          <strong>{visible.length} equipment record{visible.length === 1 ? "" : "s"}</strong>
          <span>Archived units remain connected to all historical records.</span>
        </div>

        <div className="equipment-table-wrap">
          <table className="equipment-table">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Status / source</th>
                <th>Type / group</th>
                <th>Year · make · model</th>
                <th>Engine / motor</th>
                <th>VIN / plate</th>
                <th>Mileage</th>
                <th>Driver / location</th>
                <th>History</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id} className={item.archived ? "archived-row" : undefined}>
                  <td>
                    <div className="equipment-unit">{item.unit}</div>
                    {item.notes && <div className="cell-muted clamp-one" title={item.notes}>{item.notes}</div>}
                  </td>
                  <td>
                    <div className="badge-stack">
                      <span className={`status-badge ${item.archived ? "archived" : "active"}`}>{item.archived ? "Archived" : "Active"}</span>
                      <span className={`source-badge-master ${item.source.toLowerCase()}`}>{item.source}</span>
                    </div>
                    {item.archivedAt && <div className="cell-muted">{compactDate(item.archivedAt)}</div>}
                  </td>
                  <td>
                    <strong>{labelType(item.equipmentType)}</strong>
                    <div className="cell-muted">{item.category}</div>
                  </td>
                  <td><strong>{makeModel(item)}</strong></td>
                  <td>{item.engine || "—"}</td>
                  <td>
                    <div>{item.vin || "—"}</div>
                    <div className="cell-muted">{item.licensePlate ? `${item.licensePlate}${item.licenseState ? ` · ${item.licenseState}` : ""}` : "No plate"}</div>
                  </td>
                  <td>
                    <strong>{item.currentMileage == null ? "—" : item.currentMileage.toLocaleString()}</strong>
                    <div className="cell-muted">{item.currentMileage == null ? "No mileage" : item.source === "Geotab" ? "Geotab" : "Manual"}</div>
                  </td>
                  <td>
                    <div>{item.driver || "—"}</div>
                    <div className="cell-muted">{item.location || "No location"}</div>
                  </td>
                  <td>
                    <strong>{historyTotal(item)} records</strong>
                    <div className="cell-muted">{item.history.repairs} repairs · {item.history.maintenanceEvents} PM/annual</div>
                    <div className="cell-muted">{item.history.historicalRos} imported ROs · {item.history.expenses} expenses</div>
                  </td>
                  <td>
                    <div className="equipment-actions">
                      <button type="button" onClick={() => setEditing(draftFor(item))}>Edit</button>
                      {item.archived
                        ? <button type="button" disabled={busy} onClick={() => void restore(item)}>Restore</button>
                        : <button type="button" className="danger-text" onClick={() => { setArchiveTarget(item); setArchiveReason(""); }}>Archive</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && <div className="module-empty"><strong>No matching equipment</strong><span>Change the search or filters, or add a new manual unit.</span></div>}
        </div>
      </section>

      {editing && (
        <div className="master-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
          <div className="master-modal">
            <div className="master-modal-head">
              <div>
                <p className="module-eyebrow">{editing.id ? "EDIT EQUIPMENT" : "NEW MANUAL EQUIPMENT"}</p>
                <h2>{editing.id ? editing.unit : "Add equipment"}</h2>
                <p>{editing.source === "Geotab" ? "Geotab-connected record. Unit name is controlled by Geotab; dashboard details can still be maintained here." : "Manual equipment is fully usable for repairs, PMs, inventory compatibility, expenses and reporting."}</p>
              </div>
              <button type="button" className="modal-x" onClick={() => setEditing(null)}>×</button>
            </div>

            <div className="equipment-form-grid">
              <label><span>Unit number / asset name *</span><input disabled={editing.source === "Geotab" && editing.id != null} value={editing.unit} onChange={(event) => setEditing({ ...editing, unit: event.target.value })} /></label>
              <label><span>Equipment type *</span><select value={editing.equipmentType} onChange={(event) => { const next = event.target.value; setEditing({ ...editing, equipmentType: next, category: next === "trailer" ? "Trailers" : editing.category === "Trailers" ? "Uncategorized" : editing.category }); }}>{(data?.equipmentTypes ?? Object.keys(typeLabels)).map((value) => <option key={value} value={value}>{labelType(value)}</option>)}</select></label>
              <label><span>PM / equipment group</span><select disabled={editing.equipmentType === "trailer"} value={editing.equipmentType === "trailer" ? "Trailers" : editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value })}><option>Uncategorized</option>{(data?.categories ?? []).filter((value) => value !== "Trailers").map((value) => <option key={value}>{value}</option>)}{editing.equipmentType === "trailer" && <option>Trailers</option>}</select></label>
              <label><span>Model year</span><input type="number" min="1900" max="2100" value={editing.modelYear} onChange={(event) => setEditing({ ...editing, modelYear: event.target.value })} /></label>
              <label><span>Make</span><input value={editing.make} onChange={(event) => setEditing({ ...editing, make: event.target.value })} /></label>
              <label><span>Model</span><input value={editing.model} onChange={(event) => setEditing({ ...editing, model: event.target.value })} /></label>
              <label className="wide"><span>Engine / motor</span><input value={editing.engine} onChange={(event) => setEditing({ ...editing, engine: event.target.value })} placeholder="Engine family, displacement, motor type, etc." /></label>
              <label className="wide"><span>VIN / serial identity</span><input value={editing.vin} onChange={(event) => setEditing({ ...editing, vin: event.target.value.toUpperCase() })} /></label>
              <label><span>License plate</span><input value={editing.licensePlate} onChange={(event) => setEditing({ ...editing, licensePlate: event.target.value })} /></label>
              <label><span>Plate state</span><input value={editing.licenseState} onChange={(event) => setEditing({ ...editing, licenseState: event.target.value.toUpperCase() })} /></label>
              <label><span>Current mileage</span><input type="number" min="0" value={editing.currentMileage} onChange={(event) => setEditing({ ...editing, currentMileage: event.target.value })} /></label>
              <label><span>Driver / assigned to</span><input value={editing.driver} onChange={(event) => setEditing({ ...editing, driver: event.target.value })} /></label>
              <label className="wide"><span>Location</span><input value={editing.location} onChange={(event) => setEditing({ ...editing, location: event.target.value })} /></label>
              <label className="wide"><span>Notes</span><textarea rows={4} value={editing.notes} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} /></label>
            </div>

            {editing.source === "Geotab" && <div className="form-note">Geotab can refresh VIN, plate and mileage on later syncs. Archiving is protected and will not be undone by Geotab.</div>}
            <div className="master-modal-actions">
              <button type="button" className="module-button secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="module-button primary" disabled={busy || !editing.unit.trim()} onClick={() => void saveDraft()}>{busy ? "Saving…" : editing.id ? "Save changes" : "Add equipment"}</button>
            </div>
          </div>
        </div>
      )}

      {archiveTarget && (
        <div className="master-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setArchiveTarget(null); }}>
          <div className="archive-modal">
            <p className="module-eyebrow">ARCHIVE EQUIPMENT</p>
            <h2>Archive {archiveTarget.unit}?</h2>
            <p>This removes the unit from active repair/PM equipment lists. It does <strong>not</strong> delete the unit or its history.</p>
            <div className="history-retention-box">
              <strong>{historyTotal(archiveTarget)} connected records will remain</strong>
              <span>{archiveTarget.history.repairs} repairs · {archiveTarget.history.maintenanceEvents} PM/annual events · {archiveTarget.history.historicalRos} imported ROs · {archiveTarget.history.expenses} expenses</span>
            </div>
            <label className="archive-reason"><span>Archive reason (optional)</span><textarea rows={3} value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} placeholder="Sold, retired, transferred, totaled, no longer in service…" /></label>
            <div className="master-modal-actions">
              <button type="button" className="module-button secondary" disabled={busy} onClick={() => setArchiveTarget(null)}>Cancel</button>
              <button type="button" className="module-button danger" disabled={busy} onClick={() => void archive()}>{busy ? "Archiving…" : "Archive unit"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
