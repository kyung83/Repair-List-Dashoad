"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type EquipmentRow = {
  id: number;
  unit: string;
  active: boolean;
  archived: boolean;
};

type EquipmentPayload = {
  equipment?: EquipmentRow[];
};

function unitFromRow(row: HTMLTableRowElement) {
  return (row.querySelector<HTMLElement>(".equipment-unit")?.textContent || "").trim();
}

export default function BulkArchiveEnhancer() {
  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [toolbarMount, setToolbarMount] = useState<HTMLElement | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const selectedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    selectedRef.current = selectedIds;
  }, [selectedIds]);

  const activeByUnit = useMemo(() => {
    const map = new Map<string, EquipmentRow[]>();
    for (const item of equipment) {
      if (!item.active || item.archived) continue;
      const rows = map.get(item.unit) || [];
      rows.push(item);
      map.set(item.unit, rows);
    }
    return map;
  }, [equipment]);

  useEffect(() => {
    if (window.location.pathname !== "/equipment") return;
    let stopped = false;
    fetch("/api/equipment", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: EquipmentPayload) => {
        if (!stopped) setEquipment(Array.isArray(payload.equipment) ? payload.equipment : []);
      })
      .catch(() => {
        if (!stopped) setMessage("Bulk archive selector could not load equipment IDs.");
      });
    return () => { stopped = true; };
  }, []);

  useEffect(() => {
    if (window.location.pathname !== "/equipment") return;

    function wire() {
      const table = document.querySelector<HTMLTableElement>(".equipment-table");
      const headRow = table?.querySelector<HTMLTableRowElement>("thead tr");
      const bodyRows = Array.from(table?.querySelectorAll<HTMLTableRowElement>("tbody tr") || []);
      if (!table || !headRow) {
        setToolbarMount(null);
        return;
      }

      let mount = document.querySelector<HTMLElement>("[data-bulk-archive-toolbar='1']");
      const resultsLine = document.querySelector<HTMLElement>(".equipment-master-page .results-line");
      if (!mount && resultsLine?.parentElement) {
        mount = document.createElement("div");
        mount.dataset.bulkArchiveToolbar = "1";
        resultsLine.parentElement.insertBefore(mount, resultsLine);
      }
      if (mount && toolbarMount !== mount) setToolbarMount(mount);

      let selectHead = headRow.querySelector<HTMLTableCellElement>("th[data-bulk-archive-select='1']");
      if (!selectHead) {
        selectHead = document.createElement("th");
        selectHead.dataset.bulkArchiveSelect = "1";
        selectHead.style.width = "42px";
        selectHead.style.minWidth = "42px";
        selectHead.style.textAlign = "center";
        headRow.insertBefore(selectHead, headRow.firstChild);
      }

      let selectAll = selectHead.querySelector<HTMLInputElement>("input[type='checkbox']");
      if (!selectAll) {
        selectAll = document.createElement("input");
        selectAll.type = "checkbox";
        selectAll.title = "Select all visible active equipment";
        selectAll.setAttribute("aria-label", "Select all visible active equipment");
        selectHead.appendChild(selectAll);
      }

      const selectableIds: number[] = [];
      for (const row of bodyRows) {
        let cell = row.querySelector<HTMLTableCellElement>("td[data-bulk-archive-select='1']");
        if (!cell) {
          cell = document.createElement("td");
          cell.dataset.bulkArchiveSelect = "1";
          cell.style.textAlign = "center";
          cell.style.verticalAlign = "middle";
          row.insertBefore(cell, row.firstChild);
        }

        const unit = unitFromRow(row);
        const matches = activeByUnit.get(unit) || [];
        const item = matches.length === 1 ? matches[0] : null;
        let checkbox = cell.querySelector<HTMLInputElement>("input[type='checkbox']");

        if (!item) {
          if (!checkbox) {
            checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            cell.appendChild(checkbox);
          }
          checkbox.disabled = true;
          checkbox.checked = false;
          checkbox.title = matches.length > 1
            ? "More than one active record has this unit name; archive this row individually."
            : "Archived rows are not selectable.";
          checkbox.removeAttribute("data-equipment-id");
          continue;
        }

        selectableIds.push(item.id);
        if (!checkbox) {
          checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          cell.appendChild(checkbox);
        }
        checkbox.disabled = false;
        checkbox.dataset.equipmentId = String(item.id);
        checkbox.title = `Select ${item.unit}`;
        checkbox.setAttribute("aria-label", `Select ${item.unit} for bulk archive`);
        checkbox.checked = selectedRef.current.has(item.id);
        checkbox.onchange = () => {
          setSelectedIds((current) => {
            const next = new Set(current);
            if (checkbox!.checked) next.add(item.id);
            else next.delete(item.id);
            return next;
          });
        };
      }

      const selectableSet = new Set(selectableIds);
      const pruned = new Set([...selectedRef.current].filter((id) => selectableSet.has(id)));
      if (pruned.size !== selectedRef.current.size) setSelectedIds(pruned);

      const selectedVisible = selectableIds.filter((id) => selectedRef.current.has(id)).length;
      selectAll.checked = selectableIds.length > 0 && selectedVisible === selectableIds.length;
      selectAll.indeterminate = selectedVisible > 0 && selectedVisible < selectableIds.length;
      selectAll.disabled = selectableIds.length === 0;
      selectAll.onchange = () => {
        setSelectedIds(selectAll!.checked ? new Set(selectableIds) : new Set());
      };
    }

    wire();
    const observer = new MutationObserver(wire);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [activeByUnit, toolbarMount]);

  useEffect(() => {
    const inputs = document.querySelectorAll<HTMLInputElement>("td[data-bulk-archive-select='1'] input[data-equipment-id]");
    let selectable = 0;
    let checked = 0;
    inputs.forEach((input) => {
      const id = Number(input.dataset.equipmentId);
      input.checked = selectedIds.has(id);
      selectable += 1;
      if (input.checked) checked += 1;
    });
    const header = document.querySelector<HTMLInputElement>("th[data-bulk-archive-select='1'] input[type='checkbox']");
    if (header) {
      header.checked = selectable > 0 && checked === selectable;
      header.indeterminate = checked > 0 && checked < selectable;
    }
  }, [selectedIds]);

  async function archiveSelected() {
    if (!selectedIds.size) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/equipment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "bulkArchive", ids: [...selectedIds], reason }),
      });
      const result = await response.json() as { ok?: boolean; archived?: number; skipped?: number; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Selected equipment could not be archived.");
      window.alert(`${result.archived ?? selectedIds.size} equipment record${(result.archived ?? selectedIds.size) === 1 ? "" : "s"} archived. Repair, PM, annual, RO, and expense history was retained.`);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Selected equipment could not be archived.");
      setBusy(false);
    }
  }

  const toolbar = toolbarMount ? createPortal(
    <div style={{
      margin: "10px 0 12px",
      padding: "10px 12px",
      border: "1px solid #d7dee6",
      borderRadius: 10,
      background: "#f8fafc",
      display: "flex",
      alignItems: "center",
      gap: 10,
      flexWrap: "wrap",
    }}>
      <strong style={{ color: "#172536" }}>Bulk archive</strong>
      <span className="cell-muted">Use the checkboxes to select active equipment from the current filtered list.</span>
      <span style={{ marginLeft: "auto", fontWeight: 800 }}>{selectedIds.size} selected</span>
      {selectedIds.size > 0 && (
        <button type="button" className="module-button secondary" disabled={busy} onClick={() => setSelectedIds(new Set())}>Clear</button>
      )}
      <button
        type="button"
        className="module-button danger"
        disabled={busy || selectedIds.size === 0}
        onClick={() => { setReason(""); setMessage(""); setConfirmOpen(true); }}
      >
        Archive selected{selectedIds.size ? ` (${selectedIds.size})` : ""}
      </button>
      {message && <span style={{ width: "100%", color: "#9a3412", fontWeight: 700 }}>{message}</span>}
    </div>,
    toolbarMount,
  ) : null;

  const modal = confirmOpen && typeof document !== "undefined" ? createPortal(
    <div className="master-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setConfirmOpen(false); }}>
      <div className="archive-modal">
        <p className="module-eyebrow">BULK ARCHIVE EQUIPMENT</p>
        <h2>Archive {selectedIds.size} selected record{selectedIds.size === 1 ? "" : "s"}?</h2>
        <p>This removes the selected equipment from active repair and PM lists. It does <strong>not</strong> delete the equipment or its history.</p>
        <div className="history-retention-box">
          <strong>Historical records stay connected</strong>
          <span>Repairs, PM/annual history, imported ROs and expenses remain available. Current Geotab tracking assignments are ended for archived units.</span>
        </div>
        <label className="archive-reason">
          <span>Archive reason for all selected records (optional)</span>
          <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Sold, retired, transferred, obsolete roster entry…" />
        </label>
        {message && <div className="module-message">{message}</div>}
        <div className="master-modal-actions">
          <button type="button" className="module-button secondary" disabled={busy} onClick={() => setConfirmOpen(false)}>Cancel</button>
          <button type="button" className="module-button danger" disabled={busy} onClick={() => void archiveSelected()}>{busy ? "Archiving…" : `Archive ${selectedIds.size}`}</button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return <>{toolbar}{modal}</>;
}
