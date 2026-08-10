"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import styles from "./repair-board.module.css";

type Role = "viewer" | "mechanic" | "manager" | "admin";
type Source = "repair" | "dvir" | "dvir-repair" | "pm" | "annual" | "pm-repair" | "annual-repair";
type ShopView = "clare" | "cadillac" | "all";
type RepairMode = "equipment" | "freeform";
type Technician = { id: number; name: string };
type EquipmentOption = { id: number; unit: string; equipmentType: string; driver: string; location: string };
type Timer = { startedAt: string; technician: string };
type RepairRow = {
  id: string;
  source: Source;
  priority: number;
  location: string;
  unit: string;
  driver: string;
  issue: string;
  parts: string;
  status: string;
  technicianId: number | null;
  assignedTo: string;
  laborHours: number;
  equipmentType: string;
  equipmentId: number | null;
  outOfService: boolean;
  oosReason: string;
  oosAt: string | null;
  activeTimer: Timer | null;
  dvirDefectId: string;
  dvirLogId: string;
  dvirComments: string;
  dvirPhotos: string;
  maintenanceId: string;
};
type OosUnit = {
  equipmentId: number;
  unit: string;
  equipmentType: string;
  driver: string;
  location: string;
  reason: string;
  since: string | null;
  openWork: { id: string; source: Source; issue: string; assignedTo: string; status: string }[];
};
type BoardData = {
  user: { id: number; username: string; displayName: string; role: Role; technicianId: number | null };
  canManage: boolean;
  technicians: Technician[];
  equipment: EquipmentOption[];
  repairs: RepairRow[];
  oosUnits: OosUnit[];
  summary: { total: number; oos: number; trucks: number; trailers: number; dvirOpen: number; maintenanceDue: number; unassigned: number; activeLabor: number };
  updatedAt: string;
};
type ChangeResult = { ok?: boolean; error?: string; unit?: string; repairId?: string };
type UnitGroup = {
  key: string;
  unit: string;
  equipmentId: number | null;
  equipmentType: string;
  location: string;
  driver: string;
  rows: RepairRow[];
};
type RepairDraft = {
  mode: RepairMode;
  equipmentId: string;
  unit: string;
  equipmentType: "truck" | "trailer" | "other";
  location: string;
  issue: string;
  parts: string;
  priority: number;
  technicianId: string;
};

const statuses = ["New", "Assigned", "Waiting for Parts", "In Progress", "Completed"];
const blankRepairDraft: RepairDraft = {
  mode: "equipment",
  equipmentId: "",
  unit: "",
  equipmentType: "other",
  location: "",
  issue: "",
  parts: "",
  priority: 2,
  technicianId: "",
};

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

function shopForLocation(value: string): "clare" | "cadillac" | "other" {
  const location = value.trim().toLowerCase();
  if (location.includes("clare")) return "clare";
  if (location.includes("cadillac")) return "cadillac";
  return "other";
}

function shopLabel(value: string) {
  const shop = shopForLocation(value);
  if (shop === "clare") return "Clare";
  if (shop === "cadillac") return "Cadillac";
  return "Other";
}

function displayDriver(value: string) {
  const driver = value.trim();
  return driver.includes("@") ? "" : driver;
}

function isRawMaintenance(source: Source) {
  return source === "pm" || source === "annual";
}

function isScheduled(source: Source) {
  return source === "dvir" || isRawMaintenance(source);
}

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

function unitKey(row: RepairRow) {
  if (row.equipmentId) return `equipment-${row.equipmentId}`;
  return `unit-${row.unit.trim().toLowerCase() || row.id}`;
}

function buildUnitGroups(rows: RepairRow[]) {
  const groups = new Map<string, UnitGroup>();
  for (const row of rows) {
    const key = unitKey(row);
    const current = groups.get(key);
    if (current) {
      current.rows.push(row);
      if (!current.location && row.location) current.location = row.location;
      if (!current.driver && displayDriver(row.driver)) current.driver = displayDriver(row.driver);
      continue;
    }
    groups.set(key, {
      key,
      unit: row.unit,
      equipmentId: row.equipmentId,
      equipmentType: row.equipmentType,
      location: row.location,
      driver: displayDriver(row.driver),
      rows: [row],
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort((left, right) => left.priority - right.priority || left.issue.localeCompare(right.issue)),
    }))
    .sort((left, right) => left.unit.localeCompare(right.unit, undefined, { numeric: true, sensitivity: "base" }));
}

function issueSummary(rows: RepairRow[]) {
  const issues = rows.map((row) => row.issue.trim()).filter(Boolean);
  const shown = issues.slice(0, 3).map((issue) => issue.length > 42 ? `${issue.slice(0, 39)}…` : issue);
  return `${shown.join(" • ")}${issues.length > shown.length ? ` + ${issues.length - shown.length} more` : ""}`;
}

function groupWorkload(rows: RepairRow[]) {
  const assigned = rows.filter((row) => row.technicianId !== null).length;
  const unassigned = rows.length - assigned;
  const active = rows.filter((row) => row.activeTimer).length;
  const waiting = rows.filter((row) => row.status.toLowerCase().includes("waiting")).length;
  const dvir = rows.filter((row) => row.source === "dvir" || row.source === "dvir-repair").length;
  const pm = rows.filter((row) => row.source === "pm" || row.source === "pm-repair").length;
  const annual = rows.filter((row) => row.source === "annual" || row.source === "annual-repair").length;
  return { assigned, unassigned, active, waiting, dvir, pm, annual, priority: Math.min(...rows.map((row) => row.priority || 2)) };
}

export default function RepairBoardPage() {
  const [data, setData] = useState<BoardData | null>(null);
  const [query, setQuery] = useState("");
  const [shopView, setShopView] = useState<ShopView>("all");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(() => new Set());
  const [expandedRepairId, setExpandedRepairId] = useState<string | null>(null);
  const [showAddRepair, setShowAddRepair] = useState(false);
  const [newRepair, setNewRepair] = useState<RepairDraft>(blankRepairDraft);

  async function load() {
    const response = await fetch("/api/repair-board", { cache: "no-store" });
    const payload = await response.json() as BoardData & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Repair board could not be loaded.");
    setData(payload);
  }

  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : "Repair board could not be loaded."));
  }, []);

  async function change(rowId: string, body: Record<string, unknown>) {
    setBusyId(rowId);
    setMessage("");
    try {
      const response = await fetch("/api/repair-board", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repairId: rowId, ...body }),
      });
      const result = await response.json() as ChangeResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "Repair-board change failed.");
      await load();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Repair-board change failed.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function createBoardRepair() {
    if (newRepair.mode === "equipment" && !newRepair.equipmentId) {
      setMessage("Choose the equipment this repair belongs to.");
      return;
    }
    if (newRepair.mode === "freeform" && !newRepair.unit.trim()) {
      setMessage("Enter a unit or equipment name for the freeform repair.");
      return;
    }
    if (!newRepair.issue.trim()) {
      setMessage("Enter the repair needed.");
      return;
    }
    setBusyId("create-repair");
    setMessage("");
    try {
      const response = await fetch("/api/repair-board", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "createRepair",
          mode: newRepair.mode,
          equipmentId: newRepair.mode === "equipment" ? Number(newRepair.equipmentId) : 0,
          unit: newRepair.unit,
          equipmentType: newRepair.equipmentType,
          location: newRepair.location,
          issue: newRepair.issue,
          parts: newRepair.parts,
          priority: newRepair.priority,
          technicianId: newRepair.technicianId ? Number(newRepair.technicianId) : 0,
        }),
      });
      const result = await response.json() as ChangeResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "Repair could not be added.");
      await load();
      setShopView("all");
      setShowAddRepair(false);
      setNewRepair(blankRepairDraft);
      setMessage(`Repair added${result.unit ? ` to Unit ${result.unit}` : ""}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Repair could not be added.");
    } finally {
      setBusyId(null);
    }
  }

  function toggleUnit(key: string) {
    setExpandedUnits((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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

  async function completeRepair(row: RepairRow) {
    if (!window.confirm(`Complete this repair for Unit ${row.unit || "—"}?\n\n${row.issue}`)) return;
    const ok = await change(row.id, { action: "setStatus", status: "Completed" });
    if (ok) setMessage("Repair completed.");
  }

  async function placeOos(row: RepairRow) {
    const reason = window.prompt(`Why is Unit ${row.unit || "—"} out of service?`, row.issue || "");
    if (reason === null) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setMessage("Enter an out-of-service reason.");
      return;
    }
    const ok = await change(`oos-${row.equipmentId ?? row.unit}`, {
      action: "setUnitOos",
      equipmentId: row.equipmentId,
      unit: row.unit,
      outOfService: true,
      reason: trimmed,
    });
    if (ok) setMessage(`Unit ${row.unit} is now out of service.`);
  }

  async function returnToService(unit: OosUnit) {
    if (!window.confirm(`Return Unit ${unit.unit} to service?`)) return;
    const ok = await change(`oos-${unit.equipmentId}`, {
      action: "setUnitOos",
      equipmentId: unit.equipmentId,
      outOfService: false,
      reason: "Returned to service",
    });
    if (ok) setMessage(`Unit ${unit.unit} returned to service.`);
  }

  const searchFiltered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data?.repairs ?? [];
    return (data?.repairs ?? []).filter((row) => [
      row.unit,
      row.location,
      displayDriver(row.driver),
      row.issue,
      row.parts,
      row.status,
      row.assignedTo,
      row.dvirComments,
      sourceLabel(row.source),
    ].join(" ").toLowerCase().includes(needle));
  }, [data, query]);

  const visible = useMemo(() => {
    const filtered = searchFiltered.filter((row) => shopView === "all" || shopForLocation(row.location) === shopView);
    if (shopView !== "all") return filtered;
    return [...filtered].sort((left, right) => {
      const rank = (location: string) => shopForLocation(location) === "clare" ? 0 : shopForLocation(location) === "cadillac" ? 1 : 2;
      return rank(left.location) - rank(right.location) || left.unit.localeCompare(right.unit, undefined, { numeric: true, sensitivity: "base" });
    });
  }, [searchFiltered, shopView]);

  const activeVisible = useMemo(() => visible.filter((row) => !row.outOfService), [visible]);
  const truckGroups = useMemo(() => buildUnitGroups(activeVisible.filter((row) => equipmentGroup(row.equipmentType) === "truck")), [activeVisible]);
  const trailerGroups = useMemo(() => buildUnitGroups(activeVisible.filter((row) => equipmentGroup(row.equipmentType) === "trailer")), [activeVisible]);
  const otherGroups = useMemo(() => buildUnitGroups(activeVisible.filter((row) => equipmentGroup(row.equipmentType) === "other")), [activeVisible]);

  const oosVisible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.oosUnits ?? []).filter((unit) => {
      if (shopView !== "all" && shopForLocation(unit.location) !== shopView) return false;
      if (!needle) return true;
      return [
        unit.unit,
        unit.location,
        displayDriver(unit.driver),
        unit.reason,
        unit.equipmentType,
        ...unit.openWork.flatMap((work) => [work.issue, work.assignedTo, work.status, sourceLabel(work.source)]),
      ].join(" ").toLowerCase().includes(needle);
    }).sort((left, right) => {
      if (shopView !== "all") return left.unit.localeCompare(right.unit, undefined, { numeric: true, sensitivity: "base" });
      const rank = (location: string) => shopForLocation(location) === "clare" ? 0 : shopForLocation(location) === "cadillac" ? 1 : 2;
      return rank(left.location) - rank(right.location) || left.unit.localeCompare(right.unit, undefined, { numeric: true, sensitivity: "base" });
    });
  }, [data, query, shopView]);

  const shopCounts = useMemo(() => {
    const rows = data?.repairs ?? [];
    return {
      clare: rows.filter((row) => shopForLocation(row.location) === "clare").length,
      cadillac: rows.filter((row) => shopForLocation(row.location) === "cadillac").length,
      all: rows.length,
    };
  }, [data]);

  function assignmentControl(row: RepairRow) {
    if (!data?.canManage) return <span className={styles.assignmentText}>{row.assignedTo || "Unassigned"}</span>;
    if (row.source === "dvir") {
      return (
        <select
          className={styles.techSelect}
          value=""
          disabled={busyId === row.id}
          onChange={(event) => {
            const id = Number(event.target.value);
            if (id > 0) void addDvirRepair(row, id);
          }}
        >
          <option value="">Assign & create…</option>
          {data.technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}
        </select>
      );
    }
    if (isRawMaintenance(row.source)) {
      return (
        <select
          className={styles.techSelect}
          value=""
          disabled={busyId === row.id}
          onChange={(event) => {
            const id = Number(event.target.value);
            if (id > 0) void addMaintenanceRepair(row, id);
          }}
        >
          <option value="">Assign & create…</option>
          {data.technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}
        </select>
      );
    }
    return (
      <select
        className={styles.techSelect}
        value={row.technicianId ?? ""}
        disabled={busyId === row.id}
        onChange={(event) => void change(row.id, { action: "assignTechnician", technicianId: event.target.value ? Number(event.target.value) : 0 })}
      >
        <option value="">Unassigned</option>
        {data.technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}
      </select>
    );
  }

  function renderRepairChild(row: RepairRow) {
    const rawDvir = row.source === "dvir";
    const rawMaintenance = isRawMaintenance(row.source);
    const busy = busyId === row.id;
    const driver = displayDriver(row.driver);
    return (
      <Fragment key={row.id}>
        <tr className={`${row.priority === 1 ? styles.childPriorityOne : ""} ${rawDvir ? styles.childDvir : ""} ${rawMaintenance ? styles.childMaintenance : ""}`.trim()}>
          <td>
            <div className={styles.childTypeLine}>
              <span className={`${styles.sourceBadge} ${rawDvir ? styles.dvirBadge : rawMaintenance ? styles.maintenanceBadge : styles.repairBadge}`}>{sourceLabel(row.source)}</span>
              {data?.canManage && !isScheduled(row.source) ? (
                <select className={styles.prioritySelect} value={row.priority} disabled={busy} onChange={(event) => void change(row.id, { action: "setPriority", priority: Number(event.target.value) })}>
                  <option value={1}>P1</option>
                  <option value={2}>P2</option>
                  <option value={3}>P3</option>
                </select>
              ) : <span className={styles.priorityBadge}>P{row.priority}</span>}
            </div>
          </td>
          <td className={styles.childIssue}>
            <strong>{row.issue}</strong>
            {rawDvir && row.dvirComments && <span>{row.dvirComments}</span>}
          </td>
          <td className={styles.childParts}>{row.parts || <span className={styles.muted}>—</span>}</td>
          <td>
            {data?.canManage && !isScheduled(row.source) ? (
              <select className={styles.statusSelect} value={row.status} disabled={busy} onChange={(event) => void change(row.id, { action: "setStatus", status: event.target.value })}>
                {statuses.map((status) => <option key={status}>{status}</option>)}
              </select>
            ) : <span className={styles.statusBadge}>{row.status}</span>}
            {row.activeTimer && <span className={styles.timerBadge}>{row.activeTimer.technician || row.assignedTo || "Tech"} · {runningDuration(row.activeTimer.startedAt)}</span>}
          </td>
          <td>{assignmentControl(row)}</td>
          <td className={styles.childActions}>
            <button className={styles.smallButton} type="button" onClick={() => setExpandedRepairId((current) => current === row.id ? null : row.id)}>
              {expandedRepairId === row.id ? "Close" : "Details"}
            </button>
            {rawDvir ? data?.canManage && (
              <>
                <button className={styles.actionButton} disabled={busy} onClick={() => void addDvirRepair(row)}>Add Repair</button>
                <button className={styles.completeButton} disabled={busy} onClick={() => void markDvirRepaired(row)}>Repaired</button>
              </>
            ) : rawMaintenance ? data?.canManage && (
              <>
                <button className={styles.actionButton} disabled={busy} onClick={() => void addMaintenanceRepair(row)}>Work Order</button>
                <button className={styles.completeButton} disabled={busy} onClick={() => void completeMaintenance(row)}>Complete</button>
              </>
            ) : (
              <>
                <a className={styles.actionLink} href="/work-orders">Work Order</a>
                {data?.canManage && <button className={styles.completeButton} disabled={busy} onClick={() => void completeRepair(row)}>Complete</button>}
              </>
            )}
          </td>
        </tr>
        {expandedRepairId === row.id && (
          <tr className={styles.repairDetailsRow}>
            <td colSpan={6}>
              <div className={styles.detailsGrid}>
                <div><span>Unit</span><strong>{row.unit || "—"}</strong></div>
                <div><span>Location</span><strong>{row.location || "—"}</strong></div>
                {driver && <div><span>Driver</span><strong>{driver}</strong></div>}
                <div><span>Labor</span><strong>{row.laborHours.toFixed(2)} hr</strong></div>
                <div><span>Assigned</span><strong>{row.assignedTo || "Unassigned"}</strong></div>
                {data?.canManage && row.source === "repair" && (
                  <div>
                    <span>Move to Unit</span>
                    <select
                      className={styles.techSelect}
                      value={row.equipmentId ?? ""}
                      disabled={busy}
                      onChange={(event) => {
                        const equipmentId = Number(event.target.value);
                        const equipment = data.equipment.find((item) => item.id === equipmentId);
                        if (equipmentId > 0 && equipmentId !== row.equipmentId) {
                          void change(row.id, { action: "moveRepairToEquipment", equipmentId }).then((ok) => {
                            if (ok) setMessage(`Repair moved to Unit ${equipment?.unit ?? "selected equipment"}.`);
                          });
                        }
                      }}
                    >
                      <option value="">Choose equipment…</option>
                      {data.equipment.map((item) => <option key={item.id} value={item.id}>{item.unit} — {equipmentGroup(item.equipmentType).toUpperCase()}{item.location ? ` — ${item.location}` : ""}</option>)}
                    </select>
                  </div>
                )}
                {row.dvirPhotos && <div><span>DVIR Photos</span><a href={row.dvirPhotos} target="_blank" rel="noreferrer">View photos</a></div>}
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  function renderUnitGroup(group: UnitGroup) {
    const expanded = expandedUnits.has(group.key);
    const workload = groupWorkload(group.rows);
    const driver = displayDriver(group.driver);
    return (
      <Fragment key={group.key}>
        <tr className={`${styles.unitSummaryRow} ${workload.priority === 1 ? styles.unitPriorityOne : ""}`}>
          <td className={styles.unitColumn}>
            <strong>Unit {group.unit || "—"}</strong>
            {driver && <span>{driver}</span>}
          </td>
          <td className={styles.summaryColumn}>
            <button className={styles.repairToggle} type="button" onClick={() => toggleUnit(group.key)}>
              <span className={styles.repairCount}>{group.rows.length} Repair{group.rows.length === 1 ? "" : "s"}</span>
              <span className={styles.chevron}>{expanded ? "▲" : "▼"}</span>
            </button>
            <span className={styles.issueSummary}>{issueSummary(group.rows)}</span>
          </td>
          <td className={styles.locationColumn}>
            <span className={`${styles.shopBadge} ${shopForLocation(group.location) === "clare" ? styles.clareBadge : shopForLocation(group.location) === "cadillac" ? styles.cadillacBadge : styles.otherBadge}`}>{shopLabel(group.location)}</span>
            <span>{group.location || "Location not set"}</span>
          </td>
          <td className={styles.workloadColumn}>
            <div className={styles.workloadBadges}>
              <span className={workload.priority === 1 ? styles.priorityHot : styles.priorityCool}>P{workload.priority}</span>
              {workload.dvir > 0 && <span>{workload.dvir} DVIR</span>}
              {workload.pm > 0 && <span>{workload.pm} PM</span>}
              {workload.annual > 0 && <span>{workload.annual} Annual</span>}
              <span>{workload.assigned} assigned</span>
              {workload.unassigned > 0 && <span className={styles.unassignedBadge}>{workload.unassigned} open</span>}
              {workload.waiting > 0 && <span>{workload.waiting} parts</span>}
              {workload.active > 0 && <span className={styles.activeBadge}>{workload.active} working</span>}
            </div>
          </td>
          <td className={styles.unitActions}>
            <button className={styles.expandButton} type="button" onClick={() => toggleUnit(group.key)}>{expanded ? "Hide" : "Repairs"}</button>
            {data?.canManage && <button className={styles.oosButton} type="button" disabled={busyId === `oos-${group.equipmentId ?? group.unit}`} onClick={() => void placeOos(group.rows[0])}>OOS</button>}
          </td>
        </tr>
        {expanded && (
          <tr className={styles.unitExpandedRow}>
            <td colSpan={5}>
              <div className={styles.childTableWrap}>
                <table className={styles.childTable}>
                  <thead>
                    <tr><th>Type</th><th>Repair / Service</th><th>Parts</th><th>Status</th><th>Technician</th><th>Actions</th></tr>
                  </thead>
                  <tbody>{group.rows.map(renderRepairChild)}</tbody>
                </table>
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  function repairTable(title: string, groups: UnitGroup[], kind: "truck" | "trailer" | "other") {
    const jobCount = groups.reduce((sum, group) => sum + group.rows.length, 0);
    return (
      <section className={`${styles.sheetSection} ${kind === "truck" ? styles.truckSection : kind === "trailer" ? styles.trailerSection : styles.otherSection}`}>
        <div className={styles.sectionTitle}>
          <div><span>{kind === "truck" ? "TRUCKS" : kind === "trailer" ? "TRAILERS" : "OTHER EQUIPMENT"}</span><h2>{title}</h2></div>
          <strong>{groups.length} units · {jobCount} jobs</strong>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.unitTable}>
            <thead><tr><th>Unit</th><th>Repairs / Summary</th><th>Location</th><th>Workload</th><th>Actions</th></tr></thead>
            <tbody>
              {groups.map(renderUnitGroup)}
              {groups.length === 0 && <tr><td className={styles.empty} colSpan={5}>No open work in this section.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  const currentShopName = shopView === "clare" ? "Clare Shop" : shopView === "cadillac" ? "Cadillac Shop" : "All Shops";

  return (
    <main className={styles.page}>
      <div className={styles.sheetBanner}><strong>REPAIR LIST</strong><span>{currentShopName}</span></div>

      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NORLOW SHOP CONTROL</p>
          <h1>Repair Board</h1>
          <p className={styles.subtitle}>All open repairs, DVIRs, PMs, and annuals are shown by default. Clare work stays pinned first; use the shop tabs when you want a location-only view.</p>
        </div>
        <div className={styles.headerActions}>
          {data?.canManage && <button className={styles.primaryLink} style={{ cursor: "pointer" }} onClick={() => setShowAddRepair((current) => !current)}>{showAddRepair ? "Close Add Repair" : "+ Add Repair"}</button>}
          <button className={styles.refresh} onClick={() => void load()}>Refresh</button>
          <a className={styles.primaryLink} href="/work-orders">Full Work Orders</a>
        </div>
      </header>

      {message && <div className={styles.notice}>{message}</div>}

      {showAddRepair && data?.canManage && (
        <section style={{ margin: "4px 0 12px", border: "2px solid #d87816", background: "#fffaf2", padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
            <div><strong style={{ fontSize: 14 }}>Add Repair</strong><div style={{ marginTop: 2, color: "#6b7280", fontSize: 10 }}>Choose existing equipment whenever it is already in the fleet. That attaches the repair to the exact unit and keeps every repair grouped together.</div></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
            <label style={{ fontSize: 9, fontWeight: 900, color: "#59646c" }}>EQUIPMENT SOURCE
              <select className={styles.techSelect} value={newRepair.mode} onChange={(event) => setNewRepair((current) => ({ ...current, mode: event.target.value as RepairMode, equipmentId: "" }))}>
                <option value="equipment">Existing Equipment</option>
                <option value="freeform">Freeform / Other Equipment</option>
              </select>
            </label>
            {newRepair.mode === "equipment" ? (
              <label style={{ fontSize: 9, fontWeight: 900, color: "#59646c" }}>UNIT / EQUIPMENT
                <select className={styles.techSelect} value={newRepair.equipmentId} onChange={(event) => setNewRepair((current) => ({ ...current, equipmentId: event.target.value }))}>
                  <option value="">Choose equipment…</option>
                  {data.equipment.map((item) => <option key={item.id} value={item.id}>{item.unit} — {equipmentGroup(item.equipmentType).toUpperCase()}{item.location ? ` — ${item.location}` : ""}</option>)}
                </select>
              </label>
            ) : (
              <>
                <label style={{ fontSize: 9, fontWeight: 900, color: "#59646c" }}>UNIT / NAME
                  <input className={styles.techSelect} value={newRepair.unit} onChange={(event) => setNewRepair((current) => ({ ...current, unit: event.target.value }))} placeholder="454(SC), forklift, plow truck…" />
                </label>
                <label style={{ fontSize: 9, fontWeight: 900, color: "#59646c" }}>EQUIPMENT TYPE
                  <select className={styles.techSelect} value={newRepair.equipmentType} onChange={(event) => setNewRepair((current) => ({ ...current, equipmentType: event.target.value as RepairDraft["equipmentType"] }))}>
                    <option value="other">Other Equipment</option>
                    <option value="truck">Truck</option>
                    <option value="trailer">Trailer</option>
                  </select>
                </label>
                <label style={{ fontSize: 9, fontWeight: 900, color: "#59646c" }}>LOCATION
                  <input className={styles.techSelect} value={newRepair.location} onChange={(event) => setNewRepair((current) => ({ ...current, location: event.target.value }))} placeholder="Clare, Cadillac, road…" />
                </label>
              </>
            )}
            <label style={{ fontSize: 9, fontWeight: 900, color: "#59646c" }}>REPAIR NEEDED
              <input className={styles.techSelect} value={newRepair.issue} onChange={(event) => setNewRepair((current) => ({ ...current, issue: event.target.value }))} placeholder="Describe the repair" />
            </label>
            <label style={{ fontSize: 9, fontWeight: 900, color: "#59646c" }}>PARTS NEEDED
              <input className={styles.techSelect} value={newRepair.parts} onChange={(event) => setNewRepair((current) => ({ ...current, parts: event.target.value }))} placeholder="Optional" />
            </label>
            <label style={{ fontSize: 9, fontWeight: 900, color: "#59646c" }}>PRIORITY
              <select className={styles.techSelect} value={newRepair.priority} onChange={(event) => setNewRepair((current) => ({ ...current, priority: Number(event.target.value) }))}>
                <option value={1}>P1 — High</option>
                <option value={2}>P2 — Normal</option>
                <option value={3}>P3 — Low</option>
              </select>
            </label>
            <label style={{ fontSize: 9, fontWeight: 900, color: "#59646c" }}>ASSIGN TECH
              <select className={styles.techSelect} value={newRepair.technicianId} onChange={(event) => setNewRepair((current) => ({ ...current, technicianId: event.target.value }))}>
                <option value="">Unassigned</option>
                {data.technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}
              </select>
            </label>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 7, justifyContent: "flex-end" }}>
            <button className={styles.refresh} disabled={busyId === "create-repair"} onClick={() => { setShowAddRepair(false); setNewRepair(blankRepairDraft); }}>Cancel</button>
            <button className={styles.primaryLink} style={{ cursor: "pointer" }} disabled={busyId === "create-repair"} onClick={() => void createBoardRepair()}>{busyId === "create-repair" ? "Adding…" : "Add Repair"}</button>
          </div>
        </section>
      )}

      <nav className={styles.shopTabs} aria-label="Shop view">
        <button className={shopView === "all" ? styles.activeShopTab : ""} onClick={() => setShopView("all")}><span>All Shops</span><b>{shopCounts.all}</b></button>
        <button className={shopView === "clare" ? styles.activeShopTab : ""} onClick={() => setShopView("clare")}><span>Clare Shop</span><b>{shopCounts.clare}</b></button>
        <button className={shopView === "cadillac" ? styles.activeShopTab : ""} onClick={() => setShopView("cadillac")}><span>Cadillac Shop</span><b>{shopCounts.cadillac}</b></button>
      </nav>

      <section className={styles.metrics}>
        <article><span>OOS Units</span><strong>{oosVisible.length}</strong></article>
        <article><span>Open Work</span><strong>{visible.length}</strong></article>
        <article><span>DVIR</span><strong>{visible.filter((row) => row.source === "dvir" || row.source === "dvir-repair").length}</strong></article>
        <article><span>PM / Annual</span><strong>{visible.filter((row) => ["pm", "annual", "pm-repair", "annual-repair"].includes(row.source)).length}</strong></article>
        <article><span>Unassigned</span><strong>{visible.filter((row) => row.technicianId === null).length}</strong></article>
        <article><span>Active Labor</span><strong>{visible.filter((row) => row.activeTimer).length}</strong></article>
      </section>

      <div className={styles.searchBar}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search unit, repair, location, part, technician…" />
        <span>All work sources stay visible unless you choose a shop-only filter.</span>
      </div>

      <section className={styles.oosSection}>
        <div className={styles.oosTitle}><div><span>OUT OF SERVICE</span><h2>{currentShopName} OOS</h2></div><strong>{oosVisible.length}</strong></div>
        <div className={styles.oosTableWrap}>
          <table className={styles.oosTable}>
            <thead><tr><th>Unit</th><th>Location</th><th>OOS Reason</th><th>Open Repairs</th><th>Action</th></tr></thead>
            <tbody>
              {oosVisible.map((unit) => {
                const key = `oos-unit-${unit.equipmentId}`;
                const expanded = expandedUnits.has(key);
                const openRows = unit.openWork.map((work) => data?.repairs.find((row) => row.id === work.id)).filter((row): row is RepairRow => Boolean(row));
                return (
                  <Fragment key={unit.equipmentId}>
                    <tr className={styles.oosUnitRow}>
                      <td><strong>Unit {unit.unit}</strong><span>{equipmentGroup(unit.equipmentType).toUpperCase()}</span></td>
                      <td><span className={styles.shopBadge}>{shopLabel(unit.location)}</span><small>{unit.location || "Location not set"}</small></td>
                      <td><strong>{unit.reason || "No OOS reason entered."}</strong>{unit.since && <small>Since {whenText(unit.since)}</small>}</td>
                      <td><button className={styles.oosRepairToggle} type="button" onClick={() => toggleUnit(key)}>{unit.openWork.length} Repair{unit.openWork.length === 1 ? "" : "s"} {expanded ? "▲" : "▼"}</button></td>
                      <td>{data?.canManage && <button className={styles.returnButton} disabled={busyId === `oos-${unit.equipmentId}`} onClick={() => void returnToService(unit)}>Return to Service</button>}</td>
                    </tr>
                    {expanded && (
                      <tr className={styles.oosExpandedRow}>
                        <td colSpan={5}>
                          {openRows.length ? (
                            <div className={styles.childTableWrap}>
                              <table className={styles.childTable}>
                                <thead><tr><th>Type</th><th>Repair / Service</th><th>Parts</th><th>Status</th><th>Technician</th><th>Actions</th></tr></thead>
                                <tbody>{openRows.map(renderRepairChild)}</tbody>
                              </table>
                            </div>
                          ) : <div className={styles.oosNoRepairs}>No open repair rows are attached to this OOS unit.</div>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {oosVisible.length === 0 && <tr><td className={styles.empty} colSpan={5}>No units are currently out of service in this view.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className={styles.sideBySide}>
        {repairTable("Truck Repair List", truckGroups, "truck")}
        {repairTable("Trailer Repair List", trailerGroups, "trailer")}
      </div>
      {otherGroups.length > 0 && <div className={styles.otherBoard}>{repairTable("Other Equipment", otherGroups, "other")}</div>}

      <footer className={styles.footer}>{data ? `${visible.length} open work items in ${currentShopName} · updated ${new Date(data.updatedAt).toLocaleString()}` : "Loading repair board…"}</footer>
    </main>
  );
}
