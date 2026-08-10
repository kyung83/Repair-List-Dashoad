"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import styles from "./repair-board.module.css";

type Role = "viewer" | "mechanic" | "manager" | "admin";
type Source = "repair" | "dvir" | "dvir-repair" | "pm" | "annual" | "pm-repair" | "annual-repair";
type Technician = { id: number; name: string };
type Timer = { startedAt: string; technician: string };
type RepairRow = {
  id: string; source: Source; priority: number; location: string; unit: string; driver: string; issue: string; parts: string;
  status: string; technicianId: number | null; assignedTo: string; laborHours: number; equipmentType: string; equipmentId: number | null;
  outOfService: boolean; oosReason: string; oosAt: string | null; activeTimer: Timer | null;
  dvirDefectId: string; dvirLogId: string; dvirComments: string; dvirPhotos: string; maintenanceId: string;
};
type OosUnit = {
  equipmentId: number; unit: string; equipmentType: string; driver: string; location: string; reason: string; since: string | null;
  openWork: { id: string; source: Source; issue: string; assignedTo: string; status: string }[];
};
type BoardData = {
  user: { id: number; username: string; displayName: string; role: Role; technicianId: number | null };
  canManage: boolean; technicians: Technician[]; repairs: RepairRow[]; oosUnits: OosUnit[];
  summary: { total: number; oos: number; trucks: number; trailers: number; dvirOpen: number; maintenanceDue: number; unassigned: number; activeLabor: number };
  updatedAt: string;
};
type ChangeResult = { ok?: boolean; error?: string };

const statuses = ["New", "Assigned", "Waiting for Parts", "In Progress", "Completed"];

function sourceLabel(source: Source) {
  if (source === "dvir") return "DVIR";
  if (source === "dvir-repair") return "DVIR Repair";
  if (source === "pm") return "PM Due";
  if (source === "annual") return "Annual Due";
  if (source === "pm-repair") return "PM Work Order";
  if (source === "annual-repair") return "Annual Work Order";
  return "Repair";
}

function equipmentGroup(value: string) {
  const type = value.toLowerCase();
  if (type.includes("trailer")) return "trailer";
  if (type.includes("truck") || type.includes("tractor") || type.includes("vehicle")) return "truck";
  return "other";
}

function isRawMaintenance(source: Source) { return source === "pm" || source === "annual"; }
function isScheduled(source: Source) { return source === "dvir" || isRawMaintenance(source); }

function runningDuration(startedAt: string) {
  const normalized = startedAt.includes("T") ? startedAt : startedAt.replace(" ", "T") + "Z";
  const started = Date.parse(normalized);
  if (!Number.isFinite(started)) return "running";
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}

function whenText(value: string | null) {
  if (!value) return "";
  const normalized = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function RepairBoardPage() {
  const [data, setData] = useState<BoardData | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/repair-board", { cache: "no-store" });
    const payload = await response.json() as BoardData & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Repair board could not be loaded.");
    setData(payload);
  }

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Repair board could not be loaded.")); }, []);

  async function change(rowId: string, body: Record<string, unknown>) {
    setBusyId(rowId); setMessage("");
    try {
      const response = await fetch("/api/repair-board", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repairId: rowId, ...body }),
      });
      const result = await response.json() as ChangeResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "Repair-board change failed.");
      await load();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Repair-board change failed.");
      return false;
    } finally { setBusyId(null); }
  }

  async function addDvirRepair(row: RepairRow, technicianId = 0) {
    const ok = await change(row.id, { action: "createDvirRepair", defectId: row.dvirDefectId, technicianId });
    if (ok) setMessage(technicianId ? "DVIR repair created and assigned." : "DVIR added to the repair list.");
  }

  async function markDvirRepaired(row: RepairRow) {
    if (!window.confirm(`Mark the DVIR for Unit ${row.unit || "—"} repaired?`)) return;
    const ok = await change(row.id, { action: "markDvirRepaired", defectId: row.dvirDefectId, logId: row.dvirLogId });
    if (ok) setMessage("DVIR marked repaired.");
  }

  async function addMaintenanceRepair(row: RepairRow, technicianId = 0) {
    const ok = await change(row.id, { action: "createMaintenanceRepair", maintenanceId: row.maintenanceId || row.id, technicianId });
    if (ok) setMessage(technicianId ? "Maintenance work order created and assigned." : "Maintenance work order created.");
  }

  async function completeMaintenance(row: RepairRow) {
    const label = row.source === "pm" ? "PM service" : "annual inspection";
    if (!window.confirm(`Mark the ${label} for Unit ${row.unit || "—"} completed?`)) return;
    const ok = await change(row.id, { action: "completeMaintenance", maintenanceId: row.maintenanceId || row.id });
    if (ok) setMessage(`${row.source === "pm" ? "PM" : "Annual"} completed and schedule updated.`);
  }

  async function placeOos(row: RepairRow) {
    const reason = window.prompt(`Why is Unit ${row.unit || "—"} out of service?`, row.issue || "");
    if (reason === null) return;
    const trimmed = reason.trim();
    if (!trimmed) { setMessage("Enter an out-of-service reason."); return; }
    const ok = await change(`oos-${row.equipmentId ?? row.unit}`, {
      action: "setUnitOos", equipmentId: row.equipmentId, unit: row.unit, outOfService: true, reason: trimmed,
    });
    if (ok) setMessage(`Unit ${row.unit} is now out of service.`);
  }

  async function returnToService(unit: OosUnit) {
    if (!window.confirm(`Return Unit ${unit.unit} to service?`)) return;
    const ok = await change(`oos-${unit.equipmentId}`, { action: "setUnitOos", equipmentId: unit.equipmentId, outOfService: false, reason: "Returned to service" });
    if (ok) setMessage(`Unit ${unit.unit} returned to service.`);
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data?.repairs ?? [];
    return (data?.repairs ?? []).filter((row) => [row.unit,row.location,row.driver,row.issue,row.parts,row.status,row.assignedTo,row.dvirComments,sourceLabel(row.source)].join(" ").toLowerCase().includes(needle));
  }, [data, query]);

  const grouped = useMemo(() => {
    const active = visible.filter((row) => !row.outOfService);
    return {
      trucks: active.filter((row) => equipmentGroup(row.equipmentType) === "truck"),
      trailers: active.filter((row) => equipmentGroup(row.equipmentType) === "trailer"),
      other: active.filter((row) => equipmentGroup(row.equipmentType) === "other"),
    };
  }, [visible]);

  const oosVisible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data?.oosUnits ?? [];
    return (data?.oosUnits ?? []).filter((unit) => [unit.unit,unit.driver,unit.location,unit.reason,unit.equipmentType,...unit.openWork.flatMap((work) => [work.issue,work.assignedTo,work.status,sourceLabel(work.source)])].join(" ").toLowerCase().includes(needle));
  }, [data, query]);

  function assignmentControl(row: RepairRow) {
    if (!data?.canManage) return <span className={styles.assignmentText}>{row.assignedTo || "Unassigned"}</span>;
    if (row.source === "dvir") return (
      <select className={styles.techSelect} value="" disabled={busyId === row.id} onChange={(event) => { const id = Number(event.target.value); if (id > 0) void addDvirRepair(row, id); }}>
        <option value="">Assign tech…</option>{data.technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}
      </select>
    );
    if (isRawMaintenance(row.source)) return (
      <select className={styles.techSelect} value="" disabled={busyId === row.id} onChange={(event) => { const id = Number(event.target.value); if (id > 0) void addMaintenanceRepair(row, id); }}>
        <option value="">Assign tech…</option>{data.technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}
      </select>
    );
    return (
      <select className={styles.techSelect} value={row.technicianId ?? ""} disabled={busyId === row.id} onChange={(event) => void change(row.id, { action: "assignTechnician", technicianId: event.target.value ? Number(event.target.value) : 0 })}>
        <option value="">Unassigned</option>{data.technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}
      </select>
    );
  }

  function renderRepairRow(row: RepairRow) {
    const rawDvir = row.source === "dvir";
    const rawMaintenance = isRawMaintenance(row.source);
    const busy = busyId === row.id;
    return (
      <Fragment key={row.id}>
        <tr className={`${row.priority === 1 ? styles.priorityOne : ""} ${rawDvir ? styles.dvirRow : ""} ${rawMaintenance ? styles.maintenanceRow : ""}`.trim()}>
          <td className={styles.unitColumn}>
            <strong>{row.unit || "—"}</strong>
            <span>{row.location || "No location"}</span>
            {row.driver && <span>{row.driver}</span>}
          </td>
          <td className={styles.issueColumn}>
            <div className={styles.badges}>
              <span className={`${styles.sourceBadge} ${rawDvir ? styles.dvirBadge : rawMaintenance ? styles.maintenanceBadge : styles.repairBadge}`}>{sourceLabel(row.source)}</span>
              {data?.canManage && !isScheduled(row.source) ? (
                <select className={styles.prioritySelect} value={row.priority} disabled={busy} onChange={(event) => void change(row.id, { action: "setPriority", priority: Number(event.target.value) })} aria-label={`Priority for ${row.unit}`}>
                  <option value={1}>P1</option><option value={2}>P2</option><option value={3}>P3</option>
                </select>
              ) : <span className={styles.priorityBadge}>P{row.priority}</span>}
            </div>
            <strong className={styles.issueText}>{row.issue}</strong>
            {row.parts && <span className={styles.partsText}>Parts: {row.parts}</span>}
            {rawDvir && row.dvirComments && <span className={styles.commentText}>{row.dvirComments}</span>}
          </td>
          <td className={styles.statusColumn}>
            {data?.canManage && !isScheduled(row.source) ? (
              <select className={styles.statusSelect} value={row.status} disabled={busy} onChange={(event) => void change(row.id, { action: "setStatus", status: event.target.value })}>
                {statuses.map((status) => <option key={status}>{status}</option>)}
              </select>
            ) : <span className={styles.statusBadge}>{row.status}</span>}
            {row.activeTimer && <span className={styles.timerBadge}>{row.activeTimer.technician || row.assignedTo || "Tech"} · {runningDuration(row.activeTimer.startedAt)}</span>}
          </td>
          <td className={styles.techColumn}>{assignmentControl(row)}</td>
          <td className={styles.actionsColumn}>
            <button className={styles.smallButton} type="button" onClick={() => setExpandedId((current) => current === row.id ? null : row.id)}>{expandedId === row.id ? "Close" : "Details"}</button>
            {data?.canManage && <button className={styles.oosButton} type="button" disabled={busy} onClick={() => void placeOos(row)}>OOS</button>}
            {rawDvir ? data?.canManage && <><button className={styles.actionButton} disabled={busy} onClick={() => void addDvirRepair(row)}>Add Repair</button><button className={styles.completeButton} disabled={busy} onClick={() => void markDvirRepaired(row)}>Repaired</button></> : rawMaintenance ? data?.canManage && <><button className={styles.actionButton} disabled={busy} onClick={() => void addMaintenanceRepair(row)}>Work Order</button><button className={styles.completeButton} disabled={busy} onClick={() => void completeMaintenance(row)}>Complete</button></> : <a className={styles.actionLink} href="/work-orders">Work Order</a>}
          </td>
        </tr>
        {expandedId === row.id && (
          <tr className={styles.expanded}><td colSpan={5}>
            <div className={styles.detailsGrid}>
              <div><span>Source</span><strong>{sourceLabel(row.source)}</strong></div>
              <div><span>Driver</span><strong>{row.driver || "—"}</strong></div>
              <div><span>Location</span><strong>{row.location || "—"}</strong></div>
              <div><span>Labor</span><strong>{row.laborHours.toFixed(2)} hr</strong></div>
              <div><span>Assigned</span><strong>{row.assignedTo || "Unassigned"}</strong></div>
              {row.dvirPhotos && <div><span>DVIR photos</span><a href={row.dvirPhotos} target="_blank" rel="noreferrer">View photos</a></div>}
            </div>
          </td></tr>
        )}
      </Fragment>
    );
  }

  function repairTable(title: string, rows: RepairRow[], kind: "truck" | "trailer" | "other") {
    return (
      <section className={`${styles.sheetSection} ${kind === "truck" ? styles.truckSection : kind === "trailer" ? styles.trailerSection : styles.otherSection}`}>
        <div className={styles.sectionTitle}><div><span>{kind === "truck" ? "TRUCKS" : kind === "trailer" ? "TRAILERS" : "OTHER"}</span><h2>{title}</h2></div><strong>{rows.length}</strong></div>
        <div className={styles.tableWrap}><table className={styles.compactTable}><thead><tr><th>Unit</th><th>Repair / Service Needed</th><th>Status</th><th>Tech</th><th>Actions</th></tr></thead><tbody>
          {rows.map(renderRepairRow)}
          {rows.length === 0 && <tr><td className={styles.empty} colSpan={5}>No open work in this section.</td></tr>}
        </tbody></table></div>
      </section>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>NORLOW SHOP CONTROL</p><h1>Repair Board</h1><p className={styles.subtitle}>Out-of-service equipment first, then truck and trailer repair lists side by side—closer to the shop sheet.</p></div>
        <div className={styles.headerActions}><button className={styles.refresh} onClick={() => void load()}>Refresh</button><a className={styles.primaryLink} href="/work-orders">Full Work Orders</a></div>
      </header>

      {message && <div className={styles.notice}>{message}</div>}

      <section className={styles.metrics}>
        <article><span>OOS Units</span><strong>{data?.summary.oos ?? 0}</strong></article>
        <article><span>Truck Work</span><strong>{data?.summary.trucks ?? 0}</strong></article>
        <article><span>Trailer Work</span><strong>{data?.summary.trailers ?? 0}</strong></article>
        <article><span>DVIR</span><strong>{data?.summary.dvirOpen ?? 0}</strong></article>
        <article><span>PM / Annual</span><strong>{data?.summary.maintenanceDue ?? 0}</strong></article>
        <article><span>Active Labor</span><strong>{data?.summary.activeLabor ?? 0}</strong></article>
      </section>

      <div className={styles.searchBar}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search unit, repair, driver, location, part, technician…" /><span>Rows stay grouped by unit—no priority sorting.</span></div>

      <section className={styles.oosSection}>
        <div className={styles.oosTitle}><div><span>OUT OF SERVICE</span><h2>Units held from service</h2></div><strong>{oosVisible.length}</strong></div>
        {oosVisible.length === 0 ? <div className={styles.oosEmpty}>No units are currently out of service.</div> : <div className={styles.oosGrid}>
          {oosVisible.map((unit) => (
            <article key={unit.equipmentId} className={styles.oosCard}>
              <div className={styles.oosCardHeader}><div><span className={styles.oosType}>{equipmentGroup(unit.equipmentType).toUpperCase()}</span><h3>Unit {unit.unit}</h3></div>{data?.canManage && <button className={styles.returnButton} disabled={busyId === `oos-${unit.equipmentId}`} onClick={() => void returnToService(unit)}>Return to Service</button>}</div>
              <div className={styles.oosMeta}><span>{unit.location || "No location"}</span>{unit.driver && <span>{unit.driver}</span>}{unit.since && <span>OOS since {whenText(unit.since)}</span>}</div>
              <p className={styles.oosReason}>{unit.reason || "No OOS reason entered."}</p>
              <div className={styles.oosWork}><strong>Open work</strong>
                {unit.openWork.length === 0 ? <span className={styles.noWork}>No open repair rows.</span> : unit.openWork.map((work) => {
                  const row = data?.repairs.find((item) => item.id === work.id);
                  return <div key={work.id} className={styles.oosWorkRow}><div><span className={styles.oosWorkSource}>{sourceLabel(work.source)}</span><b>{work.issue}</b><small>{work.status}</small></div>{row && <div className={styles.oosAssign}>{assignmentControl(row)}</div>}</div>;
                })}
              </div>
            </article>
          ))}
        </div>}
      </section>

      <div className={styles.sideBySide}>{repairTable("Truck Repairs", grouped.trucks, "truck")}{repairTable("Trailer Repairs", grouped.trailers, "trailer")}</div>
      {grouped.other.length > 0 && <div className={styles.otherBoard}>{repairTable("Other Equipment Repairs", grouped.other, "other")}</div>}

      <footer className={styles.footer}>{data ? `${data.repairs.length} open work items · ${data.summary.unassigned} unassigned · updated ${new Date(data.updatedAt).toLocaleString()}` : "Loading repair board…"}</footer>
    </main>
  );
}
