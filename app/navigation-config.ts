export type Role = "viewer" | "mechanic" | "manager" | "admin";
export type ModuleName = "shop" | "units" | "maintenance" | "parts" | "billing" | "reports" | "diagnostics";

export type NavLink = {
  href: string;
  label: string;
  exact?: boolean;
  activeFor?: string[];
};

export type ModuleTab = {
  href: string;
  label: string;
  exact?: boolean;
  roles: Role[];
  view?: string;
};

const allRoles: Role[] = ["viewer", "mechanic", "manager", "admin"];
const adminRoles: Role[] = ["admin"];
const managerRoles: Role[] = ["manager", "admin"];
const workingRoles: Role[] = ["mechanic", "manager", "admin"];
const officeRoles: Role[] = ["viewer", "manager", "admin"];

export const moduleConfig: Record<ModuleName, { label: string; tabs: ModuleTab[] }> = {
  shop: {
    label: "Shop",
    tabs: [
      { href: "/shop", label: "My Jobs", roles: workingRoles },
      { href: "/repair-board", label: "Shop Board", roles: workingRoles },
      { href: "/outside-work", label: "Outside Work", exact: true, roles: managerRoles },
      { href: "/work-orders", label: "Completed Work", exact: true, roles: officeRoles },
    ],
  },
  units: {
    label: "Units",
    tabs: [
      { href: "/unit", label: "Unit Hub", roles: allRoles },
      { href: "/equipment", label: "Master Equipment", roles: officeRoles },
    ],
  },
  maintenance: {
    label: "Maintenance",
    tabs: [
      { href: "/pm-schedules", label: "PM Schedule", roles: managerRoles },
      { href: "/pm-kits", label: "PM Kits", roles: managerRoles },
      { href: "/annual-schedules", label: "Annual Schedule", roles: managerRoles },
      { href: "/annual-inspections", label: "Annual Records", roles: managerRoles },
      { href: "/next-pm-repairs", label: "Planned Repairs", roles: managerRoles },
    ],
  },
  parts: {
    label: "Parts",
    tabs: [
      { href: "/parts-desk", label: "Parts Desk", roles: managerRoles },
      { href: "/inventory", label: "Inventory", roles: managerRoles },
    ],
  },
  billing: {
    label: "Billing",
    tabs: [
      { href: "/invoices?view=invoices", label: "Invoices", roles: managerRoles, view: "invoices" },
      { href: "/invoices?view=ready", label: "Create Invoice", roles: managerRoles, view: "ready" },
      { href: "/invoices?view=settings", label: "Customers & Rates", roles: managerRoles, view: "settings" },
    ],
  },
  reports: {
    label: "Reports",
    tabs: [
      { href: "/reports", label: "Reports", exact: true, roles: officeRoles },
      { href: "/reports/history", label: "Repair History", roles: officeRoles },
    ],
  },
  diagnostics: {
    label: "Diagnostics",
    tabs: [
      { href: "/admin/geotab-review/health", label: "Fleet Health", exact: true, roles: adminRoles },
      { href: "/admin/geotab-review/assignments", label: "Device Assignments", exact: true, roles: adminRoles },
      { href: "/admin/geotab-review", label: "Identity & Mileage", exact: true, roles: adminRoles },
      { href: "/admin/geotab-review/connection", label: "Connection", exact: true, roles: adminRoles },
      { href: "/admin/equipment-merge", label: "Duplicate Units", roles: adminRoles },
    ],
  },
};

const managerPrimary: NavLink[] = [
  { href: "/", label: "Today", exact: true },
  { href: "/repair-board", label: "Shop", activeFor: ["/shop", "/outside-work", "/work-orders"] },
  { href: "/unit", label: "Units", activeFor: ["/equipment"] },
  { href: "/pm-schedules", label: "Maintenance", activeFor: ["/pm-kits", "/annual-schedules", "/annual-inspections", "/next-pm-repairs"] },
  { href: "/parts-desk", label: "Parts", activeFor: ["/inventory"] },
  { href: "/invoices", label: "Billing" },
  { href: "/reports", label: "Reports" },
];

const adminPrimary: NavLink[] = [
  ...managerPrimary,
  { href: "/admin/geotab-review/health", label: "Diagnostics", activeFor: ["/admin/geotab-review", "/admin/equipment-merge"] },
];

const mechanicPrimary: NavLink[] = [
  { href: "/shop", label: "My Jobs" },
  { href: "/repair-board", label: "Shop Board" },
  { href: "/unit", label: "Find Unit" },
  { href: "/annual-inspections", label: "Forms" },
];

const viewerPrimary: NavLink[] = [
  { href: "/", label: "Today", exact: true },
  { href: "/unit", label: "Units", activeFor: ["/equipment"] },
  { href: "/work-orders", label: "Completed Work" },
  { href: "/annual-inspections", label: "Annual Forms" },
  { href: "/reports", label: "Reports" },
];

export const adminMoreLinks: NavLink[] = [
  { href: "/admin/users", label: "Users & Access" },
  { href: "/admin/history-import", label: "History Import" },
];

export function primaryLinksForRole(role: Role | null): NavLink[] {
  if (role === "admin") return adminPrimary;
  if (role === "manager") return managerPrimary;
  if (role === "mechanic") return mechanicPrimary;
  if (role === "viewer") return viewerPrimary;
  return [];
}
