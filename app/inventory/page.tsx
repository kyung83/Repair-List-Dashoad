"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import ModuleTabs from "../module-tabs";
import ReceivingHistoryButton from "./receiving-history-button";

type WarehouseStock = {
  id: number;
  warehouseCode: string;
  warehouseName: string;
  quantityOnHand: number;
  physicalOnHand?: number;
  reserved?: number;
  available?: number;
  unitOfMeasure: string;
  unitCost: number | null;
  onOrder: number;
  minimumQuantity: number | null;
};

type Equipment = { id: number; unit: string; category: string; equipmentType: string };
type CompatibleEquipment = { id: number; unit: string };
type Part = {
  id: number;
  partNumber: string;
  description: string;
  quantityOnHand: number;
  reorderLevel: number;
  unitCost: number | null;
  location: string;
  preferredVendorId: number | null;
  vendorName: string;
  warehouseStocks?: WarehouseStock[];
  compatibleEquipment?: CompatibleEquipment[];
  compatibleEquipmentIds?: number[];
  crossReferences?: string[];
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
  equipmentIds: number[];
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
  equipmentIds: [],
};

const blankVendor: VendorForm = { id: 0, name: "", phone: "", email: "", notes: "" };

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
  const [equipmentQuery, setEquipmentQuery] = useState("");

  async function load() {
    const [inventoryResponse, linksResponse] = await Promise.all([
      fetch(`/api/inventory?status=${partStatus}`, { cache: "no-store" }),
      fetch("/api/inventory/part-vendors", { cache: "no-store" }),
    ]);
    if (!inventoryResponse.ok) throw new Error("Unable to load inventory");
    if (!linksResponse.ok) throw new Error("Unable to load part vendors");
    const [inventory, links] = await Promise.all([inventoryResponse.json(), linksResponse.json()]);
    setData(inventory as InventoryData);
    setVendorLinks((links as { byPart?: Record<string, VendorLink[]> }).byPart ?? {});
  }

  useEffect(() => {
    void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to load inventory"));
  }, [partStatus]);

  function vendorsForPart(item: Part) {
    const linked = vendorLinks[String(item.id)] ?? [];
    if (linked.length) return linked;
    return item.vendorName ? [{ id: item.preferredVendorId ?? 0, name: item.vendorName, preferred: true }] : [];
  }

  function stockFor(item: Part) {
    if (warehouseCode === "ALL") {
      return {
        quantityOnHand: Number(item.quantityOnHand),
        unitCost: item.unitCost,
        location: item.location,
        onOrder: (item.warehouseStocks ?? []).reduce((sum, stock) => sum + Number(stock.onOrder || 0), 0),
        minimumQuantity: Number(item.reorderLevel),
      };
    }
    const stock = (item.warehouseStocks ?? []).find((row) => row.warehouseCode === warehouseCode);
    return {
      quantityOnHand: Number(stock?.quantityOnHand ?? 0),
      unitCost: stock?.unitCost ?? item.unitCost,
      location: stock?.warehouseName ?? warehouseCode,
      onOrder: Number(stock?.onOrder ?? 0),
      minimumQuantity: stock?.minimumQuantity == null ? Number(item.reorderLevel) : Number(stock.minimumQuantity),
    };
  }

  const scopedParts = useMemo(() => (data?.parts ?? []).filter((item) =>
    warehouseCode === "ALL" || (item.warehouseStocks ?? []).some((stock) => stock.warehouseCode === warehouseCode),
  ), [data, warehouseCode]);

  const visibleParts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = scopedParts.filter((item) => {
      const stock = stockFor(item);
      if (stockFilter === "negative" && stock.quantityOnHand >= 0) return false;
      if (stockFilter === "below-minimum" && stock.quantityOnHand >= stock.minimumQuantity) return false;
      const vendorNames = (vendorLinks[String(item.id)] ?? []).map((itemVendor) => itemVendor.name).join(" ");
      const equipmentNames = (item.compatibleEquipment ?? []).map((equipment) => equipment.unit).join(" ");
      return [item.partNumber, item.description, ...(item.crossReferences ?? []), item.location, item.vendorName, vendorNames, equipmentNames].join(" ").toLowerCase().includes(q);
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
  }, [query, scopedParts, sortMode, stockFilter, vendorLinks, warehouseCode]);

  const scopedSummary = scopedParts.reduce((summary, item) => {
    const stock = stockFor(item);
    summary.partCount += 1;
    summary.totalUnits += stock.quantityOnHand;
    summary.inventoryValue += stock.quantityOnHand * (stock.unitCost ?? 0);
    if (stock.quantityOnHand < stock.minimumQuantity) summary.lowStockCount += 1;
    if (stock.quantityOnHand < 0) summary.negativeStockCount += 1;
    return summary;
  }, { partCount: 0, lowStockCount: 0, negativeStockCount: 0, totalUnits: 0, inventoryValue: 0 });

  async function savePart(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    const preferredVendorId = part.preferredVendorId ? Number(part.preferredVendorId) : null;
    const vendorIds = [...new Set(part.vendorIds.concat(preferredVendorId ? [preferredVendorId] : []))];
    const response = await fetch("/api/inventory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "savePart", ...part, preferredVendorId }),
    });
    const result = (await response.json()) as { id?: number; error?: string };
    if (!response.ok || !result.id) return setMessage(result.error || "Part could not be saved");

    const [vendorResponse, settingsResponse] = await Promise.all([
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
    ]);
    const vendorResult = (await vendorResponse.json()) as { error?: string };
    const settingsResult = (await settingsResponse.json()) as { error?: string };
    if (!vendorResponse.ok) return setMessage(vendorResult.error || "Part saved, but vendors could not be saved");
    if (!settingsResponse.ok) return setMessage(settingsResult.error || "Part saved, but minimums/equipment could not be saved");

    setPart(blankPart);
    setEquipmentQuery("");
    setShowPartForm(false);
    setMessage("Part, vendors, minimums, and equipment saved.");
    await load();
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

  async function archivePart(item: Part) {
    const stock = stockFor(item).quantityOnHand;
    const warning = stock !== 0 ? `\n\nThis part currently shows ${stock} available in the selected view. Archiving hides it from active inventory and mechanic part search, but does not delete its history or stock records.` : "";
    if (!window.confirm(`Archive ${item.partNumber} — ${item.description}?${warning}`)) return;
    setMessage("");
    const response = await fetch("/api/inventory",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"archivePart",partId:item.id})});
    const result = await response.json() as {ok?:boolean;error?:string};
    if(!response.ok||!result.ok){setMessage(result.error||"Part could not be archived.");return}
    setMessage(`${item.partNumber} archived. It is hidden from active inventory and mechanic searches but all history is preserved.`);
    await load();
  }

  async function restorePart(item: Part) {
    setMessage("");
    const response = await fetch("/api/inventory",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"restorePart",partId:item.id})});
    const result = await response.json() as {ok?:boolean;error?:string};
    if(!response.ok||!result.ok){setMessage(result.error||"Part could not be restored.");return}
    setMessage(`${item.partNumber} restored to active inventory.`);
    await load();
  }

  async function deletePart(item: Part) {
    const typed = window.prompt(`PERMANENT DELETE is admin-only and cannot be undone.\n\nType the part number exactly to delete ${item.partNumber}:`);
    if (typed == null) return;
    if (typed.trim().toUpperCase() !== item.partNumber.trim().toUpperCase()) {
      setMessage("Delete cancelled because the part number did not match.");
      return;
    }
    setMessage("");
    const response = await fetch("/api/inventory",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"deletePart",partId:item.id})});
    const result = await response.json() as {ok?:boolean;error?:string};
    if(!response.ok||!result.ok){setMessage(result.error||"Part could not be permanently deleted.");return}
    setMessage(`${item.partNumber} permanently deleted.`);
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
    const links = vendorsForPart(item);
    const warehouseMinimums: Record<string, string> = {};
    for (const stock of item.warehouseStocks ?? []) {
      if (stock.minimumQuantity != null) warehouseMinimums[stock.warehouseCode] = String(stock.minimumQuantity);
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
      equipmentIds: item.compatibleEquipmentIds ?? [],
    });
    setEquipmentQuery("");
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
  const selectedEquipment = (data?.equipment ?? []).filter((equipment) => part.equipmentIds.includes(equipment.id));
  const equipmentMatches = (data?.equipment ?? []).filter((equipment) => {
    const q = equipmentQuery.trim().toLowerCase();
    return !q || [equipment.unit, equipment.category, equipment.equipmentType].join(" ").toLowerCase().includes(q);
  }).slice(0, 120);
  const selectedWarehouseName = warehouseCode === "ALL" ? "All warehouses" : (data?.warehouses ?? []).find((warehouse) => warehouse.code === warehouseCode)?.name ?? warehouseCode;

  return (
    <main style={{ minHeight: "100vh", background: "#f3f5f7", padding: "42px", color: "#182331" }}>
      <ModuleTabs module="parts" />
      <header style={{ display: "flex", justifyContent: "space-between", gap: 24, alignItems: "flex-end" }}>
        <div>
          <p style={{ margin: 0, color: "#f47b20", fontSize: 12, fontWeight: 800, letterSpacing: ".16em" }}>PARTS OPERATIONS</p>
          <h1 style={{ margin: "8px 0 0", color: "#0d1b2b", fontSize: 34 }}>Inventory</h1>
          <p style={{ margin: "8px 0 0", color: "#6c7886" }}>Warehouse stock, minimums, vendors, equipment compatibility, repair usage, and controlled physical counts.</p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button onClick={() => { setVendor(blankVendor); setShowVendorForm(true); }} style={{ border: "1px solid #0d1b2b", borderRadius: 9, padding: "13px 18px", background: "white", color: "#0d1b2b", fontWeight: 800 }}>+ Add vendor</button>
          <button onClick={() => { setPart(blankPart); setEquipmentQuery(""); setShowPartForm(true); }} style={{ border: 0, borderRadius: 9, padding: "13px 18px", background: "#0d1b2b", color: "white", fontWeight: 800 }}>+ Add part</button>
        </div>
      </header>

      {message && <div style={{ marginTop: 20, padding: 12, background: "#fff8e6", border: "1px solid #f2c66d", borderRadius: 9 }}>{message}</div>}

      <section style={{ marginTop: 22, padding: 16, background: "white", border: "1px solid #dce2e7", borderRadius: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
        <label style={{ display: "grid", gap: 6, minWidth: 190, fontSize: 12, fontWeight: 800, color: "#657383" }}>WAREHOUSE
          <select value={warehouseCode} onChange={(event) => setWarehouseCode(event.target.value)} style={{ padding: "10px 12px", border: "1px solid #dce2e7", borderRadius: 8, background: "white" }}>
            <option value="ALL">All warehouses</option>
            {(data?.warehouses ?? []).map((warehouse) => <option key={warehouse.code} value={warehouse.code}>{warehouse.name}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 6, minWidth: 175, fontSize: 12, fontWeight: 800, color: "#657383" }}>STOCK VIEW
          <select value={stockFilter} onChange={(event) => setStockFilter(event.target.value as StockFilter)} style={{ padding: "10px 12px", border: "1px solid #dce2e7", borderRadius: 8, background: "white" }}>
            <option value="all">All parts</option>
            <option value="below-minimum">Below minimum only</option>
            <option value="negative">Negative stock only</option>
          </select>
        </label>
        <label style={{ display: "grid", gap: 6, minWidth: 190, fontSize: 12, fontWeight: 800, color: "#657383" }}>SORT
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} style={{ padding: "10px 12px", border: "1px solid #dce2e7", borderRadius: 8, background: "white" }}>
            <option value="description">Description A-Z</option>
            <option value="negative-first">Negative stock first</option>
            <option value="qty-asc">Quantity low to high</option>
            <option value="qty-desc">Quantity high to low</option>
            <option value="part-number">Part number</option>
          </select>
        </label>
        <button onClick={() => { setWarehouseCode("CLARE"); setStockFilter("all"); }} style={{ padding: "10px 14px", border: "1px solid #dce2e7", borderRadius: 8, background: warehouseCode === "CLARE" ? "#0d1b2b" : "white", color: warehouseCode === "CLARE" ? "white" : "#182331", fontWeight: 800 }}>Clare</button>
        <button onClick={() => { setWarehouseCode("BOYNE"); setStockFilter("all"); }} style={{ padding: "10px 14px", border: "1px solid #dce2e7", borderRadius: 8, background: warehouseCode === "BOYNE" ? "#0d1b2b" : "white", color: warehouseCode === "BOYNE" ? "white" : "#182331", fontWeight: 800 }}>Boyne</button>
        <button onClick={() => { setStockFilter("negative"); setSortMode("negative-first"); }} style={{ padding: "10px 14px", border: "1px solid #b42318", borderRadius: 8, background: stockFilter === "negative" ? "#b42318" : "white", color: stockFilter === "negative" ? "white" : "#b42318", fontWeight: 800 }}>Negative only</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 7 }}>
          <button onClick={() => setPartStatus("active")} style={{ padding: "10px 14px", border: "1px solid #0d1b2b", borderRadius: 8, background: partStatus === "active" ? "#0d1b2b" : "white", color: partStatus === "active" ? "white" : "#0d1b2b", fontWeight: 800 }}>Active Parts</button>
          <button onClick={() => setPartStatus("archived")} style={{ padding: "10px 14px", border: "1px solid #6c7886", borderRadius: 8, background: partStatus === "archived" ? "#6c7886" : "white", color: partStatus === "archived" ? "white" : "#44515e", fontWeight: 800 }}>Archived Parts</button>
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
          <article key={label} style={{ padding: 20, borderRadius: 12, background: "white", border: "1px solid #dce2e7" }}>
            <span style={{ color: "#778491", fontSize: 10, fontWeight: 800, letterSpacing: ".13em" }}>{label}</span>
            <strong style={{ display: "block", marginTop: 9, color: label === "NEGATIVE STOCK" && scopedSummary.negativeStockCount ? "#b42318" : "#0d1b2b", fontSize: 30 }}>{value}</strong>
          </article>
        ))}
      </section>

      <section style={{ marginTop: 22, background: "white", border: "1px solid #dce2e7", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 18, borderBottom: "1px solid #dce2e7", display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search part, cross-reference, vendor, equipment…" style={{ width: "min(520px, 100%)", padding: "11px 13px", border: "1px solid #dce2e7", borderRadius: 9 }} />
          <span style={{ color: "#6c7886", fontSize: 13 }}><b>{partStatus === "archived" ? "Archived Parts" : selectedWarehouseName}</b> · {visibleParts.length} visible</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1180 }}>
            <thead><tr>{["Part #", "Description", "Available", "Minimum", "On order", "Location", "Vendors", "Used on", "Unit cost", "Actions"].map((heading) => <th key={heading} style={{ padding: 13, textAlign: "left", background: "#f7f9fa", color: "#657383", fontSize: 11 }}>{heading}</th>)}</tr></thead>
            <tbody>
              {visibleParts.map((item) => {
                const links = vendorsForPart(item);
                const stock = stockFor(item);
                const negative = stock.quantityOnHand < 0;
                const lowStock = stock.quantityOnHand < stock.minimumQuantity;
                const equipment = item.compatibleEquipment ?? [];
                return (
                  <tr key={item.id} style={{ borderTop: "1px solid #edf0f2", background: negative ? "#fff0f0" : lowStock ? "#fff8e6" : "white" }}>
                    <td style={{ padding: 13, fontWeight: 800 }}>{item.partNumber}</td>
                    <td style={{ padding: 13 }}>{item.description}</td>
                    <td style={{ padding: 13 }}><strong style={{ color: negative ? "#b42318" : lowStock ? "#a85b00" : "#182331" }}>{stock.quantityOnHand}</strong></td>
                    <td style={{ padding: 13 }}>{stock.minimumQuantity}</td>
                    <td style={{ padding: 13 }}>{stock.onOrder || "—"}</td>
                    <td style={{ padding: 13 }}>{stock.location || "—"}</td>
                    <td style={{ padding: 13 }}>{links.length ? links.map((itemVendor) => `${itemVendor.name}${itemVendor.preferred ? " ★" : ""}`).join(", ") : "—"}</td>
                    <td style={{ padding: 13, maxWidth: 260 }}>{equipment.length ? `${equipment.slice(0, 5).map((entry) => entry.unit).join(", ")}${equipment.length > 5 ? ` +${equipment.length - 5}` : ""}` : "—"}</td>
                    <td style={{ padding: 13 }}>{stock.unitCost == null ? "—" : stock.unitCost.toLocaleString(undefined, { style: "currency", currency: "USD" })}</td>
                    <td style={{ padding: 13, whiteSpace: "nowrap" }}>
                      <ReceivingHistoryButton partId={item.id} partNumber={item.partNumber} description={item.description}/>
                      <button onClick={() => void physicalCount(item)} style={{ marginRight: 6 }} disabled={warehouseCode === "ALL"}>Physical Count</button>
                      <button onClick={() => editPart(item)} style={{ marginRight: 6 }}>Edit</button>
                      {partStatus === "active" ? <button onClick={() => void archivePart(item)} style={{ marginRight: 6, border: "1px solid #8a5a00", color: "#8a5a00", background: "white", borderRadius: 5, padding: "4px 7px", fontWeight: 800 }}>Archive</button> : <>
                        <button onClick={() => void restorePart(item)} style={{ marginRight: 6, border: "1px solid #176448", color: "#176448", background: "white", borderRadius: 5, padding: "4px 7px", fontWeight: 800 }}>Restore</button>
                        {data?.viewerRole === "admin" && <button onClick={() => void deletePart(item)} style={{ border: "1px solid #b42318", color: "#b42318", background: "white", borderRadius: 5, padding: "4px 7px", fontWeight: 900 }}>Delete</button>}
                      </>}
                    </td>
                  </tr>
                );
              })}
              {!visibleParts.length && <tr><td colSpan={10} style={{ padding: 30, textAlign: "center", color: "#6c7886" }}>No inventory records match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {showVendorForm && (
        <div style={{ position: "fixed", inset: 0, background: "#07111db8", display: "grid", placeItems: "center", padding: 20, zIndex: 60 }}>
          <form onSubmit={saveVendor} style={{ width: "min(560px,100%)", background: "white", borderRadius: 14, padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div style={{ gridColumn: "1 / -1" }}><h2 style={{ margin: 0 }}>Add vendor</h2><p style={{ margin: "7px 0 0", color: "#6c7886", fontSize: 13 }}>New vendors become available immediately in every part's supplier list.</p></div>
            <input required placeholder="Vendor name" value={vendor.name} onChange={(event) => setVendor({ ...vendor, name: event.target.value })} style={{ gridColumn: "1 / -1", padding: 11 }} />
            <input placeholder="Phone" value={vendor.phone} onChange={(event) => setVendor({ ...vendor, phone: event.target.value })} style={{ padding: 11 }} />
            <input type="email" placeholder="Email" value={vendor.email} onChange={(event) => setVendor({ ...vendor, email: event.target.value })} style={{ padding: 11 }} />
            <textarea placeholder="Notes" value={vendor.notes} onChange={(event) => setVendor({ ...vendor, notes: event.target.value })} rows={4} style={{ gridColumn: "1 / -1", padding: 11, resize: "vertical" }} />
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 10 }}><button type="button" onClick={() => { setShowVendorForm(false); setVendor(blankVendor); }} style={{ padding: "11px 16px" }}>Cancel</button><button type="submit" style={{ border: 0, borderRadius: 8, padding: "11px 18px", background: "#f47b20", color: "white", fontWeight: 800 }}>Save vendor</button></div>
          </form>
        </div>
      )}

      {showPartForm && (
        <div style={{ position: "fixed", inset: 0, background: "#07111db8", display: "grid", placeItems: "center", padding: 20, zIndex: 50, overflowY: "auto" }}>
          <form onSubmit={savePart} style={{ width: "min(900px,100%)", background: "white", borderRadius: 14, padding: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, margin: "20px 0" }}>
            <h2 style={{ gridColumn: "1 / -1", margin: 0 }}>{part.id ? "Edit part" : "Add part"}</h2>
            <input required placeholder="Part number" value={part.partNumber} onChange={(event) => setPart({ ...part, partNumber: event.target.value })} style={{ padding: 11 }} />
            <input required placeholder="Description" value={part.description} onChange={(event) => setPart({ ...part, description: event.target.value })} style={{ padding: 11 }} />
            {part.id ? <div style={{ padding: 11, border: "1px solid #dce2e7", borderRadius: 8, background: "#f7f9fa" }}>
              <span style={{ display: "block", color: "#657383", fontSize: 10, fontWeight: 900, letterSpacing: ".08em" }}>TOTAL WAREHOUSE STOCK — READ ONLY</span>
              <strong style={{ display: "block", marginTop: 5, fontSize: 20, color: Number(editingWarehouseStocks.length ? editingPhysicalTotal : (editingItem?.quantityOnHand ?? part.quantityOnHand)) < 0 ? "#b42318" : "#182331" }}>{editingWarehouseStocks.length ? editingPhysicalTotal : (editingItem?.quantityOnHand ?? part.quantityOnHand)}</strong>
              <small style={{ display: "block", marginTop: 4, color: "#6c7886" }}>Use Warehouse physical stock below to correct inventory. Editing the part record does not change warehouse counts.</small>
            </div> : <input type="number" step="any" placeholder="Initial quantity on hand" value={part.quantityOnHand} onChange={(event) => setPart({ ...part, quantityOnHand: Number(event.target.value) })} style={{ padding: 11 }} />}
            <input type="number" step="any" placeholder="Fallback reorder level" value={part.reorderLevel} onChange={(event) => setPart({ ...part, reorderLevel: Number(event.target.value) })} style={{ padding: 11 }} />
            <input type="number" step="0.01" placeholder="Unit cost" value={part.unitCost} onChange={(event) => setPart({ ...part, unitCost: event.target.value })} style={{ padding: 11 }} />
            <input placeholder="Location / bin" value={part.location} onChange={(event) => setPart({ ...part, location: event.target.value })} style={{ padding: 11 }} />

            {part.id && editingItem && <fieldset style={{ gridColumn: "1 / -1", border: "1px solid #dce2e7", borderRadius: 10, padding: 14 }}>
              <legend style={{ fontWeight: 800, padding: "0 6px" }}>Warehouse physical stock</legend>
              <p style={{ margin: "0 0 10px", color: "#6c7886", fontSize: 13 }}>These warehouse quantities are what Inventory actually totals. Use <b>Physical Count</b> on the terminal you counted.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 9 }}>
                {editingWarehouseStocks.length ? editingWarehouseStocks.map((stock) => <div key={stock.warehouseCode} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: 10, border: "1px solid #edf0f2", borderRadius: 8, background: Number(stock.quantityOnHand) < 0 ? "#fff0f0" : "white" }}>
                  <span><b>{stock.warehouseName}</b><small style={{ display: "block", color: "#6c7886", marginTop: 3 }}>{stock.warehouseCode}{Number(stock.reserved ?? 0) > 0 ? ` · ${stock.reserved} reserved` : ""}</small></span>
                  <span style={{ textAlign: "right" }}><strong style={{ display: "block", color: Number(stock.physicalOnHand ?? stock.quantityOnHand) < 0 ? "#b42318" : "#182331", fontSize: 18 }}>{stock.physicalOnHand ?? stock.quantityOnHand}</strong><small style={{ display: "block", color: "#6c7886" }}>physical</small><button type="button" onClick={() => void physicalCount(editingItem, stock.warehouseCode)} style={{ marginTop: 4, padding: "6px 9px", border: "1px solid #0d1b2b", borderRadius: 7, background: "white", color: "#0d1b2b", fontSize: 10, fontWeight: 900 }}>PHYSICAL COUNT</button></span>
                </div>) : <div style={{ color: "#6c7886", fontSize: 12 }}>No warehouse stock rows exist for this part yet.</div>}
              </div>
            </fieldset>}

            <fieldset style={{ gridColumn: "1 / -1", border: "1px solid #dce2e7", borderRadius: 10, padding: 14 }}>
              <legend style={{ fontWeight: 800, padding: "0 6px" }}>Minimum stock by warehouse</legend>
              <p style={{ margin: "0 0 10px", color: "#6c7886", fontSize: 13 }}>Set any minimum you want. Blank uses the fallback reorder level above.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
                {(data?.warehouses ?? []).map((warehouse) => (
                  <label key={warehouse.code} style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 700 }}>{warehouse.name}
                    <input type="number" min="0" step="any" placeholder={String(part.reorderLevel)} value={part.warehouseMinimums[warehouse.code] ?? ""} onChange={(event) => setPart((current) => ({ ...current, warehouseMinimums: { ...current.warehouseMinimums, [warehouse.code]: event.target.value } }))} style={{ padding: 10 }} />
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset style={{ gridColumn: "1 / -1", border: "1px solid #dce2e7", borderRadius: 10, padding: 14 }}>
              <legend style={{ fontWeight: 800, padding: "0 6px" }}>Suppliers</legend>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 8, maxHeight: 190, overflowY: "auto" }}>
                {(data?.vendors ?? []).map((itemVendor) => <label key={itemVendor.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: 8, border: "1px solid #edf0f2", borderRadius: 8 }}><input type="checkbox" checked={part.vendorIds.includes(itemVendor.id)} onChange={() => toggleVendor(itemVendor.id)} /><span>{itemVendor.name}</span></label>)}
              </div>
            </fieldset>

            <label style={{ gridColumn: "1 / -1", display: "grid", gap: 6, fontWeight: 700 }}>Preferred vendor
              <select value={part.preferredVendorId} onChange={(event) => setPart({ ...part, preferredVendorId: event.target.value })} style={{ padding: 11 }}><option value="">No preferred vendor</option>{selectedVendors.map((itemVendor) => <option key={itemVendor.id} value={itemVendor.id}>{itemVendor.name}</option>)}</select>
            </label>

            <fieldset style={{ gridColumn: "1 / -1", border: "1px solid #dce2e7", borderRadius: 10, padding: 14 }}>
              <legend style={{ fontWeight: 800, padding: "0 6px" }}>Used on equipment</legend>
              <p style={{ margin: "0 0 10px", color: "#6c7886", fontSize: 13 }}>Link this part to every truck, trailer, forklift, or other active unit that uses it.</p>
              <input value={equipmentQuery} onChange={(event) => setEquipmentQuery(event.target.value)} placeholder="Search unit, category, or equipment type…" style={{ width: "100%", boxSizing: "border-box", padding: 10, marginBottom: 10 }} />
              {selectedEquipment.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>{selectedEquipment.map((equipment) => <button key={equipment.id} type="button" onClick={() => toggleEquipment(equipment.id)} style={{ border: "1px solid #b9c3cc", borderRadius: 999, background: "#f7f9fa", padding: "5px 9px" }}>{equipment.unit} ×</button>)}</div>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 7, maxHeight: 240, overflowY: "auto" }}>
                {equipmentMatches.map((equipment) => <label key={equipment.id} style={{ display: "flex", gap: 7, alignItems: "center", padding: 7, border: "1px solid #edf0f2", borderRadius: 8 }}><input type="checkbox" checked={part.equipmentIds.includes(equipment.id)} onChange={() => toggleEquipment(equipment.id)} /><span><b>{equipment.unit}</b><small style={{ display: "block", color: "#7a8793" }}>{equipment.category} · {equipment.equipmentType}</small></span></label>)}
              </div>
            </fieldset>

            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 10 }}><button type="button" onClick={() => { setShowPartForm(false); setPart(blankPart); setEquipmentQuery(""); }} style={{ padding: "11px 16px" }}>Cancel</button><button type="submit" style={{ border: 0, borderRadius: 8, padding: "11px 18px", background: "#f47b20", color: "white", fontWeight: 800 }}>Save part</button></div>
          </form>
        </div>
      )}
    </main>
  );
}
