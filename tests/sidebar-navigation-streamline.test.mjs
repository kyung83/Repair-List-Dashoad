import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('primary navigation is the streamlined seven-section sidebar with no Today tab', async () => {
  const config = await read('app/navigation-config.ts');
  for (const label of ['Repairs','Breakdowns','Maintenance','Units','Parts','Reports','Settings']) {
    assert.match(config, new RegExp(`label: "${label}"`));
  }
  assert.doesNotMatch(config, /label:\s*"Today"/);
  assert.match(config, /sidebarGroupsForRole/);
});

test('sidebar owns repair billing, breakdown and system destinations', async () => {
  const config = await read('app/navigation-config.ts');
  assert.match(config, /href: "\/invoices\?view=invoices"[^\n]*label: "Invoices"[^\n]*view: "invoices"/);
  assert.match(config, /href: "\/invoices\?view=ready"[^\n]*label: "Create Invoice"[^\n]*view: "ready"/);
  assert.match(config, /href: "\/invoices\?view=settings"[^\n]*label: "Customers & Rates"[^\n]*view: "settings"/);
  assert.match(config, /href: "\/breakdowns"[^\n]*label: "Active Breakdowns"/);
  assert.match(config, /href: "\/reports\/breakdowns"[^\n]*label: "Breakdown Reports"/);
  assert.match(config, /href: "\/breakdowns\/setup"[^\n]*label: "Breakdown Setup"/);
  assert.match(config, /href: "\/admin\/gmail"[^\n]*label: "Breakdown Email"/);
  assert.match(config, /href: "\/admin\/twilio"[^\n]*label: "Breakdown Texting"/);
  assert.match(config, /href: "\/admin\/geotab-review\/connection"[^\n]*label: "Geotab Connection"/);
});

test('sidebar is collapsible and defaults narrow on Repair Board without changing Repair Board dashboard', async () => {
  const [nav, css, layout] = await Promise.all([
    read('app/app-nav.tsx'),
    read('app/sidebar-shell.css'),
    read('app/layout.tsx'),
  ]);
  assert.match(nav, /pathname\.startsWith\("\/repair-board"\)/);
  assert.match(nav, /northern-sidebar-collapsed/);
  assert.match(nav, /className={`app-sidebar \$\{collapsed\?'collapsed':'expanded'\}`}/);
  assert.match(nav, /link\.view/);
  assert.match(css, /app-sidebar\.collapsed\{width:68px\}/);
  assert.match(css, /body:has\(\.app-sidebar\.collapsed\) \.app-shell-content\{margin-left:68px\}/);
  assert.match(layout, /<div className="app-shell-content">\{children\}<\/div>/);
});

test('legacy horizontal module tabs can no longer render anywhere in the app shell', async () => {
  const [moduleTabs, repairBoardPage, shopLayout, maintenanceTabs, diagnosticsTabs, reportHistoryLayout] = await Promise.all([
    read('app/module-tabs.tsx'),
    read('app/repair-board/page.tsx'),
    read('app/shop/layout.tsx'),
    read('app/maintenance-tabs.tsx'),
    read('app/admin/diagnostics-tabs.tsx'),
    read('app/reports/history/layout.tsx'),
  ]);
  assert.match(moduleTabs, /return null/);
  assert.doesNotMatch(moduleTabs, /api\/auth\/me/);
  assert.doesNotMatch(moduleTabs, /module-tabs-shell/);
  assert.doesNotMatch(repairBoardPage, /ModuleTabs|board-module-tabs/);
  assert.doesNotMatch(shopLayout, /ModuleTabs/);
  assert.match(maintenanceTabs, /return null/);
  assert.match(diagnosticsTabs, /return null/);
  assert.doesNotMatch(reportHistoryLayout, /ModuleTabs|reports-history-tabs/);
});
