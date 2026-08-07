"use client";

import { FormEvent, useEffect, useState } from "react";

type Role = "viewer" | "mechanic" | "manager" | "admin";
type User = {
  id: number;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

const roleDescriptions: Record<Role, string> = {
  viewer: "Read-only dashboard access",
  mechanic: "Repairs, work orders, DVIR repairs and part usage",
  manager: "Mechanic access plus inventory and operational changes",
  admin: "Full access including user and clearance management",
};

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [newUser, setNewUser] = useState({ email: "", displayName: "", password: "", role: "mechanic" as Role });

  async function load() {
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    if (response.status === 401) {
      window.location.assign("/login?returnTo=/admin/users");
      return;
    }
    const result = (await response.json()) as { users?: User[]; error?: string };
    if (!response.ok) throw new Error(result.error || "Users could not be loaded.");
    setUsers(result.users ?? []);
  }

  useEffect(() => {
    void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Users could not be loaded."));
  }, []);

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", ...newUser }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "User could not be created.");
      setNewUser({ email: "", displayName: "", password: "", role: "mechanic" });
      setMessage("User created. Give the user their temporary password securely.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "User could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function updateUser(user: User) {
    setMessage("");
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "update", id: user.id, displayName: user.displayName, role: user.role, active: user.active }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) return setMessage(result.error || "User could not be updated.");
    setMessage(`${user.displayName} updated.`);
    await load();
  }

  async function resetPassword(user: User) {
    const password = window.prompt(`Enter a new temporary password for ${user.displayName}. It must be at least 12 characters.`);
    if (!password) return;
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resetPassword", id: user.id, password }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) return setMessage(result.error || "Password could not be reset.");
    setMessage(`Password reset for ${user.displayName}. Existing sessions were signed out.`);
  }

  function patchUser(id: number, patch: Partial<User>) {
    setUsers((current) => current.map((user) => user.id === id ? { ...user, ...patch } : user));
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f3f5f7", padding: "42px", color: "#182331" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: 0, color: "#f47b20", fontSize: 12, fontWeight: 900, letterSpacing: ".16em" }}>ADMINISTRATION</p>
          <h1 style={{ margin: "8px 0 0", color: "#0d1b2b", fontSize: 34 }}>Users & clearances</h1>
          <p style={{ margin: "8px 0 0", color: "#6c7886" }}>Create dashboard accounts and control what each person is allowed to change.</p>
        </div>
        <a href="/" style={{ color: "#0d1b2b", fontWeight: 800 }}>Back to repair board</a>
      </header>

      {message && <div style={{ marginTop: 20, padding: 12, background: "#fff8e6", border: "1px solid #f2c66d", borderRadius: 9 }}>{message}</div>}

      <section style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        {(Object.keys(roleDescriptions) as Role[]).map((role) => (
          <article key={role} style={{ background: "white", border: "1px solid #dce2e7", borderRadius: 12, padding: 16 }}>
            <strong style={{ textTransform: "capitalize", color: "#0d1b2b" }}>{role}</strong>
            <p style={{ margin: "7px 0 0", color: "#6c7886", fontSize: 13, lineHeight: 1.45 }}>{roleDescriptions[role]}</p>
          </article>
        ))}
      </section>

      <section style={{ marginTop: 22, background: "white", border: "1px solid #dce2e7", borderRadius: 12, padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Add user</h2>
        <form onSubmit={createUser} style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          <input type="email" required placeholder="Email" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} style={{ padding: 11 }} />
          <input required placeholder="Name" value={newUser.displayName} onChange={(event) => setNewUser({ ...newUser, displayName: event.target.value })} style={{ padding: 11 }} />
          <input type="password" minLength={12} required placeholder="Temporary password (12+ characters)" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} style={{ padding: 11 }} />
          <select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value as Role })} style={{ padding: 11 }}>
            {(Object.keys(roleDescriptions) as Role[]).map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <button disabled={busy} type="submit" style={{ gridColumn: "1 / -1", justifySelf: "start", border: 0, borderRadius: 8, padding: "11px 18px", background: "#f47b20", color: "white", fontWeight: 900 }}>{busy ? "Creating…" : "Create user"}</button>
        </form>
      </section>

      <section style={{ marginTop: 22, background: "white", border: "1px solid #dce2e7", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 18, borderBottom: "1px solid #dce2e7" }}><strong>{users.length} dashboard users</strong></div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead><tr>{["Name", "Email", "Clearance", "Active", "Last login", "Actions"].map((heading) => <th key={heading} style={{ padding: 13, textAlign: "left", background: "#f7f9fa", color: "#657383", fontSize: 11 }}>{heading}</th>)}</tr></thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} style={{ borderTop: "1px solid #edf0f2", opacity: user.active ? 1 : .58 }}>
                  <td style={{ padding: 13 }}><input value={user.displayName} onChange={(event) => patchUser(user.id, { displayName: event.target.value })} style={{ padding: 8, width: 180 }} /></td>
                  <td style={{ padding: 13 }}>{user.email}</td>
                  <td style={{ padding: 13 }}><select value={user.role} onChange={(event) => patchUser(user.id, { role: event.target.value as Role })} style={{ padding: 8 }}>{(Object.keys(roleDescriptions) as Role[]).map((role) => <option key={role} value={role}>{role}</option>)}</select></td>
                  <td style={{ padding: 13 }}><input type="checkbox" checked={user.active} onChange={(event) => patchUser(user.id, { active: event.target.checked })} /></td>
                  <td style={{ padding: 13, color: "#6c7886" }}>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}</td>
                  <td style={{ padding: 13, whiteSpace: "nowrap" }}>
                    <button onClick={() => void updateUser(user)} style={{ marginRight: 7 }}>Save</button>
                    <button onClick={() => void resetPassword(user)}>Reset password</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
