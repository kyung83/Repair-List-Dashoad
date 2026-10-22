"use client";

import { useState } from "react";

type Catalog = "excelerator" | "fleetrite";
const CATALOGS: Record<Catalog, { name: string; url: string; brand: string }> = {
  excelerator: { name: "Freightliner Excelerator / PartsProX", url: "https://exceleratorparts.com/", brand: "Freightliner" },
  fleetrite: { name: "International Fleetrite", url: "https://www.fleetrite.com/", brand: "International" },
};

export default function OemCatalogEmbedTest() {
  const [catalog, setCatalog] = useState<Catalog>("excelerator");
  const [vin, setVin] = useState("");
  const [show, setShow] = useState(false);
  const selected = CATALOGS[catalog];
  return (
    <main style={{ maxWidth: 1200, margin: "30px auto", padding: 20, fontFamily: "Arial, sans-serif" }}>
      <p style={{ color: "#526378" }}>ADMIN / EXPERIMENT / LOOKUP ONLY</p>
      <h1>OEM Parts Catalog — Embedding Test</h1>
      <p>This isolated experiment does not save credentials, place orders, modify inventory, or change existing parts workflows. Only administrators can access this page.</p>
      <p><strong>Important:</strong> Your dealer's browser policy may prevent its login or diagrams from loading inside another website. A blocked frame is an expected test result, not something to bypass.</p>
      <label htmlFor="catalog">Catalog</label>{" "}
      <select id="catalog" value={catalog} onChange={(e) => {setCatalog(e.target.value as Catalog); setShow(false);}}>
        <option value="excelerator">Freightliner Excelerator / PartsProX</option>
        <option value="fleetrite">International Fleetrite</option>
      </select>
      <div style={{ marginTop: 16 }}>
        <label htmlFor="vin">VIN for manual catalog lookup (optional)</label><br />
        <input id="vin" value={vin} maxLength={17} onChange={(e) => setVin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="Enter VIN" style={{ padding: 10, width: 260, marginTop: 8 }}/>
        <button type="button" onClick={() => navigator.clipboard?.writeText(vin)} disabled={!vin} style={{ marginLeft: 8, padding: 10 }}>Copy VIN</button>
        <p style={{ color: "#526378", fontSize: 13 }}>VIN is not sent automatically. We must verify vendor-approved VIN deep linking separately.</p>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
        <button type="button" onClick={() => setShow(true)} style={{ padding: 12, background: "#123c67", color: "white", border: 0, borderRadius: 6 }}>Test embedded {selected.brand} catalog</button>
        <button type="button" onClick={() => setShow(false)} style={{ padding: 12 }}>Close embedded view</button>
        <a href={selected.url} target="_blank" rel="noopener noreferrer" style={{ padding: 12 }}>Open official catalog separately</a>
      </div>
      <div style={{ border: "1px solid #bdc7d2", borderRadius: 8, marginTop: 20, minHeight: 500, overflow: "hidden" }}>
        {show ? <iframe key={catalog} title={selected.name} src={selected.url} referrerPolicy="no-referrer" style={{ width: "100%", minHeight: 720, border: 0 }} /> :
          <div style={{ padding: 24 }}>Select a manufacturer and choose <strong>Test embedded catalog</strong>. If it stays blank or reports refusal to connect, embedding is restricted by the provider.</div>}
      </div>
      <p style={{ background: "#fff5da", padding: 12 }}>Dealer ordering is NOT integrated or enabled in this test. The existing Parts Desk internal on-order quantity feature is unchanged.</p>
    </main>
  );
}
