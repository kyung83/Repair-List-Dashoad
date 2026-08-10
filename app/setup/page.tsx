"use client";

import { FormEvent, useEffect, useState } from "react";

export default function SetupPage() {
  const [setupToken, setSetupToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [setupRequired, setSetupRequired] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/setup", { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { setupRequired?: boolean; bootstrapConfigured?: boolean }) => {
        setSetupRequired(Boolean(result.setupRequired));
        setConfigured(Boolean(result.bootstrapConfigured));
      })
      .catch(() => setConfigured(false));
  }, []);

  async function createAdministrator(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ setupToken, displayName, email, password }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(result.error || "Administrator setup failed.");
        return;
      }
      window.location.assign("/admin/users");
    } catch {
      setMessage("Administrator setup could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ position: "fixed", inset: 0, zIndex: 1000, overflow: "auto", background: "#0d1b2b", color: "#182331", display: "grid", placeItems: "center", padding: 24 }}>
      <section style={{ width: "min(620px, 100%)", background: "white", borderRadius: 18, padding: 32, boxShadow: "0 24px 70px #0007" }}>
        <p style={{ margin: 0, color: "#f47b20", fontSize: 12, fontWeight: 900, letterSpacing: ".16em" }}>ONE-TIME SECURITY SETUP</p>
        <h1 style={{ margin: "8px 0 0", color: "#0d1b2b", fontSize: 30 }}>Create the first administrator</h1>
        <p style={{ color: "#6c7886", lineHeight: 1.55 }}>This page only works while the dashboard has no users. The setup token must match the private <code>AUTH_BOOTSTRAP_TOKEN</code> Cloudflare Worker secret.</p>

        {!setupRequired && (
          <div style={{ marginTop: 18, padding: 14, borderRadius: 9, background: "#eef8f0", border: "1px solid #a8d5b0" }}>
            Setup is complete. <a href="/login">Go to sign in.</a>
          </div>
        )}
        {setupRequired && configured === false && (
          <div style={{ marginTop: 18, padding: 14, borderRadius: 9, background: "#fff8e6", border: "1px solid #f2c66d" }}>
            The bootstrap secret has not been configured yet. Add <strong>AUTH_BOOTSTRAP_TOKEN</strong> as a Cloudflare Worker secret, then reload this page.
          </div>
        )}
        {message && <div style={{ marginTop: 18, padding: 12, borderRadius: 9, background: "#fff3e9", border: "1px solid #f6b47d", color: "#88420b" }}>{message}</div>}

        {setupRequired && (
          <form onSubmit={createAdministrator} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 22 }}>
            <label style={{ gridColumn: "1 / -1", display: "grid", gap: 6, fontWeight: 700 }}>
              Private setup token
              <input type="password" autoComplete="off" required value={setupToken} onChange={(event) => setSetupToken(event.target.value)} style={{ padding: 12, border: "1px solid #ccd5dd", borderRadius: 9 }} />
            </label>
            <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
              Name
              <input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} style={{ padding: 12, border: "1px solid #ccd5dd", borderRadius: 9 }} />
            </label>
            <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
              Email
              <input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} style={{ padding: 12, border: "1px solid #ccd5dd", borderRadius: 9 }} />
            </label>
            <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
              Password
              <input type="password" minLength={6} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} style={{ padding: 12, border: "1px solid #ccd5dd", borderRadius: 9 }} />
            </label>
            <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
              Confirm password
              <input type="password" minLength={6} autoComplete="new-password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} style={{ padding: 12, border: "1px solid #ccd5dd", borderRadius: 9 }} />
            </label>
            <button disabled={busy || configured === false} type="submit" style={{ gridColumn: "1 / -1", border: 0, borderRadius: 9, padding: "13px 18px", background: "#f47b20", color: "white", fontWeight: 900, cursor: busy ? "wait" : "pointer", opacity: busy || configured === false ? .65 : 1 }}>
              {busy ? "Creating administrator…" : "Create administrator"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}