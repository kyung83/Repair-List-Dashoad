"use client";

import { useEffect, useState } from "react";

export default function PhotosPage() {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("ids") || "";
    setIds(Array.from(new Set(value.split(",").map((id) => id.trim()).filter(Boolean))));
  }, []);

  return (
    <main style={{ minHeight: "100vh", padding: 32, background: "#0b121a", color: "white" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#f47b20", fontSize: 12, fontWeight: 800, letterSpacing: ".14em" }}>GEOTAB DVIR</p>
          <h1 style={{ margin: "7px 0 0", fontSize: 30 }}>Inspection photos</h1>
        </div>
        <a href="/" style={{ color: "white", textDecoration: "none", padding: "9px 13px", border: "1px solid #526170", borderRadius: 8 }}>Back to repair board</a>
      </header>

      {!ids.length ? (
        <div style={{ marginTop: 30, padding: 24, border: "1px solid #34414d", borderRadius: 12, color: "#aeb8c2" }}>No photos were attached to this defect.</div>
      ) : (
        <section style={{ marginTop: 26, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
          {ids.map((id, index) => (
            <figure key={id} style={{ margin: 0, padding: 10, border: "1px solid #34414d", borderRadius: 12, background: "#111c27" }}>
              <img
                src={`/api/geotab-media?id=${encodeURIComponent(id)}`}
                alt={`DVIR attachment ${index + 1}`}
                style={{ display: "block", width: "100%", minHeight: 220, maxHeight: "72vh", objectFit: "contain", borderRadius: 8, background: "#05090d" }}
              />
              <figcaption style={{ padding: "9px 4px 2px", color: "#9eabb7", fontSize: 12 }}>Photo {index + 1} of {ids.length}</figcaption>
            </figure>
          ))}
        </section>
      )}
    </main>
  );
}
