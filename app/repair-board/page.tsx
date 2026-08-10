"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import styles from "./repair-board.module.css";

type Role = "viewer" | "mechanic" | "manager" | "admin";
type Technician = { id: number; name: string };
type Timer = { startedAt: string; technician: string };
type RepairRow = {
  id: string;
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
  activeTimer: Timer | null;
};
type BoardData = {
  user: { id: number; username: string; displayName: string; role: Role; technicianId: number | null };
  canManage: boolean;
  technicians: Technician[];
  repairs: RepairRow[];
  summary: { total: number; highPriority: number; unassigned: number; activeLabor: number };
  updatedAt: string;
};
type ChangeResult = { ok?: boolean; error?: string };

const priorityLabels: Record<number, string> = { 1: "1 - High", 2: "2 - Normal", 3: "3 - Low" };
const statuses = ["New", "Assigned", "Waiting for Parts", "In Progress", "Completed"];

function normalizeType(value: string) {
  const type = value.toLowerCase();
  if (type.includes("trailer")) return "trailer";
  if (type.includes("truck") || type.includes("tractor") || type.includes("vehicle")) return "truck";
  return "other";
}

function runningDuration(startedAt: string) {
  const normalized = startedAt.includes("T") ? startedAt : startedAt.replace(" ", "T") + "Z";
  const started = Date.parse(normalized);
  if (!Number.isFinite(started)) return "running";
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m running` : `${rest}m running`;
}

export default function RepairBoardPage() {
  const [data, setData] = useState<BoardData | null>(null);
  const [query, setQuery] = useState("");
  const [equipmentFilter, setEquipmentFilter] = useState("all");
  const [assignmentFilter, setAssignmentFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/repair-board", { cache: "no-store" });
    const payload = await response.json() as BoardData & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Repair board could not be loaded.");
    setData(payload);
  }

  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : "Repair board could not be loaded."));
  }, []);

  async function change(repairId: string, body: Record<string, unknown>) {
    setBusyId(repairId);
    setMessage("");
    try {
      const response = await fetch("/api/repair-board", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repairId, ...body }),
      });
      const result = await response.json() as ChangeResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "Repair-board change failed.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Repair-board change failed.");
    } finally {
      setBusyId(null);
    }
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.repairs ?? []).filter((repair) => {
      if (needle && ![
        repair.location,
        repair.unit,
        repair.driver,
        repair.issue,
        repair.parts,
        repair.status,
        repair.assignedTo,
      ].join(" ").toLowerCase().includes(needle)) return false;

      if (equipmentFilter !== "all" && normalizeType(repair.equipmentType) !== equipmentFilter) return false;
      if (priorityFilter !== "all" && repair.priority !== Number(priorityFilter)) return false;
      if (assignmentFilter === "unassigned" && repair.technicianId !== null) return false;
      if (assignmentFilter === "assigned" && repair.technicianId === null) return false;
      if (assignmentFilter === "active" && !repair.activeTimer) return false;
      return true;
    });
  }, [assignmentFilter, data, equipmentFilter, priorityFilter, query]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>MANAGER REPAIR CONTROL</p>
          <h1>Repair Board</h1>
          <p className={styles.subtitle}>A spreadsheet-style view for scanning, prioritizing, and assigning open shop work.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.refresh} type="button" onClick={() => void load()}>Refresh</button>
          <a className={styles.primaryLink} href="/work-orders">Full Work Orders</a>
        </div>
      </header>

      {message && <div className={styles.notice}>{message}</div>}

      <section className={styles.metrics} aria-label="Repair board summary">
        <article className={styles.metric}><span>Open repairs</span><strong>{data?.summary.total ?? 0}</strong></article>
        <article className={styles.metric}><span>Priority 1</span><strong>{data?.summary.highPriority ?? 0}</strong></article>
        <article className={styles.metric}><span>Unassigned</span><strong>{data?.summary.unassigned ?? 0}</strong></article>
        <article className={styles.metric}><span>Active labor</span><strong>{data?.summary.activeLabor ?? 0}</strong></article>
      </section>

      <section className={styles.toolbar} aria-label="Repair board filters">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search location, unit, driver, repair, part, tech…"
          aria-label="Search repairs"
        />
        <select value={equipmentFilter} onChange={(event) => setEquipmentFilter(event.target.value)} aria-label="Equipment filter">
          <option value="all">All equipment</option>
          <option value="truck">Trucks</option>
          <option value="trailer">Trailers</option>
          <option value="other">Other / unmatched</option>
        </select>
        <select value={assignmentFilter} onChange={(event) => setAssignmentFilter(event.target.value)} aria-label="Assignment filter">
          <option value="all">All assignments</option>
          <option value="unassigned">Unassigned</option>
          <option value="assigned">Assigned</option>
          <option value="active">Active labor</option>
        </select>
        <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} aria-label="Priority filter">
          <option value="all">All priorities</option>
          <option value="1">Priority 1</option>
          <option value="2">Priority 2</option>
          <option value="3">Priority 3</option>
        </select>
      </section>

      <div className={styles.board}>
        <table className={styles.table}>
          <colgroup>
            <col style={{ width: 100 }} />
            <col style={{ width: 145 }} />
            <col style={{ width: 95 }} />
            <col style={{ width: 180 }} />
            <col style={{ width: 360 }} />
            <col style={{ width: 250 }} />
            <col style={{ width: 165 }} />
            <col style={{ width: 205 }} />
            <col style={{ width: 155 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Priority</th>
              <th>Location</th>
              <th>Unit</th>
              <th>Driver</th>
              <th>Repair Needed</th>
              <th>Parts Needed / Used</th>
              <th>Status</th>
              <th>Assigned Tech</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((repair) => {
              const busy = busyId === repair.id;
              return (
                <Fragment key={repair.id}>
                  <tr className={repair.priority === 1 ? styles.priorityOne : repair.priority === 2 ? styles.priorityTwo : undefined}>
                    <td className={styles.priorityCell}>
                      {data?.canManage ? (
                        <select
                          className={styles.inlineSelect}
                          value={repair.priority}
                          disabled={busy}
                          onChange={(event) => void change(repair.id, { action: "setPriority", priority: Number(event.target.value) })}
                        >
                          <option value={1}>1 - High</option>
                          <option value={2}>2 - Normal</option>
                          <option value={3}>3 - Low</option>
                        </select>
                      ) : (
                        <span className={`${styles.priorityBadge} ${repair.priority === 1 ? styles.priorityHigh : ""}`}>{priorityLabels[repair.priority] ?? repair.priority}</span>
                      )}
                    </td>
                    <td>{repair.location || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.unitCell}>{repair.unit || "—"}</td>
                    <td>{repair.driver || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.issueCell}>{repair.issue}</td>
                    <td className={styles.partsCell}>{repair.parts || <span className={styles.muted}>—</span>}</td>
                    <td>
                      {data?.canManage ? (
                        <select
                          className={styles.inlineSelect}
                          value={repair.status}
                          disabled={busy}
                          onChange={(event) => void change(repair.id, { action: "setStatus", status: event.target.value })}
                        >
                          {statuses.map((status) => <option key={status}>{status}</option>)}
                        </select>
                      ) : (
                        <span className={styles.statusBadge}>{repair.status}</span>
                      )}
                    </td>
                    <td className={styles.techCell}>
                      {data?.canManage ? (
                        <>
                          <select
                            className={styles.inlineSelect}
                            value={repair.technicianId ?? ""}
                            disabled={busy}
                            onChange={(event) => void change(repair.id, { action: "assignTechnician", technicianId: event.target.value ? Number(event.target.value) : 0 })}
                          >
                            <option value="">Unassigned</option>
                            {(data.technicians ?? []).map((technician) => <option key={technician.id} value={technician.id}>{technician.name}</option>)}
                          </select>
                          {repair.activeTimer && <span className={styles.timerBadge}>{repair.activeTimer.technician || repair.assignedTo || "Tech"} · {runningDuration(repair.activeTimer.startedAt)}</span>}
                        </>
                      ) : (
                        <>
                          <span>{repair.assignedTo || "Unassigned"}</span>
                          {repair.activeTimer && <span className={styles.timerBadge}>{runningDuration(repair.activeTimer.startedAt)}</span>}
                        </>
                      )}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        <button className={styles.rowButton} type="button" onClick={() => setExpandedId((current) => current === repair.id ? null : repair.id)}>
                          {expandedId === repair.id ? "Close" : "Details"}
                        </button>
                        <a className={styles.rowLink} href="/work-orders">Work Order</a>
                      </div>
                    </td>
                  </tr>
                  {expandedId === repair.id && (
                    <tr className={styles.expanded}>
                      <td colSpan={9}>
                        <div className={styles.details}>
                          <div className={styles.detailBlock}><span>Unit</span><strong>{repair.unit || "—"}</strong></div>
                          <div className={styles.detailBlock}><span>Assigned technician</span><strong>{repair.assignedTo || "Unassigned"}</strong></div>
                          <div className={styles.detailBlock}><span>Logged labor</span><strong>{repair.laborHours.toFixed(2)} hours</strong></div>
                          <div className={styles.detailBlock}><span>Current labor</span><strong>{repair.activeTimer ? `${repair.activeTimer.technician || repair.assignedTo} · ${runningDuration(repair.activeTimer.startedAt)}` : "No timer running"}</strong></div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {data && visible.length === 0 && (
              <tr><td className={styles.empty} colSpan={9}>No open repairs match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.footerNote}>
        {data ? `${visible.length} of ${data.repairs.length} open repairs · updated ${new Date(data.updatedAt).toLocaleString()}` : "Loading repair board…"}
      </div>
    </main>
  );
}
