"use client";

import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from "react";
import ModuleTabs from "../module-tabs";
import ReceivingHistoryButton from "./receiving-history-button";
import InventoryAuditSheet, { type InventoryAuditSnapshot } from "./inventory-audit-sheet";
import InventoryQuickUpdate from "./inventory-quick-update";
import InventoryChoicePicker from "./inventory-choice-picker";
import pageStyles from "./inventory-page.module.css";

type WarehouseStock = {
  id: number;
  warehouseCode: string;
  warehouseName: string;
  binLocation?: string;
  quantityOnHand: number;
  physicalOnHand?: number;
  reserved?: number;
  available?: number;
  unitOfMeasure: string;
  unitCost: number | null;
  onOrder: number;
  minimumQuantity: number | null;
  warehouseStatus?: "active" | "archived" | "removed";
};

type Equipment = { id: number; unit: string; category: string; equipmentType: string };
type CompatibleEquipment = { id: number; unit: string };
type Part = {
  id: number;
  partNumber: string;
  description: string;
  quantityOnHand: number;
  reorderLevel: number;
  physicalOnHand?: number;
  unitCost: number | null;
  location: string;
  warehouseSummary?: string;
  preferredVendorId: number | null;
  vendorName: string;
  warehouseStocks?: WarehouseStock[];
  compatibleEquipment?: CompatibleEquipment[];
  compatibleEquipmentIds?: number[];
  crossReferences?: string[];
  warehouseStatuses?: Record<string, "active" | "archived" | "removed">;
  lowStock: boolean;
  active?: boolean;
};

type Vendor = { id: number; name: string; phone: string; email: string; notes: string };
type VendorLink = { id: number; name: string; preferred: boolean };
type Warehouse = { id: number; code: string; name: string };
type InventoryData = {
  parts: Part[];
  vendors: Vendor[];
  warehouses?: Warehouse[];
  equipment?: Equipment[];
  summary: { partCount: number; lowStockCount: number; totalUnits: number; inventoryValue: number };
  updatedAt: string;
  viewerRole?: "manager" | "admin";
  partStatus?: "active" | "archived" | "all";
};

type PartForm = {
  id: number;
  partNumber: string;
  description: string;
  quantityOnHand: number;
  reorderLevel: number;
  unitCost: string;
  location: string;
  preferredVendorId: string;
  vendorIds: number[];
  warehouseMinimums: Record<string, string>;
  warehouseBins: Record<string, string>;
  equipmentIds: number[];
  crossReferences: string[];
  initialWarehouseCode: string;
  sourceRequestId: number | null;
  sourceRequestedQuantity: number;
};

type VendorForm = { id: number; name: string; phone: string; email: string; notes: string };
type SortMode = "description" | "negative-first" | "qty-asc" | "qty-desc" | "part-number";
type StockFilter = "all" | "negative" | "below-minimum";

type CountSnapshot = {
  ok?: boolean;
  error?: string;
  partId: number;
  partNumber: string;
  description: string;
  warehouseCode: string;
  warehouseName: string;
  expectedQuantity: number;
  stockVersion: string;
};

const blankPart: PartForm = {
  id: 0,
  partNumber: "",
  description: "",
  quantityOnHand: 0,
  reorderLevel: 0,
  unitCost: "",
  location: "",
  preferredVendorId: "",
  vendorIds: [],
  warehouseMinimums: {},
  warehouseBins: {},
  equipmentIds: [],
  crossReferences: [],
  initialWarehouseCode: "",
  sourceRequestId: null,
  sourceRequestedQuantity: 0,
};

const blankVendor: VendorForm = { id: 0, name: "", phone: "", email: "", notes: "" };

async function fetchInventory(status: "active" | "archived") {
  const [inventoryResponse, linksResponse] = await Promise.all([
    fetch(`/api/inventory?status=${status}`, { cache: "no-store" }),
    fetch("/api/inventory/part-vendors", { cache: "no-store" }),
  ]);
  if (!inventoryResponse.ok) throw new Error("Unable to load inventory");
  if (!linksResponse.ok) throw new Error("Unable to load part vendors");
  const [inventory, links] = await Promise.all([inventoryResponse.json(), linksResponse.json()]);
  return {
    inventory: inventory as InventoryData,
    links: (links as { byPart?: Record<string, VendorLink[]> }).byPart ?? {},
  };
}

export default function InventoryPage() {
  const [data, setData] = useState<InventoryData | null>(null);
  const [vendorLinks, setVendorLinks] = useState<Record<string, VendorLink[]>>({});
  const [query, setQuery] = useState("");
  const [warehouseCode, setWarehouseCode] = useState("ALL");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("description");
  const [partStatus, setPartStatus] = useState<"active" | "archived">("active");
  const [message, setMessage] = useState("");
  const [part, setPart] = useState<PartForm>(blankPart);
  const [vendor, setVendor] = useState<VendorForm>(blankVendor);
  const [showPartForm, setShowPartForm] = useState(false);
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [partSaving, setPartSaving] = useState(false);
  const [quickUpdate, setQuickUpdate] = useState<{ partId: number; warehouseCode: string } | null>(null);
  const [quickDirty, setQuickDirty] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  const [printingAudit, setPrintingAudit] = useState(false);
  const [auditSnapshot, setAuditSnapshot] = useState<InventoryAuditSnapshot | null>(null);

  async function load() {
    const result = await fetchInventory(partStatus);
    setData(result.inventory);
    setVendorLinks(result.links);
  }

  function closeQuickUpdate() {
    if (quickBusy) return false;
    if (quickDirty && !window.confirm("Discard the unsaved inventory changes? Any recorded count issue remains in Count Issues.")) return false;
    setQuickUpdate(null);
    setQuickDirty(false);
    return true;
  }

  function changeView(change: () => void) {
    if (!closeQuickUpdate()) return;
    change();
  }

  function toggleQuickUpdate(item: Part) {
    if (quickUpdate?.partId === item.id) { closeQuickUpdate(); return; }
    if (!closeQuickUpdate()) return;
    setMessage("");
    setQuickUpdate({ partId: item.id, warehouseCode });
  }

  async function quickUpdateSaved(text: string) {
    setMessage(text);
    try { await load(); }
    catch { setMessage(`${text} The list could not be refreshed; reload Inventory to see the latest values.`); }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") !== "1") return;
    const sourceRequestId = Number(params.get("requestId") ?? 0);
    const sourceRequestedQuantity = Number(params.get("requestedQuantity") ?? 0);
    setPart({
      ...blankPart,
      description: params.get("description") ?? "",
      initialWarehouseCode: (params.get("warehouse") ?? "").trim().toUpperCase(),
      sourceRequestId: Number.isInteger(sourceRequestId) && sourceRequestId > 0 ? sourceRequestId : null,
      sourceRequestedQuantity: Number.isFinite(sourceRequestedQuantity) && sourceRequestedQuantity > 0 ? sourceRequestedQuantity : 0,
    });
    setShowPartForm(true);
  }, []);

  useEffect(() => {
    let current = true;
    void fetchInventory(partStatus).then((result) => {
      if (!current) return;
      setData(result.inventory);
      setVendorLinks(result.links);
    }).catch((error: unknown) => {
      if (current) setMessage(error instanceof Error ? error.message : "Unable to load inventory");
    });
    return () => { current = false; };
  }, [partStatus]);

  useEffect(() => {
    if (!auditSnapshot) return;
    const afterPrint = () => setAuditSnapshot(null);
    window.addEventListener("afterprint", afterPrint);
    const frame = window.requestAnimationFrame(() => {
      try {
        window.print();
      } catch {
        setMessage("The print dialog could not be opened. Please try Print Audit Sheet again.");
        setAuditSnapshot(null);
      } finally {
        setPrintingAudit(false);
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, [auditSnapshot]);

  function vendorsForPart(item: Part) {
    const linked = vendorLinks[String(item.id)] ?? [];
    if (linked.length) return linked;
    return item.vendorName ? [{ id: item.preferredVendorId ?? 0, name: item.vendorName, preferred: true }] : [];
  }

  const stockFor = useCallback((item: Part) => {
    if (warehouseCode === "ALL") {
      const stocks = item.warehouseStocks ?? [];
      const binLocations = [...new Set(stocks.filter((stock) => stock.binLocation?.trim()).map((stock) => `${stock.warehouseName || stock.warehouseCode}: ${stock.binLocation}`))];
      return {
        quantityOnHand: Number(item.quantityOnHand),
        unitCost: item.unitCost,
        location: item.warehouseSummary || [...new Set(stocks.map((stock) => stock.warehouseName || stock.warehouseCode))].join(" | ") || "No warehouse assigned",
        binLocation: binLocations.join("\n") || (stocks.length ? "" : item.location),
        onOrder: (item.warehouseStocks ?? []).reduce((sum, stock) => sum + Number(stock.onOrder || 0), 0),
        minimumQuantity: Number(item.reorderLevel),
      };
    }
    const stock = (item.warehouseStocks ?? []).find((row) => row.warehouseCode === warehouseCode);
    return {
      quantityOnHand: Number(stock?.quantityOnHand ?? 0),
      unitCost: stock?.unitCost ?? item.unitCost,
      location: stock?.warehouseName ?? warehouseCode,
      binLocation: stock?.binLocation ?? "",
      onOrder: Number(stock?.onOrder ?? 0),
      minimumQuantity: stock?.minimumQuantity == null ? Number(item.reorderLevel) : Number(stock.minimumQuantity),
    };
  }, [warehouseCode]);

  const warehouseStatusFor = useCallback((item: Part, code: string) =>
    item.warehouseStatuses?.[code] ?? (item.warehouseStocks ?? []).find((stock) => stock.warehouseCode === code)?.warehouseStatus ?? "active",
  []);

  const scopedParts = useMemo(() => (data?.parts ?? []).filter((item) => {
    if (partStatus !== "active") return true;
    if (warehouseCode === "ALL") return (data?.warehouses ?? []).some((warehouse) => warehouseStatusFor(item, warehouse.code) === "active");
    return warehouseStatusFor(item, warehouseCode) === "active";
  }), [data, partStatus, warehouseCode, warehouseStatusFor]);

  const filterParts = useCallback((parts: Part[], links: Record<string, VendorLink[]>) => {
    const q = query.trim().toLowerCase();
    const rows = parts.filter((item) => {
      if (partStatus === "active") {
        if (warehouseCode !== "ALL" && warehouseStatusFor(item, warehouseCode) !== "active") return false;
        if (warehouseCode === "ALL" && !(data?.warehouses ?? []).some((warehouse) => warehouseStatusFor(item, warehouse.code) === "active")) return false;
      }
      const stock = stockFor(item);
      if (stockFilter === "negative" && stock.quantityOnHand >= 0) return false;
      if (stockFilter === "below-minimum" && stock.quantityOnHand >= stock.minimumQuantity) return false;
      const vendorNames = (links[String(item.id)] ?? []).map((itemVendor) => itemVendor.name).join(" ");
      const equipmentNames = (item.compatibleEquipment ?? []).map((equipment) => equipment.unit).join(" ");
      return [item.partNumber, item.description, ...(item.crossReferences ?? []), item.location, stock.location, stock.binLocation, item.vendorName, vendorNames, equipmentNames].join(" ").toLowerCase().includes(q);
    });
    rows.sort((a, b) => {
      const aQty = stockFor(a).quantityOnHand;
      const bQty = stockFor(b).quantityOnHand;
      if (sortMode === "negative-first") return (aQty < 0 ? 0 : 1) - (bQty < 0 ? 0 : 1) || aQty - bQty || a.description.localeCompare(b.description);
      if (sortMode === "qty-asc") return aQty - bQty || a.description.localeCompare(b.description);
      if (sortMode === "qty-desc") return bQty - aQty || a.description.localeCompare(b.description);
      if (sortMode === "part-number") return a.partNumber.localeCompare(b.partNumber, undefined, { numeric: true });
      return a.description.localeCompare(b.description) || a.partNumber.localeCompare(b.partNumber, undefined, { numeric: true });
    });
    return rows;
  }, [data?.warehouses, partStatus, query, sortMode, stockFilter, stockFor, warehouseCode, warehouseStatusFor]);

  const visibleParts = useMemo(() => filterParts(data?.parts ?? [], vendorLinks), [data, filterParts, vendorLinks]);

  async function printAudit() {
    if (printingAudit || partStatus !== "active") return;
    setPrintingAudit(true);
    setAuditSnapshot(null);
    setMessage("");
    try {
      const fresh = await fetchInventory("active");
      const parts = filterParts(fresh.inventory.parts, fresh.links);
      if (!parts.length) throw new Error("No active inventory records match these filters. Choose All parts or clear the search, then try again.");
      setAuditSnapshot({
        parts,
        warehouseCode,
        warehouseName: warehouseCode === "ALL" ? "All warehouses" : fresh.inventory.warehouses?.find((warehouse) => warehouse.code === warehouseCode)?.name ?? warehouseCode,
        updatedAt: fresh.inventory.updatedAt,
        query: query.trim(),
        stockFilter: stockFilter === "negative" ? "Negative available stock only" : stockFilter === "below-minimum" ? "Below minimum available stock only" : "All parts",
        sort: { description: "Description A-Z", "negative-first": "Negative available stock first", "qty-asc": "Available quantity low to high", "qty-desc": "Available quantity high to low", "part-number": "Part number" }[sortMode],
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Inventory audit sheet could not be loaded.");
      setPrintingAudit(false);
    }
  }

  const scopedSummary = scopedParts.reduce((summary, item) => {
    const stock = stockFor(item);
    summary.partCount += 1;
    summary.totalUnits += stock.quantityOnHand;
    summary.inventoryValue += stock.quantityOnHand * (stock.unitCost ?? 0);
    if (stock.quantityOnHand < stock.minimumQuantity) summary.lowStockCount += 1;
    if (stock.quantityOnHand < 0) summary.negativeStockCount += 1;
    return summary;
  }, { partCount: 0, lowStockCount: 0, negativeStockCount: 0, totalUnits: 0, inventoryValue: 0 });

  async function savePartWarehouseBins(partId: number) {
    for (const stock of editingWarehouseStocks) {
      const desiredBins = [...new Set(String(part.warehouseBins[stock.warehouseCode] ?? "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean))];
      const currentBins = [...new Set(String(stock.binLocation ?? "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean))];
      if (JSON.stringify(desiredBins) === JSON.stringify(currentBins)) continue;

      const settingsResponse = await fetch(`/api/inventory/warehouse-settings?partId=${partId}&warehouseCode=${encodeURIComponent(stock.warehouseCode)}`, { cache: "no-store" });
      const settings = await settingsResponse.json() as { ok?: boolean; error?: string; minimumQuantity?: number | null; settingsVersion?: string };
      if (!settingsResponse.ok || !settings.ok || !settings.settingsVersion) {
        throw new Error(settings.error || `Could not load ${stock.warehouseName} bin settings.`);
      }

      const response = await fetch("/api/inventory/warehouse-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          partId,
          warehouseCode: stock.warehouseCode,
          binLocations: desiredBins,
          minimumQuantity: settings.minimumQuantity ?? null,
          settingsVersion: settings.settingsVersion,
          operationKey: `warehouse-settings:${crypto.randomUUID()}`,
        }),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || `Could not save ${stock.warehouseName} bin location.`);
    }
  }

  async function savePart(event: FormEvent) {
    event.preventDefault();
    if (partSaving) return;
    if (part.sourceRequestId && !part.initialWarehouseCode) {
      setMessage("Choose the parts warehouse that will supply the technician request.");
      return;
    }
    setPartSaving(true);
    setMessage("");
    try {
    const preferredVendorId = part.preferredVendorId ? Number(part.preferredVendorId) : null;
    const vendorIds = [...new Set(part.vendorIds.concat(preferredVendorId ? [preferredVendorId] : []))];
    const response = await fetch("/api/inventory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "savePart", ...part, preferredVendorId, initialWarehouseCode: part.initialWarehouseCode }),
    });
    const result = (await response.json()) as { id?: number; error?: string };
    if (!response.ok || !result.id) return setMessage(result.error || "Part could not be saved");
    if (!part.id) setPart((current) => ({ ...current, id: result.id! }));

    const [vendorResponse, settingsResponse, crossReferenceResponse] = await Promise.all([
      fetch("/api/inventory/part-vendors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ partId: result.id, vendorIds, preferredVendorId }),
      }),
      fetch("/api/inventory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "savePartSettings",
          partId: result.id,
          warehouseMinimums: Object.entries(part.warehouseMinimums).map(([code, minimumQuantity]) => ({ warehouseCode: code, minimumQuantity })),
          equipmentIds: part.equipmentIds,
        }),
      }),
      fetch("/api/inventory/cross-references", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ partId: result.id, crossReferences: part.crossReferences }),
      }),
    ]);
    const vendorResult = (await vendorResponse.json()) as { error?: string };
    const settingsResult = (await settingsResponse.json()) as { error?: string };
    const crossReferenceResult = (await crossReferenceResponse.json()) as { error?: string };
    if (!vendorResponse.ok) return setMessage(vendorResult.error || "Part saved, but vendors could not be saved");
    if (!settingsResponse.ok) return setMessage(settingsResult.error || "Part saved, but minimums/equipment could not be saved");
    if (!crossReferenceResponse.ok) return setMessage(crossReferenceResult.error || "Part saved, but cross-reference numbers could not be saved");
    if (part.id) {
      try { await savePartWarehouseBins(result.id); }
      catch (error) {
        return setMessage(error instanceof Error ? `Part saved, but warehouse bin locations were not fully saved: ${error.message}` : "Part saved, but warehouse bin locations were not fully saved.");
      }
    }

    if (part.sourceRequestId) {
      const requestResponse = await fetch("/api/parts-desk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "matchUnmatchedToCatalog",
          requestId: part.sourceRequestId,
          partId: result.id,
          warehouseCode: part.initialWarehouseCode,
        }),
      });
      const requestResult = await requestResponse.json() as { ok?: boolean; error?: string };
      if (!requestResponse.ok || !requestResult.ok) {
        return setMessage(requestResult.error || "Inventory item saved, but the technician request could not be moved into normal Parts Desk demand.");
      }
    }

    const fromRequest = Boolean(part.sourceRequestId);
    if (fromRequest && typeof window !== "undefined") window.history.replaceState(null, "", window.location.pathname);
    setPart(blankPart);
    setShowPartForm(false);
    setMessage(fromRequest
      ? "Inventory item saved. The technician request is now normal stocked-part demand in Parts Desk."
      : "Inventory item saved. Its warehouse quantity is now available to technician Part Lookup.");
    await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Part could not be saved. Please try again.");
    } finally { setPartSaving(false); }
  }

  async function saveVendor(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/inventory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "saveVendor", ...vendor }),
    });
    const result = (await response.json()) as { id?: number; error?: string };
    if (!response.ok || !result.id) return setMessage(result.error || "Vendor could not be saved");
    setVendor(blankVendor);
    setShowVendorForm(false);
    setMessage("Vendor added. It is now available on every part.");
    await load();
  }

  async function setWarehousePartStatus(item: Part, code: string, status: "active" | "archived" | "removed") {
    const warehouse = (data?.warehouses ?? []).find((entry) => entry.code === code);
    const label = warehouse?.name ?? code;
    const actionLabel = status === "active" ? "restore" : status === "archived" ? "archive" : "remove";
    if (status !== "active" && !window.confirm(`${actionLabel === "remove" ? "Remove" : "Archive"} ${item.partNumber} at ${label}?\n\nThis only affects ${label}. Other warehouses keep the part. Existing stock and history at ${label} will be preserved.`)) return;
    setMessage("");
    const response = await fetch("/api/inventory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "setWarehousePartStatus", partId: item.id, warehouseCode: code, status }),
    });
    const result = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      setMessage(result.error || `Part could not be ${actionLabel}d at ${label}.`);
      return;
    }
    setMessage(status === "active"
      ? `${item.partNumber} restored at ${label}.`
      : `${item.partNumber} ${status === "archived" ? "archived" : "removed"} at ${label}. Other warehouses are unchanged.`);
    await load();
  }

  async function archivePart(item: Part) {
    const stock = stockFor(item).quantityOnHand;
    const warning = stock !== 0 ? `\n\nThis part currently shows ${stock} available in the selected view. Archiving hides it from active inventory and mechanic part search, but does not delete its history or stock records.` : "";
    if (!window.confirm(`Archive ${item.partNumber} — ${item.description}?${warning}`)) return;
    setMessage("");
    const response = await fetch("/api/inventory",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"archivePart",partId:item.id})});
    const result = await response.json() as {ok?:boolean;error?:string};
    if(!response.ok||!result.ok){setMessage(result.error||"Part could not be archived.");return}
    if (part.id === item.id) { setShowPartForm(false); setPart(blankPart); }
    setMessage(`${item.partNumber} archived. It is hidden from active inventory and mechanic searches but all history is preserved.`);
    await load();
  }

  async function restorePart(item: Part) {
    setMessage("");
    const response = await fetch("/api/inventory",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"restorePart",partId:item.id})});
    const result = await response.json() as {ok?:boolean;error?:string};
    if(!response.ok||!result.ok){setMessage(result.error||"Part could not be restored.");return}
    if (part.id === item.id) { setShowPartForm(false); setPart(blankPart); }
    setMessage(`${item.partNumber} restored to active inventory.`);
    await load();
  }

  async function deletePart(item: Part) {
    const typed = window.prompt(`DELETE PART — ADMIN ONLY\n\nThis removes ${item.partNumber} from Inventory, mechanic searches, receiving, and future PM use. Existing repair, receiving, transfer, count, and inventory history stays intact.\n\nType the part number exactly to delete it:`);
    if (typed == null) return;
    if (typed.trim().toUpperCase() !== item.partNumber.trim().toUpperCase()) {
      setMessage("Delete cancelled because the part number did not match.");
      return;
    }
    setMessage("");
    const response = await fetch("/api/inventory",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"deletePart",partId:item.id})});
    const result = await response.json() as {ok?:boolean;historyPreserved?:boolean;error?:string};
    if(!response.ok||!result.ok){setMessage(result.error||"Part could not be deleted.");return}
    setShowPartForm(false);
    setPart(blankPart);
    setMessage(`${item.partNumber} deleted from Inventory. Existing history was preserved.`);
    await load();
  }

  async function physicalCount(item: Part, warehouseOverride?: string) {
    setMessage("");
    const countWarehouseCode = warehouseOverride ?? warehouseCode;
    if (countWarehouseCode === "ALL") {
      setMessage("Choose a specific warehouse before recording a physical count.");
      return;
    }
    const snapshotResponse = await fetch(`/api/inventory/count-snapshot?partId=${item.id}&warehouseCode=${encodeURIComponent(countWarehouseCode)}`, { cache: "no-store" });
    const snapshot = (await snapshotResponse.json()) as CountSnapshot;
    if (!snapshotResponse.ok || !snapshot.ok) {
      setMessage(snapshot.error || "Physical count could not be started.");
      return;
    }
    const entered = window.prompt(
      `${snapshot.partNumber} — ${snapshot.description}\n${snapshot.warehouseName}\nSystem quantity: ${snapshot.expectedQuantity}\n\nEnter the quantity you physically counted:`,
      String(snapshot.expectedQuantity),
    );
    if (entered == null) return;
    if (entered.trim() === "") {
      setMessage("Enter the quantity you counted. Use 0 for an empty bin.");
      return;
    }
    const countedQuantity = Number(entered);
    if (!Number.isFinite(countedQuantity) || countedQuantity < 0) {
      setMessage("Physical count must be zero or greater.");
      return;
    }
    const response = await fetch("/api/inventory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "recordPhysicalCount",
        partId: item.id,
        warehouseCode: countWarehouseCode,
        countedQuantity,
        stockVersion: snapshot.stockVersion,
        reason: `Physical count entered from Inventory for ${snapshot.partNumber} at ${snapshot.warehouseName}.`,
      }),
    });
    const result = (await response.json()) as { matched?: boolean; issueId?: number; error?: string };
    if (!response.ok) {
      setMessage(result.error || "Physical count could not be recorded.");
      return;
    }
    if (result.matched) {
      setMessage(`Count confirmed: ${snapshot.partNumber} matches the system quantity.`);
      await load();
      return;
    }
    if (!result.issueId) {
      setMessage("Physical count was recorded but the stock update could not be completed.");
      return;
    }
    const operationKey=`count-resolution:${crypto.randomUUID()}`;
    const applyResponse=await fetch("/api/inventory",{
      method:"POST",
      headers:{"content-type":"application/json","idempotency-key":operationKey},
      body:JSON.stringify({
        action:"resolvePhysicalCount",
        issueId:result.issueId,
        operationKey,
        note:`Physical count applied directly from Inventory for ${snapshot.partNumber} at ${snapshot.warehouseName}: ${snapshot.expectedQuantity} → ${countedQuantity}.`,
      }),
    });
    const applied=await applyResponse.json() as {ok?:boolean;error?:string};
    if(!applyResponse.ok||!applied.ok){
      setMessage(applied.error||`Physical count issue #${result.issueId} was recorded but could not be applied. Use Core → Count Issues to review it.`);
      await load();
      return;
    }
    setMessage(`Physical count applied: ${snapshot.partNumber} at ${snapshot.warehouseName} changed from ${snapshot.expectedQuantity} to ${countedQuantity}.`);
    await load();
  }

  function editPart(item: Part) {
    if (!closeQuickUpdate()) return;
    setMessage("");
    const links = vendorsForPart(item);
    const warehouseMinimums: Record<string, string> = {};
    const warehouseBins: Record<string, string> = {};
    for (const stock of item.warehouseStocks ?? []) {
      if (stock.minimumQuantity != null) warehouseMinimums[stock.warehouseCode] = String(stock.minimumQuantity);
      warehouseBins[stock.warehouseCode] = stock.binLocation ?? "";
    }
    setPart({
      id: item.id,
      partNumber: item.partNumber,
      description: item.description,
      quantityOnHand: item.quantityOnHand,
      reorderLevel: item.reorderLevel,
      unitCost: item.unitCost == null ? "" : String(item.unitCost),
      location: item.location,
      preferredVendorId: item.preferredVendorId == null ? "" : String(item.preferredVendorId),
      vendorIds: links.map((itemVendor) => itemVendor.id).filter((id) => id > 0),
      warehouseMinimums,
      warehouseBins,
      equipmentIds: item.compatibleEquipmentIds ?? [],
      crossReferences: item.crossReferences ?? [],
      initialWarehouseCode: "",
      sourceRequestId: null,
      sourceRequestedQuantity: 0,
    });
    setShowPartForm(true);
  }

  function toggleVendor(vendorId: number) {
    setPart((current) => {
      const selected = current.vendorIds.includes(vendorId) ? current.vendorIds.filter((id) => id !== vendorId) : [...current.vendorIds, vendorId];
      const preferred = current.preferredVendorId && selected.includes(Number(current.preferredVendorId)) ? current.preferredVendorId : "";
      return { ...current, vendorIds: selected, preferredVendorId: preferred };
    });
  }

  function toggleEquipment(equipmentId: number) {
    setPart((current) => ({
      ...current,
      equipmentIds: current.equipmentIds.includes(equipmentId)
        ? current.equipmentIds.filter((id) => id !== equipmentId)
        : [...current.equipmentIds, equipmentId],
    }));
  }

  const editingItem = part.id ? (data?.parts ?? []).find((item) => item.id === part.id) ?? null : null;
  const editingWarehouseStocks = editingItem?.warehouseStocks ?? [];
  const editingPhysicalTotal = editingWarehouseStocks.reduce((sum, stock) => sum + Number(stock.physicalOnHand ?? stock.quantityOnHand), 0);
  const selectedVendors = (data?.vendors ?? []).filter((itemVendor) => part.vendorIds.includes(itemVendor.id));
  const selectedWarehouseName = warehouseCode === "ALL" ? "All warehouses" : (data?.warehouses ?? []).find((warehouse) => warehouse.code === warehouseCode)?.name ?? warehouseCode;

  return (
    <main className="inventory-page" style={{ minHeight: "100vh", background: "#f3f5f7", padding: "42px", color: "#182331" }}>
      <ModuleTabs module="parts" />
      <header style={{ display: "flex", justifyContent: "space-between", gap: 24, alignItems: "flex-end" }}>
        <div>
          <p style={{ margin: 0, color: "#2f6f60", fontSize: 12, fontWeight: 800, letterSpacing: ".16em" }}>PARTS OPERATIONS</p>
          <h1 style={{ margin: "8px 0 0", color: "#0d1b2b", fontSize: 34 }}>Inventory</h1>
          <p style={{ margin: "8px 0 0", color: "#68746f" }}>Find a part, update its bins and minimum, or record a physical count.</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" onClick={() => void printAudit()} disabled={!data || printingAudit || partStatus !== "active"} title={partStatus === "archived" ? "Select Active Parts to print a stock audit." : "Print the selected warehouse and filters with blank physical-count columns, or save as PDF."} style={{ border: "1px solid #0d1b2b", borderRadius: 9, padding: "13px 18px", background: "white", color: "#0d1b2b", fontWeight: 800, opacity: !data || printingAudit || partStatus !== "active" ? 0.55 : 1 }}>{printingAudit ? "Preparing audit…" : "Print Audit Sheet"}</button>
          <button onClick={() => { if (!closeQuickUpdate()) return; setMessage(""); setVendor(blankVendor); setShowVendorForm(true); }} style={{ border: "1px solid #0d1b2b", borderRadius: 9, padding: "13px 18px", background: "white", color: "#0d1b2b", fontWeight: 800 }}>+ Add vendor</button>
          <button onClick={() => { if (!closeQuickUpdate()) return; setMessage(""); setPart(blankPart); setShowPartForm(true); }} style={{ border: 0, borderRadius: 9, padding: "13px 18px", background: "#0d1b2b", color: "white", fontWeight: 800 }}>+ New inventory item</button>
        </div>
      </header>

      {message && <div role="status" style={{ marginTop: 20, padding: 12, background: "#fff8e6", border: "1px solid #f2c66d", borderRadius: 9 }}>{message}</div>}

      <section style={{ marginTop: 22, padding: 16, background: "white", border: "1px solid #d7ded9", borderRadius: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
        <label style={{ display: "grid", gap: 6, minWidth: 190, fontSize: 12, fontWeight: 800, color: "#657383" }}>WAREHOUSE
          <select value={warehouseCode} onChange={(event) => changeView(() => setWarehouseCode(event.target.value))} disabled={quickBusy} style={{ padding: "10px 12px", border: "1px solid #d7ded9", borderRadius: 8, background: "white" }}>
            <option value="ALL">All warehouses</option>
            {(data?.warehouses ?? []).map((warehouse) => <option key={warehouse.code} value={warehouse.code}>{warehouse.name}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 6, minWidth: 175, fontSize: 12, fontWeight: 800, color: "#657383" }}>STOCK VIEW
          <select value={stockFilter} onChange={(event) => changeView(() => setStockFilter(event.target.value as StockFilter))} disabled={quickBusy} style={{ padding: "10px 12px", border: "1px solid #d7ded9", borderRadius: 8, background: "white" }}>
            <option value="all">All parts</option>
            <option value="below-minimum">Below minimum only</option>
            <option value="negative">Negative stock only</option>
          </select>
        </label>
        <label style={{ display: "grid", gap: 6, minWidth: 190, fontSize: 12, fontWeight: 800, color: "#657383" }}>SORT
          <select value={sortMode} onChange={(event) => changeView(() => setSortMode(event.target.value as SortMode))} disabled={quickBusy} style={{ padding: "10px 12px", border: "1px solid #d7ded9", borderRadius: 8, background: "white" }}>
            <option value="description">Description A-Z</option>
            <option value="negative-first">Negative stock first</option>
            <option value="qty-asc">Quantity low to high</option>
            <option value="qty-desc">Quantity high to low</option>
            <option value="part-number">Part number</option>
          </select>
        </label>
        {(data?.warehouses ?? []).map((warehouse) => <button key={warehouse.code} disabled={quickBusy} onClick={() => changeView(() => { setWarehouseCode(warehouse.code); setStockFilter("all"); })} style={{ padding: "10px 14px", border: "1px solid #d7ded9", borderRadius: 8, background: warehouseCode === warehouse.code ? "#0d1b2b" : "white", color: warehouseCode === warehouse.code ? "white" : "#182331", fontWeight: 800 }}>{warehouse.name}</button>)}
        <div style={{ marginLeft: "auto", display: "flex", gap: 7 }}>
          <button onClick={() => changeView(() => setPartStatus("active"))} disabled={quickBusy} style={{ padding: "10px 14px", border: "1px solid #0d1b2b", borderRadius: 8, background: partStatus === "active" ? "#0d1b2b" : "white", color: partStatus === "active" ? "white" : "#0d1b2b", fontWeight: 800 }}>Active Parts</button>
          <button onClick={() => changeView(() => setPartStatus("archived"))} disabled={quickBusy} style={{ padding: "10px 14px", border: "1px solid #68746f", borderRadius: 8, background: partStatus === "archived" ? "#68746f" : "white", color: partStatus === "archived" ? "white" : "#44515e", fontWeight: 800 }}>Archived Parts</button>
        </div>
      </section>

      <section style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px,1fr))", gap: 14 }}>
        {[
          ["ACTIVE PARTS", scopedSummary.partCount.toLocaleString()],
          ["BELOW MINIMUM", scopedSummary.lowStockCount.toLocaleString()],
          ["NEGATIVE STOCK", scopedSummary.negativeStockCount.toLocaleString()],
          ["UNITS AVAILABLE", scopedSummary.totalUnits.toLocaleString()],
          ["INVENTORY VALUE", scopedSummary.inventoryValue.toLocaleString(undefined, { style: "currency", currency: "USD" })],
        ].map(([label, value]) => (
          <article key={label} style={{ padding: 20, borderRadius: 12, background: "white", border: "1px solid #d7ded9" }}>
            <span style={{ color: "#778491", fontSize: 10, fontWeight: 800, letterSpacing: ".13em" }}>{label}</span>
            <strong style={{ display: "block", marginTop: 9, color: label === "NEGATIVE STOCK" && scopedSummary.negativeStockCount ? "#b42318" : "#0d1b2b", fontSize: 30 }}>{value}</strong>
          </article>
        ))}
      </section>

      <section style={{ marginTop: 22, background: "white", border: "1px solid #d7ded9", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 18, borderBottom: "1px solid #d7ded9", display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <input aria-label="Search inventory" value={query} onChange={(event) => changeView(() => setQuery(event.target.value))} disabled={quickBusy} placeholder="Search part, cross-reference, vendor, equipment, bin…" style={{ width: "min(520px, 100%)", padding: "11px 13px", border: "1px solid #d7ded9", borderRadius: 9 }} />
          <span style={{ color: "#68746f", fontSize: 13 }}><b>{partStatus === "archived" ? "Archived Parts" : selectedWarehouseName}</b> · {visibleParts.length} visible</span>
          <small style={{ width: "100%", color: "#68746f" }}>{partStatus === "archived" ? "Select Active Parts to print a stock audit." : "Print Audit Sheet uses the selected warehouse, search, stock view, and sort. For a full audit, choose All parts and clear the search."}</small>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 960 }}>
            <thead><tr>{["Part", "Available", "Bin location", "Minimum", "On order", "Unit cost", "Actions"].map((heading) => <th key={heading} scope="col" style={{ padding: 13, textAlign: "left", background: "#f7f9fa", color: "#657383", fontSize: 11 }}>{heading}</th>)}</tr></thead>
            <tbody>
              {visibleParts.map((item) => {
                const links = vendorsForPart(item);
                const stock = stockFor(item);
                const negative = stock.quantityOnHand < 0;
                const lowStock = stock.quantityOnHand < stock.minimumQuantity;
                const equipment = item.compatibleEquipment ?? [];
                return (
                  <Fragment key={item.id}>
                  <tr style={{ borderTop: "1px solid #edf0f2", background: quickUpdate?.partId === item.id ? "#edf4fa" : negative ? "#fff0f0" : lowStock ? "#fff8e6" : "white" }}>
                    <td style={{ padding: 13, minWidth: 220, maxWidth: 360 }}><strong style={{ display: "block", fontSize: 14, color: "#153b57" }}>{item.partNumber}</strong><span style={{ display: "block", marginTop: 4, lineHeight: 1.5 }}>{item.description}</span>{warehouseCode === "ALL" && <small style={{ display: "block", color: "#68746f", marginTop: 4 }}>{(item.warehouseStocks ?? []).map((entry) => entry.warehouseName).join(" · ") || "No warehouse assigned"}</small>}</td>
                    <td style={{ padding: 13 }}><strong style={{ fontSize: 18, color: negative ? "#b42318" : lowStock ? "#a85b00" : "#182331" }}>{stock.quantityOnHand}</strong></td>
                    <td style={{ padding: 13, whiteSpace: "pre-line", overflowWrap: "anywhere", maxWidth: 290 }}>{stock.binLocation || <span style={{ color: "#7b8793" }}>Not recorded</span>}</td>
                    <td style={{ padding: 13 }}>{stock.minimumQuantity}</td>
                    <td style={{ padding: 13 }}>{stock.onOrder || "—"}</td>
                    <td style={{ padding: 13 }}>{stock.unitCost == null ? "—" : stock.unitCost.toLocaleString(undefined, { style: "currency", currency: "USD" })}</td>
                    <td style={{ padding: 13, minWidth: 220 }}>
                      <div className={pageStyles.rowActions}>
                        {partStatus === "active" ? <button type="button" className={pageStyles.updateButton} aria-expanded={quickUpdate?.partId === item.id} aria-controls={`inventory-update-${item.id}`} onClick={() => toggleQuickUpdate(item)} disabled={quickBusy}>Update {quickUpdate?.partId === item.id ? "▴" : "▾"}</button> : <button type="button" onClick={() => void restorePart(item)} className={pageStyles.detailsButton}>Restore</button>}
                        <button type="button" onClick={() => editPart(item)} className={pageStyles.detailsButton} disabled={quickBusy}>Part details</button>
                      </div>
                      <div style={{ marginTop: 8 }}><ReceivingHistoryButton partId={item.id} partNumber={item.partNumber} description={item.description}/></div>
                    </td>
                  </tr>
                  {quickUpdate?.partId === item.id && <tr id={`inventory-update-${item.id}`}><td colSpan={7} style={{ padding: 0 }}>
                    <InventoryQuickUpdate key={`${item.id}:${quickUpdate.warehouseCode}`} part={item} warehouses={data?.warehouses ?? []} initialWarehouseCode={quickUpdate.warehouseCode} onSaved={quickUpdateSaved} onClose={() => { closeQuickUpdate(); }} onDirtyChange={setQuickDirty} onBusyChange={setQuickBusy} />
                    <div className={pageStyles.partContext}><div><strong>Suppliers</strong><span>{links.length ? links.map((itemVendor) => `${itemVendor.name}${itemVendor.preferred ? " ★" : ""}`).join(", ") : "No suppliers selected"}</span></div><div><strong>Used on equipment</strong><span>{equipment.length ? equipment.map((entry) => entry.unit).join(", ") : "No equipment linked"}</span></div></div>
                  </td></tr>}
                  </Fragment>
                );
              })}
              {!visibleParts.length && <tr><td colSpan={7} style={{ padding: 30, textAlign: "center", color: "#68746f" }}>No inventory records match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {showVendorForm && (
        <div style={{ position: "fixed", inset: 0, background: "#07111db8", display: "grid", placeItems: "center", padding: 20, zIndex: 60 }}>
          <form onSubmit={saveVendor} className={pageStyles.partForm} style={{ width: "min(560px,100%)" }}>
            <div style={{ gridColumn: "1 / -1" }}><h2 style={{ margin: 0 }}>Add vendor</h2><p style={{ margin: "7px 0 0", color: "#68746f", fontSize: 13 }}>New vendors become available immediately in every part&apos;s supplier list.</p></div>
            <label className={pageStyles.field} style={{ gridColumn: "1 / -1" }}>Vendor name<input required value={vendor.name} onChange={(event) => setVendor({ ...vendor, name: event.target.value })} /></label>
            <label className={pageStyles.field}>Phone<input type="tel" value={vendor.phone} onChange={(event) => setVendor({ ...vendor, phone: event.target.value })} /></label>
            <label className={pageStyles.field}>Email<input type="email" value={vendor.email} onChange={(event) => setVendor({ ...vendor, email: event.target.value })} /></label>
            <label className={pageStyles.field} style={{ gridColumn: "1 / -1" }}>Notes<textarea value={vendor.notes} onChange={(event) => setVendor({ ...vendor, notes: event.target.value })} rows={4} style={{ resize: "vertical" }} /></label>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 10 }}><button type="button" onClick={() => { setShowVendorForm(false); setVendor(blankVendor); }} style={{ padding: "11px 16px" }}>Cancel</button><button type="submit" style={{ border: 0, borderRadius: 8, padding: "11px 18px", background: "#2f6f60", color: "white", fontWeight: 800 }}>Save vendor</button></div>
          </form>
        </div>
      )}

      {showPartForm && (
        <div style={{ position: "fixed", inset: 0, background: "#07111db8", display: "grid", placeItems: "center", padding: 20, zIndex: 50, overflowY: "auto" }}>
          <form onSubmit={savePart} className={pageStyles.partForm} role="dialog" aria-modal="true" aria-labelledby="inventory-part-form-title" aria-busy={partSaving}>
            <header className={pageStyles.modalHeader}><div><h2 id="inventory-part-form-title">{part.id ? "Part details" : "New inventory item"}</h2><p>{part.id ? `${part.partNumber} · ${part.description}` : part.sourceRequestId ? `Create a stocked item for the technician request · Qty requested ${part.sourceRequestedQuantity || "—"}` : "Create a normal stocked item. One-time/non-stock purchases are created from Parts Desk."}</p></div><button type="button" className={pageStyles.detailsButton} disabled={partSaving} onClick={() => { setShowPartForm(false); setPart(blankPart); }}>Close</button></header>
            {message && <p role="alert" style={{ gridColumn: "1 / -1", background: "#fff8e6", padding: 12, borderRadius: 7, margin: 0 }}>{message}</p>}
            <label className={pageStyles.field}>Part number<input required value={part.partNumber} onChange={(event) => setPart({ ...part, partNumber: event.target.value })} disabled={partSaving} /></label>
            <label className={pageStyles.field}>Description<input required value={part.description} onChange={(event) => setPart({ ...part, description: event.target.value })} disabled={partSaving} /></label>
            {!part.id && <label className={pageStyles.field}>Initial warehouse
              <select required={part.quantityOnHand > 0 || Boolean(part.sourceRequestId)} value={part.initialWarehouseCode} onChange={(event) => setPart({ ...part, initialWarehouseCode: event.target.value })} disabled={partSaving}>
                <option value="">Choose warehouse…</option>
                {(data?.warehouses ?? []).map((warehouse) => <option key={warehouse.code} value={warehouse.code}>{warehouse.name}</option>)}
              </select>
              <small>{part.sourceRequestId ? "Required so the technician request becomes normal demand for this warehouse. Initial quantity means physical stock actually on hand, not the quantity requested." : "Required when the new item starts with stock on hand. This makes the quantity usable in technician Part Lookup immediately."}</small>
            </label>}
            {part.id ? <div style={{ padding: 11, border: "1px solid #d7ded9", borderRadius: 8, background: "#f7f9fa" }}>
              <span style={{ display: "block", color: "#657383", fontSize: 10, fontWeight: 900, letterSpacing: ".08em" }}>TOTAL WAREHOUSE STOCK — READ ONLY</span>
              <strong style={{ display: "block", marginTop: 5, fontSize: 20, color: Number(editingWarehouseStocks.length ? editingPhysicalTotal : (editingItem?.quantityOnHand ?? part.quantityOnHand)) < 0 ? "#b42318" : "#182331" }}>{editingWarehouseStocks.length ? editingPhysicalTotal : (editingItem?.quantityOnHand ?? part.quantityOnHand)}</strong>
              <small style={{ display: "block", marginTop: 4, color: "#68746f" }}>Use Warehouse physical stock below to correct inventory. Editing the part record does not change warehouse counts.</small>
            </div> : <label className={pageStyles.field}>Initial quantity on hand<input type="number" min="0" step="any" value={part.quantityOnHand} onChange={(event) => setPart({ ...part, quantityOnHand: Number(event.target.value) })} disabled={partSaving} /></label>}
            <label className={pageStyles.field}>Default minimum stock<input type="number" min="0" step="any" value={part.reorderLevel} onChange={(event) => setPart({ ...part, reorderLevel: Number(event.target.value) })} disabled={partSaving} /><small>Used when a warehouse does not have its own minimum.</small></label>
            <label className={pageStyles.field}>Unit cost ($)<input type="number" min="0" step="0.01" value={part.unitCost} onChange={(event) => setPart({ ...part, unitCost: event.target.value })} disabled={partSaving} /></label>
            <label className={pageStyles.field}>General location / fallback bin<input value={part.location} onChange={(event) => setPart({ ...part, location: event.target.value })} disabled={partSaving} /><small>Only for parts without a warehouse. Edit Clare/Cadillac bin locations in Warehouse physical stock below.</small></label>

            <label className={pageStyles.field} style={{ gridColumn: "1 / -1" }}>Cross Reference Part Numbers
              <textarea
                rows={4}
                value={part.crossReferences.join("\n")}
                onChange={(event) => setPart({ ...part, crossReferences: event.target.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) })}
                disabled={partSaving || partStatus === "archived"}
                placeholder={"Enter one cross-reference per line\nExample: LF14000NN\nExample: P551005"}
                style={{ resize: "vertical" }}
              />
              <small>Enter alternate, interchange, vendor, or manufacturer part numbers one per line. These numbers will find this same inventory part in Inventory, Receiving, Transfers, and technician part search.</small>
            </label>

            {part.id && editingItem && <fieldset style={{ gridColumn: "1 / -1", border: "1px solid #d7ded9", borderRadius: 10, padding: 14 }}>
              <legend style={{ fontWeight: 800, padding: "0 6px" }}>Warehouse physical stock</legend>
              <p style={{ margin: "0 0 10px", color: "#68746f", fontSize: 13 }}>Physical stock includes reserved parts. Choose <b>Physical Count</b> for the warehouse you counted.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 9 }}>
                {editingWarehouseStocks.length ? editingWarehouseStocks.map((stock) => <div key={stock.warehouseCode} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "start", padding: 10, border: "1px solid #edf0f2", borderRadius: 8, background: Number(stock.quantityOnHand) < 0 ? "#fff0f0" : "white" }}>
                  <span><b>{stock.warehouseName}</b><small style={{ display: "block", color: "#68746f", marginTop: 3 }}>{stock.warehouseCode}{Number(stock.reserved ?? 0) > 0 ? ` · ${stock.reserved} reserved` : ""}</small></span>
                  <span style={{ textAlign: "right" }}><strong style={{ display: "block", color: Number(stock.physicalOnHand ?? stock.quantityOnHand) < 0 ? "#b42318" : "#182331", fontSize: 18 }}>{stock.physicalOnHand ?? stock.quantityOnHand}</strong><small style={{ display: "block", color: "#68746f" }}>physical</small><button type="button" disabled={partSaving} onClick={() => void physicalCount(editingItem, stock.warehouseCode)} style={{ marginTop: 4, padding: "6px 9px", border: "1px solid #0d1b2b", borderRadius: 7, background: "white", color: "#0d1b2b", fontSize: 10, fontWeight: 900 }}>PHYSICAL COUNT</button></span>
                  <label style={{ gridColumn: "1 / -1", display: "grid", gap: 5, color: "#334d63", fontSize: 12, fontWeight: 800 }}>Bin location(s)
                    <textarea
                      rows={2}
                      disabled={partSaving}
                      value={part.warehouseBins[stock.warehouseCode] ?? ""}
                      onChange={(event) => setPart((current) => ({ ...current, warehouseBins: { ...current.warehouseBins, [stock.warehouseCode]: event.target.value } }))}
                      placeholder="Enter bin location; use a new line for each additional bin"
                      style={{ width: "100%", boxSizing: "border-box", resize: "vertical", minHeight: 44, padding: "8px 10px", border: "1px solid #a9b9c7", borderRadius: 7, background: "white", color: "#172d40", fontSize: 13 }}
                    />
                  </label>
                </div>) : <div style={{ color: "#68746f", fontSize: 12 }}>No warehouse stock rows exist for this part yet.</div>}
              </div>
            </fieldset>}

            <fieldset style={{ gridColumn: "1 / -1", border: "1px solid #d7ded9", borderRadius: 10, padding: 14 }}>
              <legend style={{ fontWeight: 800, padding: "0 6px" }}>Minimum stock by warehouse</legend>
              <p style={{ margin: "0 0 10px", color: "#68746f", fontSize: 13 }}>Blank uses the default minimum stock above. Enter 0 to set no minimum.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
                {(data?.warehouses ?? []).map((warehouse) => (
                  <label key={warehouse.code} style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 700 }}>{warehouse.name}
                    <input type="number" min="0" step="any" disabled={partSaving} placeholder={`Default: ${part.reorderLevel}`} value={part.warehouseMinimums[warehouse.code] ?? ""} onChange={(event) => setPart((current) => ({ ...current, warehouseMinimums: { ...current.warehouseMinimums, [warehouse.code]: event.target.value } }))} />
                  </label>
                ))}
              </div>
            </fieldset>

            <div style={{ gridColumn: "1 / -1" }}><InventoryChoicePicker label="Suppliers" options={(data?.vendors ?? []).map((itemVendor) => ({ id: itemVendor.id, label: itemVendor.name }))} selectedIds={part.vendorIds} onToggle={toggleVendor} placeholder="Choose suppliers…" emptyText="Add a vendor to make it available here." disabled={partSaving} /></div>

            <label className={pageStyles.field} style={{ gridColumn: "1 / -1" }}>Preferred vendor
              <select value={part.preferredVendorId} onChange={(event) => setPart({ ...part, preferredVendorId: event.target.value })} disabled={partSaving}><option value="">No preferred vendor</option>{selectedVendors.map((itemVendor) => <option key={itemVendor.id} value={itemVendor.id}>{itemVendor.name}</option>)}</select>
            </label>

            <div style={{ gridColumn: "1 / -1" }}><InventoryChoicePicker label="Used on equipment" options={(data?.equipment ?? []).map((equipment) => ({ id: equipment.id, label: equipment.unit, description: `${equipment.category} · ${equipment.equipmentType}` }))} selectedIds={part.equipmentIds} onToggle={toggleEquipment} placeholder="Choose trucks, trailers, or other equipment…" emptyText="No active equipment is available." disabled={partSaving} /></div>

            {part.id && editingItem && <fieldset style={{ gridColumn: "1 / -1", border: "1px solid #d7ded9", borderRadius: 10, padding: 14 }}>
              <legend style={{ fontWeight: 800, padding: "0 6px" }}>Warehouse availability</legend>
              <p style={{ margin: "0 0 10px", color: "#68746f", fontSize: 13 }}>Archive or remove this part from one warehouse without affecting any other warehouse. Existing stock, receipts, and history are preserved.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10 }}>
                {(data?.warehouses ?? []).map((warehouse) => {
                  const status = warehouseStatusFor(editingItem, warehouse.code);
                  return <div key={warehouse.code} style={{ padding: 12, border: "1px solid #d7ded9", borderRadius: 9, background: status === "active" ? "#f7fbf8" : status === "archived" ? "#fff8e6" : "#fff3f3" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <strong>{warehouse.name}</strong>
                      <span style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase" }}>{status}</span>
                    </div>
                    <div style={{ display: "flex", gap: 7, marginTop: 10, flexWrap: "wrap" }}>
                      {status !== "active"
                        ? <button type="button" disabled={partSaving} onClick={() => void setWarehousePartStatus(editingItem, warehouse.code, "active")} className={pageStyles.detailsButton}>Restore here</button>
                        : <>
                            <button type="button" disabled={partSaving} onClick={() => void setWarehousePartStatus(editingItem, warehouse.code, "archived")} className={pageStyles.detailsButton}>Archive here</button>
                            {data?.viewerRole === "admin" && <button type="button" disabled={partSaving} onClick={() => void setWarehousePartStatus(editingItem, warehouse.code, "removed")} style={{ padding: "8px 11px", border: "1px solid #b42318", borderRadius: 7, background: "white", color: "#b42318", fontWeight: 800 }}>Remove here</button>}
                          </>}
                    </div>
                  </div>;
                })}
              </div>
            </fieldset>}

            <div className={pageStyles.modalFooter}>
              <div style={{ display: "flex", gap: 8 }}>
                {partStatus === "archived" && part.id && editingItem && <button type="button" disabled={partSaving} onClick={() => void restorePart(editingItem)} style={{ padding: "11px 16px", border: "1px solid #2f6f60", borderRadius: 8, background: "white", color: "#2f6f60", fontWeight: 900 }}>Restore Global Legacy Archive</button>}
              </div>
              <div style={{ display: "flex", gap: 10 }}><button type="button" disabled={partSaving} onClick={() => { setShowPartForm(false); setPart(blankPart); }} className={pageStyles.detailsButton}>Cancel</button><button type="submit" disabled={partSaving} style={{ border: 0, borderRadius: 8, padding: "11px 18px", background: "#2f6f60", color: "white", fontWeight: 800, opacity: partSaving ? 0.6 : 1 }}>{partSaving ? "Saving…" : "Save part"}</button></div>
            </div>
          </form>
        </div>
      )}
      {auditSnapshot && <InventoryAuditSheet snapshot={auditSnapshot} />}
    </main>
  );
}
