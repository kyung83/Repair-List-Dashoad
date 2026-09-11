"use client";

import { useEffect, useRef, useState } from "react";

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
    section, header, div { break-inside: avoid; }
    table { width: 100% !important; border-collapse: collapse; font-size: 9px !important; }
    th, td { white-space: normal !important; padding: 5px !important; }
    h1 { font-size: 24px !important; }
    a { color: #172033; text-decoration: none; }
    [style*="overflow-x"] { overflow: visible !important; }
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
        onClick={exportCsv}
        disabled={!exportReady}
        style={{ padding: "10px 14px", border: 0, borderRadius: 8, background: exportReady ? "#0d1b2b" : "#94a3b8", color: "white", fontWeight: 850, cursor: exportReady ? "pointer" : "wait" }}
      >
        Export CSV
      </button>
    </div>
  );
}
