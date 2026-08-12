"use client";

import { useEffect, useMemo, useState } from "react";

type ChecklistPhoto = { id: number; fileName: string; contentType: string; createdAt: string; url: string };
type ChecklistItem = {
  id: number | null;
  number: number;
  section: string;
  text: string;
  result: "pending" | "pass" | "fail" | "na";
  notes: string;
  photos: ChecklistPhoto[];
};
type ChecklistData = {
  repairId: string;
  equipmentId: number;
  unit: string;
  eventType: "pm" | "annual";
  started: boolean;
  status: "not_started" | "in_progress" | "ready" | "completed";
  currentMileage: number | null;
  mileageSource: "Geotab" | "Manual";
  mileageUpdatedAt: string | null;
  mileageAtStart?: number | null;
  mileageAtCompletion?: number | null;
  pendingCount?: number;
  failedCount?: number;
  items: ChecklistItem[];
  error?: string;
};

type Props = { repairId: string; canWork: boolean };

function formatMileage(value: number | null | undefined) {
  return value == null ? "Not available" : `${Number(value).toLocaleString()} mi`;
}

export default function MaintenanceChecklistPanel({ repairId, canWork }: Props) {
  const [data, setData] = useState<ChecklistData | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [manualMileage, setManualMileage] = useState("");

  async function load() {
    const response = await fetch(`/api/maintenance-checklist?repairId=${encodeURIComponent(repairId)}`, { cache: "no-store" });
    const payload = await response.json() as ChecklistData & { error?: string };
    if (!response.ok) {
      if ((payload.error || "").includes("only available for scheduled PM and annual")) {
        setUnavailable(true);
        setData(null);
        return;
      }
      throw new Error(payload.error || "Maintenance checklist could not be loaded.");
    }
    setUnavailable(false);
    setData(payload);
    setNotes(Object.fromEntries(payload.items.map((item) => [item.number, item.notes || ""])));
    if (payload.mileageSource === "Manual" && payload.currentMileage != null) setManualMileage(String(payload.currentMileage));
  }

  useEffect(() => {
    setData(null);
    setUnavailable(false);
    setMessage("");
    void load().catch((error) => setMessage(error instanceof Error ? error.message : "Maintenance checklist could not be loaded."));
  }, [repairId]);

  async function postJson(body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/maintenance-checklist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, repairId }),
      });
      const payload = await response.json() as ChecklistData & { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Checklist change failed.");
      setData(payload);
      setNotes(Object.fromEntries(payload.items.map((item) => [item.number, item.notes || ""])));
      return payload;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checklist change failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function setItem(item: ChecklistItem, result = item.result) {
    const note = notes[item.number] ?? "";
    const payload = await postJson({ action: "setItem", itemNumber: item.number, result, notes: note });
    if (payload) setMessage(result === "fail" ? "Failure saved. Correct the item, then change it to Pass before completing the work order." : "Checklist item saved.");
  }

  async function uploadPhoto(item: ChecklistItem, file: File | null) {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("action", "uploadPhoto");
      form.set("repairId", repairId);
      form.set("itemNumber", String(item.number));
      form.set("photo", file);
      const response = await fetch("/api/maintenance-checklist", { method: "POST", body: form });
      const payload = await response.json() as ChecklistData & { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Photo upload failed.");
      setData(payload);
      setNotes(Object.fromEntries(payload.items.map((row) => [row.number, row.notes || ""])));
      setMessage("Checklist photo saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Photo upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto(photoId: number) {
    if (!window.confirm("Remove this checklist photo?")) return;
    await postJson({ action: "removePhoto", photoId });
  }

  const grouped = useMemo(() => {
    const groups = new Map<string, ChecklistItem[]>();
    for (const item of data?.items ?? []) {
      const list = groups.get(item.section) ?? [];
      list.push(item);
      groups.set(item.section, list);
    }
    return [...groups.entries()];
  }, [data]);

  if (unavailable || (!data && !message)) return null;
  if (!data) return <div style={messageStyle}>{message || "Loading maintenance checklist…"}</div>;

  const heading = data.eventType === "annual" ? "Annual Inspection Checklist" : "PM Performance Checklist";
  const doneCount = data.items.filter((item) => item.result !== "pending").length;
  const pending = data.pendingCount ?? data.items.filter((item) => item.result === "pending").length;
  const failed = data.failedCount ?? data.items.filter((item) => item.result === "fail").length;
  const isReady = data.status === "ready";
  const isCompleted = data.status === "completed";

  return (
    <section style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#f47b20", fontSize: 11, fontWeight: 900, letterSpacing: ".14em" }}>MAINTENANCE WORK-THROUGH</p>
          <h3 style={{ margin: "6px 0 4px", color: "#0d1b2b", fontSize: 22 }}>{heading}</h3>
          <div style={{ color: "#657383", fontSize: 12 }}>Unit {data.unit || "—"} · {doneCount}/{data.items.length} inspection items completed</div>
        </div>
        <div style={{ minWidth: 210, border: "1px solid #dbe3e8", borderRadius: 10, padding: "10px 12px", background: "#f8fafb" }}>
          <strong style={{ display: "block", color: "#0d1b2b", fontSize: 17 }}>{formatMileage(data.currentMileage)}</strong>
          <span style={{ color: data.mileageSource === "Geotab" ? "#176440" : "#6b7280", fontSize: 11, fontWeight: 800 }}>
            {data.mileageSource === "Geotab" ? "Geotab automatic mileage" : "Manual mileage"}
          </span>
          {data.mileageUpdatedAt && <span style={{ display: "block", marginTop: 2, color: "#7a8791", fontSize: 10 }}>Updated {new Date(data.mileageUpdatedAt).toLocaleString()}</span>}
        </div>
      </div>

      {message && <div style={messageStyle}>{message}</div>}

      {!data.started ? (
        <div style={{ marginTop: 14, padding: 15, borderRadius: 10, background: "#fff8e6", border: "1px solid #efd18c" }}>
          <strong style={{ display: "block", color: "#6f4b13" }}>Checklist has not been started.</strong>
          <span style={{ display: "block", marginTop: 4, color: "#7a633c", fontSize: 12 }}>Starting it captures the current mileage and creates the inspection record for this work order.</span>
          {canWork && <button disabled={busy} onClick={() => void postJson({ action: "startChecklist" })} style={{ ...primaryButton, marginTop: 10 }}>Start {data.eventType === "annual" ? "Annual" : "PM"} Checklist</button>}
        </div>
      ) : (
        <>
          <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={progressBadge}>{doneCount}/{data.items.length} checked</span>
            {pending > 0 && <span style={pendingBadge}>{pending} remaining</span>}
            {failed > 0 && <span style={failBadge}>{failed} failed</span>}
            {isReady && <span style={readyBadge}>Ready to close work order</span>}
            {isCompleted && <span style={readyBadge}>Completed · schedule updated</span>}
          </div>

          <div style={{ marginTop: 15, display: "grid", gap: 16 }}>
            {grouped.map(([section, items]) => (
              <div key={section} style={sectionStyle}>
                <h4 style={{ margin: "0 0 9px", color: "#0d1b2b", fontSize: 16 }}>{section}</h4>
                <div style={{ display: "grid", gap: 9 }}>
                  {items.map((item) => (
                    <div key={item.number} style={{ ...itemStyle, borderColor: item.result === "fail" ? "#e49b95" : item.result === "pass" ? "#a9d2b8" : "#dfe5ea" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "42px minmax(0,1fr)", gap: 9 }}>
                        <strong style={{ color: "#f47b20", fontSize: 15 }}>#{item.number}</strong>
                        <span style={{ color: "#263642", fontSize: 13, lineHeight: 1.45 }}>{item.text}</span>
                      </div>

                      <div style={{ marginTop: 9, display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {(["pass","fail","na"] as const).map((result) => (
                          <button
                            key={result}
                            disabled={busy || !canWork || isCompleted}
                            onClick={() => void setItem(item, result)}
                            style={resultButton(item.result === result, result)}
                          >
                            {result === "pass" ? "Pass" : result === "fail" ? "Fail" : "N/A"}
                          </button>
                        ))}
                      </div>

                      <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 7 }}>
                        <textarea
                          value={notes[item.number] ?? ""}
                          onChange={(event) => setNotes((current) => ({ ...current, [item.number]: event.target.value }))}
                          disabled={!canWork || isCompleted}
                          placeholder={item.result === "fail" ? "Failure note required — describe what is wrong and what was corrected." : "Notes (optional)"}
                          rows={2}
                          style={noteStyle}
                        />
                        {canWork && !isCompleted && <button disabled={busy} onClick={() => void setItem(item)} style={secondaryButton}>Save Note</button>}
                      </div>

                      <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        {canWork && !isCompleted && (
                          <label style={photoButton}>
                            Add Photo
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              disabled={busy}
                              onChange={(event) => {
                                const file = event.target.files?.[0] ?? null;
                                void uploadPhoto(item, file);
                                event.currentTarget.value = "";
                              }}
                              style={{ display: "none" }}
                            />
                          </label>
                        )}
                        {item.photos.map((photo) => (
                          <div key={photo.id} style={photoWrap}>
                            <a href={photo.url} target="_blank" rel="noreferrer" title={photo.fileName}>
                              <img src={photo.url} alt={`Checklist item ${item.number}`} style={photoStyle} />
                            </a>
                            {canWork && !isCompleted && <button disabled={busy} onClick={() => void removePhoto(photo.id)} style={photoRemoveButton}>×</button>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {data.mileageSource === "Manual" && data.eventType === "pm" && !isCompleted && (
            <div style={{ marginTop: 14, maxWidth: 360 }}>
              <label style={{ display: "block", marginBottom: 5, color: "#52616c", fontSize: 11, fontWeight: 900 }}>CURRENT MILEAGE</label>
              <input type="number" min="0" step="1" value={manualMileage} onChange={(event) => setManualMileage(event.target.value)} style={inputStyle} disabled={!canWork || busy} />
            </div>
          )}

          {canWork && !isCompleted && !isReady && (
            <button
              disabled={busy || pending > 0 || failed > 0}
              onClick={() => void postJson({ action: "markReady", ...(data.mileageSource === "Manual" && data.eventType === "pm" ? { mileage: manualMileage } : {}) })}
              style={{ ...completeButton, marginTop: 15, opacity: pending > 0 || failed > 0 ? 0.55 : 1 }}
            >
              Finish Checklist & Unlock Work Order
            </button>
          )}

          {isReady && (
            <div style={readyNotice}>
              Checklist complete. Use <strong>Complete Repair</strong> on this job. The {data.eventType === "pm" ? "PM mileage/date and next PM type" : "annual inspection date"} will update automatically when the work order closes.
            </div>
          )}
          {isCompleted && (
            <div style={readyNotice}>
              Maintenance completed. The schedule baseline was advanced automatically{data.eventType === "pm" && data.mileageAtCompletion != null ? ` at ${Number(data.mileageAtCompletion).toLocaleString()} miles` : ""}.
            </div>
          )}
        </>
      )}
    </section>
  );
}

function resultButton(active: boolean, result: "pass" | "fail" | "na") {
  const activeStyle = result === "pass"
    ? { background: "#176440", borderColor: "#176440", color: "white" }
    : result === "fail"
      ? { background: "#b42318", borderColor: "#b42318", color: "white" }
      : { background: "#56616b", borderColor: "#56616b", color: "white" };
  return {
    border: "1px solid #cbd4db",
    borderRadius: 7,
    padding: "7px 11px",
    background: "white",
    color: "#263642",
    fontWeight: 900,
    fontSize: 11,
    cursor: "pointer",
    ...(active ? activeStyle : {}),
  } as const;
}

const panelStyle = { marginTop: 20, padding: 17, borderRadius: 12, border: "1px solid #d8e0e6", background: "#fbfcfd" } as const;
const sectionStyle = { padding: 12, borderRadius: 10, background: "white", border: "1px solid #e1e6ea" } as const;
const itemStyle = { padding: 11, borderRadius: 9, border: "1px solid #dfe5ea", background: "#fbfcfd" } as const;
const primaryButton = { border: 0, borderRadius: 8, padding: "9px 12px", background: "#f47b20", color: "white", fontWeight: 900, cursor: "pointer" } as const;
const secondaryButton = { alignSelf: "stretch", border: "1px solid #cbd3da", borderRadius: 8, padding: "8px 10px", background: "#f7f9fa", color: "#182331", fontWeight: 800, cursor: "pointer" } as const;
const completeButton = { border: 0, borderRadius: 9, padding: "11px 14px", background: "#16784c", color: "white", fontWeight: 900, cursor: "pointer" } as const;
const inputStyle = { width: "100%", boxSizing: "border-box" as const, padding: "10px 11px", border: "1px solid #ccd4db", borderRadius: 8, background: "white", color: "#182331" } as const;
const noteStyle = { width: "100%", boxSizing: "border-box" as const, resize: "vertical" as const, padding: "8px 9px", border: "1px solid #ccd4db", borderRadius: 7, background: "white", color: "#182331", font: "inherit", fontSize: 12 } as const;
const messageStyle = { marginTop: 10, padding: "9px 11px", borderRadius: 8, background: "#fff8e6", border: "1px solid #efcf85", color: "#714b11", fontSize: 12 } as const;
const progressBadge = { padding: "5px 8px", borderRadius: 999, background: "#eef2f5", color: "#344451", fontWeight: 900, fontSize: 11 } as const;
const pendingBadge = { ...progressBadge, background: "#fff3dc", color: "#87560b" } as const;
const failBadge = { ...progressBadge, background: "#fff0ef", color: "#a6261b" } as const;
const readyBadge = { ...progressBadge, background: "#e6f6ec", color: "#176440" } as const;
const readyNotice = { marginTop: 14, padding: "11px 12px", borderRadius: 9, background: "#e9f7ed", border: "1px solid #a9d2b8", color: "#176440", fontSize: 12 } as const;
const photoButton = { display: "inline-flex", alignItems: "center", minHeight: 30, padding: "0 10px", border: "1px solid #cbd3da", borderRadius: 7, background: "white", color: "#263642", fontWeight: 900, fontSize: 11, cursor: "pointer" } as const;
const photoWrap = { position: "relative" as const, width: 74, height: 58, borderRadius: 7, overflow: "hidden", border: "1px solid #d6dde3", background: "#eef2f5" } as const;
const photoStyle = { display: "block", width: "100%", height: "100%", objectFit: "cover" as const } as const;
const photoRemoveButton = { position: "absolute" as const, top: 2, right: 2, width: 20, height: 20, border: 0, borderRadius: 999, background: "#8f1f17", color: "white", fontWeight: 900, cursor: "pointer", lineHeight: "18px" } as const;
