"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = (await response.json()) as { error?: string; setupRequired?: boolean };
      if (result.setupRequired) {
        window.location.assign("/setup");
        return;
      }
      if (!response.ok) {
        setMessage(result.error || "Sign in failed.");
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const requested = params.get("returnTo") || "/";
      const returnTo = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";
      window.location.assign(returnTo);
    } catch {
      setMessage("The dashboard could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ position: "fixed", inset: 0, zIndex: 1000, overflow: "auto", background: "#0d1b2b", color: "#182331", display: "grid", placeItems: "center", padding: 24 }}>
      <section style={{ width: "min(460px, 100%)", background: "white", borderRadius: 18, padding: 32, boxShadow: "0 24px 70px #0007" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "#f47b20", display: "grid", placeItems: "center", color: "white", fontWeight: 900 }}>N</div>
          <div>
            <strong style={{ display: "block", color: "#0d1b2b", letterSpacing: ".02em" }}>NORLOW FLEET OPERATIONS</strong>
            <span style={{ color: "#6c7886", fontSize: 12 }}>Repair, PM and inventory dashboard</span>
          </div>
        </div>

        <h1 style={{ margin: 0, fontSize: 30, color: "#0d1b2b" }}>Sign in</h1>
        <p style={{ margin: "8px 0 24px", color: "#6c7886", lineHeight: 1.5 }}>Use the account created for you by a dashboard administrator.</p>

        {message && <div style={{ marginBottom: 16, padding: 12, borderRadius: 9, background: "#fff3e9", border: "1px solid #f6b47d", color: "#88420b" }}>{message}</div>}

        <form onSubmit={signIn} style={{ display: "grid", gap: 14 }}>
          <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
            Email
            <input autoComplete="username" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} style={{ border: "1px solid #ccd5dd", borderRadius: 9, padding: "12px 13px", fontSize: 15 }} />
          </label>
          <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
            Password
            <input autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} style={{ border: "1px solid #ccd5dd", borderRadius: 9, padding: "12px 13px", fontSize: 15 }} />
          </label>
          <button disabled={busy} type="submit" style={{ border: 0, borderRadius: 9, padding: "13px 18px", background: "#f47b20", color: "white", fontWeight: 900, fontSize: 15, cursor: busy ? "wait" : "pointer", opacity: busy ? .7 : 1 }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
