"use client";

import { useEffect, useMemo, useState } from "react";

type User = {
  id: number;
  username: string;
  displayName: string;
  role: "viewer" | "mechanic" | "manager" | "admin";
  technicianId: number | null;
};
type UsedPart = { partId: number; partNumber: string; description: string; quantity: number };
type LaborEntry = { id: number; technician: string; laborDate: string; hours: number; rate: number; notes: string };
type Repair = {
  id: string;
  equipmentId: number | null;
  unit: string;
  issue: string;
  status: string;
  location: string;
  technicianId: number | null;
  assignedTo: string;
  laborHours: number;
  usedParts: UsedPart[];
  laborEntries: LaborEntry[];
};
type Part = { id: number; partNumber: string; description: string; quantityOnHand: number; location: string };
type Timer = { repairId: string; startedAt: string; title: string; unit: string };
type ShopData = { user: User; activeTimer: Timer | null; repairs: Repair[]; parts: Part[]; updatedAt: string };
type View = "mine" | "available" | "all";
type ActionResult = { ok?: boolean; error?: string; repairId?: string; hours?: number; laborStarted?: boolean; completed?: boolean };

function timerStartMs(value: string) {
  const normalized = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  return Date.parse(normalized);
}
function duration(startedAt: string, now: number) {
  const ms = Math.max(0, now - timerStartMs(startedAt));
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function sameUnit(left: Repair, right: Repair) {
  if (left.equipmentId && right.equipmentId) return left.equipmentId === right.equipmentId;
  return left.unit.trim().toLowerCase() === right.unit.trim().toLowerCase();
}

export default function ShopPage() {
  const [data, setData] = useState<ShopData | null>(null);
  const [view, setView] = useState<View>("mine");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [partId, setPartId] = useState("");
  const [partQuantity, setPartQuantity] = useState(1);

  async function load() {
    const response = await fetch("/api/shop", { cache: "no-store" });
    const payload = await response.json() as ShopData & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Shop jobs could not be loaded.");
    setData(payload);
    setSelectedId((current) => {
      if (current && payload.repairs.some((repair) => repair.id === current)) return current;
      return payload.activeTimer?.repairId ?? null;
    });
    if (payload.user.role === "manager" || payload.user.role === "admin") {
      setView((current) => current === "mine" && !payload.user.technicianId ? "all" : current);
    }
  }

  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : "Shop jobs could not be loaded."));
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  async function action(body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/shop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as ActionResult;
      if (!response.ok || !result.ok) throw new Error(result.error || "Shop action failed.");
      if (result.repairId && !result.completed) setSelectedId(result.repairId);
      if (result.completed) {
        setSelectedId(null);
        setMessage(typeof result.hours === "number"
          ? `Repair completed. ${result.hours.toFixed(2)} hours of running labor were saved.`
          : "Repair completed.");
      } else if (typeof result.hours === "number") {
        setMessage(`Labor saved: ${result.hours.toFixed(2)} hours.`);
      } else if (result.laborStarted) {
        setMessage("Job opened. Labor timer started automatically.");
      }
      await load();
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Shop action failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function openJob(id: string) {
    setSelectedId(id);
    await action({ action: "openRepair", repairId: id });
  }

  async function addPartToRepair(repair: Repair) {
    if (!partId) {
      setMessage("Choose a part first.");
      return;
    }
    if (!Number.isFinite(partQuantity) || partQuantity <= 0) {
      setMessage("Enter a positive part quantity.");
      return;
    }
    const result = await action({
      action: "usePart",
      repairId: repair.id,
      partId: Number(partId),
      quantity: partQuantity,
    });
    if (result) {
      setPartId("");
      setPartQuantity(1);
      setMessage("Part added to the repair.");
    }
  }

  async function completeJob(repair: Repair) {
    if (!window.confirm(`Complete the repair for Unit ${repair.unit || "—"}: ${repair.issue}?`)) return;
    await action({ action: "completeRepair", repairId: repair.id });
  }

  const visible = useMemo(() => {
    if (!data) return [];
    if (view === "mine") return data.repairs.filter((repair) => repair.technicianId === data.user.technicianId);
    if (view === "available") return data.repairs.filter((repair) => repair.technicianId === null);
    return data.repairs;
  }, [data, view]);

  const selected = useMemo(
    () => data?.repairs.find((repair) => repair.id === selectedId) ?? null,
    [data, selectedId],
  );
  const relatedRepairs = useMemo(
    () => selected && data ? data.repairs.filter((repair) => repair.id !== selected.id && sameUnit(repair, selected)) : [],
    [data, selected],
  );
  const myCount = data?.repairs.filter((repair) => repair.technicianId === data.user.technicianId).length ?? 0;
  const availableCount = data?.repairs.filter((repair) => repair.technicianId === null).length ?? 0;

  return (
    <main style={{ minHeight: "100vh", background: "#f3f5f7", padding: "34px 34px 100px", color: "#182331" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#f47b20", fontWeight: 900, fontSize: 12, letterSpacing: ".16em" }}>TECHNICIAN SHOP QUEUE</p>
          <h1 style={{ margin: "7px 0 5px", fontSize: 34, color: "#0d1b2b" }}>Shop Jobs</h1>
          <p style={{ margin: 0, color: "#667482" }}>Open a repair to claim it if needed, start labor automatically, add parts, and finish the repair.</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <strong style={{ display: "block" }}>{data?.user.displayName ?? "Loading…"}</strong>
          <span style={{ fontSize: 13, color: "#667482" }}>{data?.user.username ? `@${data.user.username}` : ""}</span>
        </div>
      </header>

      {message && <div style={noticeStyle}>{message}</div>}
      {data?.user.role === "mechanic" && !data.user.technicianId && (
        <div style={{ ...noticeStyle, background: "#fff1f0", borderColor: "#efb3ad" }}>
          Your login exists, but it is not linked to a technician record yet. Ask an administrator to open Users and save your mechanic account.
        </div>
      )}

      {data?.activeTimer && (
        <section style={{ marginTop: 20, background: "#0d1b2b", color: "white", borderRadius: 14, padding: 20, display: "flex", justifyContent: "space-between", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <p style={{ margin: "0 0 5px", fontSize: 11, fontWeight: 900, letterSpacing: ".15em", color: "#ff9a4c" }}>LABOR RUNNING</p>
            <button onClick={() => setSelectedId(data.activeTimer!.repairId)} style={activeJobButton}>
              Unit {data.activeTimer.unit || "—"} — {data.activeTimer.title}
            </button>
            <div style={{ marginTop: 5, color: "#cbd6df" }}>Started {new Date(timerStartMs(data.activeTimer.startedAt)).toLocaleString()}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 28, fontWeight: 900 }}>
              {duration(data.activeTimer.startedAt, now)}
            </span>
            <button disabled={busy} onClick={() => void action({ action: "stopLabor", repairId: data.activeTimer?.repairId })} style={dangerButton}>
              Stop Labor
            </button>
          </div>
        </section>
      )}

      <section style={{ marginTop: 22, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => setView("mine")} style={view === "mine" ? activeTab : tabButton}>My Jobs ({myCount})</button>
        <button onClick={() => setView("available")} style={view === "available" ? activeTab : tabButton}>Available Jobs ({availableCount})</button>
        <button onClick={() => setView("all")} style={view === "all" ? activeTab : tabButton}>All Open ({data?.repairs.length ?? 0})</button>
      </section>

      {selected && data && (() => {
        const mine = selected.technicianId === data.user.technicianId;
        const available = selected.technicianId === null;
        const running = data.activeTimer?.repairId === selected.id;
        const canOpen = Boolean(data.user.technicianId) && (mine || available);
        const blockedByOtherTimer = Boolean(data.activeTimer && !running);
        return (
          <section style={workspaceStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
              <div>
                <p style={{ margin: 0, color: "#f47b20", fontSize: 11, fontWeight: 900, letterSpacing: ".14em" }}>REPAIR WORKSPACE</p>
                <h2 style={{ margin: "7px 0 4px", fontSize: 27, color: "#0d1b2b" }}>Unit {selected.unit || "—"} — {selected.issue}</h2>
                <div style={{ color: "#667482" }}>{selected.location || "No location"} · {selected.status} · {available ? "Unassigned" : `Assigned to ${selected.assignedTo || "technician"}`}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                {canOpen && !data.activeTimer && <button disabled={busy} onClick={() => void openJob(selected.id)} style={primaryButton}>Open Job & Start Labor</button>}
                {running && <button disabled={busy} onClick={() => void action({ action: "stopLabor", repairId: selected.id })} style={dangerButton}>Stop Labor</button>}
                {mine && !blockedByOtherTimer && <button disabled={busy} onClick={() => void completeJob(selected)} style={completeButton}>Complete Repair</button>}
              </div>
            </div>

            {!mine && available && <div style={smallNotice}>Open this job first. Opening it assigns it to you and starts the labor timer.</div>}
            {!mine && !available && <div style={lockedNotice}>This repair is assigned to {selected.assignedTo || "another technician"}. You can see it, but only that technician or a manager can work it.</div>}
            {mine && blockedByOtherTimer && <div style={smallNotice}>You have labor running on another repair. Stop that timer before opening or completing this one.</div>}

            <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16 }}>
              <div style={workspaceCard}>
                <h3 style={workspaceHeading}>Parts</h3>
                <div style={{ minHeight: 32 }}>
                  {selected.usedParts.length ? selected.usedParts.map((part) => (
                    <span key={part.partId} style={chip}>{part.partNumber} × {part.quantity}</span>
                  )) : <span style={mutedText}>No parts added yet.</span>}
                </div>
                {mine && (
                  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 90px auto", gap: 8 }}>
                    <select value={partId} onChange={(event) => setPartId(event.target.value)} style={inputStyle} disabled={busy}>
                      <option value="">Choose inventory part</option>
                      {data.parts.map((part) => (
                        <option key={part.id} value={part.id} disabled={part.quantityOnHand <= 0}>
                          {part.partNumber} — {part.description} ({part.quantityOnHand})
                        </option>
                      ))}
                    </select>
                    <input type="number" min="0.01" step="any" value={partQuantity} onChange={(event) => setPartQuantity(Number(event.target.value))} style={inputStyle} disabled={busy} />
                    <button disabled={busy} onClick={() => void addPartToRepair(selected)} style={secondaryButton}>Add Part</button>
                  </div>
                )}
                {mine && <p style={helperText}>Parts are deducted from inventory and attached to this repair.</p>}
              </div>

              <div style={workspaceCard}>
                <h3 style={workspaceHeading}>Labor</h3>
                <strong style={{ display: "block", fontSize: 25, color: "#0d1b2b" }}>{selected.laborHours.toFixed(2)} hours logged</strong>
                {running && data.activeTimer && <div style={{ marginTop: 8, color: "#b45309", fontWeight: 800 }}>Current timer: {duration(data.activeTimer.startedAt, now)}</div>}
                <div style={{ marginTop: 10, display: "grid", gap: 5 }}>
                  {selected.laborEntries.slice(0, 6).map((entry) => (
                    <div key={entry.id} style={{ fontSize: 12, color: "#657383" }}>
                      {entry.laborDate} · {entry.technician} · {entry.hours.toFixed(2)} hr{entry.notes ? ` · ${entry.notes}` : ""}
                    </div>
                  ))}
                  {!selected.laborEntries.length && <span style={mutedText}>Completed timer sessions will appear here.</span>}
                </div>
                {mine && <p style={helperText}>Completing this repair automatically stops and saves its running labor first.</p>}
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                <h3 style={{ margin: 0, color: "#0d1b2b" }}>Other open repairs for Unit {selected.unit || "—"}</h3>
                <span style={{ color: "#667482", fontSize: 13 }}>{relatedRepairs.length} other repair{relatedRepairs.length === 1 ? "" : "s"}</span>
              </div>
              {relatedRepairs.length ? (
                <div style={{ marginTop: 10, display: "grid", gap: 9 }}>
                  {relatedRepairs.map((repair) => {
                    const relatedMine = repair.technicianId === data.user.technicianId;
                    const relatedAvailable = repair.technicianId === null;
                    const relatedCanOpen = Boolean(data.user.technicianId) && (relatedMine || relatedAvailable) && !data.activeTimer;
                    return (
                      <div key={repair.id} style={relatedRepairStyle}>
                        <button onClick={() => setSelectedId(repair.id)} style={relatedTitleButton}>{repair.issue}</button>
                        <span style={{ color: "#667482", fontSize: 12 }}>{repair.status} · {relatedAvailable ? "Unassigned" : `Assigned to ${repair.assignedTo || "technician"}`}</span>
                        {relatedCanOpen && <button disabled={busy} onClick={() => void openJob(repair.id)} style={secondaryButton}>Open & Start</button>}
                        {!relatedCanOpen && relatedAvailable && data.activeTimer && <span style={relatedHint}>Stop current timer first</span>}
                        {!relatedAvailable && !relatedMine && <span style={relatedHint}>Assigned to another tech</span>}
                      </div>
                    );
                  })}
                </div>
              ) : <div style={{ marginTop: 10, ...mutedText }}>No other open repairs are listed for this unit.</div>}
            </div>
          </section>
        );
      })()}

      <section style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14 }}>
        {visible.map((item) => {
          const mine = item.technicianId === data?.user.technicianId;
          const available = item.technicianId === null;
          const running = data?.activeTimer?.repairId === item.id;
          const canOpen = Boolean(data?.user.technicianId) && (mine || available);
          return (
            <article key={item.id} style={{ background: "white", border: running ? "2px solid #f47b20" : selectedId === item.id ? "2px solid #0d1b2b" : "1px solid #dce2e7", borderRadius: 13, padding: 18, boxShadow: "0 4px 18px #12202f0d" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 12, color: "#f47b20", fontWeight: 900 }}>UNIT {item.unit || "—"}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: "#5d6975" }}>{item.status || "Open"}</span>
              </div>
              <button onClick={() => setSelectedId(item.id)} style={repairTitleButton}>{item.issue}</button>
              <div style={{ fontSize: 13, color: "#667482", lineHeight: 1.6 }}>
                <div>{item.location || "No location"}</div>
                <div>{available ? "Unassigned" : `Assigned to ${item.assignedTo || "technician"}`}</div>
                <div>{item.laborHours.toFixed(2)} labor hours · {item.usedParts.length} part line{item.usedParts.length === 1 ? "" : "s"}</div>
              </div>
              <div style={{ marginTop: 16, display: "flex", gap: 9, flexWrap: "wrap" }}>
                {canOpen && !running && !data?.activeTimer && <button disabled={busy} onClick={() => void openJob(item.id)} style={primaryButton}>Open Job</button>}
                {running && <button disabled={busy} onClick={() => void action({ action: "stopLabor", repairId: item.id })} style={dangerButton}>Stop Labor</button>}
                <button onClick={() => setSelectedId(item.id)} style={secondaryButton}>View Repair + Unit Jobs</button>
                {canOpen && data?.activeTimer && !running && <span style={relatedHint}>Stop current timer before opening</span>}
              </div>
              {canOpen && !data?.activeTimer && <div style={{ marginTop: 9, fontSize: 11, color: "#7a8793" }}>Opening this job starts the labor timer automatically.</div>}
            </article>
          );
        })}
        {data && !visible.length && (
          <div style={{ gridColumn: "1 / -1", background: "white", border: "1px dashed #cbd4dc", borderRadius: 13, padding: 34, textAlign: "center", color: "#667482" }}>
            <strong style={{ display: "block", color: "#24313d", marginBottom: 5 }}>No jobs in this view</strong>
            {view === "available" ? "There are no unassigned open repairs right now." : "Assigned and open repairs will appear here."}
          </div>
        )}
      </section>
    </main>
  );
}

const noticeStyle = { marginTop: 18, padding: 12, borderRadius: 10, background: "#fff8e6", border: "1px solid #f2c66d" } as const;
const tabButton = { border: "1px solid #cdd5dc", borderRadius: 999, padding: "9px 14px", background: "white", color: "#283645", fontWeight: 800, cursor: "pointer" } as const;
const activeTab = { ...tabButton, background: "#0d1b2b", borderColor: "#0d1b2b", color: "white" } as const;
const primaryButton = { border: 0, borderRadius: 9, padding: "10px 14px", background: "#f47b20", color: "white", fontWeight: 900, cursor: "pointer" } as const;
const secondaryButton = { border: "1px solid #cbd3da", borderRadius: 9, padding: "9px 12px", background: "#f7f9fa", color: "#182331", fontWeight: 800, cursor: "pointer" } as const;
const dangerButton = { border: 0, borderRadius: 9, padding: "10px 14px", background: "#c83e32", color: "white", fontWeight: 900, cursor: "pointer" } as const;
const completeButton = { border: 0, borderRadius: 9, padding: "10px 14px", background: "#16784c", color: "white", fontWeight: 900, cursor: "pointer" } as const;
const inputStyle = { width: "100%", boxSizing: "border-box" as const, padding: "10px 11px", border: "1px solid #ccd4db", borderRadius: 8, background: "white", color: "#182331" } as const;
const workspaceStyle = { marginTop: 18, background: "white", border: "1px solid #d6dde3", borderRadius: 15, padding: 20, boxShadow: "0 8px 30px #12202f12" } as const;
const workspaceCard = { border: "1px solid #e0e5e9", borderRadius: 11, padding: 15, background: "#fbfcfd" } as const;
const workspaceHeading = { margin: "0 0 11px", color: "#0d1b2b", fontSize: 17 } as const;
const chip = { display: "inline-block", padding: "5px 8px", borderRadius: 999, background: "#eef2f5", fontSize: 12, margin: "0 5px 5px 0" } as const;
const mutedText = { color: "#7b8792", fontSize: 13 } as const;
const helperText = { margin: "9px 0 0", color: "#7b8792", fontSize: 11 } as const;
const smallNotice = { marginTop: 12, padding: "9px 11px", borderRadius: 8, background: "#fff8e6", color: "#7a5316", fontSize: 12 } as const;
const lockedNotice = { marginTop: 12, padding: "9px 11px", borderRadius: 8, background: "#f3f5f7", color: "#657383", fontSize: 12 } as const;
const relatedRepairStyle = { display: "grid", gridTemplateColumns: "minmax(180px,1fr) minmax(180px,auto) auto", gap: 10, alignItems: "center", padding: "10px 12px", border: "1px solid #e1e6ea", borderRadius: 9, background: "#fbfcfd" } as const;
const relatedTitleButton = { border: 0, padding: 0, background: "transparent", color: "#0d1b2b", fontWeight: 800, textAlign: "left" as const, cursor: "pointer" } as const;
const relatedHint = { fontSize: 11, color: "#7b8792", alignSelf: "center" } as const;
const repairTitleButton = { display: "block", border: 0, padding: 0, margin: "8px 0 7px", background: "transparent", color: "#182331", textAlign: "left" as const, fontSize: 20, fontWeight: 800, cursor: "pointer" } as const;
const activeJobButton = { display: "block", border: 0, padding: 0, background: "transparent", color: "white", textAlign: "left" as const, fontSize: 22, fontWeight: 900, cursor: "pointer" } as const;
