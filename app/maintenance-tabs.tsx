"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Role = "viewer" | "mechanic" | "manager" | "admin";
type UserPayload = { user?: { role: Role } };

function matches(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export default function MaintenanceTabs() {
  const pathname = usePathname();
  const [canManage, setCanManage] = useState(false);
  const pmActive = matches(pathname, "/pm-schedules") || matches(pathname, "/pm-kits");
  const annualActive = matches(pathname, "/annual-schedules") || matches(pathname, "/annual-inspections");
  const plannedActive = matches(pathname, "/next-pm-repairs");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as UserPayload : {})
      .then((payload) => {
        if (cancelled) return;
        setCanManage(payload.user?.role === "manager" || payload.user?.role === "admin");
      })
      .catch(() => {
        if (!cancelled) setCanManage(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (!canManage) return null;

  return (
    <div className="maintenance-tabs-shell">
      <nav className="maintenance-tabs" aria-label="Maintenance">
        <a href="/pm-schedules" className={pmActive ? "active" : ""} aria-current={pmActive ? "page" : undefined}>PMs</a>
        <a href="/annual-schedules" className={annualActive ? "active" : ""} aria-current={annualActive ? "page" : undefined}>Annuals</a>
        <a href="/next-pm-repairs" className={plannedActive ? "active" : ""} aria-current={plannedActive ? "page" : undefined}>Planned Repairs</a>
      </nav>
      {pmActive && (
        <nav className="maintenance-subtabs" aria-label="PM schedules and kits">
          <span>PMs</span>
          <a href="/pm-schedules" className={matches(pathname, "/pm-schedules") ? "active" : ""}>Schedules</a>
          <a href="/pm-kits" className={matches(pathname, "/pm-kits") ? "active" : ""}>PM Kits</a>
        </nav>
      )}
      {annualActive && (
        <nav className="maintenance-subtabs" aria-label="Annual schedules and forms">
          <span>Annuals</span>
          <a href="/annual-schedules" className={matches(pathname, "/annual-schedules") ? "active" : ""}>Schedule</a>
          <a href="/annual-inspections" className={matches(pathname, "/annual-inspections") ? "active" : ""}>Completed Forms</a>
        </nav>
      )}
    </div>
  );
}
