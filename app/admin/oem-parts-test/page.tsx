"use client";

import { useEffect, useMemo, useState } from "react";

type Unit = { id: number; unit: string; vin: string; make: string; model: string; modelYear: number | null; equipmentType: string };

type Catalog = "excelerator" | "fleetrite";
const CATALOGS: Record<Catalog, { name: string; url: string; brand: string }> = {
  excelerator: { name: "Freightliner Excelerator / PartsProX", url: "https://excelerator.com/truck-parts/en", brand: "Freightliner" },
  fleetrite: { name: "International Navistar Parts Catalog", url: "https://oecnpc.navistar.com/npc/myportal/", brand: "International" },
};

export default function OemCatalogEmbedTest() {
  const [catalog, setCatalog] = useState<Catalog>("excelerator");
  const [vin, setVin] = useState("");
  const [show, setShow] = useState(false);
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitQuery, setUnitQuery] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void fetch("/api/equipment", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Equipment list unavailable.");
      return response.json() as Promise<{ equipment?: Unit[] }>;
    }).then(result => { if (active) setUnits((result.equipment ?? []).filter(x => x.unit && /freightliner|international/i.test(x.make ?? ""))); })
    .catch(() => { if (active) setError("Could not load truck records. Manual VIN entry still works."); });
    return () => { active = false; };
  }, []);
  const matchingUnits = useMemo(() => units.filter(x => `${x.unit} ${x.vin} ${x.make}`.toLowerCase().includes(unitQuery.toLowerCase())).slice(0, 30), [units, unitQuery]);
  function chooseUnit(id: string) {
    const unit = units.find(x => String(x.id) === id);
    if (!unit) return;
    setVin(unit.vin ?? "");
    setUnitQuery(unit.unit);
    setCatalog(/international/i.test(unit.make) ? "fleetrite" : "excelerator");
    setShow(false);
  }
  const selected = CATALOGS[catalog];
  const normalizedVin = vin.trim().toUpperCase();
  const validVin = /^[A-HJ-NPR-Z0-9]{17}$/.test(normalizedVin);
  const internationalSearch = normalizedVin.length >= 8 ? normalizedVin.slice(-8) : "";
  const lookupText = catalog === "fleetrite" ? internationalSearch : normalizedVin;
  const catalogUrl = catalog === "excelerator" && validVin
    ? `https://excelerator.com/truck-parts/en/vin/${encodeURIComponent(normalizedVin)}`
    : selected.url;
  return (
    <main style={{ maxWidth: 1200, margin: "30px auto", padding: 20, fontFamily: "Arial, sans-serif" }}>
      <p style={{ color: "#526378" }}>ADMIN / EXPERIMENT / LOOKUP ONLY</p>
      <h1>OEM Parts Catalog — Embedding Test</h1>
      <p>This isolated experiment does not save credentials, place dealer orders, modify inventory, or change existing parts workflows. Only administrators can access this page.</p>
      <p><strong>Important:</strong> Your dealer's browser policy may prevent its login or diagrams from loading inside another website. A blocked frame is an expected test result, not something to bypass.</p>
      <div style={{ marginBottom: 18 }}><label htmlFor="unit-search">Find fleet truck (optional)</label><br/><input id="unit-search" list="oem-units" value={unitQuery} onChange={e => setUnitQuery(e.target.value)} placeholder="Unit number or VIN" style={{ padding: 10, width: 260, marginTop: 8 }} /><select aria-label="Select matching truck" value="" onChange={e => chooseUnit(e.target.value)} style={{ marginLeft: 8, padding: 10 }}><option value="">Select matching truck...</option>{matchingUnits.map(x => <option key={x.id} value={String(x.id)}>{x.unit} · {x.make} {x.model} · {x.vin || "No VIN"}</option>)}</select>{error && <p role="status">{error}</p>}</div><label htmlFor="catalog">Catalog</label>{" "}
      <select id="catalog" value={catalog} onChange={(e) => {setCatalog(e.target.value as Catalog); setShow(false);}}>
        <option value="excelerator">Freightliner Excelerator / PartsProX</option>
        <option value="fleetrite">International Navistar Parts Catalog</option>
      </select>
      <div style={{ marginTop: 16 }}>
        <label htmlFor="vin">VIN for manual catalog lookup (optional)</label><br />
        <input id="vin" value={vin} maxLength={17} onChange={(e) => setVin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="Enter VIN" style={{ padding: 10, width: 260, marginTop: 8 }}/>
        <button type="button" onClick={() => { if (lookupText) void navigator.clipboard.writeText(lookupText); }} disabled={!lookupText} style={{ marginLeft: 8, padding: 10 }}>{catalog === "fleetrite" ? "Copy Last 8" : "Copy VIN"}</button>
        <p style={{ color: "#526378", fontSize: 13 }}>{catalog === "fleetrite" ? "International Navistar search requires the LAST 8 VIN characters. Copy the value below, then paste into the Navistar search field after sign-in. Automatic search is not supported yet." : "For Freightliner, a valid 17-character VIN uses the PartsProX address pattern supplied from your dealer session."}</p>{catalog === "fleetrite" && <p aria-label="International VIN lookup value" style={{ fontFamily: "monospace", fontSize: 21, fontWeight: 700 }}>{internationalSearch || "Select a unit with a VIN"}</p>}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
        <button type="button" onClick={() => setShow(true)} style={{ padding: 12, background: "#123c67", color: "white", border: 0, borderRadius: 6 }}>Test embedded {selected.brand} catalog</button>
        <button type="button" onClick={() => setShow(false)} style={{ padding: 12 }}>Close embedded view</button>
        <a href={catalogUrl} target="_blank" rel="noopener noreferrer" style={{ padding: 12 }}>Open official catalog separately</a>
      </div>
      <div style={{ border: "1px solid #bdc7d2", borderRadius: 8, marginTop: 20, minHeight: 500, overflow: "hidden" }}>
        {show ? <iframe key={`${catalog}-${catalogUrl}`} title={selected.name} src={catalogUrl} referrerPolicy="no-referrer" style={{ width: "100%", minHeight: 720, border: 0 }} /> :
          <div style={{ padding: 24 }}>Select a manufacturer and choose <strong>Test embedded catalog</strong>. For Freightliner, selecting a unit with a valid VIN will attempt the matching PartsProX catalog page. If it stays blank or reports refusal to connect, embedding is restricted by the provider.</div>}
      </div>
      <p style={{ background: "#fff5da", padding: 12 }}>Dealer ordering is NOT integrated or enabled in this test. The existing Parts Desk internal on-order quantity feature is unchanged.</p>
    </main>
  );
}
