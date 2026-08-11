"use client";

import { useEffect, useState } from "react";

export default function PhotosPage() {
  const [ids, setIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("ids") || "";
    const directIds = Array.from(new Set(value.split(",").map((id) => id.trim()).filter(Boolean)));
    if (directIds.length) {
      setIds(directIds);
      setLoading(false);
      return;
    }

    const defectId = params.get("defectId") || "";
    if (!defectId) {
      setLoading(false);
      return;
    }

    void fetch(`/api/geotab-photo-ids?defectId=${encodeURIComponent(defectId)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { ids?: string[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Geotab photos could not be loaded.");
        setIds(Array.from(new Set((payload.ids || []).map((id) => id.trim()).filter(Boolean))));
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Geotab photos could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main style={{ minHeight: "100vh", padding: 32, background: "#0b121a", color: "white" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#9fb0bf", fontSize: 12, fontWeight: 800, letterSpacing: ".14em" }}>GEOTAB DVIR</p>
          <h1 style={{ margin: "7px 0 0", fontSize: 30 }}>Inspection photos</h1>
        </div>
        <a href="/repair-board" style={{ color: "white", textDecoration: "none", padding: "9px 13px", border: "1px solid #526170", borderRadius: 8 }}>Back to Repair Board</a>
      </header>

      {loading ? (
        <div style={{ marginTop: 30, padding: 24, border: "1px solid #34414d", borderRadius: 12, color: "#aeb8c2" }}>Loading Geotab photos…</div>
      ) : message ? (
        <div style={{ marginTop: 30, padding: 24, border: "1px solid #704949", borderRadius: 12, color: "#e0b7b7" }}>{message}</div>
      ) : !ids.length ? (
        <div style={{ marginTop: 30, padding: 24, border: "1px solid #34414d", borderRadius: 12, color: "#aeb8c2" }}>No photos were attached to this defect.</div>
      ) : (
        <section style={{ marginTop: 26, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18 }}>
          {ids.map((id, index) => (
            <figure key={id} style={{ margin: 0, padding: 10, border: "1px solid #34414d", borderRadius: 12, background: "#111c27" }}>
              <img
                src={`/api/geotab-media?id=${encodeURIComponent(id)}`}
                alt={`DVIR attachment ${index + 1}`}
                style={{ display: "block", width: "100%", minHeight: 260, maxHeight: "76vh", objectFit: "contain", borderRadius: 8, background: "#05090d" }}
              />
              <figcaption style={{ padding: "9px 4px 2px", color: "#9eabb7", fontSize: 13 }}>Photo {index + 1} of {ids.length}</figcaption>
            </figure>
          ))}
        </section>
      )}
    </main>
  );
}
