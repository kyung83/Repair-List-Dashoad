"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import styles from "./repair-board.module.css";

type Role = "viewer" | "mechanic" | "manager" | "admin";
type Source = "repair" | "dvir" | "dvir-repair" | "pm" | "annual" | "pm-repair" | "annual-repair";
type ShopView = "clare" | "cadillac" | "all";
type BoardView = "priority" | "type" | "lot";
type RepairMode = "equipment" | "freeform";
type RepairEquipmentType = "" | "truck" | "trailer" | "other";
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
type EtaData = { etaByEquipment: Record<string, string> };
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
  equipmentType: RepairEquipmentType;
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
  equipmentType: "",
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
  if (source === "pm-repair") return "PM Job";
  if (source === "annual-repair") return "Annual Job";
  return "Repair";
}

function equipmentGroup(value: string): "truck" | "trailer" | "other" {
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

function isPmSource(source: Source) {
  return source === "pm" || source === "pm-repair";
}

function isAnnualSource(source: Source) {
  return source === "annual" || source === "annual-repair";
}

function isRepairSource(source: Source) {
  return !isPmSource(source) && !isAnnualSource(source);
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
  return [...groups.values()].map((group) => ({
    ...group,
    rows: [...group.rows].sort((left, right) => left.priority - right.priority || left.issue.localeCompare(right.issue)),
  }));
}

function issueSummary(rows: RepairRow[]) {
  const issues = rows.map((row) => row.issue.trim()).filter(Boolean);
  const shown = issues.slice(0, 3).map((issue) => issue.length > 58 ? `${issue.slice(0, 55)}…` : issue);
  return `${shown.join(" • ")}${issues.length > shown.length ? ` + ${issues.length - shown.length} more` : ""}`;
}

function groupCountLabel(rows: RepairRow[]) {
  if (rows.length && rows.every((row) => isPmSource(row.source))) return `${rows.length} PM${rows.length === 1 ? "" : "s"}`;
  if (rows.length && rows.every((row) => isAnnualSource(row.source))) return `${rows.length} Annual${rows.length === 1 ? "" : "s"}`;
  const hasMaintenance = rows.some((row) => isPmSource(row.source) || isAnnualSource(row.source));
  return `${rows.length} ${hasMaintenance ? "items" : `repair${rows.length === 1 ? "" : "s"}`}`;
}

function groupPriority(group: UnitGroup) {
  return Math.min(...group.rows.map((row) => row.priority || 2));
}

function groupAction(group: UnitGroup) {
  if (group.rows.every((row) => row.status.toLowerCase().includes("waiting"))) return "Waiting parts";
  if (group.rows.some((row) => row.activeTimer)) return "In progress";
  if (group.rows.some((row) => row.technicianId === null)) return "Needs tech";
  if (group.rows.some((row) => isScheduled(row.source))) return "Needs job";
  return "Assigned";
}

function prioritySort(left: UnitGroup, right: UnitGroup) {
  const score = (group: UnitGroup) => {
    const priority = groupPriority(group) * 100;
    const waiting = group.rows.every((row) => row.status.toLowerCase().includes("waiting")) ? 40 : 0;
    const active = group.rows.some((row) => row.activeTimer) ? 30 : 0;
    const assigned = group.rows.every((row) => row.technicianId !== null) ? 10 : 0;
    return priority + waiting + active + assigned;
  };
  return score(left) - score(right) || left.unit.localeCompare(right.unit, undefined, { numeric: true, sensitivity: "base" });
}

export default function RepairBoardPage() {
  const [data, setData] = useState<BoardData | null>(null);
  const [etaByEquipment, setEtaByEquipment] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [shopView, setShopView] = useState<ShopView>("all");
  const [boardView, setBoardView] = useState<BoardView>("priority");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(() => new Set());
  const [expandedRepairId, setExpandedRepairId] = useState<string | null>(null);
  const [showAddRepair, setShowAddRepair] = useState(false);
  const [newRepair, setNewRepair] = useState<RepairDraft>(blankRepairDraft);
  const [equipmentLookup, setEquipmentLookup] = useState("");
  const [lotSeen, setLotSeen] = useState<Set<number>>(() => new Set());
  const [lotLoaded, setLotLoaded] = useState(false);

  async function load() {
    const [response, etaResponse] = await Promise.all([
      fetch("/api/repair-board", { cache: "no-store" }),
      fetch("/api/repair-board/eta", { cache: "no-store" }),
    ]);
    const payload = await response.json() as BoardData & { error?: string };
    const etaPayload = await etaResponse.json() as EtaData & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Repair board could not be loaded.");
    if (!etaResponse.ok) throw new Error(etaPayload.error || "Unit ETAs could not be loaded.");
    setData(payload);
    setEtaByEquipment(etaPayload.etaByEquipment ?? {});
  }

  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : "Repair board could not be loaded."));
  }, []);

  useEffect(() => {
    try {
      const key = `norlow-lot-check-${new Date().toISOString().slice(0, 10)}`;
      const stored = window.localStorage.getItem(key);
      const ids = stored ? JSON.parse(stored) as number[] : [];
      setLotSeen(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
    } catch {
      setLotSeen(new Set());
    } finally {
      setLotLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!lotLoaded) return;
    const key = `norlow-lot-check-${new Date().toISOString().slice(0, 10)}`;
    window.localStorage.setItem(key, JSON.stringify([...lotSeen]));
  }, [lotLoaded, lotSeen]);

  async function requestChange(rowId: string, body: Record<string, unknown>) {
    const response = await fetch("/api/repair-board", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repairId: rowId, ...body }),
    });
    const result = await response.json() as ChangeResult;
    if (!response.ok || !result.ok) throw new Error(result.error || "Repair-board change failed.");
    return result;
  }

  async function change(rowId: string, body: Record<string, unknown>) {
    setBusyId(rowId);
    setMessage("");
    try {
      await requestChange(rowId, body);
      await load();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Repair-board change failed.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function editUnitEta(equipmentId: number, unit: string) {
    const current = etaByEquipment[String(equipmentId)] ?? "";
    const next = window.prompt(`ETA / driver coming through for Unit ${unit || "—"}\n\nExamples: Today 3:30, Tomorrow AM, Friday`, current);
    if (next === null) return;
    setBusyId(`eta-${equipmentId}`);
    setMessage("");
    try {
      const response = await fetch("/api/repair-board/eta", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ equipmentId, eta: next }),
      });
      const result = await response.json() as ChangeResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "Unit ETA could not be saved.");
      await load();
      setMessage(next.trim() ? `Unit ${unit} ETA set to ${next.trim()}.` : `Unit ${unit} ETA cleared.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unit ETA could not be saved.");
    } finally {
      setBusyId(null);
    }
  }

  async function createBoardRepair() {
    if (!newRepair.equipmentType) return setMessage("Choose an equipment type first.");
    if (newRepair.mode === "equipment" && !newRepair.equipmentId) return setMessage("Choose the matching equipment this repair belongs to.");
    if (newRepair.mode === "freeform" && !newRepair.unit.trim()) return setMessage("Enter a unit or equipment name for the freeform repair.");
    if (!newRepair.issue.trim()) return setMessage("Enter the repair needed.");
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
      setShowAddRepair(false);
      setNewRepair(blankRepairDraft);
      setEquipmentLookup("");
      setMessage(`Repair added${result.unit ? ` to Unit ${result.unit}` : ""}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Repair could not be added.");
    } finally {
      setBusyId(null);
    }
  }

  function startRepairForEquipment(item: EquipmentOption) {
    setNewRepair({ ...blankRepairDraft, mode: "equipment", equipmentId: String(item.id), equipmentType: equipmentGroup(item.equipmentType) });
    setEquipmentLookup(item.unit);
    setShowAddRepair(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleUnit(key: string) {
    setExpandedUnits((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleLotSeen(equipmentId: number) {
    setLotSeen((current) => {
      const next = new Set(current);
      if (next.has(equipmentId)) next.delete(equipmentId);
      else next.add(equipmentId);
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
    if (ok) setMessage(technicianId ? "Maintenance job created and assigned." : "Maintenance job created.");
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

  async function assignGroupTechnician(group: UnitGroup, technicianId: number) {
    const pending = group.rows.filter((row) => row.technicianId === null);
    if (!pending.length || technicianId <= 0) return;
    const busyKey = `assign-${group.key}`;
    setBusyId(busyKey);
    setMessage("");
    try {
      for (const row of pending) {
        if (row.source === "dvir") await requestChange(row.id, { action: "createDvirRepair", defectId: row.dvirDefectId, technicianId });
        else if (isRawMaintenance(row.source)) await requestChange(row.id, { action: "createMaintenanceRepair", maintenanceId: row.maintenanceId || row.id, technicianId });
        else await requestChange(row.id, { action: "assignTechnician", technicianId });
      }
      await load();
      const technician = data?.technicians.find((item) => item.id === technicianId)?.name ?? "technician";
      setMessage(`Assigned ${pending.length} unassigned item${pending.length === 1 ? "" : "s"} for Unit ${group.unit} to ${technician}. Existing assignments were left alone.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The unit work could not be assigned.");
      await load().catch(() => undefined);
    } finally {
      setBusyId(null);
    }
  }

  async function placeOos(row: RepairRow) {
    const reason = window.prompt(`Why is Unit ${row.unit || "—"} out of service?`, row.issue || "");
    if (reason === null) return;
    const trimmed = reason.trim();
    if (!trimmed) return setMessage("Enter an out-of-service reason.");
    const ok = await change(`oos-${row.equipmentId ?? row.unit}`, { action: "setUnitOos", equipmentId: row.equipmentId, unit: row.unit, outOfService: true, reason: trimmed });
    if (ok) setMessage(`Unit ${row.unit} is now out of service.`);
  }

  async function returnToService(unit: OosUnit) {
    if (!window.confirm(`Return Unit ${unit.unit} to service?`)) return;
    const ok = await change(`oos-${unit.equipmentId}`, { action: "setUnitOos", equipmentId: unit.equipmentId, outOfService: false, reason: "Returned to service" });
    if (ok) setMessage(`Unit ${unit.unit} returned to service.`);
  }

  const matchingEquipment = useMemo(() => {
    if (!newRepair.equipmentType) return [];
    const needle = equipmentLookup.trim().toLowerCase();
    return (data?.equipment ?? [])
      .filter((item) => equipmentGroup(item.equipmentType) === newRepair.equipmentType)
      .filter((item) => !needle || [item.unit, item.location, displayDriver(item.driver)].join(" ").toLowerCase().includes(needle))
      .sort((left, right) => left.unit.localeCompare(right.unit, undefined, { numeric: true, sensitivity: "base" }))
      .slice(0, 75);
  }, [data, equipmentLookup, newRepair.equipmentType]);

  const searchFiltered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data?.repairs ?? [];
    return (data?.repairs ?? []).filter((row) => [row.unit, row.location, displayDriver(row.driver), row.issue, row.parts, row.status, row.assignedTo, row.dvirComments, sourceLabel(row.source), row.equipmentId ? etaByEquipment[String(row.equipmentId)] ?? "" : ""].join(" ").toLowerCase().includes(needle));
  }, [data, etaByEquipment, query]);

  const visible = useMemo(() => searchFiltered.filter((row) => shopView === "all" || shopForLocation(row.location) === shopView), [searchFiltered, shopView]);
  const activeVisible = useMemo(() => visible.filter((row) => !row.outOfService), [visible]);
  const priorityGroups = useMemo(() => buildUnitGroups(activeVisible).sort(prioritySort), [activeVisible]);

  const boardSections = useMemo(() => {
    const truckRows = activeVisible.filter((row) => equipmentGroup(row.equipmentType) === "truck");
    const trailerRows = activeVisible.filter((row) => equipmentGroup(row.equipmentType) === "trailer");
    const otherRows = activeVisible.filter((row) => equipmentGroup(row.equipmentType) === "other");
    const truckRepairKeys = new Set(truckRows.filter((row) => isRepairSource(row.source)).map(unitKey));
    const sortGroups = (groups: UnitGroup[]) => groups.sort((left, right) => left.unit.localeCompare(right.unit, undefined, { numeric: true, sensitivity: "base" }));
    return {
      truckRepairGroups: sortGroups(buildUnitGroups(truckRows.filter((row) => isRepairSource(row.source) || (isAnnualSource(row.source) && truckRepairKeys.has(unitKey(row)))))),
      truckPmGroups: sortGroups(buildUnitGroups(truckRows.filter((row) => isPmSource(row.source)))),
      truckAnnualGroups: sortGroups(buildUnitGroups(truckRows.filter((row) => isAnnualSource(row.source) && !truckRepairKeys.has(unitKey(row))))),
      trailerGroups: sortGroups(buildUnitGroups(trailerRows)),
      otherGroups: sortGroups(buildUnitGroups(otherRows)),
    };
  }, [activeVisible]);

  const oosVisible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.oosUnits ?? []).filter((unit) => {
      if (shopView !== "all" && shopForLocation(unit.location) !== shopView) return false;
      if (!needle) return true;
      return [unit.unit, unit.location, displayDriver(unit.driver), unit.reason, unit.equipmentType, etaByEquipment[String(unit.equipmentId)] ?? "", ...unit.openWork.flatMap((work) => [work.issue, work.assignedTo, work.status, sourceLabel(work.source)])].join(" ").toLowerCase().includes(needle);
    }).sort((left, right) => left.unit.localeCompare(right.unit, undefined, { numeric: true, sensitivity: "base" }));
  }, [data, etaByEquipment, query, shopView]);

  const shopCounts = useMemo(() => {
    const rows = data?.repairs ?? [];
    return { clare: rows.filter((row) => shopForLocation(row.location) === "clare").length, cadillac: rows.filter((row) => shopForLocation(row.location) === "cadillac").length, all: rows.length };
  }, [data]);

  const workByEquipment = useMemo(() => {
    const map = new Map<number, RepairRow[]>();
    for (const row of data?.repairs ?? []) {
      if (!row.equipmentId) continue;
      const list = map.get(row.equipmentId) ?? [];
      list.push(row);
      map.set(row.equipmentId, list);
    }
    return map;
  }, [data]);

  const oosByEquipment = useMemo(() => new Map((data?.oosUnits ?? []).map((unit) => [unit.equipmentId, unit])), [data]);

  const lotEquipment = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.equipment ?? []).filter((item) => {
      if (shopView !== "all" && shopForLocation(item.location) !== shopView) return false;
      const rows = workByEquipment.get(item.id) ?? [];
      if (!needle) return true;
      return [item.unit, item.location, displayDriver(item.driver), item.equipmentType, ...rows.flatMap((row) => [row.issue, row.status, row.assignedTo])].join(" ").toLowerCase().includes(needle);
    }).sort((left, right) => {
      const seenRank = Number(lotSeen.has(left.id)) - Number(lotSeen.has(right.id));
      if (seenRank) return seenRank;
      const leftWork = workByEquipment.get(left.id)?.length ?? 0;
      const rightWork = workByEquipment.get(right.id)?.length ?? 0;
      if (leftWork !== rightWork) return rightWork - leftWork;
      return left.unit.localeCompare(right.unit, undefined, { numeric: true, sensitivity: "base" });
    });
  }, [data, lotSeen, query, shopView, workByEquipment]);

  function assignmentControl(row: RepairRow) {
    if (!data?.canManage) return <span className={styles.assignmentText}>{row.assignedTo || "Unassigned"}</span>;
    if (row.source === "dvir") return <select className={styles.techSelect} value="" disabled={busyId === row.id} onChange={(event) => { const id = Number(event.target.value); if (id > 0) void addDvirRepair(row, id); }}><option value="">Assign & create…</option>{data.technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select>;
    if (isRawMaintenance(row.source)) return <select className={styles.techSelect} value="" disabled={busyId === row.id} onChange={(event) => { const id = Number(event.target.value); if (id > 0) void addMaintenanceRepair(row, id); }}><option value="">Assign & create…</option>{data.technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select>;
    return <select className={styles.techSelect} value={row.technicianId ?? ""} disabled={busyId === row.id} onChange={(event) => void change(row.id, { action: "assignTechnician", technicianId: event.target.value ? Number(event.target.value) : 0 })}><option value="">Unassigned</option>{data.technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select>;
  }

  function renderRepairChild(row: RepairRow) {
    const rawDvir = row.source === "dvir";
    const rawMaintenance = isRawMaintenance(row.source);
    const busy = busyId === row.id;
    const driver = displayDriver(row.driver);
    return <Fragment key={row.id}><tr><td><div className={styles.childTypeLine}><span className={`${styles.sourceBadge} ${rawDvir ? styles.dvirBadge : rawMaintenance ? styles.maintenanceBadge : styles.repairBadge}`}>{sourceLabel(row.source)}</span>{data?.canManage && !isScheduled(row.source) ? <select className={styles.prioritySelect} value={row.priority} disabled={busy} onChange={(event) => void change(row.id, { action: "setPriority", priority: Number(event.target.value) })}><option value={1}>P1</option><option value={2}>P2</option><option value={3}>P3</option></select> : <span className={`${styles.priorityBadge} ${row.priority === 1 ? styles.priorityOne : ""}`}>P{row.priority}</span>}</div></td><td className={styles.childIssue}><strong>{row.issue}</strong>{rawDvir && row.dvirComments && <span>{row.dvirComments}</span>}</td><td className={styles.childParts}>{row.parts || <span className={styles.muted}>—</span>}</td><td>{data?.canManage && !isScheduled(row.source) ? <select className={styles.statusSelect} value={row.status} disabled={busy} onChange={(event) => void change(row.id, { action: "setStatus", status: event.target.value })}>{statuses.map((status) => <option key={status}>{status}</option>)}</select> : <span className={styles.statusBadge}>{row.status}</span>}{row.activeTimer && <span className={styles.timerBadge}>{row.activeTimer.technician || row.assignedTo || "Tech"} · {runningDuration(row.activeTimer.startedAt)}</span>}</td><td>{assignmentControl(row)}</td><td className={styles.childActions}><button className={styles.smallButton} type="button" onClick={() => setExpandedRepairId((current) => current === row.id ? null : row.id)}>{expandedRepairId === row.id ? "Close" : "Details"}</button>{rawDvir ? data?.canManage && <><button className={styles.actionButton} disabled={busy} onClick={() => void addDvirRepair(row)}>Create Job</button><button className={styles.completeButton} disabled={busy} onClick={() => void markDvirRepaired(row)}>Repaired</button></> : rawMaintenance ? data?.canManage && <><button className={styles.actionButton} disabled={busy} onClick={() => void addMaintenanceRepair(row)}>Create Job</button><button className={styles.completeButton} disabled={busy} onClick={() => void completeMaintenance(row)}>Complete</button></> : <><a className={styles.actionLink} href="/work-orders">WO Review</a>{data?.canManage && <button className={styles.completeButton} disabled={busy} onClick={() => void completeRepair(row)}>Complete</button>}</>}</td></tr>{expandedRepairId === row.id && <tr className={styles.repairDetailsRow}><td colSpan={6}><div className={styles.detailsGrid}><div><span>Unit</span><strong>{row.unit || "—"}</strong></div><div><span>Location</span><strong>{row.location || "—"}</strong></div>{row.equipmentId && etaByEquipment[String(row.equipmentId)] && <div><span>ETA / Coming Through</span><strong>{etaByEquipment[String(row.equipmentId)]}</strong></div>}{driver && <div><span>Driver</span><strong>{driver}</strong></div>}<div><span>Labor</span><strong>{row.laborHours.toFixed(2)} hr</strong></div><div><span>Assigned</span><strong>{row.assignedTo || "Unassigned"}</strong></div>{data?.canManage && row.source === "repair" && <div><span>Move to Unit</span><select className={styles.techSelect} value={row.equipmentId ?? ""} disabled={busy} onChange={(event) => { const equipmentId = Number(event.target.value); const equipment = data.equipment.find((item) => item.id === equipmentId); if (equipmentId > 0 && equipmentId !== row.equipmentId) void change(row.id, { action: "moveRepairToEquipment", equipmentId }).then((ok) => { if (ok) setMessage(`Repair moved to Unit ${equipment?.unit ?? "selected equipment"}.`); }); }}><option value="">Choose equipment…</option>{data.equipment.map((item) => <option key={item.id} value={item.id}>{item.unit} — {equipmentGroup(item.equipmentType).toUpperCase()}{item.location ? ` — ${item.location}` : ""}</option>)}</select></div>}{row.dvirPhotos && <div><span>DVIR Photos</span><a href={row.dvirPhotos} target="_blank" rel="noreferrer">View photos</a></div>}</div></td></tr>}</Fragment>;
  }

  function groupAssignmentControl(group: UnitGroup) {
    const unassigned = group.rows.filter((row) => row.technicianId === null);
    if (!data?.canManage) {
      const names = [...new Set(group.rows.map((row) => row.assignedTo).filter(Boolean))];
      return <span className={styles.assignmentText}>{names.length ? names.join(", ") : "Unassigned"}</span>;
    }
    const busy = busyId === `assign-${group.key}`;
    return <select className={styles.techSelect} value="" disabled={busy || unassigned.length === 0} onChange={(event) => { const technicianId = Number(event.target.value); if (technicianId > 0) void assignGroupTechnician(group, technicianId); }}><option value="">{busy ? "Assigning…" : unassigned.length ? `Assign ${unassigned.length} unassigned…` : "All work assigned"}</option>{data.technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select>;
  }

  function renderUnitGroup(group: UnitGroup, showPriority = false) {
    const expanded = expandedUnits.has(group.key);
    const driver = displayDriver(group.driver);
    const eta = group.equipmentId ? etaByEquipment[String(group.equipmentId)] ?? "" : "";
    const priority = groupPriority(group);
    return <Fragment key={group.key}><tr className={styles.unitSummaryRow}>{showPriority && <td className={styles.priorityColumn}><span className={`${styles.queuePriority} ${priority === 1 ? styles.queuePriorityOne : priority === 3 ? styles.queuePriorityThree : ""}`}>P{priority}</span><span className={styles.nextAction}>{groupAction(group)}</span></td>}<td className={styles.unitColumn}><strong>Unit {group.unit || "—"}</strong>{driver && <span>{driver}</span>}</td><td className={styles.summaryColumn}><button className={styles.repairToggle} type="button" onClick={() => toggleUnit(group.key)}><span className={styles.repairCount}>{groupCountLabel(group.rows)}</span><span className={styles.chevron}>{expanded ? "▲" : "▼"}</span></button><span className={styles.issueSummary}>{issueSummary(group.rows)}</span></td><td className={styles.locationColumn}><span className={styles.shopBadge}>{shopLabel(group.location)}</span><span>{group.location || "Location not set"}</span>{group.equipmentId && data?.canManage ? <button className={styles.smallButton} disabled={busyId === `eta-${group.equipmentId}`} onClick={() => void editUnitEta(group.equipmentId!, group.unit)}>{eta ? `ETA: ${eta}` : "Set ETA"}</button> : eta ? <span>ETA: {eta}</span> : null}</td><td>{groupAssignmentControl(group)}</td><td className={styles.unitActions}><button className={styles.expandButton} type="button" onClick={() => toggleUnit(group.key)}>{expanded ? "Hide" : "Open"}</button>{data?.canManage && <button className={styles.oosButton} type="button" disabled={busyId === `oos-${group.equipmentId ?? group.unit}`} onClick={() => void placeOos(group.rows[0])}>OOS</button>}</td></tr>{expanded && <tr className={styles.unitExpandedRow}><td colSpan={showPriority ? 6 : 5}><div className={styles.childTableWrap}><table className={styles.childTable}><thead><tr><th>Type</th><th>Repair / Service</th><th>Parts</th><th>Status</th><th>Technician</th><th>Actions</th></tr></thead><tbody>{group.rows.map(renderRepairChild)}</tbody></table></div></td></tr>}</Fragment>;
  }

  function workTable(title: string, groups: UnitGroup[], subtitle: string) {
    const jobCount = groups.reduce((sum, group) => sum + group.rows.length, 0);
    return <section className={styles.workSection}><div className={styles.sectionTitle}><div><span>{subtitle}</span><h2>{title}</h2></div><strong>{groups.length} units · {jobCount} items</strong></div><div className={styles.tableWrap}><table className={styles.unitTable}><thead><tr><th>Unit</th><th>Work / Summary</th><th>Location / ETA</th><th>Assign Tech</th><th>Actions</th></tr></thead><tbody>{groups.map((group) => renderUnitGroup(group))}{groups.length === 0 && <tr><td className={styles.empty} colSpan={5}>No open work in this section.</td></tr>}</tbody></table></div></section>;
  }

  function renderOos() {
    if (!oosVisible.length) return null;
    return <section className={styles.oosSection}><div className={styles.oosTitle}><div><span>OUT OF SERVICE</span><h2>Needs attention before release</h2></div><strong>{oosVisible.length}</strong></div><div className={styles.oosTableWrap}><table className={styles.oosTable}><thead><tr><th>Unit</th><th>Location / ETA</th><th>Reason</th><th>Open Work</th><th>Action</th></tr></thead><tbody>{oosVisible.map((unit) => { const key = `oos-unit-${unit.equipmentId}`; const expanded = expandedUnits.has(key); const eta = etaByEquipment[String(unit.equipmentId)] ?? ""; const openRows = unit.openWork.map((work) => data?.repairs.find((row) => row.id === work.id)).filter((row): row is RepairRow => Boolean(row)); return <Fragment key={unit.equipmentId}><tr className={styles.oosUnitRow}><td><strong>Unit {unit.unit}</strong><span>{equipmentGroup(unit.equipmentType).toUpperCase()}</span></td><td><span className={styles.shopBadge}>{shopLabel(unit.location)}</span><small>{unit.location || "Location not set"}</small>{data?.canManage ? <button className={styles.smallButton} disabled={busyId === `eta-${unit.equipmentId}`} onClick={() => void editUnitEta(unit.equipmentId, unit.unit)}>{eta ? `ETA: ${eta}` : "Set ETA"}</button> : eta ? <small>ETA: {eta}</small> : null}</td><td><strong>{unit.reason || "No OOS reason entered."}</strong>{unit.since && <small>Since {whenText(unit.since)}</small>}</td><td><button className={styles.oosRepairToggle} type="button" onClick={() => toggleUnit(key)}>{unit.openWork.length} item{unit.openWork.length === 1 ? "" : "s"} {expanded ? "▲" : "▼"}</button></td><td>{data?.canManage && <button className={styles.returnButton} disabled={busyId === `oos-${unit.equipmentId}`} onClick={() => void returnToService(unit)}>Return to Service</button>}</td></tr>{expanded && <tr className={styles.oosExpandedRow}><td colSpan={5}>{openRows.length ? <div className={styles.childTableWrap}><table className={styles.childTable}><thead><tr><th>Type</th><th>Repair / Service</th><th>Parts</th><th>Status</th><th>Technician</th><th>Actions</th></tr></thead><tbody>{openRows.map(renderRepairChild)}</tbody></table></div> : <div className={styles.oosNoRepairs}>No open repair rows are attached to this OOS unit.</div>}</td></tr>}</Fragment>; })}</tbody></table></div></section>;
  }

  const currentShopName = shopView === "clare" ? "Clare" : shopView === "cadillac" ? "Cadillac" : "All Shops";
  const lotBoardCount = lotEquipment.filter((item) => (workByEquipment.get(item.id)?.length ?? 0) > 0).length;
  const lotSeenCount = lotEquipment.filter((item) => lotSeen.has(item.id)).length;

  return <main className={styles.page}><header className={styles.header}><div><p className={styles.eyebrow}>NORLOW SHOP CONTROL</p><h1>Repair Board</h1><p className={styles.subtitle}>Use Priority Queue to decide what should be worked next, By Type for the maintenance buckets, and Lot Check when walking the yard.</p></div><div className={styles.headerActions}>{data?.canManage && <button className={styles.primaryButton} onClick={() => setShowAddRepair((current) => !current)}>{showAddRepair ? "Close Add Repair" : "+ Add Repair"}</button>}<a className={styles.secondaryLink} href="/work-orders">WO Review</a><button className={styles.secondaryButton} onClick={() => void load()}>Refresh</button></div></header>{message && <div className={styles.notice}>{message}</div>}{showAddRepair && data?.canManage && <section className={styles.addRepairPanel}><div className={styles.addRepairHead}><div><strong>Add Repair</strong><span>Choose the equipment type, find the exact unit, then add the repair.</span></div></div><div className={styles.addRepairGrid}><label>Equipment source<select className={styles.techSelect} value={newRepair.mode} onChange={(event) => { setNewRepair((current) => ({ ...current, mode: event.target.value as RepairMode, equipmentId: "", unit: "" })); setEquipmentLookup(""); }}><option value="equipment">Existing Equipment</option><option value="freeform">Freeform / Other Equipment</option></select></label><label>Equipment type<select className={styles.techSelect} value={newRepair.equipmentType} onChange={(event) => { setNewRepair((current) => ({ ...current, equipmentType: event.target.value as RepairEquipmentType, equipmentId: "" })); setEquipmentLookup(""); }}><option value="">Choose type…</option><option value="truck">Truck</option><option value="trailer">Trailer</option><option value="other">Other Equipment</option></select></label>{newRepair.mode === "equipment" ? <><label>Type to find unit<input className={styles.techSelect} value={equipmentLookup} disabled={!newRepair.equipmentType} onChange={(event) => { setEquipmentLookup(event.target.value); setNewRepair((current) => ({ ...current, equipmentId: "" })); }} placeholder={newRepair.equipmentType ? "Type unit, location, or driver…" : "Choose type first"} autoComplete="off" /></label><label>Matching equipment<select className={styles.techSelect} value={newRepair.equipmentId} disabled={!newRepair.equipmentType} onChange={(event) => setNewRepair((current) => ({ ...current, equipmentId: event.target.value }))}><option value="">{!newRepair.equipmentType ? "Choose type first…" : matchingEquipment.length ? `Choose from ${matchingEquipment.length} match${matchingEquipment.length === 1 ? "" : "es"}…` : "No matching equipment"}</option>{matchingEquipment.map((item) => { const driver = displayDriver(item.driver); return <option key={item.id} value={item.id}>{item.unit}{item.location ? ` — ${item.location}` : ""}{driver ? ` — ${driver}` : ""}</option>; })}</select></label></> : <><label>Unit / name<input className={styles.techSelect} value={newRepair.unit} onChange={(event) => setNewRepair((current) => ({ ...current, unit: event.target.value }))} placeholder="454(SC), forklift, plow truck…" /></label><label>Location<input className={styles.techSelect} value={newRepair.location} onChange={(event) => setNewRepair((current) => ({ ...current, location: event.target.value }))} placeholder="Clare, Cadillac, road…" /></label></>}<label>Repair needed<input className={styles.techSelect} value={newRepair.issue} onChange={(event) => setNewRepair((current) => ({ ...current, issue: event.target.value }))} placeholder="Describe the repair" /></label><label>Parts needed<input className={styles.techSelect} value={newRepair.parts} onChange={(event) => setNewRepair((current) => ({ ...current, parts: event.target.value }))} placeholder="Optional" /></label><label>Priority<select className={styles.techSelect} value={newRepair.priority} onChange={(event) => setNewRepair((current) => ({ ...current, priority: Number(event.target.value) }))}><option value={1}>P1 — High</option><option value={2}>P2 — Normal</option><option value={3}>P3 — Low</option></select></label><label>Assign tech<select className={styles.techSelect} value={newRepair.technicianId} onChange={(event) => setNewRepair((current) => ({ ...current, technicianId: event.target.value }))}><option value="">Unassigned</option>{data.technicians.map((tech) => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select></label></div><div className={styles.addRepairActions}><button className={styles.secondaryButton} disabled={busyId === "create-repair"} onClick={() => { setShowAddRepair(false); setNewRepair(blankRepairDraft); setEquipmentLookup(""); }}>Cancel</button><button className={styles.primaryButton} disabled={busyId === "create-repair"} onClick={() => void createBoardRepair()}>{busyId === "create-repair" ? "Adding…" : "Add Repair"}</button></div></section>}<div className={styles.controlBar}><nav className={styles.viewTabs} aria-label="Repair board view"><button className={boardView === "priority" ? styles.activeViewTab : ""} onClick={() => setBoardView("priority")}>Priority Queue</button><button className={boardView === "type" ? styles.activeViewTab : ""} onClick={() => setBoardView("type")}>By Type</button><button className={boardView === "lot" ? styles.activeViewTab : ""} onClick={() => setBoardView("lot")}>Lot Check</button></nav><nav className={styles.shopTabs} aria-label="Shop view"><button className={shopView === "all" ? styles.activeShopTab : ""} onClick={() => setShopView("all")}>All Shops <b>{shopCounts.all}</b></button><button className={shopView === "clare" ? styles.activeShopTab : ""} onClick={() => setShopView("clare")}>Clare <b>{shopCounts.clare}</b></button><button className={shopView === "cadillac" ? styles.activeShopTab : ""} onClick={() => setShopView("cadillac")}>Cadillac <b>{shopCounts.cadillac}</b></button></nav></div><div className={styles.searchBar}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={boardView === "lot" ? "Search unit, location, driver, repair…" : "Search unit, repair, location, ETA, part, technician…"} /><span>{boardView === "priority" ? "P1 and unassigned work rises to the top; blocked and already-running work falls lower." : boardView === "lot" ? "Check each unit as you see it in the yard. Units with board work are called out in the same row." : "Maintenance stays separated without hiding related annual work under a truck repair."}</span></div>{boardView !== "lot" && renderOos()}{boardView === "priority" && <section className={styles.workSection}><div className={styles.sectionTitle}><div><span>{currentShopName.toUpperCase()}</span><h2>Priority Queue</h2></div><strong>{priorityGroups.length} units</strong></div><div className={styles.queueHelp}><span><b>P1</b> first</span><span><b>Needs tech</b> before already-assigned work</span><span><b>Waiting parts / In progress</b> lower because they are blocked or already being worked</span></div><div className={styles.tableWrap}><table className={`${styles.unitTable} ${styles.priorityTable}`}><thead><tr><th>Priority / Next</th><th>Unit</th><th>Work / Summary</th><th>Location / ETA</th><th>Assign Tech</th><th>Actions</th></tr></thead><tbody>{priorityGroups.map((group) => renderUnitGroup(group, true))}{priorityGroups.length === 0 && <tr><td className={styles.empty} colSpan={6}>No open work in this view.</td></tr>}</tbody></table></div></section>}{boardView === "type" && <div className={styles.typeStack}>{workTable("Truck Repairs", boardSections.truckRepairGroups, "TRUCKS")}{workTable("Truck PMs", boardSections.truckPmGroups, "TRUCKS")}{workTable("Truck Annuals", boardSections.truckAnnualGroups, "TRUCKS")}{workTable("Trailer Repairs / Annuals", boardSections.trailerGroups, "TRAILERS")}{boardSections.otherGroups.length > 0 && workTable("Other Equipment", boardSections.otherGroups, "OTHER")}</div>}{boardView === "lot" && <section className={styles.workSection}><div className={styles.sectionTitle}><div><span>{currentShopName.toUpperCase()}</span><h2>Lot Check</h2></div><strong>{lotSeenCount}/{lotEquipment.length} seen</strong></div><div className={styles.lotSummary}><span><b>{lotBoardCount}</b> units have work on the board</span><span><b>{lotEquipment.length - lotBoardCount}</b> show no open board work</span><span>Checks save on this device for today</span><button className={styles.secondaryButton} onClick={() => { if (window.confirm("Reset today's lot check on this device?")) setLotSeen(new Set()); }}>Reset Lot Check</button></div><div className={styles.tableWrap}><table className={styles.lotTable}><thead><tr><th>Seen</th><th>Unit</th><th>Type</th><th>Stored Location</th><th>Repair Board</th><th>Priority / Tech</th><th>ETA</th><th>Actions</th></tr></thead><tbody>{lotEquipment.map((item) => { const rows = workByEquipment.get(item.id) ?? []; const group = rows.length ? buildUnitGroups(rows)[0] : null; const oos = oosByEquipment.get(item.id); const key = `lot-${item.id}`; const expanded = expandedUnits.has(key); const eta = etaByEquipment[String(item.id)] ?? ""; const priority = group ? groupPriority(group) : null; const techs = [...new Set(rows.map((row) => row.assignedTo).filter(Boolean))]; return <Fragment key={item.id}><tr className={`${lotSeen.has(item.id) ? styles.lotSeenRow : ""} ${oos ? styles.lotOosRow : ""}`.trim()}><td><label className={styles.seenCheck}><input type="checkbox" checked={lotSeen.has(item.id)} onChange={() => toggleLotSeen(item.id)} /><span>{lotSeen.has(item.id) ? "Seen" : "Check"}</span></label></td><td className={styles.unitColumn}><strong>{item.unit}</strong>{displayDriver(item.driver) && <span>{displayDriver(item.driver)}</span>}</td><td>{equipmentGroup(item.equipmentType).toUpperCase()}</td><td>{item.location || "Location not set"}</td><td>{oos ? <span className={styles.oosInline}>OOS</span> : rows.length ? <button className={styles.repairToggle} onClick={() => toggleUnit(key)}><span className={styles.repairCount}>{rows.length} board item{rows.length === 1 ? "" : "s"}</span><span className={styles.chevron}>{expanded ? "▲" : "▼"}</span></button> : <span className={styles.clearInline}>No open work</span>}</td><td>{priority ? <><span className={`${styles.queuePriority} ${priority === 1 ? styles.queuePriorityOne : priority === 3 ? styles.queuePriorityThree : ""}`}>P{priority}</span><small className={styles.lotTech}>{techs.length ? techs.join(", ") : "Unassigned"}</small></> : <span className={styles.muted}>—</span>}</td><td>{eta || "—"}</td><td className={styles.unitActions}>{rows.length > 0 && <button className={styles.expandButton} onClick={() => toggleUnit(key)}>{expanded ? "Hide" : "Open"}</button>}{data?.canManage && <button className={styles.smallButton} onClick={() => startRepairForEquipment(item)}>Add Repair</button>}</td></tr>{expanded && rows.length > 0 && <tr className={styles.unitExpandedRow}><td colSpan={8}><div className={styles.childTableWrap}><table className={styles.childTable}><thead><tr><th>Type</th><th>Repair / Service</th><th>Parts</th><th>Status</th><th>Technician</th><th>Actions</th></tr></thead><tbody>{rows.map(renderRepairChild)}</tbody></table></div></td></tr>}</Fragment>; })}{lotEquipment.length === 0 && <tr><td className={styles.empty} colSpan={8}>No equipment matches this shop/search.</td></tr>}</tbody></table></div></section>}<footer className={styles.footer}>{data ? `${currentShopName} · ${new Date(data.updatedAt).toLocaleString()}` : "Loading repair board…"}</footer></main>;
}
