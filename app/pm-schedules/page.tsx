"use client";

import { useEffect, useMemo, useState } from "react";
import MaintenanceTabs from "../maintenance-tabs";

type Profile = { id: number; name: string; sequence: string[] };
type Preset = {
  category: string;
  profileId: number | null;
  profileName: string;
  mileageInterval: number | null;
  timeIntervalDays: number | null;
  annualIntervalDays: number | null;
};
type Equipment = {
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
  profileId: number | null;
  profileName: string;
  mileageInterval: number | null;
  timeIntervalDays: number | null;
  nextPmType: string;
  lastMileage: number | null;
  lastServiceDate: string;
  annualIntervalDays: number | null;
  lastAnnualDate: string;
};
type SetupData = {
  categories: string[];
  profiles: Profile[];
  presets: Preset[];
  equipment: Equipment[];
  updatedAt: string;
};
type RuleDraft = {
  profileId: string;
  mileageInterval: string;
  timeIntervalDays: string;
  annualIntervalDays: string;
};
type CorrectionDraft = {
  equipmentId: number;
  unit: string;
  equipmentType: "Vehicle" | "Trailer";
  lastMileage: string;
  lastServiceDate: string;
  nextPmType: string;
  lastAnnualDate: string;
};

const emptyRule: RuleDraft = { profileId: "", mileageInterval: "", timeIntervalDays: "", annualIntervalDays: "365" };
const inputStyle = { width: "100%", minHeight: 34, padding: "6px 8px", border: "1px solid #cbd3d9", borderRadius: 4, background: "white", color: "#172033" } as const;
const labelStyle = { display: "grid", gap: 4, fontSize: 11, fontWeight: 800, color: "#53616e" } as const;
const buttonStyle = { minHeight: 32, padding: "0 10px", border: "1px solid #c5cdd3", borderRadius: 4, background: "white", color: "#263746", fontWeight: 800, fontSize: 11 } as const;

function ruleFromPreset(preset?: Preset): RuleDraft {
  if (!preset) return { ...emptyRule };
  return {
    profileId: preset.profileId == null ? "" : String(preset.profileId),
    mileageInterval: preset.mileageInterval == null ? "" : String(preset.mileageInterval),
    timeIntervalDays: preset.timeIntervalDays == null ? "" : String(preset.timeIntervalDays),
    annualIntervalDays: preset.annualIntervalDays == null ? "" : String(preset.annualIntervalDays),
  };
}

function scheduleText(item: Equipment) {
  if (!item.profileName) return "No PM rule";
  const trigger = [
    item.mileageInterval ? `${item.mileageInterval.toLocaleString()} mi` : "",
    item.timeIntervalDays ? `${item.timeIntervalDays} days` : "",
  ].filter(Boolean).join(" or ");
  return `${item.nextPmType || item.profileName}${trigger ? ` · ${trigger}` : ""}`;
}

function baselineWarnings(item: Equipment) {
  const warnings: string[] = [];
  if (item.profileName && item.mileageInterval != null && item.lastMileage == null) warnings.push("PM mileage baseline needed");
  if (item.profileName && item.timeIntervalDays != null && !item.lastServiceDate) warnings.push("PM date baseline needed");
  if (item.annualIntervalDays != null && !item.lastAnnualDate) warnings.push("Annual date needed");
  return warnings;
}

export default function PmSchedulesPage() {
  const [data, setData] = useState<SetupData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RuleDraft>>({});
  const [selected, setSelected] = useState<number[]>([]);
  const [assignCategory, setAssignCategory] = useState("");
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [correction, setCorrection] = useState<CorrectionDraft | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/maintenance-setup", { cache: "no-store" });
    const payload = await response.json() as SetupData & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Maintenance setup could not be loaded.");
    setData(payload);
    setDrafts(Object.fromEntries(payload.categories.map((category) => [category, ruleFromPreset(payload.presets.find((preset) => preset.category === category))])));
  }

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/maintenance-setup", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as SetupData & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Maintenance setup could not be loaded.");
        return payload;
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setDrafts(Object.fromEntries(payload.categories.map((category) => [category, ruleFromPreset(payload.presets.find((preset) => preset.category === category))])));
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Maintenance setup could not be loaded.");
      });
    return () => { cancelled = true; };
  }, []);

  async function post(body: Record<string, unknown>, success: string) {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/maintenance-setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Maintenance setup could not be saved.");
      await load();
      setMessage(success);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Maintenance setup could not be saved.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function updateDraft(category: string, patch: Partial<RuleDraft>) {
    setDrafts((current) => ({ ...current, [category]: { ...(current[category] ?? emptyRule), ...patch } }));
  }

  function saveCategoryRule(category: string) {
    const rule = drafts[category] ?? emptyRule;
    void post({
      action: "saveCategoryRule",
      category,
      profileId: rule.profileId || null,
      mileageInterval: rule.mileageInterval || null,
      timeIntervalDays: rule.timeIntervalDays || null,
      annualIntervalDays: rule.annualIntervalDays || null,
    }, `${category} rule saved and applied to every unit currently in that category.`);
  }

  function assignSelected() {
    if (!selected.length) return setMessage("Check the units you want to categorize first.");
    if (!assignCategory) return setMessage("Choose a category first.");
    const count = selected.length;
    const success = assignCategory === "Trailers"
      ? `${count} trailer${count === 1 ? "" : "s"} assigned to Trailers. The saved Trailer Service rule was applied.`
      : `${count} unit${count === 1 ? "" : "s"} assigned to ${assignCategory} and inherited its maintenance rule.`;
    void post({ action: "assignCategory", equipmentIds: selected, category: assignCategory }, success);
    setSelected([]);
  }

  function openCorrection(item: Equipment) {
    const profile = (data?.profiles ?? []).find((candidate) => candidate.id === item.profileId);
    setCorrection({
      equipmentId: item.id,
      unit: item.unit,
      equipmentType: item.equipmentType,
      lastMileage: item.lastMileage == null ? "" : String(item.lastMileage),
      lastServiceDate: item.lastServiceDate || "",
      nextPmType: item.nextPmType || profile?.sequence[0] || "",
      lastAnnualDate: item.lastAnnualDate || "",
    });
  }

  async function saveCorrection() {
    if (!correction) return;
    const current = correction;
    const ok = await post({
      action: "correctUnitMaintenance",
      equipmentId: current.equipmentId,
      lastMileage: current.equipmentType === "Trailer" ? null : current.lastMileage || null,
      lastServiceDate: current.lastServiceDate || null,
      nextPmType: current.nextPmType || null,
      lastAnnualDate: current.lastAnnualDate || null,
    }, `${current.unit} PM and annual correction saved.`);
    if (ok) setCorrection(null);
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.equipment ?? []).filter((item) => {
      if (filter !== "All" && item.category !== filter) return false;
      if (!needle) return true;
      return [item.unit, item.equipmentType, item.category, item.profileName, item.make, item.model, item.driver, item.location].join(" ").toLowerCase().includes(needle);
    });
  }, [data, filter, query]);

  const membersByCategory = useMemo(() => {
    const groups = new Map<string, Equipment[]>();
    for (const category of data?.categories ?? []) groups.set(category, []);
    for (const item of data?.equipment ?? []) if (groups.has(item.category)) groups.get(item.category)?.push(item);
    for (const members of groups.values()) members.sort((a, b) => a.unit.localeCompare(b.unit, undefined, { numeric: true }));
    return groups;
  }, [data]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allVisibleSelected = visible.length > 0 && visible.every((item) => selectedSet.has(item.id));
  const unconfigured = (data?.equipment ?? []).filter((item) => item.category === "Uncategorized").length;
  const correctionItem = correction ? (data?.equipment ?? []).find((item) => item.id === correction.equipmentId) : undefined;
  const correctionProfile = correctionItem ? (data?.profiles ?? []).find((profile) => profile.id === correctionItem.profileId) : undefined;

  function toggleVisible() {
    const ids = visible.map((item) => item.id);
    setSelected((current) => {
      const next = new Set(current);
      if (ids.every((id) => next.has(id))) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return [...next];
    });
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f3f5f7", padding: "28px 32px 70px", color: "#172033" }}>
      <MaintenanceTabs />
      <header style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#f47b20", fontSize: 11, fontWeight: 900, letterSpacing: ".14em" }}>MAINTENANCE SCHEDULES</p>
          <h1 style={{ margin: "6px 0 0", fontSize: 30, color: "#0d1b2b" }}>PM Schedules</h1>
          <p style={{ margin: "6px 0 0", color: "#64748b", maxWidth: 820, fontSize: 13 }}>
            Compact schedule groups up top; the unit assignment table stays below for bulk setup and corrections.
          </p>
        </div>
        <div style={{ fontSize: 12, color: unconfigured ? "#9a5b00" : "#64748b", fontWeight: 800 }}>{unconfigured} units uncategorized</div>
      </header>

      {message && <div style={{ marginTop: 12, padding: 10, borderRadius: 5, background: "#fff8e6", border: "1px solid #f2c66d", fontSize: 12 }}>{message}</div>}

      <section style={{ marginTop: 16, border: "1px solid #cfd6db", background: "white" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(140px,1.3fr) minmax(180px,2fr) 110px 100px 110px 95px 72px", gap: 0, padding: "7px 10px", borderBottom: "1px solid #cfd6db", background: "#eef1f2", color: "#59656e", fontSize: 9, fontWeight: 900, letterSpacing: ".05em", textTransform: "uppercase" }}>
          <span>Schedule group</span><span>PM rule</span><span>Mileage</span><span>PM days</span><span>Annual</span><span>Assigned</span><span></span>
        </div>
        {(data?.categories ?? []).map((category) => {
          const rule = drafts[category] ?? emptyRule;
          const trailer = category === "Trailers";
          const members = membersByCategory.get(category) ?? [];
          const expanded = openGroup === category;
          const allowedProfiles = (data?.profiles ?? []).filter((profile) => trailer ? profile.name === "Trailer Service" : profile.name !== "Trailer Service");
          const selectedProfile = allowedProfiles.find((profile) => String(profile.id) === rule.profileId);
          return (
            <div key={category} style={{ borderBottom: "1px solid #e3e7ea" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(140px,1.3fr) minmax(180px,2fr) 110px 100px 110px 95px 72px", alignItems: "center", minHeight: 44, padding: "5px 10px", fontSize: 12 }}>
                <strong style={{ color: "#172033" }}>{category}</strong>
                <span>{selectedProfile ? `${selectedProfile.name} · ${selectedProfile.sequence.join(" → ")}` : "No PM reminder"}</span>
                <span>{trailer ? "—" : rule.mileageInterval ? `${Number(rule.mileageInterval).toLocaleString()} mi` : "—"}</span>
                <span>{rule.timeIntervalDays ? `${rule.timeIntervalDays} d` : "—"}</span>
                <span>{rule.annualIntervalDays ? `${rule.annualIntervalDays} d` : "—"}</span>
                <span>{members.length} units</span>
                <button type="button" style={buttonStyle} onClick={() => setOpenGroup(expanded ? null : category)}>{expanded ? "Close" : "Edit"}</button>
              </div>

              {expanded && (
                <div style={{ padding: 12, borderTop: "1px solid #eef1f3", background: "#fafbfb", display: "grid", gridTemplateColumns: "minmax(320px,1fr) minmax(340px,1.2fr)", gap: 14 }}>
                  <div>
                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 8 }}>
                      <label style={labelStyle}>PM option
                        <select value={rule.profileId} onChange={(event) => updateDraft(category, { profileId: event.target.value })} style={inputStyle}>
                          <option value="">No PM reminder</option>
                          {allowedProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} ({profile.sequence.join(" → ")})</option>)}
                        </select>
                      </label>
                      <label style={labelStyle}>Mileage
                        <input disabled={trailer} type="number" min="1" value={rule.mileageInterval} onChange={(event) => updateDraft(category, { mileageInterval: event.target.value })} style={inputStyle} placeholder={trailer ? "N/A" : "20000"} />
                      </label>
                      <label style={labelStyle}>PM days
                        <input type="number" min="1" value={rule.timeIntervalDays} onChange={(event) => updateDraft(category, { timeIntervalDays: event.target.value })} style={inputStyle} placeholder="90" />
                      </label>
                      <label style={labelStyle}>Annual days
                        <input type="number" min="1" value={rule.annualIntervalDays} onChange={(event) => updateDraft(category, { annualIntervalDays: event.target.value })} style={inputStyle} placeholder="365" />
                      </label>
                    </div>
                    <div style={{ marginTop: 9, display: "flex", gap: 7, alignItems: "center" }}>
                      <button type="button" disabled={saving} onClick={() => saveCategoryRule(category)} style={{ ...buttonStyle, borderColor: "#d56e13", background: "#f47b20", color: "white" }}>Save rule</button>
                      <span style={{ color: "#73808a", fontSize: 11 }}>{trailer ? "Trailer Service uses time-based PM rules." : "Saved changes apply to all units in this group."}</span>
                    </div>
                  </div>

                  <div style={{ borderLeft: "1px solid #e0e5e8", paddingLeft: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <strong style={{ fontSize: 12 }}>Assigned units</strong>
                      <button type="button" style={buttonStyle} onClick={() => { setFilter(category); setAssignCategory(category); setQuery(""); }}>Show in table</button>
                    </div>
                    <div style={{ marginTop: 7, maxHeight: 180, overflowY: "auto" }}>
                      {members.map((item) => {
                        const warnings = baselineWarnings(item);
                        return (
                          <div key={item.id} style={{ display: "grid", gridTemplateColumns: "95px 1fr auto", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: "1px solid #e7eaec", fontSize: 11 }}>
                            <strong>{item.unit}</strong>
                            <span style={{ color: warnings.length ? "#8b5a08" : "#64748b" }}>{scheduleText(item)}{warnings.length ? ` · ${warnings.join(" / ")}` : ""}</span>
                            <button type="button" style={buttonStyle} onClick={() => openCorrection(item)}>Correct</button>
                          </div>
                        );
                      })}
                      {!members.length && <div style={{ padding: 8, color: "#64748b", fontSize: 11 }}>No units assigned.</div>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section style={{ marginTop: 16, background: "white", border: "1px solid #cfd6db" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #dce2e7", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Assign schedule groups</h2>
            <p style={{ margin: "3px 0 0", color: "#64748b", fontSize: 11 }}>Check units, choose the schedule group, then assign them in bulk.</p>
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            <select value={assignCategory} onChange={(event) => setAssignCategory(event.target.value)} style={{ ...inputStyle, width: 190 }}>
              <option value="">Choose schedule group</option>
              {(data?.categories ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <button type="button" disabled={saving || !selected.length} onClick={assignSelected} style={buttonStyle}>Assign {selected.length || 0}</button>
            <button type="button" disabled={!selected.length} onClick={() => setSelected([])} style={buttonStyle}>Clear</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 7, padding: 10, borderBottom: "1px solid #e4e8eb", flexWrap: "wrap" }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search unit, type, group, make, model, driver..." style={{ ...inputStyle, minWidth: 260, flex: 1 }} />
          <select value={filter} onChange={(event) => {
            const next = event.target.value;
            setFilter(next);
            if (next !== "All" && next !== "Uncategorized") setAssignCategory(next);
          }} style={{ ...inputStyle, width: 190 }}>
            <option value="All">All schedule groups</option>
            <option value="Uncategorized">Unassigned schedule</option>
            {(data?.categories ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 1050 }}>
            <thead>
              <tr style={{ textAlign: "left", background: "#eef1f2", color: "#59656e", fontSize: 9, textTransform: "uppercase", letterSpacing: ".04em" }}>
                <th style={{ padding: 8 }}><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} disabled={!visible.length} /></th>
                <th style={{ padding: 8 }}>Unit</th><th style={{ padding: 8 }}>Type</th><th style={{ padding: 8 }}>Schedule group</th><th style={{ padding: 8 }}>Mileage</th><th style={{ padding: 8 }}>PM reminder</th><th style={{ padding: 8 }}>Annual</th><th style={{ padding: 8 }}>Location</th><th style={{ padding: 8 }}>Correction</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const warnings = baselineWarnings(item);
                return (
                  <tr key={item.id} style={{ borderTop: "1px solid #edf0f2", background: item.category === "Uncategorized" || warnings.length ? "#fffaf2" : "white" }}>
                    <td style={{ padding: 8 }}><input type="checkbox" checked={selectedSet.has(item.id)} onChange={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /></td>
                    <td style={{ padding: 8, fontWeight: 900 }}>{item.unit}</td>
                    <td style={{ padding: 8 }}>{item.equipmentType}</td>
                    <td style={{ padding: 8, fontWeight: item.category === "Uncategorized" ? 800 : 500 }}>{item.category}</td>
                    <td style={{ padding: 8 }}>{item.currentMileage == null ? "—" : `${item.currentMileage.toLocaleString()} (${item.mileageSource})`}</td>
                    <td style={{ padding: 8 }}><div>{scheduleText(item)}</div>{warnings.filter((warning) => warning.startsWith("PM")).length > 0 && <small style={{ color: "#9a5b00", fontWeight: 800 }}>{warnings.filter((warning) => warning.startsWith("PM")).join(" · ")}</small>}</td>
                    <td style={{ padding: 8 }}><div>{item.annualIntervalDays ? `${item.annualIntervalDays} days` : "No annual rule"}</div>{item.lastAnnualDate && <small style={{ color: "#64748b" }}>Last {item.lastAnnualDate}</small>}{warnings.includes("Annual date needed") && <small style={{ display: "block", color: "#9a5b00", fontWeight: 800 }}>Annual date needed</small>}</td>
                    <td style={{ padding: 8 }}>{item.location || "—"}</td>
                    <td style={{ padding: 8 }}><button type="button" style={buttonStyle} onClick={() => openCorrection(item)}>Correct</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!visible.length && <div style={{ padding: 18, color: "#64748b", fontSize: 12 }}>No units match this filter.</div>}
        </div>
      </section>

      {correction && <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.46)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 }}>
        <div style={{ width: "min(620px, 100%)", maxHeight: "90vh", overflowY: "auto", background: "white", borderRadius: 10, padding: 18, boxShadow: "0 20px 60px rgba(15,23,42,.25)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
            <div><p style={{ margin: 0, color: "#f47b20", fontSize: 10, fontWeight: 900, letterSpacing: ".12em" }}>MANUAL CORRECTION</p><h2 style={{ margin: "5px 0 0", fontSize: 22 }}>{correction.unit}</h2><p style={{ margin: "5px 0 0", color: "#64748b", fontSize: 12 }}>Correct stored PM and annual baselines without changing the schedule rule.</p></div>
            <button type="button" style={buttonStyle} onClick={() => setCorrection(null)}>Close</button>
          </div>
          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <label style={labelStyle}>Last PM / service date<input type="date" value={correction.lastServiceDate} onChange={(event) => setCorrection((current) => current ? { ...current, lastServiceDate: event.target.value } : current)} style={inputStyle} /></label>
            <label style={labelStyle}>Last PM mileage<input disabled={correction.equipmentType === "Trailer"} type="number" min="0" value={correction.lastMileage} onChange={(event) => setCorrection((current) => current ? { ...current, lastMileage: event.target.value } : current)} style={inputStyle} placeholder={correction.equipmentType === "Trailer" ? "Not used for trailers" : "Enter corrected mileage"} /></label>
            <label style={labelStyle}>Next PM type<select disabled={!correctionProfile?.sequence.length} value={correction.nextPmType} onChange={(event) => setCorrection((current) => current ? { ...current, nextPmType: event.target.value } : current)} style={inputStyle}>{!correctionProfile?.sequence.length && <option value="">No PM rule assigned</option>}{(correctionProfile?.sequence ?? []).map((pmType) => <option key={pmType} value={pmType}>{pmType}</option>)}</select></label>
            <label style={labelStyle}>Last annual / inspection date<input type="date" value={correction.lastAnnualDate} onChange={(event) => setCorrection((current) => current ? { ...current, lastAnnualDate: event.target.value } : current)} style={inputStyle} /></label>
            <div style={{ padding: 9, background: "#f8fafc", color: "#64748b", fontSize: 11 }}>This corrects the stored baseline only. It does not mark a new PM or annual complete.</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 7 }}><button type="button" disabled={saving} style={buttonStyle} onClick={() => setCorrection(null)}>Cancel</button><button type="button" disabled={saving} onClick={() => void saveCorrection()} style={{ ...buttonStyle, borderColor: "#d56e13", background: "#f47b20", color: "white" }}>{saving ? "Saving..." : "Save correction"}</button></div>
          </div>
        </div>
      </div>}
    </main>
  );
}
