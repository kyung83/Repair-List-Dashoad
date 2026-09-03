export type Role = "viewer" | "mechanic" | "dispatch" | "manager" | "admin";
export type ModuleName = "shop" | "units" | "maintenance" | "parts" | "billing" | "reports" | "diagnostics";

export type NavLink = {
  href: string;
  label: string;
  exact?: boolean;
  activeFor?: string[];
  view?: string;
};

export type ModuleTab = {
  href: string;
  label: string;
  exact?: boolean;
  roles: Role[];
  view?: string;
};

export type SidebarGroup = {
  key: "repairs" | "breakdowns" | "maintenance" | "units" | "parts" | "reports" | "settings";
  label: string;
  href: string;
  roles: Role[];
  links: Array<NavLink & { roles: Role[] }>;
};

const allRoles: Role[] = ["viewer", "mechanic", "manager", "admin"];
const adminRoles: Role[] = ["admin"];
const managerRoles: Role[] = ["manager", "admin"];
const workingRoles: Role[] = ["mechanic", "manager", "admin"];
const officeRoles: Role[] = ["viewer", "manager", "admin"];
const repairBoardRoles: Role[] = ["mechanic", "dispatch", "manager", "admin"];
const breakdownOperatorRoles: Role[] = ["dispatch", "manager", "admin"];
const repairGroupRoles: Role[] = ["viewer", "mechanic", "dispatch", "manager", "admin"];

// Legacy metadata is retained for compatibility with older source assertions.
// The visible application navigation is now exclusively sidebarGroups below.
export const moduleConfig: Record<ModuleName, { label: string; tabs: ModuleTab[] }> = {
  shop: {
    label: "Repairs",
    tabs: [
      { href: "/shop", label: "My Jobs", roles: workingRoles },
      { href: "/repair-board", label: "Shop Board", roles: repairBoardRoles },
      { href: "/breakdowns", label: "Breakdowns", exact: true, roles: breakdownOperatorRoles },
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
      { href: "/annual-schedules", label: "Annual Schedule", roles: managerRoles },
      { href: "/annual-inspections", label: "Annual Records", roles: managerRoles },
      { href: "/next-pm-repairs", label: "Planned Repairs", roles: managerRoles },
    ],
  },
  parts: {
    label: "Parts",
    tabs: [
      { href: "/parts-desk", label: "Parts Desk", roles: managerRoles },
      { href: "/inventory", label: "Inventory", exact: true, roles: managerRoles },
      { href: "/pm-kits", label: "PM Kits", roles: managerRoles },
      { href: "/inventory-controls", label: "Controls", roles: managerRoles },
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
      { href: "/reports", label: "Summary", exact: true, roles: officeRoles },
      { href: "/reports/search", label: "Search Reports", exact: true, roles: officeRoles },
      { href: "/reports/breakdowns", label: "Breakdowns", exact: true, roles: officeRoles },
      { href: "/reports/history", label: "Repair History", roles: officeRoles },
    ],
  },
  diagnostics: {
    label: "Settings",
    tabs: [
      { href: "/admin/geotab-review/health", label: "Fleet Health", exact: true, roles: adminRoles },
      { href: "/admin/geotab-review/assignments", label: "Device Assignments", exact: true, roles: adminRoles },
      { href: "/admin/geotab-review", label: "Identity & Mileage", exact: true, roles: adminRoles },
      { href: "/admin/geotab-review/connection", label: "Geotab Connection", exact: true, roles: adminRoles },
      { href: "/admin/gmail", label: "Breakdown Email", exact: true, roles: adminRoles },
      { href: "/admin/twilio", label: "Breakdown Texting", exact: true, roles: adminRoles },
      { href: "/admin/twilio/schedule", label: "Text Schedule", exact: true, roles: adminRoles },
      { href: "/admin/equipment-merge", label: "Duplicate Units", roles: adminRoles },
    ],
  },
};

const sidebarGroups: SidebarGroup[] = [
  {
    key: "repairs",
    label: "Repairs",
    href: "/repair-board",
    roles: repairGroupRoles,
    links: [
      { href: "/repair-board", label: "Repair Board", roles: repairBoardRoles },
      { href: "/shop", label: "My Jobs", roles: workingRoles },
      { href: "/outside-work", label: "Outside Repairs", exact: true, roles: managerRoles },
      { href: "/work-orders", label: "Completed Work", exact: true, roles: officeRoles },
      { href: "/invoices?view=invoices", label: "Invoices", view: "invoices", roles: managerRoles },
      { href: "/invoices?view=ready", label: "Create Invoice", view: "ready", roles: managerRoles },
    ],
  },
  {
    key: "breakdowns",
    label: "Breakdowns",
    href: "/breakdowns",
    roles: breakdownOperatorRoles,
    links: [
      { href: "/breakdowns", label: "Active Breakdowns", exact: true, roles: breakdownOperatorRoles },
      { href: "/reports/breakdowns", label: "Breakdown Reports", exact: true, roles: managerRoles },
      { href: "/breakdowns/setup", label: "Breakdown Setup", exact: true, roles: managerRoles },
    ],
  },
  {
    key: "maintenance",
    label: "Maintenance",
    href: "/pm-schedules",
    roles: allRoles,
    links: [
      { href: "/pm-schedules", label: "PM Schedule", roles: managerRoles },
      { href: "/annual-schedules", label: "Annual Schedule", roles: managerRoles },
      { href: "/next-pm-repairs", label: "Planned Repairs", roles: managerRoles },
      { href: "/annual-inspections", label: "Annual Records / Forms", roles: allRoles },
    ],
  },
  {
    key: "units",
    label: "Units",
    href: "/unit",
    roles: allRoles,
    links: [
      { href: "/unit", label: "Unit Hub", roles: allRoles },
      { href: "/equipment", label: "Master Equipment", roles: officeRoles },
    ],
  },
  {
    key: "parts",
    label: "Parts",
    href: "/parts-desk",
    roles: managerRoles,
    links: [
      { href: "/parts-desk", label: "Parts Desk", roles: managerRoles },
      { href: "/inventory", label: "Inventory", exact: true, roles: managerRoles },
      { href: "/pm-kits", label: "PM Kits", roles: managerRoles },
      { href: "/inventory-controls", label: "Inventory Controls", roles: managerRoles },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    href: "/reports",
    roles: officeRoles,
    links: [
      { href: "/reports", label: "Fleet Summary", exact: true, roles: officeRoles },
      { href: "/reports/search", label: "Unit Cost / Search", exact: true, roles: officeRoles },
      { href: "/reports/breakdowns", label: "Breakdown Reports", exact: true, roles: officeRoles },
      { href: "/reports/history", label: "Repair History", roles: officeRoles },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    href: "/invoices?view=settings",
    roles: managerRoles,
    links: [
      { href: "/invoices?view=settings", label: "Customers & Rates", view: "settings", roles: managerRoles },
      { href: "/admin/users", label: "Users & Access", roles: adminRoles },
      { href: "/admin/gmail", label: "Breakdown Email", exact: true, roles: adminRoles },
      { href: "/admin/twilio", label: "Breakdown Texting", exact: true, roles: adminRoles },
      { href: "/admin/twilio/schedule", label: "Text Schedule", exact: true, roles: adminRoles },
      { href: "/admin/geotab-review/health", label: "Fleet / Geotab Health", exact: true, roles: adminRoles },
      { href: "/admin/geotab-review/assignments", label: "Device Assignments", exact: true, roles: adminRoles },
      { href: "/admin/geotab-review", label: "Identity & Mileage", exact: true, roles: adminRoles },
      { href: "/admin/geotab-review/connection", label: "Geotab Connection", exact: true, roles: adminRoles },
      { href: "/admin/equipment-merge", label: "Duplicate Units", roles: adminRoles },
      { href: "/admin/history-import", label: "History Import", roles: adminRoles },
    ],
  },
];

function defaultHrefForRole(group: SidebarGroup, role: Role) {
  if (group.key === "repairs") {
    if (role === "viewer") return "/work-orders";
    if (role === "mechanic") return "/shop";
  }
  if (group.key === "maintenance" && (role === "viewer" || role === "mechanic")) return "/annual-inspections";
  return group.href;
}

export function sidebarGroupsForRole(role: Role | null): SidebarGroup[] {
  if (!role) return [];
  return sidebarGroups
    .filter((group) => group.roles.includes(role))
    .map((group) => ({
      ...group,
      href: defaultHrefForRole(group, role),
      links: group.links.filter((link) => link.roles.includes(role)),
    }))
    .filter((group) => group.links.length > 0);
}

// Kept for compatibility with older callers/tests. The visible application shell now
// uses sidebarGroupsForRole. "Today" is intentionally not part of primary navigation.
export function primaryLinksForRole(role: Role | null): NavLink[] {
  return sidebarGroupsForRole(role).map((group) => ({
    href: group.href,
    label: group.label,
    activeFor: group.links.map((link) => link.href.split("?")[0]),
  }));
}

export const adminMoreLinks: NavLink[] = [
  { href: "/admin/users", label: "Users & Access" },
  { href: "/admin/history-import", label: "History Import" },
];
