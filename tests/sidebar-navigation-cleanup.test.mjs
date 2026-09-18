import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const nav=readFileSync(new URL('../app/navigation-config.ts',import.meta.url),'utf8');
const shell=readFileSync(new URL('../app/app-nav.tsx',import.meta.url),'utf8');
const setup=readFileSync(new URL('../app/setup-center/page.tsx',import.meta.url),'utf8');

test('billing is separated from repairs and keeps billing destinations together',()=>{
  const repairsStart=nav.indexOf('key: "repairs"');
  const breakdownStart=nav.indexOf('key: "breakdowns"');
  const repairsBlock=nav.slice(repairsStart,breakdownStart);
  assert.doesNotMatch(repairsBlock,/Ready to Bill/);
  assert.doesNotMatch(repairsBlock,/Customers & Rates/);
  assert.match(nav,/key: "billing"/);
  assert.match(nav,/href: "\/invoices\?view=ready", label: "Ready to Bill"/);
  assert.match(nav,/href: "\/invoices\?view=invoices", label: "Invoices"/);
  assert.match(nav,/href: "\/invoices\?view=settings", label: "Customers & Rates"/);
});

test('sidebar only allows one expanded group at a time',()=>{
  assert.match(shell,/return new Set\(\[active\.key\]\)/);
  assert.match(shell,/current\.has\(key\)\?new Set\(\):new Set\(\[key\]\)/);
});

test('sidebar hides detailed setup destinations while retaining them for active routing',()=>{
  assert.match(nav,/href: "\/setup-center", label: "Setup Home"/);
  assert.match(nav,/href: "\/pm-schedules", label: "PM Schedule Setup"/);
  assert.match(nav,/Repair Types".*showInSidebar: false/);
  assert.match(nav,/Custom PM Builder".*showInSidebar: false/);
  assert.match(nav,/PM & Annual Checklists".*showInSidebar: false/);
  assert.match(nav,/Go-Live Cutover".*showInSidebar: false/);
  assert.match(shell,/const visibleLinks=group\.links\.filter\(link=>link\.showInSidebar!==false\)/);
});

test('Setup Home groups every existing configuration area into a clean landing page',()=>{
  assert.match(setup,/Setup Home/);
  assert.match(setup,/Maintenance Setup/);
  assert.match(setup,/Parts Setup/);
  assert.match(setup,/Breakdown & Operations/);
  assert.match(setup,/Users & Fleet Connections/);
  assert.match(setup,/Billing Setup/);
  assert.match(setup,/Advanced Admin/);
  assert.match(setup,/href:"\/maintenance-programs"/);
  assert.match(setup,/href:"\/admin\/warehouses"/);
  assert.match(setup,/href:"\/admin\/geotab-review\/connection"/);
  assert.match(setup,/href:"\/admin\/go-live-cutover"/);
});
