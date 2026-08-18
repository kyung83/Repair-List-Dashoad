"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Role = "viewer" | "mechanic" | "manager" | "admin";
type ModuleName = "shop" | "units" | "parts" | "reports";
type Tab = { href: string; label: string; exact?: boolean; roles: Role[] };

const managerRoles: Role[] = ["manager", "admin"];
const officeRoles: Role[] = ["viewer", "manager", "admin"];
const moduleConfig: Record<ModuleName, { label: string; tabs: Tab[] }> = {
  shop: {
    label: "Shop Board",
    tabs: [
      { href: "/repair-board", label: "Open Work", roles: managerRoles },
      { href: "/work-orders", label: "Completed Work", roles: officeRoles },
    ],
  },
  units: {
    label: "Units",
    tabs: [
      { href: "/unit", label: "Find Unit", roles: ["viewer", "mechanic", "manager", "admin"] },
      { href: "/equipment", label: "Equipment List", roles: officeRoles },
    ],
  },
  parts: {
    label: "Parts",
    tabs: [
      { href: "/parts-desk", label: "Parts Desk", roles: managerRoles },
      { href: "/inventory", label: "Inventory", roles: managerRoles },
      { href: "/invoices", label: "Invoices", roles: managerRoles },
    ],
  },
  reports: {
    label: "Reports",
    tabs: [
      { href: "/reports", label: "Reports", exact: true, roles: officeRoles },
      { href: "/reports/history", label: "Repair History", roles: officeRoles },
    ],
  },
};

function isActive(pathname: string, tab: Tab) {
  return tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
}

export default function ModuleTabs({ module }: { module: ModuleName }) {
  const pathname = usePathname();
  const [role, setRole] = useState<Role | null>(null);
  const config = moduleConfig[module];

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => response.ok ? await response.json() as { user?: { role: Role } } : {})
      .then((payload) => {
        if (!cancelled) setRole(payload.user?.role ?? null);
      })
      .catch(() => {
        if (!cancelled) setRole(null);
      });
    return () => { cancelled = true; };
  }, []);

  const tabs = role ? config.tabs.filter((tab) => tab.roles.includes(role)) : [];
  if (tabs.length < 2) return null;

  return (
    <nav className="module-tabs-shell" aria-label={config.label}>
      {tabs.map((tab) => <a key={tab.href} href={tab.href} className={isActive(pathname, tab) ? "active" : ""} aria-current={isActive(pathname, tab) ? "page" : undefined}>{tab.label}</a>)}
    </nav>
  );
}
