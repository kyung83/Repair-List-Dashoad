"use client";

import { useEffect, useMemo, useState } from "react";

type RepairPartUsage = {
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

type Dvir = {
  id: string;
  asset: string;
  driver: string;
  defect: string;
  comments: string;
  photos: string;
  repaired: boolean;
  logId: string;
  defectId: string;
};

type Pm = {
  unit: string;
  pmType: string;
  status: string;
  driver: string;
  location: string;
};

type Equipment = {
  unit: string;
  serviceDate: string;
  annualDate: string;
  notes: string;
  type: "Truck" | "Trailer";
};

type DashboardData = {
  repairs: Repair[];
  dvir: Dvir[];
  pm: Pm[];
  equipment: Equipment[];
  updatedAt: string;
  preview?: boolean;
};

type PmTruckRow = Pm & {
  annualDate: string;
  hasPmRecord: boolean;
};

type EquipmentGroup = "Truck" | "Trailer" | "Unclassified";

type BoardItem =
  | {
      key: string;
      kind: "repair";
      unit: string;
      equipmentType: EquipmentGroup;
      searchText: string;
      repair: Repair;
    }
  | {
      key: string;
      kind: "dvir";
      unit: string;
      equipmentType: EquipmentGroup;
      searchText: string;
      defect: Dvir;
    };

type RepairContext = {
  label: string;
  detail?: string;
};

type InventoryWarehouseStock = {
  warehouseCode: string;
  warehouseName: string;
  quantityOnHand: number;
  unitOfMeasure: string;
};

type InventoryPart = {
  id: number;
  partNumber: string;
  description: string;
  quantityOnHand: number;
  warehouseStocks: InventoryWarehouseStock[];
};

type InventoryData = {
  parts: InventoryPart[];
};

type PartSelection = {
  search: string;
  partId: string;
  warehouseCode: string;
  quantity: number;
};

const previewData: DashboardData = {
  preview: true,
  updatedAt: new Date().toISOString(),
  repairs: [],
  dvir: [],
  pm: [],
  equipment: [],
};

const tabs = ["Repairs", "DVIR Defects", "PM Status", "Equipment"] as const;
type Tab = (typeof tabs)[number];

const emptyRepair: Repair = {
  id: "",
  unit: "",
  issue: "",
  parts: "",
  status: "New",
  driver: "",
  location: "",
};

const emptyInventory: InventoryData = { parts: [] };
const emptyPartSelection: PartSelection = { search: "", partId: "", warehouseCode: "", quantity: 1 };

function statusClass(status: string) {
  const s = status.toLowerCase();
  if (s.includes("overdue") || s.includes("oos") || s.includes("needs repair")) return "danger";
  if (s.includes("waiting") || s.includes("ordered") || s.includes("due in")) return "warning";
  if (s.includes("complete") || s.includes("repaired")) return "success";
  return "neutral";
}

function unitKey(unit: string) {
  return unit.trim().toLowerCase();
}

function repairIsComplete(status: string) {
  return status.toLowerCase().includes("complete");
}

function BoardWorkCard({
  item,
  onEditRepair,
  onCompleteRepair,
  onMarkDvirRepaired,
  onAddRelatedRepair,
}: {
  item: BoardItem;
  onEditRepair: (repair: Repair) => void;
  onCompleteRepair: (repair: Repair) => void;
  onMarkDvirRepaired: (defect: Dvir) => void;
  onAddRelatedRepair: (defect: Dvir) => void;
}) {
  if (item.kind === "dvir") {
    const defect = item.defect;
    return (
      <article className="work-card dvir-work-card">
        <div className="work-card-head">
          <div>
            <span className="unit-label">Unit {defect.asset}</span>
            <span className="source-badge dvir-source">DVIR</span>
          </div>
          <span className="pill danger">Needs repair</span>
        </div>
        <h3>{defect.defect}</h3>
        <p className="work-card-description">{defect.comments || "No driver comments"}</p>
        <div className="work-card-meta">
          <span>Driver: {defect.driver || "Unknown"}</span>
          {defect.photos && defect.photos !== "None" ? (
            <a href={defect.photos} target="_blank" rel="noreferrer">
              View photos
            </a>
          ) : (
            <span>No photos</span>
          )}
        </div>
        <div className="work-card-actions">
          <button type="button" className="secondary-card-action" onClick={() => onAddRelatedRepair(defect)}>
            + Add another repair
          </button>
          <button type="button" className="complete-card-action" onClick={() => onMarkDvirRepaired(defect)}>
            Mark repaired
          </button>
        </div>
      </article>
    );
  }

  const repair = item.repair;
  return (
    <article className="work-card repair-work-card">
      <div className="work-card-head">
        <div>
          <span className="unit-label">Unit {repair.unit}</span>
          <span className="source-badge repair-source">Repair list</span>
        </div>
        <span className={`pill ${statusClass(repair.status)}`}>{repair.status || "Open"}</span>
      </div>
      <h3>{repair.issue}</h3>
      {repair.parts && (
        <p className="parts-line">
          <strong>Parts:</strong> {repair.parts}
        </p>
      )}
      <div className="work-card-meta">
        <span>{repair.driver ? `Assigned: ${repair.driver}` : "Unassigned"}</span>
        <span>{repair.location || "No location"}</span>
      </div>
      <div className="work-card-actions">
        <button type="button" className="secondary-card-action" onClick={() => onEditRepair(repair)}>
          Edit
        </button>
        {!repairIsComplete(repair.status) && (
          <button type="button" className="complete-card-action" onClick={() => onCompleteRepair(repair)}>
            Complete
          </button>
        )}
      </div>
    </article>
  );
}

function RepairBoardColumn({
  title,
  equipmentType,
  items,
  onAddRepair,
  onEditRepair,
  onCompleteRepair,
  onMarkDvirRepaired,
  onAddRelatedRepair,
}: {
  title: string;
  equipmentType: "Truck" | "Trailer";
  items: BoardItem[];
  onAddRepair: () => void;
  onEditRepair: (repair: Repair) => void;
  onCompleteRepair: (repair: Repair) => void;
  onMarkDvirRepaired: (defect: Dvir) => void;
  onAddRelatedRepair: (defect: Dvir) => void;
}) {
  const repairCount = items.filter((item) => item.kind === "repair").length;
  const dvirCount = items.filter((item) => item.kind === "dvir").length;

  return (
    <section className={`repair-board-column ${equipmentType.toLowerCase()}-column`}>
      <header className="repair-board-column-head">
        <div>
          <p className="eyebrow">{equipmentType.toUpperCase()} WORK QUEUE</p>
          <h3>
            {title} <span>{items.length}</span>
          </h3>
          <small>
            {repairCount} repair list · {dvirCount} DVIR
          </small>
        </div>
        <button type="button" className="column-add-button" onClick={onAddRepair}>
          + Add repair
        </button>
      </header>
      <div className="repair-board-column-body">
        {items.map((item) => (
          <BoardWorkCard
            key={item.key}
            item={item}
            onEditRepair={onEditRepair}
            onCompleteRepair={onCompleteRepair}
            onMarkDvirRepaired={onMarkDvirRepaired}
            onAddRelatedRepair={onAddRelatedRepair}
          />
        ))}
        {!items.length && (
          <div className="column-empty-state">
            <strong>No matching {equipmentType.toLowerCase()} work</strong>
            <span>New repairs and open DVIR defects will appear here.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function DvirDefectCard({
  defect,
  onAddRelatedRepair,
  onMarkRepaired,
}: {
  defect: Dvir;
  onAddRelatedRepair: (defect: Dvir) => void;
  onMarkRepaired: (defect: Dvir) => void;
}) {
  return (
    <article className="defect-card">
      <div className="defect-head">
        <div>
          <span className="asset">{defect.asset}</span>
          <h3>{defect.defect}</h3>
        </div>
        <span className={`pill ${defect.repaired ? "success" : "danger"}`}>
          {defect.repaired ? "Repaired" : "Needs repair"}
        </span>
      </div>
      <p>{defect.comments || "No driver comments"}</p>
      <div className="defect-meta">
        <span>Driver: {defect.driver || "Unknown"}</span>
        {defect.photos && defect.photos !== "None" ? (
          <a href={defect.photos} target="_blank" rel="noreferrer">
            View photos
          </a>
        ) : (
          <span>No photos</span>
        )}
      </div>
      {!defect.repaired && (
        <div className="defect-actions">
          <button type="button" className="secondary-card-action" onClick={() => onAddRelatedRepair(defect)}>
            + Add another repair
          </button>
          <button type="button" className="repair-button" onClick={() => onMarkRepaired(defect)}>
            Mark repaired
          </button>
        </div>
      )}
    </article>
  );
}

function DvirColumn({
  title,
  equipmentType,
  defects,
  onAddRepair,
  onAddRelatedRepair,
  onMarkRepaired,
}: {
  title: string;
  equipmentType: "Truck" | "Trailer";
  defects: Dvir[];
  onAddRepair: () => void;
  onAddRelatedRepair: (defect: Dvir) => void;
  onMarkRepaired: (defect: Dvir) => void;
}) {
  const openCount = defects.filter((defect) => !defect.repaired).length;
  const repairedCount = defects.length - openCount;
  return (
    <section className={`repair-board-column ${equipmentType.toLowerCase()}-column`}>
      <header className="repair-board-column-head">
        <div>
          <p className="eyebrow">{equipmentType === "Truck" ? "VEHICLE DVIR" : "TRAILER DVIR"}</p>
          <h3>
            {title} <span>{defects.length}</span>
          </h3>
          <small>{openCount} open · {repairedCount} repaired</small>
        </div>
        <button type="button" className="column-add-button" onClick={onAddRepair}>
          + Add repair
        </button>
      </header>
      <div className="repair-board-column-body">
        {defects.map((defect) => (
          <DvirDefectCard
            key={defect.id}
            defect={defect}
            onAddRelatedRepair={onAddRelatedRepair}
            onMarkRepaired={onMarkRepaired}
          />
        ))}
        {!defects.length && (
          <div className="column-empty-state">
            <strong>No matching {equipmentType === "Truck" ? "vehicle" : "trailer"} DVIRs</strong>
            <span>New pulled DVIR defects will appear here.</span>
          </div>
        )}
      </div>
    </section>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("Repairs");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<DashboardData>(previewData);
  const [loading, setLoading] = useState(true);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [editingRepair, setEditingRepair] = useState<Repair | null>(null);
  const [repairContext, setRepairContext] = useState<RepairContext | null>(null);
  const [saving, setSaving] = useState(false);
  const [attachingPart, setAttachingPart] = useState(false);
  const [inventory, setInventory] = useState<InventoryData>(emptyInventory);
  const [partSelections, setPartSelections] = useState<PartSelection[]>([{ ...emptyPartSelection }]);
  const [partMessage, setPartMessage] = useState("");
  const [removingPartId, setRemovingPartId] = useState<number | null>(null);
  const [selectedPmUnits, setSelectedPmUnits] = useState<string[]>([]);

  async function loadData() {
    setLoading(true);
    try {
      const response = await fetch("/api/repairs", { cache: "no-store" });
      if (!response.ok) throw new Error("The Google Sheet connector has not been deployed yet.");
      const fresh = (await response.json()) as DashboardData;
      setData(fresh);
      setConnectionMessage("");
      return fresh;
    } catch (error) {
      setData(previewData);
      setConnectionMessage(error instanceof Error ? error.message : "Unable to reach the Google Sheet.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/repairs", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("The Google Sheet connector has not been deployed yet.");
        return response.json() as Promise<DashboardData>;
      })
      .then((fresh) => {
        if (!cancelled) {
          setData(fresh);
          setConnectionMessage("");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setData(previewData);
          setConnectionMessage(error instanceof Error ? error.message : "Unable to reach the Google Sheet.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/inventory", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as InventoryData & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Inventory could not be loaded.");
        return payload;
      })
      .then((payload) => {
        if (!cancelled) setInventory(payload);
      })
      .catch((error: unknown) => {
        if (!cancelled) setPartMessage(error instanceof Error ? error.message : "Inventory could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function closeRepairEditor() {
    setEditingRepair(null);
    setRepairContext(null);
    setPartSelections([{ ...emptyPartSelection }]);
    setPartMessage("");
  }

  function openNewRepair(prefill: Partial<Repair> = {}, context: RepairContext | null = null) {
    setActiveTab("Repairs");
    setRepairContext(context);
    setEditingRepair({ ...emptyRepair, ...prefill, id: "" });
  }

  function openRelatedDvirRepair(defect: Dvir) {
    openNewRepair(
      {
        unit: defect.asset,
        driver: defect.driver,
        status: "New",
        geotabDefectId: defect.defectId,
      },
      {
        label: "Additional issue found during DVIR work",
        detail: `Original DVIR: ${defect.defect}`,
      },
    );
  }

  async function markRepaired(defect: Dvir) {
    if (data.preview) {
      setConnectionMessage("Deploy the included Google Apps Script connector before updating live repairs.");
      return;
    }
    const response = await fetch("/api/repairs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "markRepaired",
        logId: defect.logId,
        defectId: defect.defectId,
        id: defect.id,
      }),
    });
    if (!response.ok) {
      setConnectionMessage("The DVIR repair could not be updated. Please try again.");
      return;
    }
    await loadData();
  }

  async function repairAction(action: "saveRepair" | "completeRepair", repair: Repair) {
    setSaving(true);
    try {
      const response = await fetch("/api/repairs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...repair }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string; id?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "The repair could not be saved.");

      if (action === "saveRepair" && !repair.id && result.id) {
        const fresh = await loadData();
        const created = fresh?.repairs.find((item) => item.id === result.id);
        if (created) {
          setEditingRepair(created);
          setRepairContext(null);
          setPartMessage("Repair saved. You can attach inventory parts below.");
          return;
        }
      }

      closeRepairEditor();
      await loadData();
    } catch (error) {
      setConnectionMessage(error instanceof Error ? error.message : "The repair could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function updatePartSelection(index: number, patch: Partial<PartSelection>) {
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

  const q = query.trim().toLowerCase();

  const equipmentTypeByUnit = useMemo(() => {
    const result = new Map<string, Equipment["type"]>();
    data.equipment.forEach((equipment) => {
      const key = unitKey(equipment.unit);
      if (key) result.set(key, equipment.type);
    });
    return result;
  }, [data.equipment]);

  const boardItems = useMemo<BoardItem[]>(() => {
    const classify = (unit: string): EquipmentGroup => equipmentTypeByUnit.get(unitKey(unit)) || "Unclassified";
    const items: BoardItem[] = [];

    data.repairs.forEach((repair) => {
      if (repairIsComplete(repair.status)) return;
      items.push({
        key: `repair-${repair.id}`,
        kind: "repair",
        unit: repair.unit,
        equipmentType: classify(repair.unit),
        searchText: Object.values(repair).join(" ").toLowerCase(),
        repair,
      });
    });

    data.dvir.forEach((defect) => {
      if (defect.repaired) return;
      items.push({
        key: `dvir-${defect.id}`,
        kind: "dvir",
        unit: defect.asset,
        equipmentType: classify(defect.asset),
        searchText: Object.values(defect).join(" ").toLowerCase(),
        defect,
      });
    });

    return items.sort((a, b) => {
      const unitCompare = a.unit.localeCompare(b.unit, undefined, { numeric: true, sensitivity: "base" });
      if (unitCompare !== 0) return unitCompare;
      return a.kind === b.kind ? 0 : a.kind === "dvir" ? -1 : 1;
    });
  }, [data.dvir, data.repairs, equipmentTypeByUnit]);

  const visibleBoardItems = useMemo(
    () => boardItems.filter((item) => item.searchText.includes(q)),
    [boardItems, q],
  );

  const truckBoardItems = visibleBoardItems.filter((item) => item.equipmentType === "Truck");
  const trailerBoardItems = visibleBoardItems.filter((item) => item.equipmentType === "Trailer");
  const unclassifiedBoardItems = visibleBoardItems.filter((item) => item.equipmentType === "Unclassified");

  const filteredDvir = useMemo(
    () => data.dvir.filter((defect) => Object.values(defect).join(" ").toLowerCase().includes(q)),
    [data.dvir, q],
  );
  const vehicleDvir = filteredDvir.filter((defect) => equipmentTypeByUnit.get(unitKey(defect.asset)) === "Truck");
  const trailerDvir = filteredDvir.filter((defect) => equipmentTypeByUnit.get(unitKey(defect.asset)) === "Trailer");
  const unclassifiedDvir = filteredDvir.filter((defect) => !equipmentTypeByUnit.has(unitKey(defect.asset)));

  const filteredEquipment = useMemo(
    () => data.equipment.filter((equipment) => Object.values(equipment).join(" ").toLowerCase().includes(q)),
    [data.equipment, q],
  );

  const pmTruckRows = useMemo<PmTruckRow[]>(() => {
    const pmByUnit = new Map<string, Pm>();
    data.pm.forEach((pm) => {
      const key = unitKey(pm.unit);
      if (key && !pmByUnit.has(key)) pmByUnit.set(key, pm);
    });

    const rows: PmTruckRow[] = data.equipment
      .filter((equipment) => equipment.type === "Truck" && equipment.unit.trim())
      .map((equipment) => {
        const pm = pmByUnit.get(unitKey(equipment.unit));
        return {
          unit: equipment.unit,
          pmType: pm?.pmType || "—",
          status: pm?.status || "No PM record",
          driver: pm?.driver || "",
          location: pm?.location || "",
          annualDate: equipment.annualDate || "",
          hasPmRecord: Boolean(pm),
        };
      });

    const listedUnits = new Set(rows.map((row) => unitKey(row.unit)));
    data.pm.forEach((pm) => {
      const key = unitKey(pm.unit);
      if (!key || listedUnits.has(key)) return;
      rows.push({ ...pm, annualDate: "", hasPmRecord: true });
      listedUnits.add(key);
    });

    return rows.sort((a, b) => a.unit.localeCompare(b.unit, undefined, { numeric: true, sensitivity: "base" }));
  }, [data.equipment, data.pm]);

  const filteredPmTrucks = useMemo(
    () => pmTruckRows.filter((row) => Object.values(row).join(" ").toLowerCase().includes(q)),
    [pmTruckRows, q],
  );

  useEffect(() => {
    const availableUnits = new Set(pmTruckRows.map((row) => row.unit));
    setSelectedPmUnits((current) => current.filter((unit) => availableUnits.has(unit)));
  }, [pmTruckRows]);

  const selectedPmUnitSet = useMemo(() => new Set(selectedPmUnits), [selectedPmUnits]);
  const allVisiblePmTrucksSelected =
    filteredPmTrucks.length > 0 && filteredPmTrucks.every((row) => selectedPmUnitSet.has(row.unit));

  function togglePmUnit(unit: string) {
    setSelectedPmUnits((current) =>
      current.includes(unit) ? current.filter((item) => item !== unit) : [...current, unit],
    );
  }

  function toggleAllVisiblePmTrucks() {
    const visibleUnits = filteredPmTrucks.map((row) => row.unit);
    const visibleSet = new Set(visibleUnits);
    setSelectedPmUnits((current) => {
      if (allVisiblePmTrucksSelected) return current.filter((unit) => !visibleSet.has(unit));
      return Array.from(new Set([...current, ...visibleUnits]));
    });
  }

  const openDvirCount = data.dvir.filter((defect) => !defect.repaired).length;
  const photoCount = data.dvir.filter((defect) => !defect.repaired && defect.photos && defect.photos !== "None").length;
  const truckWorkCount = boardItems.filter((item) => item.equipmentType === "Truck").length;
  const trailerWorkCount = boardItems.filter((item) => item.equipmentType === "Trailer").length;
  const overdue = data.pm.filter((pm) => pm.status.toLowerCase().includes("overdue")).length;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">N</div>
        <div className="brand-copy">
          <strong>NORLOWORLD</strong>
          <span>Fleet maintenance</span>
        </div>
        <nav aria-label="Repair dashboard sections">
          {tabs.map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? "nav-button active" : "nav-button"}
              onClick={() => setActiveTab(tab)}
            >
              <span className="nav-dot" />
              {tab}
              <span className="nav-count">
                {tab === "Repairs"
                  ? boardItems.length
                  : tab === "DVIR Defects"
                    ? openDvirCount
                    : tab === "PM Status"
                      ? pmTruckRows.length
                      : data.equipment.length}
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className={data.preview ? "status-light preview" : "status-light"} />
          {data.preview ? "Preview data" : "Sheet connected"}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">REPAIR OPERATIONS</p>
            <h1>Fleet repair dashboard</h1>
          </div>
          <div className="topbar-actions">
            <label className="search">
              <span>⌕</span>
              <input
                aria-label="Search all repair records"
                placeholder="Search unit, driver, issue…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button className="refresh" onClick={() => void loadData()} disabled={loading}>
              {loading ? "Loading…" : "Refresh data"}
            </button>
            <button className="primary-action" onClick={() => openNewRepair()}>
              + New repair
            </button>
          </div>
        </header>

        {connectionMessage && (
          <div className="connection-banner">
            <strong>Preview mode:</strong> {connectionMessage}
          </div>
        )}

        <section className="metrics" aria-label="Fleet repair summary">
          <article>
            <span className="metric-label">TRUCK WORK</span>
            <strong>{truckWorkCount}</strong>
            <small>Repairs and open DVIRs</small>
          </article>
          <article>
            <span className="metric-label">TRAILER WORK</span>
            <strong>{trailerWorkCount}</strong>
            <small>Repairs and open DVIRs</small>
          </article>
          <article>
            <span className="metric-label">OPEN DVIR</span>
            <strong>{openDvirCount}</strong>
            <small>{photoCount} with photos</small>
          </article>
          <article>
            <span className="metric-label">PM TRUCKS</span>
            <strong>{pmTruckRows.length}</strong>
            <small>{overdue} overdue</small>
          </article>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">LIVE WORK QUEUE</p>
              <h2>{activeTab === "Repairs" ? "Repair Board" : activeTab}</h2>
            </div>
            <span suppressHydrationWarning>Updated {new Date(data.updatedAt).toLocaleString()}</span>
          </div>

          {activeTab === "Repairs" && (
            <div className="repair-board-shell">
              <div className="repair-board-intro">
                <div>
                  <strong>Truck and trailer work shown together</strong>
                  <span>Open Repair List items and open DVIR defects are combined by equipment type.</span>
                </div>
                <span className="board-total">{visibleBoardItems.length} visible work items</span>
              </div>

              <div className="repair-board-grid">
                <RepairBoardColumn
                  title="Truck Repairs"
                  equipmentType="Truck"
                  items={truckBoardItems}
                  onAddRepair={() =>
                    openNewRepair({}, { label: "New truck repair", detail: "Enter a truck unit from Equipment Info." })
                  }
                  onEditRepair={(repair) => {
                    setRepairContext(null);
                    setEditingRepair({ ...repair });
                  }}
                  onCompleteRepair={(repair) => void repairAction("completeRepair", repair)}
                  onMarkDvirRepaired={(defect) => void markRepaired(defect)}
                  onAddRelatedRepair={openRelatedDvirRepair}
                />
                <RepairBoardColumn
                  title="Trailer Repairs"
                  equipmentType="Trailer"
                  items={trailerBoardItems}
                  onAddRepair={() =>
                    openNewRepair({}, { label: "New trailer repair", detail: "Enter a trailer unit from Equipment Info." })
                  }
                  onEditRepair={(repair) => {
                    setRepairContext(null);
                    setEditingRepair({ ...repair });
                  }}
                  onCompleteRepair={(repair) => void repairAction("completeRepair", repair)}
                  onMarkDvirRepaired={(defect) => void markRepaired(defect)}
                  onAddRelatedRepair={openRelatedDvirRepair}
                />
              </div>

              {unclassifiedBoardItems.length > 0 && (
                <section className="unclassified-work">
                  <div className="unclassified-work-head">
                    <div>
                      <p className="eyebrow">NEEDS EQUIPMENT MATCH</p>
                      <h3>Unclassified Repairs</h3>
                    </div>
                    <span>{unclassifiedBoardItems.length}</span>
                  </div>
                  <p>
                    These unit numbers do not match a truck or trailer in Equipment Info. Correct the unit or add the
                    equipment record so the work moves to the proper column.
                  </p>
                  <div className="unclassified-card-grid">
                    {unclassifiedBoardItems.map((item) => (
                      <BoardWorkCard
                        key={item.key}
                        item={item}
                        onEditRepair={(repair) => {
                          setRepairContext(null);
                          setEditingRepair({ ...repair });
                        }}
                        onCompleteRepair={(repair) => void repairAction("completeRepair", repair)}
                        onMarkDvirRepaired={(defect) => void markRepaired(defect)}
                        onAddRelatedRepair={openRelatedDvirRepair}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {activeTab === "DVIR Defects" && (
            <div className="repair-board-shell">
              <div className="repair-board-intro">
                <div>
                  <strong>DVIRs separated by equipment type</strong>
                  <span>Vehicle defects stay on the left, trailer defects stay on the right, with repair actions on both sides.</span>
                </div>
                <span className="board-total">{filteredDvir.length} matching DVIRs</span>
              </div>

              <div className="repair-board-grid">
                <DvirColumn
                  title="Vehicle DVIRs"
                  equipmentType="Truck"
                  defects={vehicleDvir}
                  onAddRepair={() =>
                    openNewRepair({}, { label: "New vehicle repair", detail: "Enter a vehicle unit from Equipment Info." })
                  }
                  onAddRelatedRepair={openRelatedDvirRepair}
                  onMarkRepaired={(defect) => void markRepaired(defect)}
                />
                <DvirColumn
                  title="Trailer DVIRs"
                  equipmentType="Trailer"
                  defects={trailerDvir}
                  onAddRepair={() =>
                    openNewRepair({}, { label: "New trailer repair", detail: "Enter a trailer unit from Equipment Info." })
                  }
                  onAddRelatedRepair={openRelatedDvirRepair}
                  onMarkRepaired={(defect) => void markRepaired(defect)}
                />
              </div>

              {unclassifiedDvir.length > 0 && (
                <section className="unclassified-work">
                  <div className="unclassified-work-head">
                    <div>
                      <p className="eyebrow">NEEDS EQUIPMENT MATCH</p>
                      <h3>Unclassified DVIRs</h3>
                    </div>
                    <span>{unclassifiedDvir.length}</span>
                  </div>
                  <p>
                    These DVIR unit numbers do not match a vehicle or trailer in Equipment Info yet. They stay visible here until the equipment match is corrected.
                  </p>
                  <div className="unclassified-card-grid">
                    {unclassifiedDvir.map((defect) => (
                      <DvirDefectCard
                        key={defect.id}
                        defect={defect}
                        onAddRelatedRepair={openRelatedDvirRepair}
                        onMarkRepaired={(item) => void markRepaired(item)}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {activeTab === "PM Status" && (
            <div>
              <div className="pm-selection-toolbar">
                <label>
                  <input
                    type="checkbox"
                    aria-label="Select all visible trucks"
                    checked={allVisiblePmTrucksSelected}
                    disabled={!filteredPmTrucks.length}
                    onChange={toggleAllVisiblePmTrucks}
                  />
                  Select all visible trucks
                </label>
                <div>
                  <strong>{selectedPmUnits.length} selected</strong>
                  <button type="button" disabled={!selectedPmUnits.length} onClick={() => setSelectedPmUnits([])}>
                    Clear
                  </button>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Select</th>
                      <th>Unit</th>
                      <th>PM type</th>
                      <th>Status / mileage</th>
                      <th>Annual date</th>
                      <th>Driver</th>
                      <th>Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPmTrucks.map((truck) => {
                      const selected = selectedPmUnitSet.has(truck.unit);
                      return (
                        <tr key={truck.unit} className={selected ? "selected-pm-row" : undefined}>
                          <td>
                            <input
                              className="pm-checkbox"
                              type="checkbox"
                              aria-label={`Select truck ${truck.unit}`}
                              checked={selected}
                              onChange={() => togglePmUnit(truck.unit)}
                            />
                          </td>
                          <td className="unit">{truck.unit}</td>
                          <td>{truck.pmType}</td>
                          <td>
                            <span className={`pill ${statusClass(truck.status)}`}>
                              {truck.status || "Current"}
                            </span>
                          </td>
                          <td>{truck.annualDate || "—"}</td>
                          <td>{truck.driver || "—"}</td>
                          <td>{truck.location || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "Equipment" && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>Type</th>
                    <th>Last service</th>
                    <th>Annual date</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEquipment.map((equipment, index) => (
                    <tr key={`${equipment.unit}-${index}`}>
                      <td className="unit">{equipment.unit}</td>
                      <td>{equipment.type}</td>
                      <td>{equipment.serviceDate || "—"}</td>
                      <td>{equipment.annualDate || "—"}</td>
                      <td>{equipment.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {((activeTab === "DVIR Defects" && !filteredDvir.length) ||
            (activeTab === "PM Status" && !filteredPmTrucks.length) ||
            (activeTab === "Equipment" && !filteredEquipment.length)) && (
            <div className="empty-state">
              <strong>No matching records</strong>
              <span>Try a different search.</span>
            </div>
          )}
        </section>
      </section>

      {editingRepair && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeRepairEditor();
          }}
        >
          <form
            className="repair-modal"
            onSubmit={(event) => {
              event.preventDefault();
              void repairAction("saveRepair", editingRepair);
            }}
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">REPAIR RECORD</p>
                <h2>{editingRepair.id ? "Edit repair" : "Add a new repair"}</h2>
              </div>
              <button type="button" className="close-modal" aria-label="Close" onClick={closeRepairEditor}>
                ×
              </button>
            </div>

            {repairContext && (
              <div className="repair-context-banner">
                <strong>{repairContext.label}</strong>
                {repairContext.detail && <span>{repairContext.detail}</span>}
              </div>
            )}

            <div className="form-grid">
              <label>
                Unit number
                <input
                  required
                  value={editingRepair.unit}
                  onChange={(event) => setEditingRepair({ ...editingRepair, unit: event.target.value })}
                />
              </label>
              <label>
                Status
                <select
                  value={editingRepair.status}
                  onChange={(event) => setEditingRepair({ ...editingRepair, status: event.target.value })}
                >
                  <option>New</option>
                  <option>Assigned</option>
                  <option>Waiting for Parts</option>
                  <option>In Progress</option>
                  <option>Completed</option>
                </select>
              </label>
              <label className="wide">
                Repair needed
                <textarea
                  required
                  autoFocus
                  rows={3}
                  value={editingRepair.issue}
                  onChange={(event) => setEditingRepair({ ...editingRepair, issue: event.target.value })}
                  placeholder={repairContext ? "Describe the additional issue you found…" : undefined}
                />
              </label>
                            <label className="wide">
                Attached inventory parts
                <input value={editingRepair.parts} readOnly placeholder="No inventory parts attached yet." />
              </label>
              {editingRepair.id ? (
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
                Assigned mechanic / driver
                <input
                  value={editingRepair.driver}
                  onChange={(event) => setEditingRepair({ ...editingRepair, driver: event.target.value })}
                />
              </label>
              <label>
                Location
                <input
                  value={editingRepair.location}
                  onChange={(event) => setEditingRepair({ ...editingRepair, location: event.target.value })}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={closeRepairEditor}>
                Cancel
              </button>
              <button className="primary-action" disabled={saving}>
                {saving ? "Saving…" : "Save repair"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
