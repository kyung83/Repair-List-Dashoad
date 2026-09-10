"use client";

import { useEffect, useMemo, useState } from "react";
import MaintenanceTabs from "../maintenance-tabs";

type MaintenanceItem = { id: number; name: string; description: string };
type RotationStep = { id: number; maintenanceItemId: number; name: string; description: string; position: number };
type IntervalStep = {
  id: number;
  maintenanceItemId: number;
  name: string;
  description: string;
  mileageInterval: number | null;
  timeIntervalDays: number | null;
  resetsItemIds: number[];
};
type Program = {
  id: number;
  name: string;
  equipmentScope: "vehicle" | "trailer" | "any";
  rotationMileageInterval: number | null;
  rotationTimeIntervalDays: number | null;
  dueSoonMiles: number;
  dueSoonDays: number;
  rotation: RotationStep[];
  intervals: IntervalStep[];
};
type Equipment = {
  id: number;
  unit: string;
  equipmentType: "Vehicle" | "Trailer";
  category: string;
  currentMileage: number | null;
  make: string;
  model: string;
  programId: number | null;
  programName: string;
  rotationPosition: number;
  rotationLastMileage: number | null;
  rotationLastDate: string;
};
type DuePreview = {
  id: string;
  equipmentId: number;
  unit: string;
  programName: string;
  kind: "rotation" | "interval";
  itemName: string;
  milesRemaining: number | null;
  daysRemaining: number | null;
  status: string;
};
type SetupData = {
  items: MaintenanceItem[];
  programs: Program[];
  equipment: Equipment[];
  duePreview: DuePreview[];
  updatedAt: string;
};
type ItemDraft = { id: number | null; name: string; description: string };
type IntervalDraft = {
  key: string;
  maintenanceItemId: string;
  mileageInterval: string;
  timeIntervalDays: string;
  resetsItemIds: number[];
};
type ProgramDraft = {
  id: number | null;
  name: string;
  equipmentScope: "vehicle" | "trailer" | "any";
  rotationMileageInterval: string;
  rotationTimeIntervalDays: string;
  dueSoonMiles: string;
  dueSoonDays: string;
  rotationItemIds: number[];
  intervalItems: IntervalDraft[];
};

const blankItem: ItemDraft = { id: null, name: "", description: "" };
const blankProgram: ProgramDraft = {
  id: null,
  name: "",
  equipmentScope: "vehicle",
  rotationMileageInterval: "",
  rotationTimeIntervalDays: "",
  dueSoonMiles: "1000",
  dueSoonDays: "30",
  rotationItemIds: [],
  intervalItems: [],
};

function intervalKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function numeric(value: number | null, suffix: string) {
  return value == null ? "—" : `${value.toLocaleString()}${suffix}`;
}

function dueText(row: DuePreview) {
  const bits: string[] = [];
  if (row.milesRemaining != null) bits.push(row.milesRemaining <= 0 ? `${Math.abs(row.milesRemaining).toLocaleString()} mi overdue` : `${row.milesRemaining.toLocaleString()} mi left`);
  if (row.daysRemaining != null) bits.push(row.daysRemaining <= 0 ? `${Math.abs(row.daysRemaining)} days overdue` : `${row.daysRemaining} days left`);
  return bits.join(" · ") || row.status;
}

export default function MaintenanceProgramsPage() {
  const [data, setData] = useState<SetupData | null>(null);
  const [tab, setTab] = useState<"items" | "programs" | "assignments">("items");
  const [itemDraft, setItemDraft] = useState<ItemDraft>(blankItem);
  const [programDraft, setProgramDraft] = useState<ProgramDraft>(blankProgram);
  const [rotationPick, setRotationPick] = useState("");
  const [selectedEquipment, setSelectedEquipment] = useState<number[]>([]);
  const [assignmentProgramId, setAssignmentProgramId] = useState("");
  const [equipmentQuery, setEquipmentQuery] = useState("");
  const [equipmentFilter, setEquipmentFilter] = useState<"All" | "Vehicle" | "Trailer">("All");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const response = await fetch("/api/maintenance-programs", { cache: "no-store" });
    const payload = await response.json() as SetupData & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Maintenance programs could not be loaded.");
    setData(payload);
  }

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/maintenance-programs", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as SetupData & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Maintenance programs could not be loaded.");
        return payload;
      })
      .then((payload) => { if (!cancelled) setData(payload); })
      .catch((error: unknown) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "Maintenance programs could not be loaded."); });
    return () => { cancelled = true; };
  }, []);

  async function post(body: Record<string, unknown>, success: string) {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/maintenance-programs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Maintenance program could not be saved.");
      await load();
      setMessage(success);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Maintenance program could not be saved.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveItem() {
    const ok = await post({ action: "saveItem", ...itemDraft }, itemDraft.id ? "Maintenance item updated." : "Maintenance item created.");
    if (ok) setItemDraft(blankItem);
  }

  function editProgram(program: Program) {
    setProgramDraft({
      id: program.id,
      name: program.name,
      equipmentScope: program.equipmentScope,
      rotationMileageInterval: program.rotationMileageInterval == null ? "" : String(program.rotationMileageInterval),
      rotationTimeIntervalDays: program.rotationTimeIntervalDays == null ? "" : String(program.rotationTimeIntervalDays),
      dueSoonMiles: String(program.dueSoonMiles),
      dueSoonDays: String(program.dueSoonDays),
      rotationItemIds: program.rotation.map((step) => step.maintenanceItemId),
      intervalItems: program.intervals.map((step) => ({
        key: String(step.id),
        maintenanceItemId: String(step.maintenanceItemId),
        mileageInterval: step.mileageInterval == null ? "" : String(step.mileageInterval),
        timeIntervalDays: step.timeIntervalDays == null ? "" : String(step.timeIntervalDays),
        resetsItemIds: step.resetsItemIds,
      })),
    });
    setRotationPick("");
    setTab("programs");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveProgram() {
    const body = {
      action: "saveProgram",
      id: programDraft.id,
      name: programDraft.name,
      equipmentScope: programDraft.equipmentScope,
      rotationMileageInterval: programDraft.rotationMileageInterval || null,
      rotationTimeIntervalDays: programDraft.rotationTimeIntervalDays || null,
      dueSoonMiles: programDraft.dueSoonMiles || 0,
      dueSoonDays: programDraft.dueSoonDays || 0,
      rotationItemIds: programDraft.rotationItemIds,
      intervalItems: programDraft.intervalItems.map((item) => ({
        maintenanceItemId: item.maintenanceItemId,
        mileageInterval: item.mileageInterval || null,
        timeIntervalDays: item.timeIntervalDays || null,
        resetsItemIds: item.resetsItemIds,
      })),
    };
    const ok = await post(body, programDraft.id ? "Maintenance program updated." : "Maintenance program created.");
    if (ok) setProgramDraft(blankProgram);
  }

  function addRotationStep() {
    const id = Number(rotationPick);
    if (!id) return setMessage("Choose a maintenance item to add to the rotation.");
    setProgramDraft((current) => ({ ...current, rotationItemIds: [...current.rotationItemIds, id] }));
    setRotationPick("");
  }

  function moveRotation(index: number, direction: -1 | 1) {
    setProgramDraft((current) => {
      const next = [...current.rotationItemIds];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, rotationItemIds: next };
    });
  }

  function addIndependentItem() {
    setProgramDraft((current) => ({
      ...current,
      intervalItems: [...current.intervalItems, { key: intervalKey(), maintenanceItemId: "", mileageInterval: "", timeIntervalDays: "", resetsItemIds: [] }],
    }));
  }

  function patchIndependent(key: string, patch: Partial<IntervalDraft>) {
    setProgramDraft((current) => ({
      ...current,
      intervalItems: current.intervalItems.map((item) => item.key === key ? { ...item, ...patch } : item),
    }));
  }

  function toggleReset(key: string, itemId: number) {
    setProgramDraft((current) => ({
      ...current,
      intervalItems: current.intervalItems.map((item) => {
        if (item.key !== key) return item;
        const next = new Set(item.resetsItemIds);
        if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
        return { ...item, resetsItemIds: [...next] };
      }),
    }));
  }

  async function assignProgram() {
    if (!assignmentProgramId) return setMessage("Choose a maintenance program first.");
    if (!selectedEquipment.length) return setMessage("Check the units you want to assign first.");
    const count = selectedEquipment.length;
    const ok = await post({ action: "assignProgram", programId: assignmentProgramId, equipmentIds: selectedEquipment }, `${count} unit${count === 1 ? "" : "s"} assigned to the maintenance program.`);
    if (ok) setSelectedEquipment([]);
  }

  async function removeProgram() {
    if (!selectedEquipment.length) return setMessage("Check the units you want to clear first.");
    const count = selectedEquipment.length;
    const ok = await post({ action: "removeProgram", equipmentIds: selectedEquipment }, `Maintenance program removed from ${count} unit${count === 1 ? "" : "s"}.`);
    if (ok) setSelectedEquipment([]);
  }

  const itemById = useMemo(() => new Map((data?.items ?? []).map((item) => [item.id, item])), [data]);
  const programById = useMemo(() => new Map((data?.programs ?? []).map((program) => [program.id, program])), [data]);
  const visibleEquipment = useMemo(() => {
    const needle = equipmentQuery.trim().toLowerCase();
    return (data?.equipment ?? []).filter((row) => {
      if (equipmentFilter !== "All" && row.equipmentType !== equipmentFilter) return false;
      if (!needle) return true;
      return [row.unit, row.category, row.make, row.model, row.programName].join(" ").toLowerCase().includes(needle);
    });
  }, [data, equipmentFilter, equipmentQuery]);
  const selectedSet = useMemo(() => new Set(selectedEquipment), [selectedEquipment]);
  const allVisibleSelected = visibleEquipment.length > 0 && visibleEquipment.every((row) => selectedSet.has(row.id));
  const activeDue = (data?.duePreview ?? []).filter((row) => row.status === "Overdue" || row.status === "Due Soon");

  function toggleAllVisible() {
    setSelectedEquipment((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleEquipment.forEach((row) => next.delete(row.id));
      else visibleEquipment.forEach((row) => next.add(row.id));
      return [...next];
    });
  }

  return (
    <main style={pageStyle}>
      <MaintenanceTabs />
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>CUSTOM MAINTENANCE</p>
          <h1 style={titleStyle}>Maintenance Program Builder</h1>
          <p style={subheadStyle}>Create your own maintenance items, build any repeating rotation, add independent mileage/time services, and assign the finished program to the units you choose.</p>
        </div>
        <div style={summaryStyle}>
          <strong>{data?.items.length ?? 0}</strong> items · <strong>{data?.programs.length ?? 0}</strong> programs · <strong>{activeDue.length}</strong> due soon/overdue
        </div>
      </header>

      {message && <div style={noticeStyle}>{message}</div>}

      <nav style={tabBarStyle}>
        <button type="button" onClick={() => setTab("items")} style={tab === "items" ? activeTabStyle : tabStyle}>1. Maintenance Items</button>
        <button type="button" onClick={() => setTab("programs")} style={tab === "programs" ? activeTabStyle : tabStyle}>2. Programs & Rotations</button>
        <button type="button" onClick={() => setTab("assignments")} style={tab === "assignments" ? activeTabStyle : tabStyle}>3. Unit Assignments</button>
      </nav>

      {tab === "items" && (
        <section style={twoColumnStyle}>
          <div style={panelStyle}>
            <div style={sectionHeadingStyle}>
              <div><p style={miniLabelStyle}>BUILDING BLOCK</p><h2 style={h2Style}>{itemDraft.id ? "Edit Maintenance Item" : "Create Maintenance Item"}</h2></div>
              {itemDraft.id && <button type="button" style={secondaryButtonStyle} onClick={() => setItemDraft(blankItem)}>New Item</button>}
            </div>
            <p style={helpStyle}>An item is the work itself: 40 PM, 20A, Allison Filter, Coolant Service, Differential Service, DPF Cleaning, or anything else you create.</p>
            <label style={labelStyle}>Item name
              <input style={inputStyle} value={itemDraft.name} onChange={(event) => setItemDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Example: Allison Transmission Filter" />
            </label>
            <label style={labelStyle}>Description / technician instructions
              <textarea style={{ ...inputStyle, minHeight: 96, resize: "vertical" }} value={itemDraft.description} onChange={(event) => setItemDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Optional notes about what this service includes" />
            </label>
            <button type="button" disabled={saving} style={primaryButtonStyle} onClick={() => void saveItem()}>{saving ? "Saving…" : itemDraft.id ? "Save Changes" : "+ Create Maintenance Item"}</button>
          </div>

          <div style={panelStyle}>
            <div style={sectionHeadingStyle}><div><p style={miniLabelStyle}>YOUR LIBRARY</p><h2 style={h2Style}>Maintenance Items</h2></div><span style={countBadgeStyle}>{data?.items.length ?? 0}</span></div>
            <div style={listStyle}>
              {(data?.items ?? []).map((item) => (
                <div key={item.id} style={listRowStyle}>
                  <div style={{ minWidth: 0 }}><strong>{item.name}</strong>{item.description && <div style={rowDetailStyle}>{item.description}</div>}</div>
                  <div style={rowActionsStyle}>
                    <button type="button" style={smallButtonStyle} onClick={() => setItemDraft({ id: item.id, name: item.name, description: item.description })}>Edit</button>
                    <button type="button" disabled={saving} style={dangerButtonStyle} onClick={() => void post({ action: "deactivateItem", id: item.id }, `${item.name} deactivated.`)}>Deactivate</button>
                  </div>
                </div>
              ))}
              {!data?.items.length && <div style={emptyStyle}>Create your first maintenance item on the left.</div>}
            </div>
          </div>
        </section>
      )}

      {tab === "programs" && (
        <section style={{ display: "grid", gap: 16 }}>
          <div style={panelStyle}>
            <div style={sectionHeadingStyle}>
              <div><p style={miniLabelStyle}>MAINTENANCE PROGRAM</p><h2 style={h2Style}>{programDraft.id ? `Edit ${programDraft.name}` : "Create a Program"}</h2></div>
              {programDraft.id && <button type="button" style={secondaryButtonStyle} onClick={() => setProgramDraft(blankProgram)}>New Program</button>}
            </div>
            <div style={programTopGridStyle}>
              <label style={labelStyle}>Program name
                <input style={inputStyle} value={programDraft.name} onChange={(event) => setProgramDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Example: S60 Highway Trucks" />
              </label>
              <label style={labelStyle}>Can be assigned to
                <select style={inputStyle} value={programDraft.equipmentScope} onChange={(event) => setProgramDraft((current) => ({ ...current, equipmentScope: event.target.value as ProgramDraft["equipmentScope"] }))}>
                  <option value="vehicle">Vehicles only</option><option value="trailer">Trailers only</option><option value="any">Any equipment</option>
                </select>
              </label>
              <label style={labelStyle}>Show mileage work this many miles early
                <input type="number" min="0" style={inputStyle} value={programDraft.dueSoonMiles} onChange={(event) => setProgramDraft((current) => ({ ...current, dueSoonMiles: event.target.value }))} />
              </label>
              <label style={labelStyle}>Show time work this many days early
                <input type="number" min="0" style={inputStyle} value={programDraft.dueSoonDays} onChange={(event) => setProgramDraft((current) => ({ ...current, dueSoonDays: event.target.value }))} />
              </label>
            </div>
          </div>

          <div style={builderGridStyle}>
            <div style={panelStyle}>
              <p style={miniLabelStyle}>REPEATING SEQUENCE</p><h2 style={h2Style}>Rotation</h2>
              <p style={helpStyle}>Use this when work advances through a repeating order. The same maintenance item can be added more than once.</p>
              <div style={intervalGridStyle}>
                <label style={labelStyle}>Every ___ miles
                  <input type="number" min="1" style={inputStyle} value={programDraft.rotationMileageInterval} onChange={(event) => setProgramDraft((current) => ({ ...current, rotationMileageInterval: event.target.value }))} placeholder="18500" />
                </label>
                <label style={labelStyle}>Or every ___ days
                  <input type="number" min="1" style={inputStyle} value={programDraft.rotationTimeIntervalDays} onChange={(event) => setProgramDraft((current) => ({ ...current, rotationTimeIntervalDays: event.target.value }))} placeholder="Optional" />
                </label>
              </div>
              <div style={addLineStyle}>
                <select style={{ ...inputStyle, flex: 1 }} value={rotationPick} onChange={(event) => setRotationPick(event.target.value)}>
                  <option value="">Choose maintenance item…</option>
                  {(data?.items ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <button type="button" style={secondaryButtonStyle} onClick={addRotationStep}>+ Add Step</button>
              </div>
              <div style={rotationListStyle}>
                {programDraft.rotationItemIds.map((itemId, index) => (
                  <div key={`${itemId}-${index}`} style={rotationRowStyle}>
                    <span style={stepNumberStyle}>{index + 1}</span><strong style={{ flex: 1 }}>{itemById.get(itemId)?.name ?? `Item ${itemId}`}</strong>
                    <button type="button" style={iconButtonStyle} disabled={index === 0} onClick={() => moveRotation(index, -1)}>↑</button>
                    <button type="button" style={iconButtonStyle} disabled={index === programDraft.rotationItemIds.length - 1} onClick={() => moveRotation(index, 1)}>↓</button>
                    <button type="button" style={dangerButtonStyle} onClick={() => setProgramDraft((current) => ({ ...current, rotationItemIds: current.rotationItemIds.filter((_, position) => position !== index) }))}>Remove</button>
                  </div>
                ))}
                {!programDraft.rotationItemIds.length && <div style={emptyStyle}>No rotation yet. Add items above in the exact order they should repeat.</div>}
              </div>
              {programDraft.rotationItemIds.length > 0 && <div style={sequencePreviewStyle}><b>Repeats:</b> {programDraft.rotationItemIds.map((id) => itemById.get(id)?.name ?? "?").join(" → ")} → repeat</div>}
            </div>

            <div style={panelStyle}>
              <div style={sectionHeadingStyle}><div><p style={miniLabelStyle}>RUNS ON ITS OWN COUNTER</p><h2 style={h2Style}>Independent Maintenance</h2></div><button type="button" style={secondaryButtonStyle} onClick={addIndependentItem}>+ Add Item</button></div>
              <p style={helpStyle}>Use these for services that have their own mileage/time schedule, even while the normal PM rotation keeps running.</p>
              <div style={listStyle}>
                {programDraft.intervalItems.map((row, index) => {
                  const selectedItemId = Number(row.maintenanceItemId) || 0;
                  return (
                    <div key={row.key} style={independentCardStyle}>
                      <div style={sectionHeadingStyle}><strong>Independent item {index + 1}</strong><button type="button" style={dangerButtonStyle} onClick={() => setProgramDraft((current) => ({ ...current, intervalItems: current.intervalItems.filter((item) => item.key !== row.key) }))}>Remove</button></div>
                      <label style={labelStyle}>Maintenance item
                        <select style={inputStyle} value={row.maintenanceItemId} onChange={(event) => patchIndependent(row.key, { maintenanceItemId: event.target.value, resetsItemIds: row.resetsItemIds.filter((id) => id !== Number(event.target.value)) })}>
                          <option value="">Choose item…</option>{(data?.items ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                      </label>
                      <div style={intervalGridStyle}>
                        <label style={labelStyle}>Every ___ miles<input type="number" min="1" style={inputStyle} value={row.mileageInterval} onChange={(event) => patchIndependent(row.key, { mileageInterval: event.target.value })} placeholder="Optional" /></label>
                        <label style={labelStyle}>Or every ___ days<input type="number" min="1" style={inputStyle} value={row.timeIntervalDays} onChange={(event) => patchIndependent(row.key, { timeIntervalDays: event.target.value })} placeholder="Optional" /></label>
                      </div>
                      <div style={resetBoxStyle}>
                        <strong style={{ fontSize: 12 }}>Completing this also resets:</strong>
                        <div style={checkGridStyle}>
                          {(data?.items ?? []).filter((item) => item.id !== selectedItemId).map((item) => (
                            <label key={item.id} style={checkLabelStyle}><input type="checkbox" checked={row.resetsItemIds.includes(item.id)} onChange={() => toggleReset(row.key, item.id)} /> {item.name}</label>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!programDraft.intervalItems.length && <div style={emptyStyle}>No independent services. Add one for transmission, coolant, DPF, differential, or any other separate interval.</div>}
              </div>
            </div>
          </div>

          <div style={saveBarStyle}>
            <div><strong>{programDraft.name || "New program"}</strong><div style={rowDetailStyle}>{programDraft.rotationItemIds.length} rotation steps · {programDraft.intervalItems.length} independent items</div></div>
            <button type="button" disabled={saving} style={primaryButtonStyle} onClick={() => void saveProgram()}>{saving ? "Saving…" : programDraft.id ? "Save Program Changes" : "Create Maintenance Program"}</button>
          </div>

          <div style={panelStyle}>
            <div style={sectionHeadingStyle}><div><p style={miniLabelStyle}>SAVED PROGRAMS</p><h2 style={h2Style}>Your Maintenance Programs</h2></div><span style={countBadgeStyle}>{data?.programs.length ?? 0}</span></div>
            <div style={listStyle}>
              {(data?.programs ?? []).map((program) => (
                <div key={program.id} style={programSummaryStyle}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 16 }}>{program.name}</strong>
                    <div style={rowDetailStyle}>{program.equipmentScope === "any" ? "Any equipment" : program.equipmentScope === "trailer" ? "Trailers" : "Vehicles"} · Rotation {program.rotation.length ? `${numeric(program.rotationMileageInterval, " mi")} / ${numeric(program.rotationTimeIntervalDays, " days")}` : "off"} · {program.intervals.length} independent item{program.intervals.length === 1 ? "" : "s"}</div>
                    {program.rotation.length > 0 && <div style={sequenceSmallStyle}>{program.rotation.map((step) => step.name).join(" → ")} → repeat</div>}
                  </div>
                  <div style={rowActionsStyle}><button type="button" style={smallButtonStyle} onClick={() => editProgram(program)}>Edit</button><button type="button" disabled={saving} style={dangerButtonStyle} onClick={() => void post({ action: "deactivateProgram", id: program.id }, `${program.name} deactivated.`)}>Deactivate</button></div>
                </div>
              ))}
              {!data?.programs.length && <div style={emptyStyle}>No programs yet. Create maintenance items first, then build a program.</div>}
            </div>
          </div>
        </section>
      )}

      {tab === "assignments" && (
        <section style={{ display: "grid", gap: 16 }}>
          <div style={panelStyle}>
            <div style={sectionHeadingStyle}><div><p style={miniLabelStyle}>BULK ASSIGNMENT</p><h2 style={h2Style}>Assign Programs to Units</h2></div><strong>{selectedEquipment.length} selected</strong></div>
            <div style={assignmentBarStyle}>
              <select style={{ ...inputStyle, minWidth: 250, flex: 1 }} value={assignmentProgramId} onChange={(event) => setAssignmentProgramId(event.target.value)}>
                <option value="">Choose maintenance program…</option>{(data?.programs ?? []).map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
              </select>
              <button type="button" disabled={saving} style={primaryButtonStyle} onClick={() => void assignProgram()}>Assign to Selected</button>
              <button type="button" disabled={saving} style={secondaryButtonStyle} onClick={() => void removeProgram()}>Remove Program</button>
            </div>
            <p style={helpStyle}>When a program is assigned for the first time, current mileage and today become its starting baseline so a brand-new assignment does not immediately show overdue.</p>
          </div>

          <div style={panelStyle}>
            <div style={filtersStyle}>
              <input style={{ ...inputStyle, maxWidth: 360 }} value={equipmentQuery} onChange={(event) => setEquipmentQuery(event.target.value)} placeholder="Search unit, category, make, model, program…" />
              <select style={{ ...inputStyle, maxWidth: 180 }} value={equipmentFilter} onChange={(event) => setEquipmentFilter(event.target.value as typeof equipmentFilter)}><option>All</option><option>Vehicle</option><option>Trailer</option></select>
              <button type="button" style={smallButtonStyle} onClick={toggleAllVisible}>{allVisibleSelected ? "Clear Visible" : "Select Visible"}</button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead><tr><th style={thStyle}></th><th style={thStyle}>Unit</th><th style={thStyle}>Type</th><th style={thStyle}>Category</th><th style={thStyle}>Mileage</th><th style={thStyle}>Current Program</th><th style={thStyle}>Next Rotation</th></tr></thead>
                <tbody>
                  {visibleEquipment.map((row) => {
                    const program = row.programId ? programById.get(row.programId) : undefined;
                    const next = program?.rotation.length ? program.rotation[row.rotationPosition % program.rotation.length]?.name : "—";
                    return <tr key={row.id} style={trStyle}>
                      <td style={tdStyle}><input type="checkbox" checked={selectedSet.has(row.id)} onChange={() => setSelectedEquipment((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /></td>
                      <td style={tdStyle}><strong>{row.unit}</strong></td><td style={tdStyle}>{row.equipmentType}</td><td style={tdStyle}>{row.category}</td><td style={tdStyle}>{row.currentMileage == null ? "—" : row.currentMileage.toLocaleString()}</td><td style={tdStyle}>{row.programName || <span style={{ color: "#9a5b00" }}>Not assigned</span>}</td><td style={tdStyle}>{next}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={panelStyle}>
            <div style={sectionHeadingStyle}><div><p style={miniLabelStyle}>SCHEDULE PREVIEW</p><h2 style={h2Style}>What Each Counter Says Now</h2></div><span style={countBadgeStyle}>{data?.duePreview.length ?? 0} counters</span></div>
            <p style={helpStyle}>This is the custom-program engine. Rotations and independent items are tracked separately so completing one does not accidentally move another counter.</p>
            <div style={listStyle}>
              {(data?.duePreview ?? []).map((row) => (
                <div key={row.id} style={listRowStyle}>
                  <div><strong>Unit {row.unit} · {row.itemName}</strong><div style={rowDetailStyle}>{row.programName} · {row.kind === "rotation" ? "Rotation" : "Independent"}</div></div>
                  <div style={{ textAlign: "right" }}><strong style={{ color: row.status === "Overdue" ? "#b42318" : row.status === "Due Soon" ? "#9a5b00" : "#52616c" }}>{row.status}</strong><div style={rowDetailStyle}>{dueText(row)}</div></div>
                </div>
              ))}
              {!data?.duePreview.length && <div style={emptyStyle}>Assign a maintenance program to a unit to start its counters.</div>}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

const pageStyle = { minHeight: "100vh", background: "#f3f5f7", color: "#172033", padding: "28px 32px 100px" } as const;
const headerStyle = { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 18, flexWrap: "wrap" as const } as const;
const eyebrowStyle = { margin: 0, color: "#f47b20", fontSize: 11, fontWeight: 900, letterSpacing: ".14em" } as const;
const titleStyle = { margin: "6px 0 0", fontSize: 32, color: "#0d1b2b" } as const;
const subheadStyle = { margin: "7px 0 0", maxWidth: 880, color: "#64748b", lineHeight: 1.5, fontSize: 13 } as const;
const summaryStyle = { color: "#52616c", fontSize: 12, whiteSpace: "nowrap" as const } as const;
const noticeStyle = { marginTop: 14, padding: 11, borderRadius: 7, border: "1px solid #f2c66d", background: "#fff8e6", fontSize: 12 } as const;
const tabBarStyle = { display: "flex", gap: 6, flexWrap: "wrap" as const, marginTop: 18, marginBottom: 16 } as const;
const tabStyle = { minHeight: 38, padding: "0 14px", border: "1px solid #cbd3d9", borderRadius: 6, background: "white", color: "#53616e", fontWeight: 900, cursor: "pointer" } as const;
const activeTabStyle = { ...tabStyle, background: "#0d1b2b", borderColor: "#0d1b2b", color: "white" } as const;
const twoColumnStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 16, alignItems: "start" } as const;
const builderGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 16, alignItems: "start" } as const;
const panelStyle = { background: "white", border: "1px solid #cfd6db", borderRadius: 8, padding: 16 } as const;
const sectionHeadingStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" as const } as const;
const miniLabelStyle = { margin: 0, color: "#f47b20", fontSize: 9, fontWeight: 900, letterSpacing: ".12em" } as const;
const h2Style = { margin: "3px 0 0", fontSize: 20, color: "#172033" } as const;
const helpStyle = { margin: "7px 0 14px", color: "#64748b", fontSize: 12, lineHeight: 1.5 } as const;
const labelStyle = { display: "grid", gap: 5, marginBottom: 11, color: "#53616e", fontSize: 11, fontWeight: 900 } as const;
const inputStyle = { width: "100%", boxSizing: "border-box" as const, minHeight: 38, padding: "8px 10px", border: "1px solid #cbd3d9", borderRadius: 5, background: "white", color: "#172033", fontSize: 14 } as const;
const primaryButtonStyle = { minHeight: 38, padding: "0 14px", border: 0, borderRadius: 5, background: "#f47b20", color: "white", fontWeight: 900, cursor: "pointer" } as const;
const secondaryButtonStyle = { minHeight: 36, padding: "0 11px", border: "1px solid #c5cdd3", borderRadius: 5, background: "white", color: "#263746", fontWeight: 900, cursor: "pointer" } as const;
const smallButtonStyle = { ...secondaryButtonStyle, minHeight: 30, padding: "0 9px", fontSize: 11 } as const;
const dangerButtonStyle = { minHeight: 30, padding: "0 8px", border: "1px solid #e2b8b5", borderRadius: 4, background: "#fff7f6", color: "#9b2c24", fontWeight: 800, fontSize: 10, cursor: "pointer" } as const;
const iconButtonStyle = { ...smallButtonStyle, width: 31, padding: 0 } as const;
const listStyle = { display: "grid", gap: 8 } as const;
const listRowStyle = { display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", padding: "11px 12px", border: "1px solid #e0e5e8", borderRadius: 6, background: "#fbfcfc" } as const;
const rowDetailStyle = { marginTop: 3, color: "#77838d", fontSize: 11, lineHeight: 1.4 } as const;
const rowActionsStyle = { display: "flex", gap: 6, flexWrap: "wrap" as const, flexShrink: 0 } as const;
const countBadgeStyle = { display: "inline-flex", minWidth: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 999, background: "#eef2f5", color: "#52616c", fontSize: 11, fontWeight: 900 } as const;
const emptyStyle = { padding: 20, border: "1px dashed #cbd5dc", borderRadius: 6, textAlign: "center" as const, color: "#75828d", background: "#fbfcfc", fontSize: 12 } as const;
const programTopGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 13 } as const;
const intervalGridStyle = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 } as const;
const addLineStyle = { display: "flex", gap: 8, alignItems: "center", marginBottom: 10 } as const;
const rotationListStyle = { display: "grid", gap: 6 } as const;
const rotationRowStyle = { display: "flex", gap: 8, alignItems: "center", padding: "8px 9px", border: "1px solid #e0e5e8", borderRadius: 5 } as const;
const stepNumberStyle = { display: "inline-flex", width: 26, height: 26, borderRadius: 999, alignItems: "center", justifyContent: "center", background: "#eef2f5", fontSize: 11, fontWeight: 900 } as const;
const sequencePreviewStyle = { marginTop: 10, padding: 10, background: "#f3f6f8", borderRadius: 5, color: "#52616c", fontSize: 12, lineHeight: 1.5 } as const;
const sequenceSmallStyle = { marginTop: 6, color: "#52616c", fontSize: 12, lineHeight: 1.5 } as const;
const independentCardStyle = { padding: 12, border: "1px solid #dce2e6", borderRadius: 6, background: "#fbfcfc" } as const;
const resetBoxStyle = { marginTop: 4, paddingTop: 9, borderTop: "1px solid #e3e7ea" } as const;
const checkGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 5, marginTop: 7 } as const;
const checkLabelStyle = { display: "flex", gap: 6, alignItems: "center", fontSize: 11, color: "#53616e" } as const;
const saveBarStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap" as const, padding: 14, background: "#0d1b2b", color: "white", borderRadius: 7 } as const;
const programSummaryStyle = { ...listRowStyle, alignItems: "flex-start" } as const;
const assignmentBarStyle = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const, marginTop: 12 } as const;
const filtersStyle = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const, marginBottom: 10 } as const;
const tableStyle = { width: "100%", borderCollapse: "collapse" as const, minWidth: 760, fontSize: 12 } as const;
const thStyle = { textAlign: "left" as const, padding: "8px 9px", background: "#eef1f2", color: "#59656e", fontSize: 9, letterSpacing: ".05em", textTransform: "uppercase" as const, borderBottom: "1px solid #cfd6db" } as const;
const tdStyle = { padding: "9px", borderBottom: "1px solid #e4e8eb", color: "#344553" } as const;
const trStyle = { background: "white" } as const;
