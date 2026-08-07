from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


# --- Repair Board UI ---
page_path = Path('app/page.tsx')
text = page_path.read_text()

text = replace_once(text,
'''type Repair = {
  id: string;
  unit: string;
  issue: string;
  parts: string;
  status: string;
  driver: string;
  location: string;
  geotabDefectId?: string;
};
''',
'''type RepairPartUsage = {
  id: number;
  partId: number;
  partNumber: string;
  description: string;
  quantity: number;
  warehouseCode: string;
  warehouseName: string;
  removable: boolean;
};

type Repair = {
  id: string;
  unit: string;
  issue: string;
  parts: string;
  status: string;
  driver: string;
  location: string;
  geotabDefectId?: string;
  usedParts?: RepairPartUsage[];
};
''', 'repair usage type')

text = replace_once(text,
'''type PartSelection = {
  partId: string;
  warehouseCode: string;
  quantity: number;
};
''',
'''type PartSelection = {
  search: string;
  partId: string;
  warehouseCode: string;
  quantity: number;
};
''', 'part selection type')

text = replace_once(text,
'''const emptyPartSelection: PartSelection = { partId: "", warehouseCode: "", quantity: 1 };
''',
'''const emptyPartSelection: PartSelection = { search: "", partId: "", warehouseCode: "", quantity: 1 };
''', 'part selection default')

text = replace_once(text,
'''  const [partSelection, setPartSelection] = useState<PartSelection>(emptyPartSelection);
  const [partMessage, setPartMessage] = useState("");
''',
'''  const [partSelections, setPartSelections] = useState<PartSelection[]>([{ ...emptyPartSelection }]);
  const [partMessage, setPartMessage] = useState("");
  const [removingPartId, setRemovingPartId] = useState<number | null>(null);
''', 'part state')

old_reset = '    setPartSelection(emptyPartSelection);\n'
reset_count = text.count(old_reset)
if reset_count != 2:
    raise SystemExit(f'part selection resets: expected exactly two matches, found {reset_count}')
text = text.replace(old_reset, '    setPartSelections([{ ...emptyPartSelection }]);\n')

function_pattern = re.compile(
    r'  async function attachPartToRepair\(\) \{.*?  const q = query\.trim\(\)\.toLowerCase\(\);',
    re.DOTALL,
)
function_replacement = r'''  function updatePartSelection(index: number, patch: Partial<PartSelection>) {
    setPartSelections((current) => current.map((selection, selectionIndex) =>
      selectionIndex === index ? { ...selection, ...patch } : selection,
    ));
    setPartMessage("");
  }

  function addPartSelection() {
    setPartSelections((current) => [...current, { ...emptyPartSelection }]);
    setPartMessage("");
  }

  function removePartSelection(index: number) {
    setPartSelections((current) => {
      const next = current.filter((_, selectionIndex) => selectionIndex !== index);
      return next.length ? next : [{ ...emptyPartSelection }];
    });
    setPartMessage("");
  }

  function matchingInventoryParts(search: string) {
    const needle = search.trim().toLowerCase();
    const terms = needle.split(/\s+/).filter(Boolean);
    const candidates = inventory.parts.filter((part) => {
      if (part.quantityOnHand <= 0) return false;
      if (!terms.length) return true;
      const haystack = `${part.partNumber} ${part.description}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
    if (!terms.length) return candidates.slice(0, 30);

    const score = (part: InventoryPart) => {
      const partNumber = part.partNumber.toLowerCase();
      const description = part.description.toLowerCase();
      if (partNumber === needle) return 0;
      if (partNumber.startsWith(needle)) return 1;
      if (description.startsWith(needle)) return 2;
      if (partNumber.includes(needle)) return 3;
      return 4;
    };
    return [...candidates]
      .sort((left, right) => score(left) - score(right) || left.partNumber.localeCompare(right.partNumber))
      .slice(0, 80);
  }

  async function refreshRepairAndInventory(repairId: string) {
    const [repairResponse, inventoryResponse] = await Promise.all([
      fetch("/api/repairs", { cache: "no-store" }),
      fetch("/api/inventory", { cache: "no-store" }),
    ]);
    if (!repairResponse.ok) throw new Error("Parts changed, but the repair board could not refresh.");
    if (!inventoryResponse.ok) throw new Error("Parts changed, but inventory could not refresh.");

    const freshRepairs = (await repairResponse.json()) as DashboardData;
    const freshInventory = (await inventoryResponse.json()) as InventoryData;
    setData(freshRepairs);
    setInventory(freshInventory);

    const refreshedRepair = freshRepairs.repairs.find((item) => item.id === repairId);
    if (refreshedRepair) setEditingRepair(refreshedRepair);
  }

  async function attachPartsToRepair() {
    if (!editingRepair?.id) {
      setPartMessage("Save the repair before attaching inventory parts.");
      return;
    }

    const touchedSelections = partSelections.filter((selection) =>
      Boolean(selection.partId || selection.search.trim() || selection.warehouseCode),
    );
    if (!touchedSelections.length) {
      setPartMessage("Search for and choose at least one inventory part.");
      return;
    }

    const requestedByStock = new Map<string, number>();
    for (let index = 0; index < touchedSelections.length; index += 1) {
      const selection = touchedSelections[index];
      const part = inventory.parts.find((item) => String(item.id) === selection.partId);
      const quantity = Number(selection.quantity);
      if (!part) {
        setPartMessage(`Part ${index + 1}: choose a part from the search results.`);
        return;
      }
      if (!selection.warehouseCode) {
        setPartMessage(`Part ${index + 1}: choose a warehouse.`);
        return;
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setPartMessage(`Part ${index + 1}: enter a positive quantity.`);
        return;
      }
      const stock = part.warehouseStocks.find((item) => item.warehouseCode === selection.warehouseCode);
      if (!stock || stock.quantityOnHand <= 0) {
        setPartMessage(`Part ${index + 1}: ${part.partNumber} has no available stock in that warehouse.`);
        return;
      }
      const stockKey = `${part.id}|${selection.warehouseCode}`;
      requestedByStock.set(stockKey, (requestedByStock.get(stockKey) ?? 0) + quantity);
    }

    for (const [stockKey, requestedQuantity] of requestedByStock) {
      const [partIdText, warehouseCode] = stockKey.split("|");
      const part = inventory.parts.find((item) => item.id === Number(partIdText));
      const stock = part?.warehouseStocks.find((item) => item.warehouseCode === warehouseCode);
      if (!part || !stock || requestedQuantity > stock.quantityOnHand) {
        setPartMessage(`${part?.partNumber || "Part"}: requested ${requestedQuantity}, but only ${stock?.quantityOnHand ?? 0} is available in ${warehouseCode}.`);
        return;
      }
    }

    setAttachingPart(true);
    setPartMessage("");
    let attachedCount = 0;
    let attachError = "";

    try {
      for (const selection of touchedSelections) {
        const response = await fetch("/api/work-orders", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "usePart",
            repairId: editingRepair.id,
            partId: Number(selection.partId),
            quantity: Number(selection.quantity),
            warehouseCode: selection.warehouseCode,
          }),
        });
        const result = (await response.json()) as { ok?: boolean; error?: string };
        if (!response.ok || !result.ok) {
          attachError = result.error || `Part ${attachedCount + 1} could not be attached.`;
          break;
        }
        attachedCount += 1;
      }

      await refreshRepairAndInventory(editingRepair.id);

      if (attachError) {
        const remaining = touchedSelections.slice(attachedCount);
        setPartSelections(remaining.length ? remaining : [{ ...emptyPartSelection }]);
        setPartMessage(attachedCount
          ? `Attached ${attachedCount} part line${attachedCount === 1 ? "" : "s"}, then stopped: ${attachError}`
          : attachError);
        return;
      }

      setPartSelections([{ ...emptyPartSelection }]);
      setPartMessage(`Attached ${attachedCount} part line${attachedCount === 1 ? "" : "s"} to this repair.`);
    } catch (error) {
      setPartMessage(error instanceof Error ? error.message : "The parts could not be attached.");
    } finally {
      setAttachingPart(false);
    }
  }

  async function removeAttachedPart(usage: RepairPartUsage) {
    if (!editingRepair?.id || !usage.removable) return;
    setRemovingPartId(usage.id);
    setPartMessage("");
    try {
      const response = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "removePart", repairId: editingRepair.id, usageId: usage.id }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "The attached part could not be removed.");
      await refreshRepairAndInventory(editingRepair.id);
      setPartMessage(`Removed ${usage.partNumber} x${usage.quantity} and returned it to ${usage.warehouseName}.`);
    } catch (error) {
      setPartMessage(error instanceof Error ? error.message : "The attached part could not be removed.");
    } finally {
      setRemovingPartId(null);
    }
  }

  const q = query.trim().toLowerCase();'''
text, count = function_pattern.subn(lambda _: function_replacement, text, count=1)
if count != 1:
    raise SystemExit(f'attach function block: expected exactly one match, found {count}')

jsx_pattern = re.compile(
    r'              \{editingRepair\.id \? \(.*?              \)\}\n              <label>\n                Assigned mechanic / driver',
    re.DOTALL,
)
jsx_replacement = r'''              {editingRepair.id ? (
                <div className="wide" style={{ display: "grid", gap: 12, padding: 12, border: "1px solid #dce2e7", borderRadius: 10, background: "#f7f9fa" }}>
                  {(editingRepair.usedParts ?? []).length > 0 && (
                    <div style={{ display: "grid", gap: 6 }}>
                      <strong>Attached parts</strong>
                      {(editingRepair.usedParts ?? []).map((usage) => (
                        <div key={usage.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "8px 10px", border: "1px solid #e5e9ec", borderRadius: 8, background: "white", flexWrap: "wrap" }}>
                          <div>
                            <strong>{usage.partNumber}</strong> — {usage.description} · x{usage.quantity}
                            <div style={{ fontSize: 12, color: "#6b747c", marginTop: 2 }}>
                              {usage.warehouseName || "Original warehouse not recorded"}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="secondary-card-action"
                            disabled={!usage.removable || removingPartId === usage.id || attachingPart}
                            title={usage.removable ? "Return this quantity to its source warehouse" : "Legacy attachment: source warehouse was not recorded"}
                            onClick={() => void removeAttachedPart(usage)}
                          >
                            {removingPartId === usage.id ? "Removing…" : usage.removable ? "Remove / return" : "Legacy part"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <div>
                      <strong>Attach inventory parts</strong>
                      <div style={{ fontSize: 13, color: "#5c6670", marginTop: 2 }}>Search by part number or description, then choose warehouse and quantity.</div>
                    </div>
                    <button type="button" className="secondary-card-action" onClick={addPartSelection} disabled={attachingPart}>
                      + Add another part
                    </button>
                  </div>

                  {partSelections.map((selection, index) => {
                    const matches = matchingInventoryParts(selection.search);
                    const selectedPart = inventory.parts.find((item) => String(item.id) === selection.partId);
                    const warehouseStocks = (selectedPart?.warehouseStocks ?? []).filter((stock) => stock.quantityOnHand > 0);
                    const selectedStock = warehouseStocks.find((stock) => stock.warehouseCode === selection.warehouseCode);
                    return (
                      <div key={index} style={{ display: "grid", gap: 8, padding: 10, border: "1px solid #e5e9ec", borderRadius: 8, background: "white" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                          <strong style={{ fontSize: 13 }}>Part {index + 1}</strong>
                          {partSelections.length > 1 && (
                            <button type="button" className="secondary-card-action" onClick={() => removePartSelection(index)} disabled={attachingPart}>
                              Remove row
                            </button>
                          )}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, alignItems: "end" }}>
                          <label>
                            Search parts
                            <input
                              aria-label={`Search inventory part ${index + 1}`}
                              value={selection.search}
                              placeholder="Part # or description"
                              onChange={(event) => updatePartSelection(index, { search: event.target.value, partId: "", warehouseCode: "" })}
                            />
                            <span style={{ fontSize: 12, color: "#6b747c" }}>
                              {selection.search.trim() ? `${matches.length} best matches` : "Start typing to narrow 2,000+ parts"}
                            </span>
                          </label>
                          <label>
                            Matching part
                            <select aria-label={`Inventory part ${index + 1}`} value={selection.partId} onChange={(event) => updatePartSelection(index, { partId: event.target.value, warehouseCode: "" })}>
                              <option value="">Choose part</option>
                              {matches.map((inventoryPart) => (
                                <option key={inventoryPart.id} value={inventoryPart.id}>
                                  {inventoryPart.partNumber} — {inventoryPart.description} ({inventoryPart.quantityOnHand} total)
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Warehouse
                            <select aria-label={`Inventory warehouse ${index + 1}`} value={selection.warehouseCode} disabled={!selectedPart} onChange={(event) => updatePartSelection(index, { warehouseCode: event.target.value })}>
                              <option value="">Choose warehouse</option>
                              {warehouseStocks.map((stock) => (
                                <option key={stock.warehouseCode} value={stock.warehouseCode}>
                                  {stock.warehouseName} ({stock.quantityOnHand}{stock.unitOfMeasure ? ` ${stock.unitOfMeasure}` : ""})
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Qty
                            <input aria-label={`Part quantity ${index + 1}`} type="number" min="0.01" step="any" max={selectedStock?.quantityOnHand} value={selection.quantity} onChange={(event) => updatePartSelection(index, { quantity: Number(event.target.value) })} />
                          </label>
                        </div>
                      </div>
                    );
                  })}

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="secondary-card-action" onClick={addPartSelection} disabled={attachingPart}>+ Add another part</button>
                    <button type="button" className="primary-action" disabled={attachingPart || !partSelections.some((selection) => selection.partId)} onClick={() => void attachPartsToRepair()}>
                      {attachingPart ? "Attaching parts…" : "Attach all parts"}
                    </button>
                  </div>
                  {partMessage && <span style={{ fontSize: 13, color: "#5c6670" }}>{partMessage}</span>}
                </div>
              ) : (
                <div className="wide" style={{ padding: 12, border: "1px solid #dce2e7", borderRadius: 10, background: "#f7f9fa", color: "#5c6670" }}>
                  Save this repair first; the editor will stay open so you can attach inventory parts immediately afterward.
                </div>
              )}
              <label>
                Assigned mechanic / driver'''
text, count = jsx_pattern.subn(lambda _: jsx_replacement, text, count=1)
if count != 1:
    raise SystemExit(f'multi-part picker JSX: expected exactly one match, found {count}')

if 'setPartSelection(' in text or 'partSelection.' in text:
    raise SystemExit('single-part state references remain after UI patch')
page_path.write_text(text)


# --- Dashboard data: expose concrete attached-part rows ---
dash_path = Path('lib/dashboard-db.ts')
dash = dash_path.read_text()
dash = replace_once(dash,
'''type EquipmentRow = {
  unit: string;
  service_date: string | null;
  annual_date: string | null;
  notes: string | null;
  equipment_type: string;
};
''',
'''type EquipmentRow = {
  unit: string;
  service_date: string | null;
  annual_date: string | null;
  notes: string | null;
  equipment_type: string;
};

type RepairPartUsageRow = {
  id: number;
  repair_id: number;
  part_id: number;
  part_number: string;
  description: string;
  quantity: number;
  warehouse_stock_id: number | null;
  warehouse_code: string | null;
  warehouse_name: string | null;
};
''', 'dashboard repair usage row type')

dash = replace_once(dash,
'''  const [repairsResult, dvirResult, pmResult, equipmentResult] = await Promise.all([
''',
'''  const [repairsResult, dvirResult, pmResult, equipmentResult, repairPartsResult] = await Promise.all([
''', 'dashboard promise destructuring')

dash = replace_once(dash,
'''    db.prepare(`
      SELECT unit, service_date, annual_date, notes, equipment_type
      FROM equipment
      WHERE active = 1
      ORDER BY unit
    `).all<EquipmentRow>(),
  ]);

  return {
''',
'''    db.prepare(`
      SELECT unit, service_date, annual_date, notes, equipment_type
      FROM equipment
      WHERE active = 1
      ORDER BY unit
    `).all<EquipmentRow>(),
    db.prepare(`
      SELECT rp.id, rp.repair_id, rp.part_id, p.part_number, p.description, rp.quantity,
             rp.warehouse_stock_id, w.code AS warehouse_code, w.name AS warehouse_name
      FROM repair_parts rp
      JOIN parts p ON p.id = rp.part_id
      LEFT JOIN part_warehouse_stock s ON s.id = rp.warehouse_stock_id
      LEFT JOIN warehouses w ON w.id = s.warehouse_id
      ORDER BY rp.created_at, rp.id
    `).all<RepairPartUsageRow>(),
  ]);

  const repairPartsByRepair = new Map<number, RepairPartUsageRow[]>();
  for (const usage of repairPartsResult.results) {
    const list = repairPartsByRepair.get(usage.repair_id) ?? [];
    list.push(usage);
    repairPartsByRepair.set(usage.repair_id, list);
  }

  return {
''', 'dashboard repair parts query')

dash = replace_once(dash,
'''      relatedGeotabDefectId: row.geotab_defect_id ?? '',
    })),
''',
'''      relatedGeotabDefectId: row.geotab_defect_id ?? '',
      usedParts: (repairPartsByRepair.get(row.id) ?? []).map((usage) => ({
        id: usage.id,
        partId: usage.part_id,
        partNumber: usage.part_number,
        description: usage.description,
        quantity: Number(usage.quantity),
        warehouseCode: usage.warehouse_code ?? '',
        warehouseName: usage.warehouse_name ?? '',
        removable: usage.warehouse_stock_id != null,
      })),
    })),
''', 'dashboard used parts mapping')
dash_path.write_text(dash)


# --- Inventory transactions: remember source stock and support reversal ---
inv_path = Path('lib/inventory-db.ts')
inv = inv_path.read_text()
inv = replace_once(inv,
'''    db.prepare('INSERT INTO repair_parts (repair_id, part_id, quantity, unit_cost) VALUES (?, ?, ?, ?)')
      .bind(repairId, partId, quantity, stock.unit_cost ?? part.unit_cost),
''',
'''    db.prepare('INSERT INTO repair_parts (repair_id, part_id, quantity, unit_cost, warehouse_stock_id) VALUES (?, ?, ?, ?, ?)')
      .bind(repairId, partId, quantity, stock.unit_cost ?? part.unit_cost, stock.id),
''', 'record source warehouse stock')

inv += r'''

export async function removePartFromRepair(db: D1Database, body: Record<string, unknown>) {
  const usageId = finiteNumber(body.usageId, 0);
  if (!usageId) throw new Error('Attached part row is required');

  const usage = await db.prepare(`
    SELECT id, repair_id, part_id, quantity, warehouse_stock_id
    FROM repair_parts
    WHERE id = ?
  `).bind(usageId).first<{
    id: number;
    repair_id: number;
    part_id: number;
    quantity: number;
    warehouse_stock_id: number | null;
  }>();
  if (!usage) throw new Error('Attached part was not found');

  const requestedRepair = String(body.repairId ?? '').match(/^repair-(\d+)$/);
  if (requestedRepair && Number(requestedRepair[1]) !== usage.repair_id) throw new Error('Attached part does not belong to this repair');
  if (usage.warehouse_stock_id == null) {
    throw new Error('This older attachment does not record its source warehouse, so it cannot be safely returned automatically.');
  }

  await db.batch([
    db.prepare(`
      UPDATE part_warehouse_stock
      SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND part_id = ?
    `).bind(Number(usage.quantity), usage.warehouse_stock_id, usage.part_id),
    db.prepare('DELETE FROM repair_parts WHERE id = ?').bind(usage.id),
    db.prepare(`
      UPDATE parts
      SET quantity_on_hand = COALESCE((SELECT SUM(quantity_on_hand) FROM part_warehouse_stock WHERE part_id = ?), quantity_on_hand),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(usage.part_id, usage.part_id),
  ]);

  return { ok: true, usageId: usage.id, repairId: usage.repair_id, partId: usage.part_id };
}
'''
inv_path.write_text(inv)


# --- API: expose reversal and refresh parts summary ---
route_path = Path('app/api/work-orders/route.ts')
route = route_path.read_text()
route = replace_once(route,
'''import { usePartOnRepair } from '@/lib/inventory-db';
''',
'''import { removePartFromRepair, usePartOnRepair } from '@/lib/inventory-db';
''', 'work order inventory imports')
route = replace_once(route,
'''    if (String(body.action ?? '') === 'usePart') {
      const result = await usePartOnRepair(env.DB, body);
      const match = String(body.repairId ?? '').match(/^repair-(\d+)$/);
      if (match) await refreshRepairPartsText(Number(match[1]));
      return Response.json(result);
    }
''',
'''    if (String(body.action ?? '') === 'usePart') {
      const result = await usePartOnRepair(env.DB, body);
      const match = String(body.repairId ?? '').match(/^repair-(\d+)$/);
      if (match) await refreshRepairPartsText(Number(match[1]));
      return Response.json(result);
    }
    if (String(body.action ?? '') === 'removePart') {
      const result = await removePartFromRepair(env.DB, body);
      await refreshRepairPartsText(result.repairId);
      return Response.json(result);
    }
''', 'work order remove action')
route_path.write_text(route)
