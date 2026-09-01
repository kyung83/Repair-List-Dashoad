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

test('breakdown and system setup are directly discoverable from their sidebar groups', async () => {
  const config = await read('app/navigation-config.ts');
  assert.match(config, /href: "\/breakdowns"[^\n]*label: "Active Breakdowns"/);
  assert.match(config, /href: "\/reports\/breakdowns"[^\n]*label: "Breakdown Reports"/);
  assert.match(config, /href: "\/breakdowns\/setup"[^\n]*label: "Breakdown Setup"/);
  assert.match(config, /href: "\/admin\/gmail"[^\n]*label: "Breakdown Email"/);
  assert.match(config, /href: "\/admin\/twilio"[^\n]*label: "Breakdown Texting"/);
  assert.match(config, /href: "\/admin\/geotab-review\/connection"[^\n]*label: "Geotab Connection"/);
});

test('sidebar is collapsible and defaults narrow on Repair Board without changing Repair Board component', async () => {
  const [nav, css, layout] = await Promise.all([
    read('app/app-nav.tsx'),
    read('app/sidebar-shell.css'),
    read('app/layout.tsx'),
  ]);
  assert.match(nav, /pathname\.startsWith\("\/repair-board"\)/);
  assert.match(nav, /northern-sidebar-collapsed/);
  assert.match(nav, /className={`app-sidebar \$\{collapsed\?'collapsed':'expanded'\}`}/);
  assert.match(css, /app-sidebar\.collapsed\{width:68px\}/);
  assert.match(css, /body:has\(\.app-sidebar\.collapsed\) \.app-shell-content\{margin-left:68px\}/);
  assert.match(layout, /<div className="app-shell-content">\{children\}<\/div>/);
});
