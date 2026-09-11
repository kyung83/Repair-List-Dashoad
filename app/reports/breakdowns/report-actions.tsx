"use client";

import { useEffect, useRef, useState } from "react";

const SUMMARY_TABLE_TITLES = [
  "Breakdown Cost by Unit",
  "Monthly Breakdown Trend",
  "By Breakdown Category",
  "By Service Provider",
  "By Location",
] as const;

function findExistingExportButton() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === "Export Breakdown CSV",
  ) ?? null;
}

function replaceFormControlsWithValues(root: HTMLElement) {
  root.querySelectorAll("input, select, textarea").forEach((control) => {
    const span = document.createElement("span");
    span.style.display = "inline-block";
    span.style.padding = "4px 0";
    span.style.fontWeight = "700";
    span.style.color = "#172033";

    if (control instanceof HTMLSelectElement) {
      span.textContent = control.selectedOptions[0]?.textContent?.trim() || "All";
    } else if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
      span.textContent = control.value || "—";
    }

    control.replaceWith(span);
  });
}

function expandScrollableReportTables(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("div").forEach((node) => {
    if (!node.querySelector("table")) return;
    const inlineStyle = node.getAttribute("style") || "";
    if (!/overflow|max-height|height/i.test(inlineStyle)) return;
    node.style.maxHeight = "none";
    node.style.height = "auto";
    node.style.overflow = "visible";
    node.style.overflowX = "visible";
    node.style.overflowY = "visible";
  });

  root.querySelectorAll<HTMLElement>("table").forEach((table) => {
    table.style.minWidth = "0";
    table.style.width = "100%";
  });
}

function cleanPrintClone(root: HTMLElement) {
  root.querySelectorAll("nav").forEach((node) => node.remove());
  root.querySelectorAll("button").forEach((button) => {
    const text = button.textContent?.trim() || "";
    if (/^(delete|apply filters|reset|export breakdown csv)$/i.test(text)) {
      button.remove();
      return;
    }

    const span = document.createElement("span");
    span.textContent = text.replace(/\s*[▲▼]$/, "");
    span.style.fontWeight = "850";
    button.replaceWith(span);
  });

  replaceFormControlsWithValues(root);
  expandScrollableReportTables(root);
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function tableToCsv(table: HTMLTableElement) {
  return Array.from(table.querySelectorAll("tr"))
    .map((row) => Array.from(row.querySelectorAll("th,td"))
      .map((cell) => csvCell((cell.textContent || "").replace(/\s+/g, " ").trim()))
      .join(","))
    .join("\n");
}

function findSummaryTables(root: HTMLElement) {
  return SUMMARY_TABLE_TITLES.flatMap((title) => {
    const heading = Array.from(root.querySelectorAll<HTMLHeadingElement>("h2"))
      .find((candidate) => candidate.textContent?.trim() === title);
    const table = heading?.parentElement?.querySelector<HTMLTableElement>("table") ?? null;
    return table ? [{ title, table }] : [];
  });
}

function downloadSummaryCsv() {
  const root = document.getElementById("breakdown-report-print-scope");
  if (!root) {
    window.alert("The report is still loading. Try Export Summary CSV again in a moment.");
    return;
  }

  const sections = findSummaryTables(root);
  if (!sections.length) {
    window.alert("No summary tables are available for the current report.");
    return;
  }

  const content = sections
    .map(({ title, table }) => `${csvCell(title)}\n${tableToCsv(table)}`)
    .join("\n\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `breakdown-summary-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function BreakdownReportActions() {
  const originalDisplay = useRef<string | null>(null);
  const [exportReady, setExportReady] = useState(false);

  useEffect(() => {
    let hiddenButton: HTMLButtonElement | null = null;

    const hideBuiltInExport = () => {
      const candidate = findExistingExportButton();
      if (!candidate || candidate === hiddenButton) return;
      hiddenButton = candidate;
      originalDisplay.current = candidate.style.display;
      candidate.dataset.breakdownOriginalExport = "true";
      candidate.style.display = "none";
      setExportReady(true);
    };

    hideBuiltInExport();
    const observer = new MutationObserver(hideBuiltInExport);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (hiddenButton) {
        hiddenButton.style.display = originalDisplay.current ?? "";
        delete hiddenButton.dataset.breakdownOriginalExport;
      }
    };
  }, []);

  function exportCsv() {
    const button = document.querySelector<HTMLButtonElement>('button[data-breakdown-original-export="true"]') ?? findExistingExportButton();
    if (!button) {
      window.alert("The report is still loading. Try Export CSV again in a moment.");
      return;
    }
    button.click();
  }

  function printReport() {
    const source = document.getElementById("breakdown-report-print-scope");
    if (!source) {
      window.print();
      return;
    }

    const clone = source.cloneNode(true) as HTMLElement;
    cleanPrintClone(clone);

    const printWindow = window.open("", "_blank", "width=1400,height=900");
    if (!printWindow) {
      window.print();
      return;
    }

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Breakdown Report</title>
  <style>
    @page { size: landscape; margin: 0.35in; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #fff; color: #172033; font-family: Arial, Helvetica, sans-serif; font-size: 11px; }
    main { min-height: auto !important; padding: 0 !important; background: #fff !important; }
    section, header, div { break-inside: auto; }
    article, tr { break-inside: avoid; }
    table { width: 100% !important; min-width: 0 !important; border-collapse: collapse; font-size: 9px !important; }
    th, td { white-space: normal !important; padding: 5px !important; }
    h1 { font-size: 24px !important; }
    h2 { break-after: avoid; }
    a { color: #172033; text-decoration: none; }
    [style*="overflow"], [style*="max-height"] {
      max-height: none !important;
      height: auto !important;
      overflow: visible !important;
      overflow-x: visible !important;
      overflow-y: visible !important;
    }
  </style>
</head>
<body>${clone.innerHTML}</body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
  }

  return (
    <div
      className="breakdown-report-actions"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        display: "flex",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: 10,
        padding: "10px 34px",
        background: "rgba(243,245,247,.96)",
        borderBottom: "1px solid #dce2e7",
        backdropFilter: "blur(8px)",
      }}
    >
      <span style={{ marginRight: "auto", fontSize: 12, fontWeight: 900, letterSpacing: ".08em", color: "#64748b" }}>
        BREAKDOWN REPORT ACTIONS
      </span>
      <button
        type="button"
        onClick={printReport}
        style={{ padding: "10px 14px", border: "1px solid #94a3b8", borderRadius: 8, background: "white", color: "#172033", fontWeight: 850, cursor: "pointer" }}
      >
        Print / Save PDF
      </button>
      <button
        type="button"
        onClick={downloadSummaryCsv}
        style={{ padding: "10px 14px", border: "1px solid #94a3b8", borderRadius: 8, background: "white", color: "#172033", fontWeight: 850, cursor: "pointer" }}
      >
        Export Summary CSV
      </button>
      <button
        type="button"
        onClick={exportCsv}
        disabled={!exportReady}
        style={{ padding: "10px 14px", border: 0, borderRadius: 8, background: exportReady ? "#0d1b2b" : "#94a3b8", color: "white", fontWeight: 850, cursor: exportReady ? "pointer" : "wait" }}
      >
        Export CSV
      </button>
    </div>
  );
}
