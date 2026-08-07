"use client";

import { useEffect, useState } from "react";

type User = { id: number; email: string; displayName: string; role: "viewer" | "mechanic" | "manager" | "admin" };

export default function SessionNav() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    void fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => response.ok ? (await response.json() as { user: User }).user : null)
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/login");
  }

  if (!user) return null;
  return (
    <>
      {user.role === "admin" && <a href="/admin/users" style={{ padding: "10px 14px", borderRadius: 999, background: "#49657a", color: "white", textDecoration: "none", fontWeight: 800, boxShadow: "0 6px 20px #0003" }}>Users</a>}
      <span title={user.email} style={{ padding: "10px 14px", borderRadius: 999, background: "white", color: "#0d1b2b", fontWeight: 800, boxShadow: "0 6px 20px #0003" }}>{user.displayName} · {user.role}</span>
      <button onClick={() => void signOut()} style={{ border: 0, padding: "10px 14px", borderRadius: 999, background: "#5c6670", color: "white", fontWeight: 800, boxShadow: "0 6px 20px #0003", cursor: "pointer" }}>Sign out</button>
    </>
  );
}
