import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readPage = () => readFile(new URL('../app/reports/page.tsx', import.meta.url), 'utf8');

test('main reporting tables scroll independently with sticky headings', async () => {
  const page = await readPage();
  assert.match(page, /function TableWrap/);
  assert.match(page, /maxHeight = 420/);
  assert.match(page, /maxHeight, overflow: "auto"/);
  assert.match(page, /position: "sticky", top: 0/);
  assert.match(page, /role="region"/);
  assert.equal((page.match(/<TableWrap(?: maxHeight=\{560\})?>/g) || []).length, 8);
});

test('all eight reporting tables expose sortable headings and data rows', async () => {
  const page = await readPage();
  for (const name of ['units', 'yearly', 'repairs', 'parts', 'issues', 'technicians', 'maintenance', 'expenses']) {
    assert.ok(page.includes('sortHeads("' + name + '"'), name + ' should have sortable headings');
    assert.ok(page.includes('"' + name + '").map(') || page.includes('"' + name + '").slice('), name + ' should sort its rows');
  }
  assert.match(page, /aria-sort=/);
  assert.match(page, /setSortConfig/);
  assert.match(page, /prior\?\.key === key && prior\.direction === "asc" \? "desc" : "asc"/);
  assert.match(page, /typeof left === "number" && typeof right === "number"/);
  assert.match(page, /localeCompare\(String\(right\).*numeric: true/);
});

test('sorts complete loaded data before per-table display caps and preserves CSV display order', async () => {
  const page = await readPage();
  assert.match(page, /sortRows\(visibleParts, "parts"\)\.slice\(0, 100\)/);
  assert.match(page, /sortRows\(data\.issueAnalysis, "issues"\)\.slice\(0, 75\)/);
  assert.match(page, /sortRows\(visibleMaintenance, "maintenance"\)\.slice\(0, 150\)/);
  for (const name of ['units', 'repairs', 'parts', 'maintenance', 'expenses']) {
    const count = page.split('"' + name + '").map(').length - 1
      + page.split('"' + name + '").slice(').length - 1;
    assert.ok(count >= 2, name + ' should use the same sorted rows for display and CSV');
  }
});
