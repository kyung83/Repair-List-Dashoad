"use client";

import { useEffect, useMemo, useState } from "react";
import MaintenanceTabs from "../maintenance-tabs";

type Part = { id: number; partNumber: string; description: string; quantityOnHand: number };
type Truck = { id: number; unit: string; modelYear: number | null; make: string; model: string; engine: string; equipmentType: string };
type KitPart = { partId: number; partNumber: string; description: string; quantity: number };
type Kit = {
  id: string;
  name: string;
  pmType: string;
  yearFrom: number | null;
  yearTo: number | null;
  make: string;
  model: string;
  engine: string;
  active: boolean;
  parts: KitPart[];
};
type Data = {
  user: { displayName: string; role: "manager" | "admin" };
  pmTypes: string[];
  kits: Kit[];
  parts: Part[];
  trucks: Truck[];
  updatedAt: string;
};
type DraftPart = { partId: number; quantity: number };
type Draft = {
  id: string;
  name: string;
  pmType: string;
  yearFrom: string;
  yearTo: string;
  make: string;
  model: string;
  engine: string;
  parts: DraftPart[];
};

const blankDraft: Draft = { id: "", name: "", pmType: "", yearFrom: "", yearTo: "", make: "", model: "", engine: "", parts: [] };

function same(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

function matches(truck: Truck, criteria: Pick<Draft, "yearFrom" | "yearTo" | "make" | "model" | "engine">) {
  const from = criteria.yearFrom ? Number(criteria.yearFrom) : null;
  const to = criteria.yearTo ? Number(criteria.yearTo) : null;
  if (from != null && (truck.modelYear == null || truck.modelYear < from)) return false;
  if (to != null && (truck.modelYear == null || truck.modelYear > to)) return false;
  if (criteria.make && !same(truck.make, criteria.make)) return false;
  if (criteria.model && !same(truck.model, criteria.model)) return false;
  if (criteria.engine && !same(truck.engine, criteria.engine)) return false;
  return true;
}

function kitCriteria(kit: Kit): Pick<Draft, "yearFrom" | "yearTo" | "make" | "model" | "engine"> {
  return {
    yearFrom: kit.yearFrom == null ? "" : String(kit.yearFrom),
    yearTo: kit.yearTo == null ? "" : String(kit.yearTo),
    make: kit.make,
    model: kit.model,
    engine: kit.engine,
  };
}

export default function PmKitsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [partSearch, setPartSearch] = useState("");
  const [partToAdd, setPartToAdd] = useState("");

  async function load() {
    const response = await fetch("/api/pm-kits", { cache: "no-store" });
    const payload = await response.json() as Data & { error?: string };
    if (!response.ok) throw new Error(payload.error || "PM kits could not be loaded.");
    setData(payload);
    setDraft((current) => current.pmType || !payload.pmTypes.length ? current : { ...current, pmType: payload.pmTypes[0] });
  }

  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : "PM kits could not be loaded."));
  }, []);

  const years = useMemo(() => {
    const current = new Date().getFullYear() + 1;
    return Array.from({ length: current - 1989 }, (_, index) => current - index);
  }, []);
  const makeOptions = useMemo(() => unique(data?.trucks.map((truck) => truck.make) ?? []), [data]);
  const modelOptions = useMemo(() => unique((data?.trucks ?? []).filter((truck) => !draft.make || same(truck.make, draft.make)).map((truck) => truck.model)), [data, draft.make]);
  const engineOptions = useMemo(() => unique((data?.trucks ?? []).filter((truck) => (!draft.make || same(truck.make, draft.make)) && (!draft.model || same(truck.model, draft.model))).map((truck) => truck.engine)), [data, draft.make, draft.model]);
  const matchingTrucks = useMemo(() => (data?.trucks ?? []).filter((truck) => matches(truck, draft)), [data, draft]);
  const filteredParts = useMemo(() => {
    const needle = partSearch.trim().toLowerCase();
    return (data?.parts ?? []).filter((part) => !draft.parts.some((selected) => selected.partId === part.id) && (!needle || `${part.partNumber} ${part.description}`.toLowerCase().includes(needle))).slice(0, 80);
  }, [data, draft.parts, partSearch]);

  function reset() {
    setDraft({ ...blankDraft, pmType: data?.pmTypes[0] ?? "" });
    setPartSearch("");
    setPartToAdd("");
  }

  function edit(kit: Kit) {
    setDraft({
      id: kit.id,
      name: kit.name,
      pmType: kit.pmType,
      yearFrom: kit.yearFrom == null ? "" : String(kit.yearFrom),
      yearTo: kit.yearTo == null ? "" : String(kit.yearTo),
      make: kit.make,
      model: kit.model,
      engine: kit.engine,
      parts: kit.parts.map((part) => ({ partId: part.partId, quantity: part.quantity })),
    });
    setMessage(`Editing ${kit.name}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function addPart() {
    const id = Number(partToAdd);
    if (!id || !data?.parts.some((part) => part.id === id)) {
      setMessage("Choose an inventory part to add to the kit.");
      return;
    }
    setDraft((current) => ({ ...current, parts: [...current.parts, { partId: id, quantity: 1 }] }));
    setPartToAdd("");
    setPartSearch("");
  }

  async function save() {
    if (!draft.name.trim()) { setMessage("Give the PM kit a name."); return; }
    if (!draft.pmType) { setMessage("Choose a PM type."); return; }
    if (!draft.parts.length) { setMessage("Add at least one part to the PM kit."); return; }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/pm-kits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "saveKit",
          id: draft.id || undefined,
          name: draft.name,
          pmType: draft.pmType,
          yearFrom: draft.yearFrom,
          yearTo: draft.yearTo,
          make: draft.make,
          model: draft.model,
          engine: draft.engine,
          parts: draft.parts,
        }),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "PM kit could not be saved.");
      const edited = Boolean(draft.id);
      await load();
      reset();
      setMessage(edited ? "PM kit updated." : "PM kit created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PM kit could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function setActive(kit: Kit, active: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/pm-kits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "setActive", id: kit.id, active }),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "PM kit could not be changed.");
      await load();
      setMessage(`${kit.name} ${active ? "enabled" : "disabled"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PM kit could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  const selectedPartRows = draft.parts.map((selected) => ({ selected, part: data?.parts.find((part) => part.id === selected.partId) })).filter((row) => row.part);

  return (
    <main style={pageStyle}>
      <MaintenanceTabs />
      <header style={headerStyle}>
        <div>
          <p style={eyebrow}>MAINTENANCE SETUP</p>
          <h1 style={{ margin: "5px 0", fontSize: 32 }}>Truck PM Kits</h1>
          <p style={subtitle}>Build reusable expected-parts kits by PM type and truck year range, make, model, and engine. Matching parts are copied to each PM work order without reducing inventory.</p>
        </div>
      </header>

      {message && <div style={noticeStyle}>{message}</div>}

      <section style={editorStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
          <div><strong style={{ fontSize: 18 }}>{draft.id ? "Edit PM Kit" : "Create PM Kit"}</strong><div style={helperStyle}>Blank matching fields mean “Any.” More-specific matching kits win over broad kits.</div></div>
          {draft.id && <button type="button" style={lightButton} onClick={reset}>Cancel Edit</button>}
        </div>

        <div style={formGrid}>
          <label style={labelStyle}>KIT NAME<input style={inputStyle} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="2022-2025 Cascadia DD15 20A" /></label>
          <label style={labelStyle}>PM TYPE<select style={inputStyle} value={draft.pmType} onChange={(event) => setDraft((current) => ({ ...current, pmType: event.target.value }))}><option value="">Choose PM type…</option>{data?.pmTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
          <label style={labelStyle}>YEAR FROM<select style={inputStyle} value={draft.yearFrom} onChange={(event) => setDraft((current) => ({ ...current, yearFrom: event.target.value }))}><option value="">Any year</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
          <label style={labelStyle}>YEAR TO<select style={inputStyle} value={draft.yearTo} onChange={(event) => setDraft((current) => ({ ...current, yearTo: event.target.value }))}><option value="">Any year</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
          <label style={labelStyle}>MAKE<select style={inputStyle} value={draft.make} onChange={(event) => setDraft((current) => ({ ...current, make: event.target.value, model: "", engine: "" }))}><option value="">Any make</option>{makeOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label style={labelStyle}>MODEL<select style={inputStyle} value={draft.model} onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value, engine: "" }))}><option value="">Any model</option>{modelOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label style={labelStyle}>ENGINE / MOTOR<select style={inputStyle} value={draft.engine} onChange={(event) => setDraft((current) => ({ ...current, engine: event.target.value }))}><option value="">Any engine / motor</option>{engineOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
        </div>

        <div style={matchBox}>
          <strong>{matchingTrucks.length} matching truck{matchingTrucks.length === 1 ? "" : "s"}</strong>
          <span style={helperStyle}>{matchingTrucks.length ? matchingTrucks.slice(0, 16).map((truck) => truck.unit).join(", ") + (matchingTrucks.length > 16 ? ` + ${matchingTrucks.length - 16} more` : "") : "No current trucks match these selections. The kit can still be saved for future equipment."}</span>
        </div>

        <div style={{ marginTop: 16 }}>
          <h2 style={sectionHeading}>Kit Parts</h2>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) minmax(260px,2fr) auto", gap: 8 }}>
            <input style={inputStyle} value={partSearch} onChange={(event) => { setPartSearch(event.target.value); setPartToAdd(""); }} placeholder="Search part number or description" />
            <select style={inputStyle} value={partToAdd} onChange={(event) => setPartToAdd(event.target.value)}><option value="">Choose matching inventory part…</option>{filteredParts.map((part) => <option key={part.id} value={part.id}>{part.partNumber} — {part.description} ({part.quantityOnHand} on hand)</option>)}</select>
            <button type="button" style={orangeButton} onClick={addPart}>Add Part</button>
          </div>
          <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
            {selectedPartRows.map(({ selected, part }) => part && (
              <div key={selected.partId} style={partRowStyle}>
                <div><strong>{part.partNumber}</strong><span style={helperStyle}>{part.description} · {part.quantityOnHand} on hand</span></div>
                <label style={{ ...labelStyle, display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>QTY<input type="number" min="0.01" step="any" style={{ ...inputStyle, width: 90 }} value={selected.quantity} onChange={(event) => setDraft((current) => ({ ...current, parts: current.parts.map((row) => row.partId === selected.partId ? { ...row, quantity: Number(event.target.value) } : row) }))} /></label>
                <button type="button" style={removeButton} onClick={() => setDraft((current) => ({ ...current, parts: current.parts.filter((row) => row.partId !== selected.partId) }))}>Remove</button>
              </div>
            ))}
            {!selectedPartRows.length && <div style={emptyStyle}>No parts in this kit yet.</div>}
          </div>
        </div>

        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" style={lightButton} onClick={reset} disabled={busy}>Clear</button>
          <button type="button" style={saveButton} onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : draft.id ? "Update PM Kit" : "Save PM Kit"}</button>
        </div>
      </section>

      <section style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}><h2 style={sectionHeading}>Saved PM Kits</h2><span style={helperStyle}>{data?.kits.length ?? 0} total</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(330px,1fr))", gap: 12 }}>
          {data?.kits.map((kit) => {
            const kitMatches = (data.trucks ?? []).filter((truck) => matches(truck, kitCriteria(kit)));
            return (
              <article key={kit.id} style={{ ...kitCard, opacity: kit.active ? 1 : .62 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><div><span style={pmBadge}>{kit.pmType}</span><h3 style={{ margin: "7px 0 4px" }}>{kit.name}</h3></div><span style={kit.active ? activeBadge : inactiveBadge}>{kit.active ? "Active" : "Disabled"}</span></div>
                <div style={criteriaText}>{kit.yearFrom || kit.yearTo ? `${kit.yearFrom ?? "Any"}–${kit.yearTo ?? "Any"}` : "Any year"} · {kit.make || "Any make"} · {kit.model || "Any model"} · {kit.engine || "Any engine"}</div>
                <div style={{ marginTop: 8, color: "#47606f", fontSize: 12 }}>{kitMatches.length} current truck{kitMatches.length === 1 ? "" : "s"} match</div>
                <div style={{ marginTop: 10, display: "flex", gap: 5, flexWrap: "wrap" }}>{kit.parts.map((part) => <span key={part.partId} style={partChip}>{part.partNumber} × {part.quantity}</span>)}</div>
                <div style={{ marginTop: 13, display: "flex", gap: 7 }}><button type="button" style={lightButton} onClick={() => edit(kit)} disabled={busy}>Edit</button><button type="button" style={kit.active ? removeButton : saveButton} onClick={() => void setActive(kit, !kit.active)} disabled={busy}>{kit.active ? "Disable" : "Enable"}</button></div>
              </article>
            );
          })}
          {data && !data.kits.length && <div style={emptyStyle}>No PM kits yet. Create the first one above.</div>}
        </div>
      </section>
    </main>
  );
}

const pageStyle = { minHeight: "100vh", background: "#f3f5f7", color: "#182331", padding: "30px 34px 90px" } as const;
const headerStyle = { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-end", flexWrap: "wrap" as const };
const eyebrow = { margin: 0, color: "#f47b20", fontSize: 11, fontWeight: 900, letterSpacing: ".15em" } as const;
const subtitle = { margin: 0, color: "#667482", maxWidth: 820, lineHeight: 1.5 } as const;
const editorStyle = { marginTop: 18, background: "white", border: "1px solid #d6dde3", borderRadius: 13, padding: 18, boxShadow: "0 6px 22px #12202f0d" } as const;
const formGrid = { marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 } as const;
const labelStyle = { display: "grid", gap: 5, color: "#5b6873", fontSize: 9, fontWeight: 900, letterSpacing: ".05em" } as const;
const inputStyle = { minHeight: 38, boxSizing: "border-box" as const, border: "1px solid #cbd3da", borderRadius: 7, padding: "8px 10px", background: "white", color: "#182331", fontSize: 12 } as const;
const helperStyle = { display: "block", marginTop: 3, color: "#7a8792", fontSize: 11, lineHeight: 1.45 } as const;
const matchBox = { marginTop: 13, padding: "10px 12px", background: "#eef6ed", border: "1px solid #b9d2b3", borderRadius: 8 } as const;
const sectionHeading = { margin: "0 0 9px", fontSize: 18, color: "#0d1b2b" } as const;
const partRowStyle = { display: "grid", gridTemplateColumns: "minmax(180px,1fr) auto auto", gap: 10, alignItems: "center", padding: "9px 10px", border: "1px solid #e0e5e9", borderRadius: 8, background: "#fbfcfd" } as const;
const kitCard = { background: "white", border: "1px solid #d7dfe4", borderRadius: 11, padding: 15 } as const;
const criteriaText = { marginTop: 4, color: "#5d6975", fontSize: 12, lineHeight: 1.45 } as const;
const pmBadge = { display: "inline-flex", padding: "3px 7px", borderRadius: 999, background: "#fff0df", color: "#9a4d0b", fontSize: 10, fontWeight: 900 } as const;
const activeBadge = { height: 24, display: "inline-flex", alignItems: "center", padding: "0 8px", borderRadius: 999, background: "#e5f6eb", color: "#176440", fontSize: 10, fontWeight: 900 } as const;
const inactiveBadge = { ...activeBadge, background: "#edf0f2", color: "#68757e" } as const;
const partChip = { display: "inline-flex", padding: "4px 7px", borderRadius: 999, background: "#eef2f5", color: "#344654", fontSize: 11, fontWeight: 800 } as const;
const noticeStyle = { marginTop: 14, padding: "10px 12px", borderRadius: 8, background: "#fff8e6", border: "1px solid #f2c66d", color: "#6e5017" } as const;
const emptyStyle = { padding: 18, border: "1px dashed #cbd4dc", borderRadius: 9, color: "#7a8792", background: "#fafbfc" } as const;
const lightButton = { minHeight: 36, border: "1px solid #cbd3da", borderRadius: 7, padding: "0 11px", background: "white", color: "#263746", fontWeight: 800, cursor: "pointer" } as const;
const orangeButton = { ...lightButton, background: "#fff0df", borderColor: "#e69a52", color: "#8c4708" } as const;
const saveButton = { ...lightButton, background: "#0d1b2b", borderColor: "#0d1b2b", color: "white" } as const;
const removeButton = { ...lightButton, background: "#fff0ef", borderColor: "#e4aaa5", color: "#8b312a" } as const;
