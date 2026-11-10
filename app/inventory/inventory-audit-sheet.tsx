type AuditPart = {
  id: number;
  partNumber: string;
  description: string;
  quantityOnHand: number;
  physicalOnHand?: number;
  location: string;
  warehouseStocks?: {
    warehouseCode: string;
    warehouseName: string;
    quantityOnHand: number;
    physicalOnHand?: number;
    unitOfMeasure?: string;
  }[];
};

export type InventoryAuditSnapshot = {
  parts: AuditPart[];
  warehouseCode: string;
  warehouseName: string;
  updatedAt: string;
  query: string;
  stockFilter: string;
  sort: string;
};

type AuditRow = {
  partId: number;
  partNumber: string;
  description: string;
  unit: string;
  systemQuantity: number;
  location: string;
};

function auditGroups(snapshot: InventoryAuditSnapshot) {
  const groups = new Map<string, { code: string; name: string; rows: AuditRow[] }>();
  for (const part of snapshot.parts) {
    const stocks = part.warehouseStocks ?? [];
    const selected = stocks.filter((stock) => snapshot.warehouseCode === "ALL" || stock.warehouseCode === snapshot.warehouseCode);
    for (const stock of selected) {
      const group = groups.get(stock.warehouseCode) ?? { code: stock.warehouseCode, name: stock.warehouseName || stock.warehouseCode, rows: [] };
      group.rows.push({
        partId: part.id,
        partNumber: part.partNumber,
        description: part.description,
        unit: stock.unitOfMeasure || "—",
        systemQuantity: Number(stock.physicalOnHand ?? stock.quantityOnHand),
        location: "",
      });
      groups.set(group.code, group);
    }
    if (!stocks.length && snapshot.warehouseCode === "ALL") {
      const group = groups.get("") ?? { code: "", name: "No warehouse assigned", rows: [] };
      group.rows.push({ partId: part.id, partNumber: part.partNumber, description: part.description, unit: "—", systemQuantity: Number(part.physicalOnHand ?? part.quantityOnHand), location: part.location });
      groups.set("", group);
    }
  }
  return [...groups.values()].sort((a, b) => a.code === "" ? 1 : b.code === "" ? -1 : a.name.localeCompare(b.name));
}

export default function InventoryAuditSheet({ snapshot }: { snapshot: InventoryAuditSnapshot }) {
  const groups = auditGroups(snapshot);
  const timestamp = new Date(snapshot.updatedAt).toLocaleString("en-US", { timeZone: "America/Detroit", timeZoneName: "short" });
  const filtered = Boolean(snapshot.query) || snapshot.stockFilter !== "All parts";
  const totalRows = groups.reduce((sum, group) => sum + group.rows.length, 0);

  return <section className="inventory-audit-sheet" aria-label="Parts inventory audit sheet">
    <style>{auditCss}</style>
    {groups.map((group) => <section className="inventory-audit-warehouse" key={group.code}>
      <table>
        <colgroup>{[5, 15, 29, 6, 9, 10, 8, 18].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
        <thead>
          <tr><td colSpan={8} className="inventory-audit-heading">
            <div className="inventory-audit-title"><div><strong>NORTHERN LOGISTICS</strong><h1>Parts Inventory Audit</h1></div><div><h2>{group.name}</h2><span>{group.rows.length} count lines</span></div></div>
            <div className="inventory-audit-meta"><span><b>Inventory as of:</b> {timestamp}</span><span><b>Scope:</b> {snapshot.warehouseName} · {snapshot.parts.length} parts · {totalRows} count lines</span></div>
            <p className="inventory-audit-filters"><b>{filtered ? "FILTERED AUDIT" : "FULL ACTIVE INVENTORY"}</b> · {snapshot.stockFilter}{snapshot.query ? ` · Search: “${snapshot.query}”` : ""} · Sort: {snapshot.sort}</p>
            <div className="inventory-audit-counted"><span>Counted by: ___________________________________</span><span>Count date / time: ______________________________</span></div>
            <p className="inventory-audit-instructions">System qty is physical stock on hand, including reserved parts. Count in the listed unit. Difference = counted qty − system qty.</p>
            {!group.code && <p className="inventory-audit-instructions"><b>Warehouse assignment needed:</b> Confirm where these parts are stored before applying a physical count.</p>}
          </td></tr>
          <tr>{["Line", "Part #", "Description", "Unit", "System qty", "Counted qty", "Difference +/−", "Notes / shelf / bin"].map((label) => <th key={label} scope="col">{label}</th>)}</tr>
        </thead>
        <tbody>{group.rows.map((row, index) => <tr key={`${row.partId}:${index}`}>
          <td className="inventory-audit-number">{index + 1}</td>
          <td><b>{row.partNumber}</b></td>
          <td>{row.description}{row.location && <small>Location: {row.location}</small>}</td>
          <td className="inventory-audit-number">{row.unit}</td>
          <td className="inventory-audit-number">{Number.isFinite(row.systemQuantity) ? row.systemQuantity.toLocaleString("en-US", { maximumFractionDigits: 6 }) : "Check stock"}</td>
          <td></td><td></td><td></td>
        </tr>)}</tbody>
      </table>
      <p className="inventory-audit-footer">End of {group.name} · {group.rows.length} count lines. Enter reviewed corrections using Physical Count in Inventory.</p>
    </section>)}
  </section>;
}

const auditCss = `
.inventory-audit-sheet { display: none; }
@page inventory-audit { size: letter landscape; margin: .35in; }
@media print {
  body:has(.inventory-audit-sheet) { margin: 0 !important; padding: 0 !important; background: white !important; }
  body:has(.inventory-audit-sheet) .app-sidebar,
  body:has(.inventory-audit-sheet) .easy-nav,
  body:has(.inventory-audit-sheet) .tech-mobile-dock,
  body:has(.inventory-audit-sheet) .tech-mobile-more,
  body:has(.inventory-audit-sheet) .tech-active-work-ribbon { display: none !important; }
  body:has(.inventory-audit-sheet) .app-shell-content { margin: 0 !important; padding: 0 !important; overflow: visible !important; }
  .inventory-page:has(.inventory-audit-sheet) { margin: 0 !important; padding: 0 !important; min-height: 0 !important; background: white !important; }
  .inventory-page:has(.inventory-audit-sheet) > :not(.inventory-audit-sheet) { display: none !important; }
  .inventory-audit-sheet { display: block !important; page: inventory-audit; color: #111 !important; font: 10pt/1.25 Arial, Helvetica, sans-serif; }
  .inventory-audit-sheet * { box-sizing: border-box; }
  .inventory-audit-warehouse + .inventory-audit-warehouse { break-before: page; }
  .inventory-audit-sheet table { width: 100% !important; min-width: 0 !important; table-layout: fixed; border-collapse: collapse; }
  .inventory-audit-sheet thead { display: table-header-group; }
  .inventory-audit-sheet tr { break-inside: avoid; page-break-inside: avoid; }
  .inventory-audit-sheet th, .inventory-audit-sheet td { border: 1px solid #777; padding: 7px 6px; overflow-wrap: anywhere; vertical-align: middle; }
  .inventory-audit-sheet th { font-size: 9pt; text-align: left; white-space: normal; text-transform: none; letter-spacing: normal; background: #eee !important; color: #111 !important; }
  .inventory-audit-sheet tbody td { height: .38in; }
  .inventory-audit-sheet .inventory-audit-heading { border: 0; padding: 0 0 10px; }
  .inventory-audit-title { display: flex; justify-content: space-between; align-items: end; gap: 20px; }
  .inventory-audit-title strong { font-size: 9pt; letter-spacing: .08em; }
  .inventory-audit-title h1 { margin: 3px 0 8px; font-size: 19pt; line-height: 1.15; }
  .inventory-audit-title h2 { margin: 0 0 3px; font-size: 15pt; }
  .inventory-audit-title > div:last-child { text-align: right; }
  .inventory-audit-meta { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 5px 18px; font-size: 9pt; }
  .inventory-audit-filters { margin: 7px 0; font-size: 9pt; }
  .inventory-audit-counted { display: flex; justify-content: space-between; gap: 18px; margin: 13px 0 8px; }
  .inventory-audit-instructions { margin: 4px 0 0; font-size: 8pt; }
  .inventory-audit-sheet .inventory-audit-number { text-align: center; }
  .inventory-audit-sheet small { display: block; font-size: 8pt; margin-top: 4px; }
  .inventory-audit-footer { margin: 8px 0 0; font-size: 8pt; break-inside: avoid; }
}
`;
