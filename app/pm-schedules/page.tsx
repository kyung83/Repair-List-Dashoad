"use client";

import { useEffect, useMemo, useState } from "react";

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

const emptyRule: RuleDraft = {
  profileId: "",
  mileageInterval: "",
  timeIntervalDays: "",
  annualIntervalDays: "365",
};

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

  async function load() {
    const response = await fetch("/api/maintenance-setup", { cache: "no-store" });
    const payload = await response.json() as SetupData & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Maintenance setup could not be loaded.");
    setData(payload);
    setDrafts(Object.fromEntries(payload.categories.map((category) => [
      category,
      ruleFromPreset(payload.presets.find((preset) => preset.category === category)),
    ])));
  }

  useEffect(() => {
    void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Maintenance setup could not be loaded."));
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
    setDrafts((current) => ({
      ...current,
      [category]: { ...(current[category] ?? emptyRule), ...patch },
    }));
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
      return [
        item.unit,
        item.equipmentType,
        item.category,
        item.profileName,
        item.make,
        item.model,
        item.driver,
        item.location,
      ].join(" ").toLowerCase().includes(needle);
    });
  }, [data, filter, query]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allVisibleSelected = visible.length > 0 && visible.every((item) => selectedSet.has(item.id));
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    (data?.equipment ?? []).forEach((item) => counts.set(item.category, (counts.get(item.category) ?? 0) + 1));
    return counts;
  }, [data]);
  const unconfigured = (data?.equipment ?? []).filter((item) => item.category === "Uncategorized").length;
  const correctionItem = correction ? (data?.equipment ?? []).find((item) => item.id === correction.equipmentId) : undefined;
  const correctionProfile = correctionItem
    ? (data?.profiles ?? []).find((profile) => profile.id === correctionItem.profileId)
    : undefined;

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
    <main style={{ minHeight: "100vh", background: "#f3f5f7", padding: 34, color: "#172033" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#f47b20", fontSize: 12, fontWeight: 900, letterSpacing: ".15em" }}>MAINTENANCE RULES</p>
          <h1 style={{ margin: "8px 0 0", fontSize: 34, color: "#0d1b2b" }}>Set it once by category</h1>
          <p style={{ margin: "8px 0 0", color: "#64748b", maxWidth: 820 }}>
            Categorize units, set the PM and annual rules, and use Manual correction whenever a unit's last PM mileage/date, next PM type, or annual date needs to be fixed.
          </p>
        </div>
        <div style={{ fontSize: 13, color: "#64748b" }}>{unconfigured} units still uncategorized</div>
      </header>

      {message && <div style={{ marginTop: 16, padding: 12, borderRadius: 9, background: "#fff8e6", border: "1px solid #f2c66d" }}>{message}</div>}

      <section style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14 }}>
        {(data?.categories ?? []).map((category) => {
          const rule = drafts[category] ?? emptyRule;
          const trailer = category === "Trailers";
          const allowedProfiles = (data?.profiles ?? []).filter((profile) => trailer ? profile.name === "Trailer Service" : profile.name !== "Trailer Service");
          return (
            <article key={category} style={{ background: "white", border: "1px solid #dce2e7", borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <h2 style={{ margin: 0, fontSize: 19 }}>{category}</h2>
                <span style={{ padding: "4px 8px", borderRadius: 999, background: "#eef2f5", fontSize: 12, fontWeight: 800 }}>{categoryCounts.get(category) ?? 0} assigned</span>
              </div>
              {trailer && <p style={{ margin: "8px 0 0", fontSize: 12, color: "#64748b" }}>Trailer Service is the PM rule used by the Trailers group.</p>}
              <div style={{ display: "grid", gap: 9, marginTop: 14 }}>
                <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 800 }}>PM option
                  <select value={rule.profileId} onChange={(event) => updateDraft(category, { profileId: event.target.value })} style={{ padding: 9 }}>
                    <option value="">No PM reminder</option>
                    {allowedProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} ({profile.sequence.join(" → ")})</option>)}
                  </select>
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 800 }}>Mileage interval
                    <input disabled={trailer} type="number" min="1" placeholder={trailer ? "Not used" : "20,000"} value={rule.mileageInterval} onChange={(event) => updateDraft(category, { mileageInterval: event.target.value })} style={{ padding: 9 }} />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 800 }}>PM time (days)
                    <input type="number" min="1" placeholder="90" value={rule.timeIntervalDays} onChange={(event) => updateDraft(category, { timeIntervalDays: event.target.value })} style={{ padding: 9 }} />
                  </label>
                </div>
                <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 800 }}>Annual / inspection interval (days)
                  <input type="number" min="1" placeholder="365" value={rule.annualIntervalDays} onChange={(event) => updateDraft(category, { annualIntervalDays: event.target.value })} style={{ padding: 9 }} />
                </label>
                <button type="button" disabled={saving} onClick={() => saveCategoryRule(category)} style={{ padding: "10px 14px", border: 0, borderRadius: 8, background: "#f47b20", color: "white", fontWeight: 900 }}>
                  Save {category} rule
                </button>
              </div>
            </article>
          );
        })}
      </section>

      <section style={{ marginTop: 20, background: "white", border: "1px solid #dce2e7", borderRadius: 12, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>Assign schedule groups</h2>
            <p style={{ margin: "5px 0 0", color: "#64748b", fontSize: 13 }}>
              Equipment type tells you what the unit is. Schedule group tells you which maintenance rule it is assigned to. A Trailer can still be Uncategorized until it is assigned to the Trailers group.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={assignCategory} onChange={(event) => setAssignCategory(event.target.value)} style={{ padding: 9 }}>
              <option value="">Choose schedule group</option>
              {(data?.categories ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <button type="button" disabled={saving || !selected.length} onClick={assignSelected} style={{ padding: "9px 13px", fontWeight: 800 }}>Assign {selected.length || 0} checked</button>
            <button type="button" disabled={!selected.length} onClick={() => setSelected([])}>Clear</button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search unit, type, schedule group, make, model, driver..." style={{ padding: 9, minWidth: 260, flex: 1 }} />
          <select value={filter} onChange={(event) => {
            const next = event.target.value;
            setFilter(next);
            if (next === "Trailers") setAssignCategory("Trailers");
          }} style={{ padding: 9 }}>
            <option value="All">All schedule groups</option>
            <option value="Uncategorized">Unassigned schedule</option>
            {(data?.categories ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>

        <div style={{ marginTop: 9, fontSize: 12, color: "#64748b" }}>
          All shows every active unit. Type identifies Vehicle vs Trailer; Schedule group shows the saved PM assignment.
        </div>

        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #dce2e7" }}>
                <th style={{ padding: 9 }}><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} disabled={!visible.length} /></th>
                <th style={{ padding: 9 }}>Unit</th>
                <th style={{ padding: 9 }}>Type</th>
                <th style={{ padding: 9 }}>Schedule group</th>
                <th style={{ padding: 9 }}>Mileage</th>
                <th style={{ padding: 9 }}>PM reminder</th>
                <th style={{ padding: 9 }}>Annual</th>
                <th style={{ padding: 9 }}>Location</th>
                <th style={{ padding: 9 }}>Correction</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id} style={{ borderBottom: "1px solid #edf0f2", background: item.category === "Uncategorized" ? "#fffaf2" : "transparent" }}>
                  <td style={{ padding: 9 }}>
                    <input type="checkbox" checked={selectedSet.has(item.id)} onChange={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} />
                  </td>
                  <td style={{ padding: 9, fontWeight: 900 }}>{item.unit}</td>
                  <td style={{ padding: 9 }}>
                    <span style={{ display: "inline-block", padding: "3px 7px", borderRadius: 999, background: "#eef2f5", fontSize: 11, fontWeight: 800 }}>{item.equipmentType}</span>
                  </td>
                  <td style={{ padding: 9, fontWeight: item.category === "Uncategorized" ? 800 : 600 }}>{item.category}</td>
                  <td style={{ padding: 9 }}>{item.currentMileage == null ? "—" : `${item.currentMileage.toLocaleString()} (${item.mileageSource})`}</td>
                  <td style={{ padding: 9 }}>
                    <div>{scheduleText(item)}</div>
                    {(item.lastServiceDate || item.lastMileage != null) && <div style={{ marginTop: 3, fontSize: 11, color: "#64748b" }}>
                      Last {item.lastServiceDate || "date unknown"}{item.lastMileage != null ? ` · ${item.lastMileage.toLocaleString()} mi` : ""}
                    </div>}
                  </td>
                  <td style={{ padding: 9 }}>
                    <div>{item.annualIntervalDays ? `${item.annualIntervalDays} days` : "No annual rule"}</div>
                    {item.lastAnnualDate && <div style={{ marginTop: 3, fontSize: 11, color: "#64748b" }}>Last {item.lastAnnualDate}</div>}
                  </td>
                  <td style={{ padding: 9 }}>{item.location || "—"}</td>
                  <td style={{ padding: 9 }}><button type="button" onClick={() => openCorrection(item)}>Manual correction</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && <div style={{ padding: 20, color: "#64748b" }}>No units match this filter.</div>}
        </div>
      </section>

      {correction && <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.46)", display: "grid", placeItems: "center", padding: 20, zIndex: 50 }}>
        <div style={{ width: "min(620px, 100%)", maxHeight: "90vh", overflowY: "auto", background: "white", borderRadius: 14, padding: 20, boxShadow: "0 20px 60px rgba(15,23,42,.25)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
            <div>
              <p style={{ margin: 0, color: "#f47b20", fontSize: 11, fontWeight: 900, letterSpacing: ".12em" }}>MANUAL CORRECTION</p>
              <h2 style={{ margin: "6px 0 0", fontSize: 24 }}>{correction.unit}</h2>
              <p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 13 }}>Correct stored PM and annual baselines without changing the category rule.</p>
            </div>
            <button type="button" onClick={() => setCorrection(null)}>Close</button>
          </div>

          <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
            <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 800 }}>Last PM / service date
              <input type="date" value={correction.lastServiceDate} onChange={(event) => setCorrection((current) => current ? { ...current, lastServiceDate: event.target.value } : current)} style={{ padding: 10 }} />
            </label>

            <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 800 }}>Last PM mileage
              <input disabled={correction.equipmentType === "Trailer"} type="number" min="0" placeholder={correction.equipmentType === "Trailer" ? "Not used for trailers" : "Enter corrected mileage"} value={correction.lastMileage} onChange={(event) => setCorrection((current) => current ? { ...current, lastMileage: event.target.value } : current)} style={{ padding: 10 }} />
            </label>

            <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 800 }}>Next PM type
              <select disabled={!correctionProfile?.sequence.length} value={correction.nextPmType} onChange={(event) => setCorrection((current) => current ? { ...current, nextPmType: event.target.value } : current)} style={{ padding: 10 }}>
                {!correctionProfile?.sequence.length && <option value="">No PM rule assigned</option>}
                {(correctionProfile?.sequence ?? []).map((pmType) => <option key={pmType} value={pmType}>{pmType}</option>)}
              </select>
            </label>

            <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 800 }}>Last annual / inspection date
              <input type="date" value={correction.lastAnnualDate} onChange={(event) => setCorrection((current) => current ? { ...current, lastAnnualDate: event.target.value } : current)} style={{ padding: 10 }} />
            </label>

            <div style={{ padding: 11, borderRadius: 9, background: "#f8fafc", color: "#64748b", fontSize: 12 }}>
              Use this only to correct the stored baseline. It does not mark a new PM or annual as completed and it does not change the unit's category rule.
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" disabled={saving} onClick={() => setCorrection(null)}>Cancel</button>
              <button type="button" disabled={saving} onClick={() => void saveCorrection()} style={{ padding: "10px 14px", border: 0, borderRadius: 8, background: "#f47b20", color: "white", fontWeight: 900 }}>
                {saving ? "Saving..." : "Save correction"}
              </button>
            </div>
          </div>
        </div>
      </div>}
    </main>
  );
}