"use client";

import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import styles from "./inventory-quick-update.module.css";

type Stock = {
  warehouseCode: string;
  warehouseName: string;
  quantityOnHand: number;
  physicalOnHand?: number;
  reserved?: number;
  unitOfMeasure?: string;
};

type QuickPart = {
  id: number;
  partNumber: string;
  description: string;
  warehouseStocks?: Stock[];
};

type Settings = {
  ok: boolean;
  partId: number;
  warehouseCode: string;
  warehouseName: string;
  binLocations: string[];
  minimumQuantity: number | null;
  defaultMinimum: number;
  settingsVersion: string;
  binOptions: string[];
};

type CountSnapshot = {
  ok: boolean;
  partId: number;
  partNumber: string;
  description: string;
  warehouseCode: string;
  warehouseName: string;
  expectedQuantity: number;
  stockVersion: string;
};

type Props = {
  part: QuickPart;
  warehouses: { code: string; name: string }[];
  initialWarehouseCode: string;
  onSaved: (message: string) => Promise<void>;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
};

function cleanBins(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function readResponse<T>(response: Response): Promise<T> {
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "The update could not be completed. Please try again.");
  return result;
}

export default function InventoryQuickUpdate({ part, warehouses, initialWarehouseCode, onSaved, onClose, onDirtyChange, onBusyChange }: Props) {
  const id = useId();
  const allowedWarehouses = useMemo(() => warehouses.filter((warehouse) =>
    part.warehouseStocks?.some((stock) => stock.warehouseCode === warehouse.code)), [warehouses, part.warehouseStocks]);
  const [warehouseCode, setWarehouseCode] = useState(() =>
    allowedWarehouses.some((warehouse) => warehouse.code === initialWarehouseCode) ? initialWarehouseCode :
      allowedWarehouses.length === 1 ? allowedWarehouses[0].code : "");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [snapshot, setSnapshot] = useState<CountSnapshot | null>(null);
  const [bins, setBins] = useState<string[]>([""]);
  const [minimum, setMinimum] = useState("");
  const [count, setCount] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [countError, setCountError] = useState("");
  const [settingsNotice, setSettingsNotice] = useState("");
  const [countNotice, setCountNotice] = useState("");
  const [loading, setLoading] = useState(Boolean(warehouseCode));
  const [saving, setSaving] = useState<"settings" | "count" | null>(null);
  const [reload, setReload] = useState(0);
  const [pendingCount, setPendingCount] = useState<{ issueId: number; operationKey: string; countedQuantity: number; expectedQuantity: number } | null>(null);
  const settingsAttempt = useRef<{ fingerprint: string; operationKey: string } | null>(null);
  const saveLock = useRef(false);

  const settingsDirty = Boolean(settings && (
    JSON.stringify(cleanBins(bins)) !== JSON.stringify(settings.binLocations) ||
    minimum.trim() !== (settings.minimumQuantity == null ? "" : String(settings.minimumQuantity))));
  const countDirty = count.trim() !== "" || pendingCount !== null;
  const dirty = settingsDirty || countDirty;
  const stock = part.warehouseStocks?.find((entry) => entry.warehouseCode === warehouseCode);
  const physical = snapshot?.expectedQuantity ?? stock?.physicalOnHand;
  const reserved = Number(stock?.reserved ?? 0);
  const unit = stock?.unitOfMeasure || "units";

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(saving !== null); }, [saving, onBusyChange]);
  useEffect(() => () => { onDirtyChange(false); onBusyChange(false); }, [onDirtyChange, onBusyChange]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    if (!warehouseCode) return () => { current = false; controller.abort(); };
    const query = `partId=${part.id}&warehouseCode=${encodeURIComponent(warehouseCode)}`;
    void Promise.allSettled([
      fetch(`/api/inventory/warehouse-settings?${query}`, { cache: "no-store", signal: controller.signal }).then(readResponse<Settings>),
      fetch(`/api/inventory/count-snapshot?${query}`, { cache: "no-store", signal: controller.signal }).then(readResponse<CountSnapshot>),
    ]).then(([settingsResult, countResult]) => {
      if (!current) return;
      if (settingsResult.status === "fulfilled") {
        const value = settingsResult.value;
        if (value.ok && value.partId === part.id && value.warehouseCode === warehouseCode) {
          setSettings(value);
          setBins(value.binLocations.length ? value.binLocations : [""]);
          setMinimum(value.minimumQuantity == null ? "" : String(value.minimumQuantity));
        } else setSettingsError("The warehouse settings did not match this part. Reload to try again.");
      } else setSettingsError(settingsResult.reason instanceof Error ? settingsResult.reason.message : "Warehouse settings could not be loaded.");
      if (countResult.status === "fulfilled") {
        const value = countResult.value;
        if (value.ok && value.partId === part.id && value.warehouseCode === warehouseCode) setSnapshot(value);
        else setCountError("The stock count did not match this part. Reload to try again.");
      } else setCountError(countResult.reason instanceof Error ? countResult.reason.message : "Current stock could not be loaded.");
      setLoading(false);
    });
    return () => { current = false; controller.abort(); };
  }, [part.id, warehouseCode, reload]);

  function resetFields(nextWarehouse: string) {
    setSettings(null);
    setSnapshot(null);
    setBins([""]);
    setMinimum("");
    setCount("");
    setPendingCount(null);
    setSettingsError("");
    setCountError("");
    setSettingsNotice("");
    setCountNotice("");
    settingsAttempt.current = null;
    setLoading(Boolean(nextWarehouse));
  }

  function changeWarehouse(value: string) {
    if (saveLock.current) return;
    if (dirty && !window.confirm("Discard the unsaved changes before changing warehouses?")) return;
    resetFields(value);
    setWarehouseCode(value);
  }

  function reloadPanel() {
    if (saveLock.current) return;
    if (dirty && !window.confirm("Discard the entered values and reload this warehouse? Any recorded count issue remains in Count Issues.")) return;
    resetFields(warehouseCode);
    setReload((value) => value + 1);
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!settings || saveLock.current || !settingsDirty || countDirty) return;
    const minimumQuantity = minimum.trim() === "" ? null : Number(minimum);
    if (minimumQuantity !== null && (!Number.isFinite(minimumQuantity) || minimumQuantity < 0)) {
      setSettingsError("Minimum stock must be zero or greater. Leave it blank to use the part default.");
      return;
    }
    const payload = { partId: part.id, warehouseCode, binLocations: cleanBins(bins), minimumQuantity, settingsVersion: settings.settingsVersion };
    const fingerprint = JSON.stringify(payload);
    if (settingsAttempt.current?.fingerprint !== fingerprint) settingsAttempt.current = { fingerprint, operationKey: `warehouse-settings:${crypto.randomUUID()}` };
    saveLock.current = true;
    setSaving("settings");
    setSettingsError("");
    setSettingsNotice("");
    try {
      const result = await readResponse<{ ok: boolean; settings: Settings }>(await fetch("/api/inventory/warehouse-settings", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, operationKey: settingsAttempt.current.operationKey }),
      }));
      if (!result.ok || !result.settings || result.settings.partId !== part.id || result.settings.warehouseCode !== warehouseCode) throw new Error("The save result could not be confirmed. Reload before making another change.");
      setSettings(result.settings);
      setBins(result.settings.binLocations.length ? result.settings.binLocations : [""]);
      setMinimum(result.settings.minimumQuantity == null ? "" : String(result.settings.minimumQuantity));
      settingsAttempt.current = null;
      const message = `Bin locations and minimum saved for ${part.partNumber} at ${result.settings.warehouseName}.`;
      setSettingsNotice(message);
      await onSaved(message);
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "Bin locations and minimum could not be saved.");
    } finally { saveLock.current = false; setSaving(null); }
  }

  async function saveCount(event: FormEvent) {
    event.preventDefault();
    if (!snapshot || saveLock.current || settingsDirty) return;
    if (count.trim() === "" || !Number.isFinite(Number(count)) || Number(count) < 0) {
      setCountError("Enter the quantity you counted. Use 0 for an empty bin.");
      return;
    }
    const countedQuantity = Number(count);
    saveLock.current = true;
    setSaving("count");
    setCountError("");
    setCountNotice("");
    let issue = pendingCount;
    try {
      if (!issue) {
        const recorded = await readResponse<{ ok: boolean; matched?: boolean; issueId?: number }>(await fetch("/api/inventory", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "recordPhysicalCount", partId: part.id, warehouseCode, countedQuantity,
            stockVersion: snapshot.stockVersion, reason: `Physical count entered from Inventory for ${part.partNumber} at ${snapshot.warehouseName}.` }),
        }));
        if (!recorded.ok) throw new Error("The physical count could not be confirmed.");
        if (!recorded.matched) {
          if (!recorded.issueId) throw new Error("The physical count was recorded, but the stock update could not be confirmed. Check Count Issues before trying again.");
          issue = { issueId: recorded.issueId, operationKey: `count-resolution:${crypto.randomUUID()}`, countedQuantity, expectedQuantity: snapshot.expectedQuantity };
          setPendingCount(issue);
        }
      }
      if (issue) {
        const applied = await readResponse<{ ok: boolean }>(await fetch("/api/inventory", {
          method: "POST", headers: { "content-type": "application/json", "idempotency-key": issue.operationKey },
          body: JSON.stringify({ action: "resolvePhysicalCount", issueId: issue.issueId, operationKey: issue.operationKey,
            note: `Physical count applied directly from Inventory for ${part.partNumber} at ${snapshot.warehouseName}: ${issue.expectedQuantity} → ${issue.countedQuantity}.` }),
        }));
        if (!applied.ok) throw new Error("The stock update could not be confirmed.");
      }
      const message = `Physical count saved: ${part.partNumber} at ${snapshot.warehouseName} is ${countedQuantity} ${unit}.`;
      setCount("");
      setPendingCount(null);
      setCountNotice(message);
      setSnapshot(null);
      try {
        const refreshed = await readResponse<CountSnapshot>(await fetch(`/api/inventory/count-snapshot?partId=${part.id}&warehouseCode=${encodeURIComponent(warehouseCode)}`, { cache: "no-store" }));
        if (!refreshed.ok || refreshed.partId !== part.id || refreshed.warehouseCode !== warehouseCode) throw new Error("Count saved. Reload to view the latest stock.");
        setSnapshot(refreshed);
      } catch { setCountError("Count saved. Reload this warehouse before entering another count."); }
      await onSaved(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The physical count could not be saved.";
      setCountError(issue ? `${message} Count issue #${issue.issueId} is recorded. Retry applying it, or review it in Core → Count Issues.` : message);
    } finally { saveLock.current = false; setSaving(null); }
  }

  return <section className={styles.panel} aria-labelledby={`${id}-title`}>
    <header className={styles.header}>
      <div><h3 id={`${id}-title`}>Update {part.partNumber}</h3><p>{part.description}</p></div>
      <button type="button" className={styles.secondary} onClick={onClose} disabled={saving !== null}>Close update</button>
    </header>
    <div className={styles.warehouseRow}>
      <label className={styles.label} htmlFor={`${id}-warehouse`}>Warehouse
        <select id={`${id}-warehouse`} value={warehouseCode} onChange={(event) => changeWarehouse(event.target.value)} disabled={saving !== null || !allowedWarehouses.length} className={styles.input}>
          <option value="">Choose warehouse</option>
          {allowedWarehouses.map((warehouse) => <option key={warehouse.code} value={warehouse.code}>{warehouse.name}</option>)}
        </select>
      </label>
      {warehouseCode && <div className={styles.stockSummary} aria-label="Current stock">
        <span>Physical on hand <strong>{physical ?? "—"} {unit}</strong></span>
        <span>Reserved <strong>{reserved} {unit}</strong></span>
        <span>Available <strong>{physical == null ? "—" : physical - reserved} {unit}</strong></span>
      </div>}
      {warehouseCode && <button type="button" className={styles.secondary} onClick={reloadPanel} disabled={saving !== null || loading}>Reload</button>}
    </div>
    {!allowedWarehouses.length && <p className={styles.hint}>This part does not have stock in an active warehouse yet. Receive the part into a warehouse before updating its stock.</p>}
    {allowedWarehouses.length > 0 && !warehouseCode && <p className={styles.hint}>Choose the warehouse you are updating. Each warehouse keeps its own bins, minimum, and count.</p>}
    {loading && <p role="status" className={styles.hint}>Loading this warehouse…</p>}
    {warehouseCode && !loading && <div className={styles.sections}>
      <form onSubmit={(event) => void saveSettings(event)} className={styles.card}>
        <h4>Bin locations &amp; minimum</h4>
        {settingsError && <p role="alert" className={styles.error}>{settingsError}</p>}
        {settings && <fieldset disabled={saving !== null || countDirty} className={styles.fields}>
          <p className={styles.hint}>Choose a bin suggestion or type a new location. Keep a separate line for each bin.</p>
          <datalist id={`${id}-bins`}>{settings.binOptions.map((bin) => <option key={bin} value={bin} />)}</datalist>
          {bins.map((bin, index) => <div key={index} className={styles.binRow}>
            <label className={styles.label} htmlFor={`${id}-bin-${index}`}>Bin {index + 1}
              <input id={`${id}-bin-${index}`} className={styles.input} list={`${id}-bins`} value={bin} maxLength={512} placeholder="Choose or type a bin location" onChange={(event) => setBins((values) => values.map((value, at) => at === index ? event.target.value : value))} />
            </label>
            <button type="button" className={styles.secondary} aria-label={`Remove bin ${index + 1}`} onClick={() => setBins((values) => values.length === 1 ? [""] : values.filter((_, at) => at !== index))}>Remove</button>
          </div>)}
          <button type="button" className={styles.addBin} disabled={bins.length >= 64} onClick={() => setBins((values) => [...values, ""])}>+ Add another bin</button>
          <label className={styles.label} htmlFor={`${id}-minimum`}>Minimum stock for this warehouse
            <input id={`${id}-minimum`} className={styles.input} type="number" min="0" step="any" value={minimum} placeholder={`Part default: ${settings.defaultMinimum}`} onChange={(event) => setMinimum(event.target.value)} />
          </label>
          <p className={styles.hint}>Leave blank to use the part default ({settings.defaultMinimum}). Enter 0 to set no minimum.</p>
          <button type="submit" className={styles.primary} disabled={!settingsDirty}>{saving === "settings" ? "Saving…" : "Save bins & minimum"}</button>
        </fieldset>}
        {countDirty && <p className={styles.hint}>Save or clear the physical count before changing bins or the minimum.</p>}
        {settingsNotice && <p role="status" className={styles.success}>{settingsNotice}</p>}
      </form>
      <form onSubmit={(event) => void saveCount(event)} className={styles.card}>
        <h4>Physical count</h4>
        <p className={styles.hint}>Count all bins for this part at {snapshot?.warehouseName || stock?.warehouseName || warehouseCode}, including reserved stock.</p>
        {countError && <p role="alert" className={styles.error}>{countError}</p>}
        <fieldset disabled={!snapshot || saving !== null || settingsDirty} className={styles.fields}>
          <label className={styles.label} htmlFor={`${id}-count`}>Quantity physically counted ({unit})
            <input id={`${id}-count`} className={styles.input} type="number" min="0" step="any" value={count} placeholder="Enter your count" disabled={pendingCount !== null} onChange={(event) => { setCount(event.target.value); setCountError(""); }} />
          </label>
          {count.trim() !== "" && Number.isFinite(Number(count)) && Number(count) >= 0 && snapshot && <p className={styles.changePreview}>System: <b>{snapshot.expectedQuantity}</b> → Counted: <b>{Number(count)}</b> {unit}</p>}
          <p className={styles.hint}>Enter 0 when no stock is on the shelf. A blank count does not change inventory.</p>
          <div className={styles.buttons}>
            <button type="submit" className={styles.primary} disabled={count.trim() === ""}>{saving === "count" ? "Saving count…" : pendingCount ? "Retry applying count" : "Save physical count"}</button>
            {countDirty && !pendingCount && <button type="button" className={styles.secondary} onClick={() => { setCount(""); setCountError(""); }}>Clear count</button>}
          </div>
        </fieldset>
        {settingsDirty && <p className={styles.hint}>Save the bin and minimum changes before entering a physical count.</p>}
        {countNotice && <p role="status" className={styles.success}>{countNotice}</p>}
      </form>
    </div>}
  </section>;
}
