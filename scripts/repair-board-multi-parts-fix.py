from pathlib import Path
import re

path = Path('app/page.tsx')
text = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    text = text.replace(old, new, 1)


replace_once(
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
''',
'part selection type',
)

replace_once(
'''const emptyPartSelection: PartSelection = { partId: "", warehouseCode: "", quantity: 1 };
''',
'''const emptyPartSelection: PartSelection = { search: "", partId: "", warehouseCode: "", quantity: 1 };
''',
'part selection default',
)

replace_once(
'''  const [partSelection, setPartSelection] = useState<PartSelection>(emptyPartSelection);
''',
'''  const [partSelections, setPartSelections] = useState<PartSelection[]>([{ ...emptyPartSelection }]);
''',
'part selection state',
)

replace_once(
'''    setPartSelection(emptyPartSelection);
''',
'''    setPartSelections([{ ...emptyPartSelection }]);
''',
'part selection reset',
)

function_pattern = re.compile(
    r'  async function attachPartToRepair\(\) \{.*?  const q = query\.trim\(\)\.toLowerCase\(\);',
    re.DOTALL,
)
function_replacement = '''  function updatePartSelection(index: number, patch: Partial<PartSelection>) {
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
    const terms = needle.split(/\\s+/).filter(Boolean);
    const candidates = inventory.parts.filter((part) => {
      if (part.quantityOnHand <= 0) return false;
      if (!terms.length) return true;
      const haystack = `${part.partNumber} ${part.description}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
    if (!terms.length) return candidates.slice(0, 40);

    const score = (part: InventoryPart) => {
      const partNumber = part.partNumber.toLowerCase();
      const description = part.description.toLowerCase();
      if (partNumber === needle) return 0;
      if (partNumber.startsWith(needle)) return 1;
      if (description.startsWith(needle)) return 2;
      if (partNumber.includes(needle)) return 3;
      return 4;
    };
    return candidates
      .sort((left, right) => score(left) - score(right) || left.partNumber.localeCompare(right.partNumber))
      .slice(0, 80);
  }

  async function refreshRepairAndInventory(repairId: string) {
    const [repairResponse, inventoryResponse] = await Promise.all([
      fetch("/api/repairs", { cache: "no-store" }),
      fetch("/api/inventory", { cache: "no-store" }),
    ]);
    if (!repairResponse.ok) throw new Error("Parts were attached, but the repair board could not refresh.");
    if (!inventoryResponse.ok) throw new Error("Parts were attached, but inventory could not refresh.");

    const freshRepairs = (await repairResponse.json()) as DashboardData;
    const freshInventory = (await inventoryResponse.json()) as InventoryData;
    setData(freshRepairs);
    setInventory(freshInventory);

    const refreshedRepair = freshRepairs.repairs.find((item) => item.id === repairId);
    if (refreshedRepair) {
      setEditingRepair((current) => current && current.id === refreshedRepair.id
        ? { ...current, parts: refreshedRepair.parts }
        : current);
    }
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

  const q = query.trim().toLowerCase();'''
text, count = function_pattern.subn(function_replacement, text, count=1)
if count != 1:
    raise SystemExit(f'attach function block: expected exactly one match, found {count}')

jsx_pattern = re.compile(
    r'              \{editingRepair\.id \? \(.*?              \)\}\n              <label>\n                Assigned mechanic / driver',
    re.DOTALL,
)
jsx_replacement = '''              {editingRepair.id ? (
                <div className="wide" style={{ display: "grid", gap: 12, padding: 12, border: "1px solid #dce2e7", borderRadius: 10, background: "#f7f9fa" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <div>
                      <strong>Attach inventory parts</strong>
                      <div style={{ fontSize: 13, color: "#5c6670", marginTop: 2 }}>Search by part number or description, then choose the warehouse and quantity.</div>
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
                              Remove
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
                              onChange={(event) => updatePartSelection(index, {
                                search: event.target.value,
                                partId: "",
                                warehouseCode: "",
                              })}
                            />
                            <span style={{ fontSize: 12, color: "#6b747c" }}>
                              {selection.search.trim() ? `Showing up to ${matches.length} matches` : "Type to narrow the inventory list"}
                            </span>
                          </label>
                          <label>
                            Part
                            <select
                              aria-label={`Inventory part ${index + 1}`}
                              value={selection.partId}
                              onChange={(event) => updatePartSelection(index, { partId: event.target.value, warehouseCode: "" })}
                            >
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
                            <select
                              aria-label={`Inventory warehouse ${index + 1}`}
                              value={selection.warehouseCode}
                              disabled={!selectedPart}
                              onChange={(event) => updatePartSelection(index, { warehouseCode: event.target.value })}
                            >
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
                            <input
                              aria-label={`Part quantity ${index + 1}`}
                              type="number"
                              min="0.01"
                              step="any"
                              max={selectedStock?.quantityOnHand}
                              value={selection.quantity}
                              onChange={(event) => updatePartSelection(index, { quantity: Number(event.target.value) })}
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="secondary-card-action" onClick={addPartSelection} disabled={attachingPart}>
                      + Add another part
                    </button>
                    <button
                      type="button"
                      className="primary-action"
                      disabled={attachingPart || !partSelections.some((selection) => selection.partId)}
                      onClick={() => void attachPartsToRepair()}
                    >
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
text, count = jsx_pattern.subn(jsx_replacement, text, count=1)
if count != 1:
    raise SystemExit(f'multi-part picker JSX: expected exactly one match, found {count}')

if 'setPartSelection(' in text or 'partSelection.' in text:
    raise SystemExit('single-part state references remain after patch')

path.write_text(text)
