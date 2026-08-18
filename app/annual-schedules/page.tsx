"use client";

import { useEffect, useMemo, useState } from "react";

type AnnualUnit = {
  id: number;
  unit: string;
  equipmentType: "Truck / Vehicle" | "Trailer";
  category: string;
  annualIntervalDays: number | null;
  lastAnnualDate: string;
};

type Payload = {
  equipment: AnnualUnit[];
  updatedAt: string;
  error?: string;
};

type View = "trucks" | "trailers";
type Tone = "green" | "orange" | "red" | "gray";

function dateAtNoon(value: string) {
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shortDate(value: string) {
  const parsed = dateAtNoon(value);
  return parsed ? parsed.toLocaleDateString() : "—";
}

function dueDetails(item: AnnualUnit): { date: string; label: string; tone: Tone } {
  if (!item.annualIntervalDays) return { date: "", label: "No schedule", tone: "gray" };
  if (!item.lastAnnualDate) return { date: "", label: "Annual date needed", tone: "orange" };
  const last = dateAtNoon(item.lastAnnualDate);
  if (!last) return { date: "", label: "Invalid date", tone: "red" };
  const due = new Date(last);
  due.setDate(due.getDate() + item.annualIntervalDays);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.ceil((due.getTime() - today.getTime()) / 86_400_000);
  const date = due.toISOString().slice(0, 10);
  if (days < 0) return { date, label: `${Math.abs(days)} days overdue`, tone: "red" };
  if (days === 0) return { date, label: "Due today", tone: "red" };
  if (days <= 45) return { date, label: `Due in ${days} days`, tone: "orange" };
  return { date, label: `${days} days remaining`, tone: "green" };
}

export default function AnnualSchedulesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [view, setView] = useState<View>("trucks");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [dates, setDates] = useState<Record<number, string>>({});
  const [intervalDays, setIntervalDays] = useState("365");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const response = await fetch("/api/annual-schedules", { cache: "no-store" });
    const payload = await response.json() as Payload;
    if (!response.ok) throw new Error(payload.error || "Annual schedules could not be loaded.");
    setData(payload);
    setDates(Object.fromEntries(payload.equipment.map((item) => [item.id, item.lastAnnualDate])));
  }

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/annual-schedules", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as Payload;
        if (!response.ok) throw new Error(payload.error || "Annual schedules could not be loaded.");
        return payload;
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setDates(Object.fromEntries(payload.equipment.map((item) => [item.id, item.lastAnnualDate])));
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Annual schedules could not be loaded.");
      });
    return () => { cancelled = true; };
  }, []);

  async function post(body: Record<string, unknown>, success: string, busyKey: string) {
    setBusy(busyKey);
    setMessage("");
    try {
      const response = await fetch("/api/annual-schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Annual schedule could not be updated.");
      await load();
      setMessage(success);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Annual schedule could not be updated.");
      return false;
    } finally {
      setBusy("");
    }
  }

  const trucks = useMemo(() => (data?.equipment ?? []).filter((item) => item.equipmentType !== "Trailer"), [data]);
  const trailers = useMemo(() => (data?.equipment ?? []).filter((item) => item.equipmentType === "Trailer"), [data]);
  const visible = useMemo(() => {
    const source = view === "trucks" ? trucks : trailers;
    const needle = query.trim().toLowerCase();
    if (!needle) return source;
    return source.filter((item) => `${item.unit} ${item.category} ${item.lastAnnualDate}`.toLowerCase().includes(needle));
  }, [query, trailers, trucks, view]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allVisibleSelected = visible.length > 0 && visible.every((item) => selectedSet.has(item.id));

  function changeView(next: View) {
    setView(next);
    setSelected([]);
    setQuery("");
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

  async function saveDate(item: AnnualUnit) {
    const date = dates[item.id] || "";
    if (!date) return setMessage(`Choose the last completed Annual date for unit ${item.unit}.`);
    await post(
      { action: "completeAnnual", equipmentId: item.id, date },
      `Unit ${item.unit} Annual date updated to ${shortDate(date)}.`,
      `date-${item.id}`,
    );
  }

  async function applySchedule() {
    const interval = Number(intervalDays);
    if (!selected.length) return setMessage("Select at least one unit first.");
    if (!Number.isInteger(interval) || interval <= 0) return setMessage("Annual days must be a positive whole number.");
    const count = selected.length;
    const ok = await post(
      { action: "applyAnnual", equipmentIds: selected, intervalDays: interval },
      `${interval}-day Annual schedule applied to ${count} unit${count === 1 ? "" : "s"}.`,
      "apply",
    );
    if (ok) setSelected([]);
  }

  async function removeSchedule() {
    if (!selected.length) return setMessage("Select at least one unit first.");
    const count = selected.length;
    const ok = await post(
      { action: "clearAnnual", equipmentIds: selected },
      `Annual schedule removed from ${count} unit${count === 1 ? "" : "s"}. The stored Annual date was kept.`,
      "remove",
    );
    if (ok) setSelected([]);
  }

  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>TRUCK &amp; TRAILER COMPLIANCE</p>
          <h1 style={{ margin: "7px 0 4px", fontSize: 34, color: "#0d1b2b" }}>Annual Schedules</h1>
          <p style={{ margin: 0, maxWidth: 850, color: "#64748b", lineHeight: 1.5 }}>
            Update each unit&apos;s last completed Annual date here. The next due date is calculated from that date and the assigned Annual-day interval.
          </p>
        </div>
        <a href="/annual-inspections" style={formsLinkStyle}>Completed Annual Forms</a>
      </header>

      {message && <div style={noticeStyle}>{message}</div>}

      <section style={toolbarCardStyle}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => changeView("trucks")} style={view === "trucks" ? activeTabStyle : tabStyle}>Trucks <b>{trucks.length}</b></button>
          <button type="button" onClick={() => changeView("trailers")} style={view === "trailers" ? activeTabStyle : tabStyle}>Trailers <b>{trailers.length}</b></button>
        </div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${view} by unit or group…`} style={{ ...inputStyle, minWidth: 260, flex: 1 }} />
      </section>

      <section style={bulkCardStyle}>
        <div>
          <strong>{selected.length} selected</strong>
          <span style={{ display: "block", marginTop: 3, color: "#64748b", fontSize: 12 }}>Select units below to assign or remove their Annual schedule.</span>
        </div>
        <label style={{ display: "grid", gap: 4, color: "#52616e", fontSize: 11, fontWeight: 900 }}>
          Annual days
          <input type="number" min="1" value={intervalDays} onChange={(event) => setIntervalDays(event.target.value)} style={{ ...inputStyle, width: 110 }} />
        </label>
        <button type="button" disabled={Boolean(busy) || !selected.length} onClick={() => void applySchedule()} style={orangeButtonStyle}>{busy === "apply" ? "Applying…" : "Apply Schedule"}</button>
        <button type="button" disabled={Boolean(busy) || !selected.length} onClick={() => void removeSchedule()} style={buttonStyle}>{busy === "remove" ? "Removing…" : "Remove Schedule"}</button>
      </section>

      <section style={tableCardStyle}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#eef2f5", color: "#52616e", textAlign: "left", fontSize: 10, letterSpacing: ".05em", textTransform: "uppercase" }}>
                <th style={cellStyle}><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} disabled={!visible.length} /></th>
                <th style={cellStyle}>Unit</th>
                <th style={cellStyle}>Schedule group</th>
                <th style={cellStyle}>Last completed Annual</th>
                <th style={cellStyle}>Interval</th>
                <th style={cellStyle}>Next due</th>
                <th style={cellStyle}>Status</th>
                <th style={cellStyle}>Update</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const due = dueDetails(item);
                return (
                  <tr key={item.id} style={{ borderTop: "1px solid #e5e9ec", background: due.tone === "red" ? "#fff8f7" : "white" }}>
                    <td style={cellStyle}><input type="checkbox" checked={selectedSet.has(item.id)} onChange={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /></td>
                    <td style={{ ...cellStyle, fontWeight: 950, fontSize: 15 }}>{item.unit}</td>
                    <td style={cellStyle}>{item.category}</td>
                    <td style={cellStyle}><input type="date" value={dates[item.id] || ""} onChange={(event) => setDates((current) => ({ ...current, [item.id]: event.target.value }))} style={{ ...inputStyle, width: 150 }} /></td>
                    <td style={cellStyle}>{item.annualIntervalDays ? `${item.annualIntervalDays} days` : "Not assigned"}</td>
                    <td style={{ ...cellStyle, fontWeight: 800 }}>{due.date ? shortDate(due.date) : "—"}</td>
                    <td style={cellStyle}><span style={badgeStyle[due.tone]}>{due.label}</span></td>
                    <td style={cellStyle}><button type="button" disabled={Boolean(busy)} onClick={() => void saveDate(item)} style={orangeButtonStyle}>{busy === `date-${item.id}` ? "Saving…" : "Save Date"}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!visible.length && <div style={{ padding: 30, textAlign: "center", color: "#75828d" }}>No {view} match this search.</div>}
      </section>
    </main>
  );
}

const pageStyle = { minHeight: "100vh", padding: "30px 32px 100px", background: "#fff", color: "#172033" } as const;
const headerStyle = { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 18, flexWrap: "wrap" as const } as const;
const eyebrowStyle = { margin: 0, color: "#f47b20", fontWeight: 950, letterSpacing: ".14em", fontSize: 11 } as const;
const toolbarCardStyle = { marginTop: 18, padding: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" as const, border: "1px solid #dce2e7", borderRadius: 12, background: "#f8fafb" } as const;
const bulkCardStyle = { marginTop: 12, padding: 14, display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "end", flexWrap: "wrap" as const, border: "1px solid #dce2e7", borderRadius: 12, background: "white" } as const;
const tableCardStyle = { marginTop: 12, overflow: "hidden", border: "1px solid #dce2e7", borderRadius: 12, background: "white", boxShadow: "0 4px 18px #12202f0a" } as const;
const inputStyle = { minHeight: 40, boxSizing: "border-box" as const, padding: "7px 10px", border: "1px solid #cbd5dd", borderRadius: 8, background: "white", color: "#172033" } as const;
const buttonStyle = { minHeight: 40, padding: "0 13px", border: "1px solid #cbd5dd", borderRadius: 8, background: "white", color: "#263746", fontWeight: 900, cursor: "pointer" } as const;
const orangeButtonStyle = { ...buttonStyle, borderColor: "#f47b20", background: "#f47b20", color: "white" } as const;
const formsLinkStyle = { ...buttonStyle, display: "inline-flex", alignItems: "center", textDecoration: "none" } as const;
const tabStyle = { ...buttonStyle, minWidth: 130 } as const;
const activeTabStyle = { ...tabStyle, borderColor: "#0d1b2b", background: "#0d1b2b", color: "white" } as const;
const noticeStyle = { marginTop: 14, padding: 12, border: "1px solid #f2c66d", borderRadius: 9, background: "#fff8e6", color: "#654d18" } as const;
const cellStyle = { padding: "10px 11px", verticalAlign: "middle" as const } as const;
const badgeStyle: Record<Tone, { display: "inline-flex"; padding: string; borderRadius: number; fontSize: number; fontWeight: number; background: string; color: string }> = {
  green: { display: "inline-flex", padding: "5px 8px", borderRadius: 999, fontSize: 11, fontWeight: 900, background: "#e7f6ed", color: "#176440" },
  orange: { display: "inline-flex", padding: "5px 8px", borderRadius: 999, fontSize: 11, fontWeight: 900, background: "#fff1df", color: "#8a5015" },
  red: { display: "inline-flex", padding: "5px 8px", borderRadius: 999, fontSize: 11, fontWeight: 900, background: "#fdecea", color: "#9d241a" },
  gray: { display: "inline-flex", padding: "5px 8px", borderRadius: 999, fontSize: 11, fontWeight: 900, background: "#eef2f5", color: "#52616e" },
};
