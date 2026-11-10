"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

export type InventoryChoiceOption = { id: number; label: string; description?: string };

export type InventoryChoicePickerProps = {
  label: string;
  options: InventoryChoiceOption[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
};

const resultLimit = 80;
const naturalOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const searchable = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export default function InventoryChoicePicker({
  label,
  options,
  selectedIds,
  onToggle,
  placeholder = "Choose options…",
  emptyText = "No options are available.",
  disabled = false,
}: InventoryChoicePickerProps) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const choices = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const expanded = open && !disabled;

  const orderedOptions = useMemo(() => [...new Map(options.map((option) => [option.id, option])).values()]
    .sort((a, b) => naturalOrder.compare(a.label, b.label) || a.id - b.id), [options]);
  const optionById = useMemo(() => new Map(orderedOptions.map((option) => [option.id, option])), [orderedOptions]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedOptions = useMemo(() => [...selected].map((optionId) => ({
    id: optionId,
    label: optionById.get(optionId)?.label ?? `Saved selection #${optionId}`,
    description: optionById.get(optionId)?.description,
    unavailable: !optionById.has(optionId),
  })).sort((a, b) => naturalOrder.compare(a.label, b.label) || a.id - b.id), [optionById, selected]);
  const matches = useMemo(() => {
    const terms = searchable(query.trim()).split(/\s+/).filter(Boolean);
    return orderedOptions.filter((option) => {
      const text = searchable(`${option.label} ${option.description ?? ""}`);
      return terms.every((term) => text.includes(term));
    });
  }, [orderedOptions, query]);
  const shownOptions = matches.slice(0, resultLimit);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!expanded) return;
    search.current?.focus();
    const closeOutside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
    };
  }, [expanded, close]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!expanded) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.target === search.current && event.key === "Enter") event.preventDefault();
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const checkboxes = [...(choices.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not(:disabled)') ?? [])];
    if (!checkboxes.length) return;
    const index = checkboxes.findIndex((checkbox) => checkbox === event.target);
    if (event.target !== search.current && index < 0) return;
    event.preventDefault();
    const next = event.target === search.current
      ? event.key === "ArrowDown" ? 0 : checkboxes.length - 1
      : Math.max(0, Math.min(checkboxes.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    checkboxes[next].focus();
  }

  return (
    <div ref={root} onKeyDown={onKeyDown} role="group" aria-labelledby={`${id}-label`} style={{ minWidth: 0 }}>
      <div id={`${id}-label`} style={{ marginBottom: 7, color: "#44515e", fontSize: 13, fontWeight: 800 }}>{label}</div>
      <div style={{ position: "relative" }}>
        <button
          ref={trigger}
          type="button"
          disabled={disabled}
          aria-expanded={expanded}
          aria-controls={`${id}-choices`}
          aria-labelledby={`${id}-label ${id}-summary`}
          onClick={() => expanded ? close() : setOpen(true)}
          style={{ width: "100%", minHeight: 44, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "11px 13px", border: `1px solid ${expanded ? "#f5f5f5" : "#b9c6d2"}`, borderRadius: 8, background: disabled ? "#0f0f0f" : "white", color: "#f5f5f5", textAlign: "left", opacity: disabled ? 0.65 : 1 }}
        >
          <span id={`${id}-summary`}>{selected.size ? `${selected.size} selected` : placeholder}</span>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flexShrink: 0, transform: expanded ? "rotate(180deg)" : undefined }}><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>

        {expanded && <div id={`${id}-choices`} style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 30, padding: 10, border: "1px solid #b9c6d2", borderRadius: 10, background: "white", boxShadow: "0 10px 28px #153f3724" }}>
          <label htmlFor={`${id}-search`} style={{ display: "block", marginBottom: 5, color: "#657383", fontSize: 12, fontWeight: 700 }}>Search {label.toLowerCase()}</label>
          <input
            ref={search}
            id={`${id}-search`}
            type="search"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type a name or number…"
            style={{ width: "100%", boxSizing: "border-box", minHeight: 40, padding: "9px 11px", border: "1px solid #b9c6d2", borderRadius: 7, color: "#f5f5f5", background: "white" }}
          />
          <div role="status" aria-live="polite" style={{ margin: "8px 1px", color: "#657383", fontSize: 12 }}>
            {matches.length > resultLimit ? `Showing ${resultLimit} of ${matches.length} matches. Type more to narrow the list.` : `${matches.length} ${matches.length === 1 ? "option" : "options"}`}
          </div>
          <div ref={choices} role="group" aria-label={`${label} options`} style={{ maxHeight: "min(280px, 40vh)", overflowY: "auto", overscrollBehavior: "contain" }}>
            {shownOptions.map((option) => <label key={option.id} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 42, boxSizing: "border-box", marginBottom: 3, padding: "8px 9px", borderRadius: 7, cursor: "pointer", background: selected.has(option.id) ? "#1515153e8" : "white", color: "#f5f5f5" }}>
              <input
                type="checkbox"
                checked={selected.has(option.id)}
                onChange={() => onToggle(option.id)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onToggle(option.id); } }}
                style={{ width: 18, height: 18, flexShrink: 0, margin: 0, padding: 0, accentColor: "#f5f5f5" }}
              />
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}><span style={{ fontSize: 13, fontWeight: 700 }}>{option.label}</span>{option.description && <small style={{ display: "block", marginTop: 2, color: "#657383", fontSize: 11 }}>{option.description}</small>}</span>
            </label>)}
            {!shownOptions.length && <p style={{ margin: 0, padding: "12px 9px", color: "#657383", fontSize: 13 }}>{orderedOptions.length ? "No matching options. Try another name or number." : emptyText}</p>}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8, paddingTop: 8, borderTop: "1px solid #edf0f2" }}>
            <span style={{ color: "#657383", fontSize: 12 }}>{selected.size} selected</span>
            <button type="button" onClick={() => close(true)} style={{ minHeight: 34, padding: "6px 13px", border: "1px solid #153f37", borderRadius: 7, color: "#153f37", background: "white", fontSize: 12, fontWeight: 800 }}>Done</button>
          </div>
        </div>}
      </div>

      {selectedOptions.length > 0 && <div aria-label={`Selected ${label.toLowerCase()}`} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9 }}>
        {selectedOptions.map((option) => <span key={option.id} title={option.description} style={{ display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%", padding: "4px 5px 4px 9px", border: `1px solid ${option.unavailable ? "#dfbb7f" : "#cad4dd"}`, borderRadius: 8, background: option.unavailable ? "#1515158e6" : "#f3f6f8", fontSize: 12, color: "#334556" }}>
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{option.label}{option.unavailable && <small style={{ display: "block", fontSize: 10 }}>No longer in the available list</small>}</span>
          <button type="button" disabled={disabled} aria-label={`Remove ${option.label} from ${label.toLowerCase()}`} onClick={() => onToggle(option.id)} style={{ width: 28, minWidth: 28, height: 28, border: 0, borderRadius: 5, background: "transparent", color: "#44515e", fontSize: 19, lineHeight: 1, opacity: disabled ? 0.5 : 1 }}>×</button>
        </span>)}
      </div>}
    </div>
  );
}
