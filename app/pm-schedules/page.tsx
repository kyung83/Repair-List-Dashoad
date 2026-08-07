"use client";

import { useEffect, useMemo, useState } from "react";

type PmProfile = { id: number; name: string; sequence: string[] };
type PmSchedule = {
  profileId: number;
  profileName: string;
  mileageInterval: number | null;
  timeIntervalDays: number | null;
};
type PmEquipment = {
  id: number;
  unit: string;
  category: string;
  equipmentType: "Vehicle" | "Trailer";
  currentMileage: number | null;
  mileageSource: "Geotab" | "Manual";
  make: string;
  model: string;
  driver: string;
  location: string;
  schedule: PmSchedule | null;
  nextPmType: string;
  lastMileage: number | null;
  lastServiceDate: string;
};
type PmData = { categories: string[]; profiles: PmProfile[]; equipment: PmEquipment[]; updatedAt: string };
type AnnualEquipment = {
  id: number;
  unit: string;
  equipmentType: string;
  category: string;
  annualIntervalDays: number | null;
  lastAnnualDate: string;
};
type AnnualData = { equipment: AnnualEquipment[]; updatedAt: string };
type DueState = "overdue" | "due-soon" | "current" | "unconfigured";

const dayMs = 24 * 60 * 60 * 1000;

function addDays(date: string, days: number) {
  if (!date) return "";
  const value = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(value.getTime())) return "";
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysUntil(date: string) {
  if (!date) return null;
  const target = new Date(`${date}T12:00:00`).getTime();
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.ceil((target - today.getTime()) / dayMs);
}

function formatDate(date: string) {
  if (!date) return "—";
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString();
}

function pillStyle(state: DueState) {
  if (state === "overdue") return { background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" };
  if (state === "due-soon") return { background: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa" };
  if (state === "current") return { background: "#ecfdf5", color: "#166534", border: "1px solid #bbf7d0" };
  return { background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" };
}

function pmDue(item: PmEquipment) {
  if (!item.schedule) return { state: "unconfigured" as DueState, label: "No PM schedule", detail: "" };
  const mileageDue = item.schedule.mileageInterval != null && item.lastMileage != null
    ? item.lastMileage + item.schedule.mileageInterval
    : null;
  const milesRemaining = mileageDue != null && item.currentMileage != null ? mileageDue - item.currentMileage : null;
  const timeDue = item.schedule.timeIntervalDays != null ? addDays(item.lastServiceDate, item.schedule.timeIntervalDays) : "";
  const timeRemaining = daysUntil(timeDue);
  const overdue = (milesRemaining != null && milesRemaining <= 0) || (timeRemaining != null && timeRemaining <= 0);
  const dueSoon = (milesRemaining != null && milesRemaining <= 1000) || (timeRemaining != null && timeRemaining <= 30);
  const detail = [mileageDue != null ? `${mileageDue.toLocaleString()} mi` : "", timeDue ? formatDate(timeDue) : ""].filter(Boolean).join(" or ");
  return {
    state: overdue ? "overdue" as DueState : dueSoon ? "due-soon" as DueState : "current" as DueState,
    label: item.nextPmType ? `${item.nextPmType} PM` : item.schedule.profileName,
    detail: detail ? `Due ${detail}` : "Baseline needed",
  };
}

function annualDue(item?: AnnualEquipment) {
  if (!item?.annualIntervalDays) return { state: "unconfigured" as DueState, label: "No annual schedule" };
  if (!item.lastAnnualDate) return { state: "due-soon" as DueState, label: "Annual date needed" };
  const due = addDays(item.lastAnnualDate, item.annualIntervalDays);
  const remaining = daysUntil(due);
  const state: DueState = remaining != null && remaining <= 0 ? "overdue" : remaining != null && remaining <= 45 ? "due-soon" : "current";
  return { state, label: formatDate(due) };
}

export default function PmSchedulesPage() {
  const [pmData, setPmData] = useState<PmData | null>(null);
  const [annualData, setAnnualData] = useState<AnnualData | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [profileId, setProfileId] = useState("");
  const [mileageInterval, setMileageInterval] = useState("");
  const [timeIntervalDays, setTimeIntervalDays] = useState("");
  const [annualIntervalDays, setAnnualIntervalDays] = useState("365");
  const [mileageDrafts, setMileageDrafts] = useState<Record<number, string>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const [pmResponse, annualResponse] = await Promise.all([
      fetch("/api/pm-schedules", { cache: "no-store" }),
      fetch("/api/annual-schedules", { cache: "no-store" }),
    ]);
    const pm = await pmResponse.json() as PmData & { error?: string };
    const annual = await annualResponse.json() as AnnualData & { error?: string };
    if (!pmResponse.ok) throw new Error(pm.error || "PM schedules could not be loaded.");
    if (!annualResponse.ok) throw new Error(annual.error || "Annual schedules could not be loaded.");
    setPmData(pm);
    setAnnualData(annual);
    setMileageDrafts(Object.fromEntries(pm.equipment.map((item) => [item.id, item.currentMileage == null ? "" : String(item.currentMileage)])));
  }

  useEffect(() => {
    void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Schedules could not be loaded."));
  }, []);

  async function post(url: string, body: Record<string, unknown>, success: string) {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Schedule action failed.");
      await load();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Schedule action failed.");
    } finally {
      setSaving(false);
    }
  }

  const annualById = useMemo(() => new Map((annualData?.equipment ?? []).map((item) => [item.id, item])), [annualData]);
  const categories = useMemo(() => ["All", ...(pmData?.categories ?? []), "Uncategorized"], [pmData]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (pmData?.equipment ?? []).filter((item) => {
      if (category !== "All" && item.category !== category) return false;
      if (!needle) return true;
      return [item.unit, item.category, item.make, item.model, item.driver, item.location, item.schedule?.profileName ?? ""].join(" ").toLowerCase().includes(needle);
    });
  }, [category, pmData, query]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allVisibleSelected = visible.length > 0 && visible.every((item) => selectedSet.has(item.id));

  const summary = useMemo(() => {
    let overdue = 0;
    let dueSoon = 0;
    let noPm = 0;
    for (const item of pmData?.equipment ?? []) {
      const pm = pmDue(item);
      const annual = annualDue(annualById.get(item.id));
      if (!item.schedule) noPm += 1;
      if (pm.state === "overdue" || annual.state === "overdue") overdue += 1;
      else if (pm.state === "due-soon" || annual.state === "due-soon") dueSoon += 1;
    }
    return { total: pmData?.equipment.length ?? 0, overdue, dueSoon, noPm };
  }, [annualById, pmData]);

  function toggleOne(id: number) {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function toggleVisible() {
    const ids = visible.map((item) => item.id);
    setSelected((current) => {
      const next = new Set(current);
      if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return [...next];
    });
  }

  function applyPm() {
    if (!selected.length) return setMessage("Select at least one unit first.");
    if (!profileId) return setMessage("Choose a PM option first.");
    if (!mileageInterval && !timeIntervalDays) return setMessage("Set mileage, time, or both for the PM schedule.");
    void post("/api/pm-schedules", {
      action: "applySchedule",
      equipmentIds: selected,
      profileId: Number(profileId),
      mileageInterval: mileageInterval || null,
      timeIntervalDays: timeIntervalDays || null,
      annualRequired: false,
    }, `PM schedule applied to ${selected.length} checked unit${selected.length === 1 ? "" : "s"}.`);
  }

  function applyAnnual() {
    if (!selected.length) return setMessage("Select at least one truck, vehicle, or trailer first.");
    void post("/api/annual-schedules", {
      action: "applyAnnual",
      equipmentIds: selected,
      intervalDays: Number(annualIntervalDays || 365),
    }, `Annual / inspection schedule applied to ${selected.length} checked unit${selected.length === 1 ? "" : "s"}.`);
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f3f5f7", padding: 36, color: "#172033" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#f47b20", fontSize: 12, fontWeight: 900, letterSpacing: ".15em" }}>PREVENTIVE MAINTENANCE</p>
          <h1 style={{ margin: "8px 0 0", fontSize: 34, color: "#0d1b2b" }}>PM & Annual Schedules</h1>
          <p style={{ margin: "8px 0 0", color: "#64748b" }}>PM mileage/time rules are separate from annual or inspection time schedules.</p>
        </div>
        <strong>{selected.length} checked</strong>
      </header>

      {message && <div style={{ marginTop: 16, padding: 12, borderRadius: 9, background: "#fff8e6", border: "1px solid #f2c66d" }}>{message}</div>}

      <section style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
        {[["ACTIVE UNITS", summary.total], ["OVERDUE", summary.overdue], ["DUE SOON", summary.dueSoon], ["NO PM SCHEDULE", summary.noPm]].map(([label, value]) => (
          <article key={label} style={{ background: "white", padding: 18, border: "1px solid #dce2e7", borderRadius: 12 }}>
            <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: ".12em", color: "#64748b" }}>{label}</span>
            <strong style={{ display: "block", marginTop: 8, fontSize: 28 }}>{value}</strong>
          </article>
        ))}
      </section>

      <section style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", gap: 16 }}>
        <article style={{ background: "white", border: "1px solid #dce2e7", borderRadius: 12, padding: 18 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>1. PM Schedule</h2>
          <p style={{ color: "#64748b", fontSize: 13 }}>Choose the checked units’ PM option, then set mileage, time, or both. Geotab supplies mileage where available.</p>
          <div style={{ display: "grid", gap: 11 }}>
            <label style={{ display: "grid", gap: 5, fontWeight: 700, fontSize: 13 }}>PM option
              <select value={profileId} onChange={(event) => setProfileId(event.target.value)} style={{ padding: 10 }}>
                <option value="">Choose PM option</option>
                {(pmData?.profiles ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.name} — {profile.sequence.join(" → ")}</option>)}
              </select>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ display: "grid", gap: 5, fontWeight: 700, fontSize: 13 }}>Mileage interval
                <input type="number" min="1" placeholder="Example: 20,000" value={mileageInterval} onChange={(event) => setMileageInterval(event.target.value)} style={{ padding: 10 }} />
              </label>
              <label style={{ display: "grid", gap: 5, fontWeight: 700, fontSize: 13 }}>Time interval (days)
                <input type="number" min="1" placeholder="Example: 90" value={timeIntervalDays} onChange={(event) => setTimeIntervalDays(event.target.value)} style={{ padding: 10 }} />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" disabled={saving || !selected.length} onClick={applyPm} style={{ padding: "11px 15px", border: 0, borderRadius: 8, background: "#f47b20", color: "white", fontWeight: 900 }}>Apply PM to checked</button>
              <button type="button" disabled={saving || !selected.length} onClick={() => void post("/api/pm-schedules", { action: "clearSchedule", equipmentIds: selected }, "PM schedule removed from checked units.")}>Remove PM schedule</button>
            </div>
          </div>
        </article>

        <article style={{ background: "white", border: "1px solid #dce2e7", borderRadius: 12, padding: 18 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>2. Annual / Inspection Schedule</h2>
          <p style={{ color: "#64748b", fontSize: 13 }}>Separate from PM. Use this for annual inspections or another time interval on trucks, company vehicles, and trailers.</p>
          <div style={{ display: "grid", gap: 11 }}>
            <label style={{ display: "grid", gap: 5, fontWeight: 700, fontSize: 13 }}>Annual / inspection interval (days)
              <input type="number" min="1" value={annualIntervalDays} onChange={(event) => setAnnualIntervalDays(event.target.value)} style={{ padding: 10 }} />
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" disabled={saving || !selected.length} onClick={applyAnnual} style={{ padding: "11px 15px", border: 0, borderRadius: 8, background: "#29465f", color: "white", fontWeight: 900 }}>Apply annual to checked</button>
              <button type="button" disabled={saving || !selected.length} onClick={() => void post("/api/annual-schedules", { action: "clearAnnual", equipmentIds: selected }, "Annual schedule removed from checked units.")}>Remove annual schedule</button>
            </div>
          </div>
        </article>
      </section>

      <section style={{ marginTop: 20, background: "white", border: "1px solid #dce2e7", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 16, display: "flex", gap: 10, flexWrap: "wrap", borderBottom: "1px solid #e2e8f0", alignItems: "center" }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search unit, category, make, model, driver…" style={{ minWidth: 260, flex: "1 1 340px", padding: 10 }} />
          <select value={category} onChange={(event) => setCategory(event.target.value)} style={{ padding: 10 }}>{categories.map((item) => <option key={item}>{item}</option>)}</select>
          <button type="button" disabled={!selected.length} onClick={() => setSelected([])}>Clear checks</button>
          <span style={{ color: "#64748b", fontSize: 13 }}>{visible.length} visible</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1420 }}>
            <thead><tr style={{ background: "#f8fafc", color: "#64748b", fontSize: 11 }}>
              <th style={{ padding: 11, textAlign: "left" }}><input type="checkbox" aria-label="Select all visible units" checked={allVisibleSelected} onChange={toggleVisible} /></th>
              {["Unit", "Category", "Mileage", "PM option", "Next PM", "Annual / inspection", "Last PM", "Location", "Actions"].map((heading) => <th key={heading} style={{ padding: 11, textAlign: "left" }}>{heading}</th>)}
            </tr></thead>
            <tbody>
              {visible.map((item) => {
                const pm = pmDue(item);
                const annualItem = annualById.get(item.id);
                const annual = annualDue(annualItem);
                return <tr key={item.id} style={{ borderTop: "1px solid #edf0f2", background: selectedSet.has(item.id) ? "#fff9f2" : "white" }}>
                  <td style={{ padding: 11 }}><input type="checkbox" checked={selectedSet.has(item.id)} onChange={() => toggleOne(item.id)} /></td>
                  <td style={{ padding: 11 }}><strong>{item.unit}</strong><div style={{ fontSize: 12, color: "#64748b" }}>{[item.make, item.model].filter(Boolean).join(" ") || item.equipmentType}</div></td>
                  <td style={{ padding: 11 }}>
                    <select value={item.category} disabled={saving || item.equipmentType === "Trailer"} onChange={(event) => void post("/api/pm-schedules", { action: "setCategory", equipmentId: item.id, category: event.target.value }, `${item.unit} category updated.`)} style={{ maxWidth: 170, padding: 7 }}>
                      <option>Uncategorized</option>
                      {(pmData?.categories ?? []).filter((name) => name !== "Trailers").map((name) => <option key={name}>{name}</option>)}
                      {item.equipmentType === "Trailer" && <option>Trailers</option>}
                    </select>
                  </td>
                  <td style={{ padding: 11 }}>
                    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                      <input type="number" min="0" value={mileageDrafts[item.id] ?? ""} disabled={item.mileageSource === "Geotab" || saving} onChange={(event) => setMileageDrafts({ ...mileageDrafts, [item.id]: event.target.value })} style={{ width: 95, padding: 7 }} />
                      {item.mileageSource === "Manual" && <button type="button" disabled={saving || !(mileageDrafts[item.id] ?? "").trim()} onClick={() => void post("/api/pm-schedules", { action: "updateMileage", equipmentId: item.id, mileage: mileageDrafts[item.id] }, `${item.unit} mileage updated.`)}>Save</button>}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>{item.mileageSource}</div>
                  </td>
                  <td style={{ padding: 11 }}><strong>{item.schedule?.profileName || "—"}</strong>{item.schedule && <div style={{ fontSize: 12, color: "#64748b" }}>{[item.schedule.mileageInterval ? `${item.schedule.mileageInterval.toLocaleString()} mi` : "", item.schedule.timeIntervalDays ? `${item.schedule.timeIntervalDays} days` : ""].filter(Boolean).join(" + ")}</div>}</td>
                  <td style={{ padding: 11 }}><span style={{ display: "inline-block", borderRadius: 999, padding: "4px 8px", fontSize: 12, fontWeight: 800, ...pillStyle(pm.state) }}>{pm.label}</span><div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{pm.detail}</div></td>
                  <td style={{ padding: 11 }}><span style={{ display: "inline-block", borderRadius: 999, padding: "4px 8px", fontSize: 12, fontWeight: 800, ...pillStyle(annual.state) }}>{annual.label}</span>{annualItem?.annualIntervalDays && <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{annualItem.annualIntervalDays} day interval</div>}</td>
                  <td style={{ padding: 11 }}>{formatDate(item.lastServiceDate)}<div style={{ fontSize: 12, color: "#64748b" }}>{item.lastMileage == null ? "—" : `${item.lastMileage.toLocaleString()} mi`}</div></td>
                  <td style={{ padding: 11 }}>{item.location || "—"}</td>
                  <td style={{ padding: 11 }}><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" disabled={saving || !item.schedule} onClick={() => void post("/api/pm-schedules", { action: "completePm", equipmentId: item.id, mileage: item.currentMileage }, `${item.unit} PM completed; next PM advanced.`)}>Complete PM</button>
                    <button type="button" disabled={saving || !annualItem?.annualIntervalDays} onClick={() => void post("/api/annual-schedules", { action: "completeAnnual", equipmentId: item.id }, `${item.unit} annual / inspection completed.`)}>Complete annual</button>
                  </div></td>
                </tr>;
              })}
              {!visible.length && <tr><td colSpan={10} style={{ padding: 30, textAlign: "center", color: "#64748b" }}>No matching units.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
