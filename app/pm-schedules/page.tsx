"use client";

import { useEffect, useMemo, useState } from "react";

type PmProfile = { id: number; name: string; sequence: string[] };
type PmSchedule = {
  profileId: number;
  profileName: string;
  mileageInterval: number | null;
  timeIntervalDays: number | null;
  annualRequired: boolean;
};
type PmEquipment = {
  id: number;
  unit: string;
  category: string;
  equipmentType: "Vehicle" | "Trailer";
  currentMileage: number | null;
  mileageUpdatedAt: string;
  mileageSource: "Geotab" | "Manual";
  make: string;
  model: string;
  driver: string;
  location: string;
  schedule: PmSchedule | null;
  nextPmType: string;
  lastMileage: number | null;
  lastServiceDate: string;
  lastAnnualDate: string;
};
type PmData = {
  categories: string[];
  profiles: PmProfile[];
  equipment: PmEquipment[];
  updatedAt: string;
};

type DueState = "overdue" | "due-soon" | "current" | "unconfigured";

type ScheduleForm = {
  profileId: string;
  mileageInterval: string;
  timeIntervalDays: string;
  annualRequired: boolean;
};

const blankForm: ScheduleForm = {
  profileId: "",
  mileageInterval: "",
  timeIntervalDays: "",
  annualRequired: true,
};

const dayMs = 24 * 60 * 60 * 1000;

function datePlusDays(date: string, days: number) {
  if (!date) return "";
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function datePlusYear(date: string) {
  if (!date) return "";
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCFullYear(parsed.getUTCFullYear() + 1);
  return parsed.toISOString().slice(0, 10);
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

function numberText(value: number | null) {
  return value == null ? "—" : value.toLocaleString();
}

function pmDueDetails(item: PmEquipment) {
  if (!item.schedule) return { state: "unconfigured" as DueState, label: "No PM schedule", detail: "" };

  const mileageDue = item.schedule.mileageInterval != null && item.lastMileage != null
    ? item.lastMileage + item.schedule.mileageInterval
    : null;
  const milesRemaining = mileageDue != null && item.currentMileage != null
    ? mileageDue - item.currentMileage
    : null;
  const timeDue = item.schedule.timeIntervalDays != null
    ? datePlusDays(item.lastServiceDate, item.schedule.timeIntervalDays)
    : "";
  const timeRemaining = daysUntil(timeDue);

  const overdue = (milesRemaining != null && milesRemaining <= 0) || (timeRemaining != null && timeRemaining <= 0);
  const dueSoon = (milesRemaining != null && milesRemaining <= 1000) || (timeRemaining != null && timeRemaining <= 30);
  const state: DueState = overdue ? "overdue" : dueSoon ? "due-soon" : "current";

  const bits: string[] = [];
  if (mileageDue != null) bits.push(`${mileageDue.toLocaleString()} mi`);
  if (timeDue) bits.push(formatDate(timeDue));
  return {
    state,
    label: item.nextPmType ? `${item.nextPmType} PM` : item.schedule.profileName,
    detail: bits.length ? `Due ${bits.join(" or ")}` : "Baseline needed",
  };
}

function annualDueDetails(item: PmEquipment) {
  if (!item.schedule?.annualRequired) return { state: "unconfigured" as DueState, label: "Not required", due: "" };
  const due = datePlusYear(item.lastAnnualDate);
  if (!due) return { state: "due-soon" as DueState, label: "Annual date needed", due: "" };
  const remaining = daysUntil(due);
  const state: DueState = remaining != null && remaining <= 0 ? "overdue" : remaining != null && remaining <= 45 ? "due-soon" : "current";
  return { state, label: formatDate(due), due };
}

function pillStyle(state: DueState) {
  if (state === "overdue") return { background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca" };
  if (state === "due-soon") return { background: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa" };
  if (state === "current") return { background: "#ecfdf5", color: "#166534", border: "1px solid #bbf7d0" };
  return { background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" };
}

export default function PmSchedulesPage() {
  const [data, setData] = useState<PmData | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<ScheduleForm>(blankForm);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [mileageDrafts, setMileageDrafts] = useState<Record<number, string>>({});

  async function load() {
    const response = await fetch("/api/pm-schedules", { cache: "no-store" });
    const payload = await response.json() as PmData & { error?: string };
    if (!response.ok) throw new Error(payload.error || "PM schedules could not be loaded.");
    setData(payload);
    setMileageDrafts(Object.fromEntries(payload.equipment.map((item) => [item.id, item.currentMileage == null ? "" : String(item.currentMileage)])));
  }

  useEffect(() => {
    void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "PM schedules could not be loaded."));
  }, []);

  async function post(body: Record<string, unknown>, success: string) {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/pm-schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "PM schedule action failed.");
      await load();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PM schedule action failed.");
      throw error;
    } finally {
      setSaving(false);
    }
  }

  const categories = useMemo(() => ["All", ...(data?.categories ?? []), "Uncategorized"], [data]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.equipment ?? []).filter((item) => {
      if (category !== "All" && item.category !== category) return false;
      if (!needle) return true;
      return [item.unit, item.category, item.make, item.model, item.driver, item.location, item.schedule?.profileName ?? ""]
        .join(" ").toLowerCase().includes(needle);
    });
  }, [category, data, query]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allVisibleSelected = visible.length > 0 && visible.every((item) => selectedSet.has(item.id));
  const summary = useMemo(() => {
    const rows = data?.equipment ?? [];
    let overdue = 0;
    let dueSoon = 0;
    let unconfigured = 0;
    for (const item of rows) {
      const pm = pmDueDetails(item);
      const annual = annualDueDetails(item);
      if (!item.schedule) unconfigured += 1;
      if (pm.state === "overdue" || annual.state === "overdue") overdue += 1;
      else if (pm.state === "due-soon" || annual.state === "due-soon") dueSoon += 1;
    }
    return { total: rows.length, overdue, dueSoon, unconfigured };
  }, [data]);

  function toggleOne(id: number) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleVisible() {
    const visibleIds = visible.map((item) => item.id);
    setSelected((current) => {
      const currentSet = new Set(current);
      if (visibleIds.every((id) => currentSet.has(id))) return current.filter((id) => !visibleIds.includes(id));
      visibleIds.forEach((id) => currentSet.add(id));
      return [...currentSet];
    });
  }

  async function applySchedule() {
    if (!selected.length) return setMessage("Select at least one vehicle or trailer first.");
    if (!form.profileId) return setMessage("Choose a PM profile.");
    if (!form.mileageInterval && !form.timeIntervalDays && !form.annualRequired) {
      return setMessage("Choose mileage, time, or annual scheduling.");
    }
    await post({
      action: "applySchedule",
      equipmentIds: selected,
      profileId: Number(form.profileId),
      mileageInterval: form.mileageInterval || null,
      timeIntervalDays: form.timeIntervalDays || null,
      annualRequired: form.annualRequired,
    }, `PM schedule applied to ${selected.length} selected unit${selected.length === 1 ? "" : "s"}.`);
  }

  async function clearSchedule() {
    if (!selected.length) return setMessage("Select at least one unit first.");
    await post({ action: "clearSchedule", equipmentIds: selected }, `PM schedule removed from ${selected.length} selected unit${selected.length === 1 ? "" : "s"}.`);
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f3f5f7", padding: "38px", color: "#172033" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 24, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#f47b20", fontSize: 12, fontWeight: 900, letterSpacing: ".15em" }}>PREVENTIVE MAINTENANCE</p>
          <h1 style={{ margin: "8px 0 0", fontSize: 34, color: "#0d1b2b" }}>PM Schedules</h1>
          <p style={{ margin: "8px 0 0", color: "#64748b" }}>Mileage, time, annual, and trailer service reminders for the active fleet.</p>
        </div>
        <div style={{ fontSize: 13, color: "#64748b" }}>{selected.length} selected</div>
      </header>

      {message && <div style={{ marginTop: 18, padding: 12, borderRadius: 9, background: "#fff8e6", border: "1px solid #f2c66d" }}>{message}</div>}

      <section style={{ marginTop: 22, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
        {[
          ["ACTIVE UNITS", summary.total],
          ["OVERDUE", summary.overdue],
          ["DUE SOON", summary.dueSoon],
          ["NOT SCHEDULED", summary.unconfigured],
        ].map(([label, value]) => (
          <article key={label} style={{ background: "white", padding: 18, border: "1px solid #dce2e7", borderRadius: 12 }}>
            <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: ".12em", color: "#64748b" }}>{label}</span>
            <strong style={{ display: "block", marginTop: 8, fontSize: 28 }}>{value}</strong>
          </article>
        ))}
      </section>

      <section style={{ marginTop: 20, background: "white", border: "1px solid #dce2e7", borderRadius: 12, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 19 }}>Apply PM reminder to checked units</h2>
            <p style={{ margin: "5px 0 0", color: "#64748b", fontSize: 13 }}>40 → 20A → 20B repeats automatically. Strict 40 always returns to 40. Trailers can use Trailer Service.</p>
          </div>
          <button type="button" onClick={() => setSelected([])} disabled={!selected.length || saving}>Clear selection</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginTop: 16, alignItems: "end" }}>
          <label style={{ display: "grid", gap: 5, fontSize: 13, fontWeight: 700 }}>
            PM profile
            <select value={form.profileId} onChange={(event) => setForm({ ...form, profileId: event.target.value })} style={{ padding: 10 }}>
              <option value="">Choose profile</option>
              {(data?.profiles ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.name} ({profile.sequence.join(" → ")})</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 5, fontSize: 13, fontWeight: 700 }}>
            Mileage interval
            <input type="number" min="1" step="1" placeholder="Example: 20000" value={form.mileageInterval} onChange={(event) => setForm({ ...form, mileageInterval: event.target.value })} style={{ padding: 10 }} />
          </label>
          <label style={{ display: "grid", gap: 5, fontSize: 13, fontWeight: 700 }}>
            Time interval (days)
            <input type="number" min="1" step="1" placeholder="Example: 180" value={form.timeIntervalDays} onChange={(event) => setForm({ ...form, timeIntervalDays: event.target.value })} style={{ padding: 10 }} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 40, fontSize: 13, fontWeight: 700 }}>
            <input type="checkbox" checked={form.annualRequired} onChange={(event) => setForm({ ...form, annualRequired: event.target.checked })} />
            Annual reminder required
          </label>
          <button type="button" disabled={saving || !selected.length} onClick={() => void applySchedule()} style={{ padding: "11px 15px", border: 0, borderRadius: 8, background: "#f47b20", color: "white", fontWeight: 900 }}>
            Apply to {selected.length || 0} checked
          </button>
          <button type="button" disabled={saving || !selected.length} onClick={() => void clearSchedule()} style={{ padding: "10px 14px" }}>Remove schedule</button>
        </div>
      </section>

      <section style={{ marginTop: 20, background: "white", border: "1px solid #dce2e7", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 16, display: "flex", gap: 10, flexWrap: "wrap", borderBottom: "1px solid #e2e8f0", alignItems: "center" }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search unit, category, make, model, driver…" style={{ minWidth: 260, flex: "1 1 340px", padding: 10 }} />
          <select value={category} onChange={(event) => setCategory(event.target.value)} style={{ padding: 10 }}>
            {categories.map((item) => <option key={item}>{item}</option>)}
          </select>
          <span style={{ color: "#64748b", fontSize: 13 }}>{visible.length} visible</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1380 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#64748b", fontSize: 11 }}>
                <th style={{ padding: 11, textAlign: "left" }}><input type="checkbox" aria-label="Select all visible units" checked={allVisibleSelected} onChange={toggleVisible} /></th>
                {['Unit', 'Category', 'Mileage', 'PM profile', 'Next PM / due', 'Annual due', 'Last service', 'Location', 'Actions'].map((heading) => <th key={heading} style={{ padding: 11, textAlign: "left" }}>{heading}</th>)}
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const pmDue = pmDueDetails(item);
                const annual = annualDueDetails(item);
                return (
                  <tr key={item.id} style={{ borderTop: "1px solid #edf0f2", background: selectedSet.has(item.id) ? "#fff9f2" : "white" }}>
                    <td style={{ padding: 11 }}><input type="checkbox" aria-label={`Select ${item.unit}`} checked={selectedSet.has(item.id)} onChange={() => toggleOne(item.id)} /></td>
                    <td style={{ padding: 11 }}>
                      <strong>{item.unit}</strong>
                      <div style={{ fontSize: 12, color: "#64748b" }}>{[item.make, item.model].filter(Boolean).join(" ") || item.equipmentType}</div>
                    </td>
                    <td style={{ padding: 11 }}>
                      <select value={item.category} disabled={saving || item.equipmentType === "Trailer"} onChange={(event) => void post({ action: "setCategory", equipmentId: item.id, category: event.target.value }, `${item.unit} moved to ${event.target.value}.`)} style={{ maxWidth: 170, padding: 7 }}>
                        <option>Uncategorized</option>
                        {(data?.categories ?? []).filter((name) => name !== "Trailers").map((name) => <option key={name}>{name}</option>)}
                        {item.equipmentType === "Trailer" && <option>Trailers</option>}
                      </select>
                    </td>
                    <td style={{ padding: 11 }}>
                      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                        <input type="number" min="0" value={mileageDrafts[item.id] ?? ""} disabled={item.mileageSource === "Geotab" || saving} onChange={(event) => setMileageDrafts({ ...mileageDrafts, [item.id]: event.target.value })} style={{ width: 95, padding: 7 }} />
                        {item.mileageSource === "Manual" && <button type="button" disabled={saving || !(mileageDrafts[item.id] ?? "").trim()} onClick={() => void post({ action: "updateMileage", equipmentId: item.id, mileage: mileageDrafts[item.id] }, `${item.unit} mileage updated.`)}>Save</button>}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>{item.mileageSource}</div>
                    </td>
                    <td style={{ padding: 11 }}>
                      <strong>{item.schedule?.profileName || "—"}</strong>
                      {item.schedule && <div style={{ fontSize: 12, color: "#64748b" }}>
                        {[
                          item.schedule.mileageInterval ? `${item.schedule.mileageInterval.toLocaleString()} mi` : "",
                          item.schedule.timeIntervalDays ? `${item.schedule.timeIntervalDays} days` : "",
                        ].filter(Boolean).join(" + ") || "Annual only"}
                      </div>}
                    </td>
                    <td style={{ padding: 11 }}>
                      <span style={{ display: "inline-block", borderRadius: 999, padding: "4px 8px", fontSize: 12, fontWeight: 800, ...pillStyle(pmDue.state) }}>{pmDue.label}</span>
                      {pmDue.detail && <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{pmDue.detail}</div>}
                    </td>
                    <td style={{ padding: 11 }}>
                      <span style={{ display: "inline-block", borderRadius: 999, padding: "4px 8px", fontSize: 12, fontWeight: 800, ...pillStyle(annual.state) }}>{annual.label}</span>
                    </td>
                    <td style={{ padding: 11 }}>
                      {formatDate(item.lastServiceDate)}
                      <div style={{ fontSize: 12, color: "#64748b" }}>at {numberText(item.lastMileage)} mi</div>
                    </td>
                    <td style={{ padding: 11 }}>{item.location || "—"}</td>
                    <td style={{ padding: 11 }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" disabled={saving || !item.schedule} onClick={() => void post({ action: "completePm", equipmentId: item.id, mileage: item.currentMileage }, `${item.unit} PM completed. Next PM advanced automatically.`)}>Complete PM</button>
                        <button type="button" disabled={saving || !item.schedule?.annualRequired} onClick={() => void post({ action: "completeAnnual", equipmentId: item.id }, `${item.unit} annual completed.`)}>Complete annual</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!visible.length && <tr><td colSpan={10} style={{ padding: 30, textAlign: "center", color: "#64748b" }}>No matching vehicles.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
