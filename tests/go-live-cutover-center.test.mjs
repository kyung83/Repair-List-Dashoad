import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync(new URL('../lib/go-live-cutover.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/admin/go-live-cutover/route.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/admin/go-live-cutover/page.tsx', import.meta.url), 'utf8');
const nav = readFileSync(new URL('../app/navigation-config.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0136_go_live_cutover_center.sql', import.meta.url), 'utf8');
const protectionMigration = readFileSync(new URL('../migrations/0164_go_live_cutover_protection_audit.sql', import.meta.url), 'utf8');
const archiveMigration = readFileSync(new URL('../migrations/0165_cutover_archive_inventory_linked_repairs.sql', import.meta.url), 'utf8');
const workOrders = readFileSync(new URL('../lib/work-orders.ts', import.meta.url), 'utf8');
const reports = readFileSync(new URL('../lib/reports.ts', import.meta.url), 'utf8');
const reportSearch = readFileSync(new URL('../lib/report-search.ts', import.meta.url), 'utf8');
const unitHistory = readFileSync(new URL('../app/api/shop/unit-history/route.ts', import.meta.url), 'utf8');
const productivity = readFileSync(new URL('../lib/technician-productivity-sql.js', import.meta.url), 'utf8');
const geotab = readFileSync(new URL('../lib/geotab.ts', import.meta.url), 'utf8');

test('cutover center exposes an admin-only, typed-confirmation one-time action', () => {
  assert.match(service, /mode:'armed'/);
  assert.match(service, /destructiveActionsEnabled:true/);
  assert.match(service, /confirmationPhrase:'GO LIVE'/);
  assert.match(service, /executeGoLiveCutover/);
  assert.match(service, /Type GO LIVE exactly/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /user\.role !== 'admin'/);
  assert.match(page, /CUTOVER ARMED — ADMIN ONLY/);
  assert.match(page, /RUN GO-LIVE CUTOVER/);
  assert.match(page, /FINAL WARNING/);
});

test('cutover hard-protects live breakdowns and active equipment', () => {
  assert.match(service, /roadside-breakdown/);
  assert.match(service, /id NOT IN \(SELECT repair_id FROM roadside_breakdowns\)/);
  assert.match(service, /breakdownRows/);
  assert.match(service, /breakdownRepairRows/);
  assert.match(service, /activeEquipment/);
  assert.match(service, /totalEquipment/);
  assert.match(service, /NOT EXISTS \([\s\S]*roadside_breakdowns b[\s\S]*b\.stage < 5/);
  assert.match(page, /Breakdowns protected/);
  assert.match(page, /Active equipment protected/);
  assert.match(page, /no equipment is deleted/);
});

test('cutover archives inventory-linked sandbox repairs instead of deleting or unlinking them', () => {
  assert.match(service, /protectionSnapshot/);
  assert.match(service, /inventoryLinkSummary/);
  assert.match(service, /INVENTORY_AUDIT_LINK_WHERE/);
  assert.match(service, /inventory_operation_lines/);
  assert.match(service, /part_lifecycle_events/);
  assert.match(service, /part_core_obligations/);
  assert.match(service, /recovered_used_tires/);
  assert.match(service, /repairsToArchive:inventoryLinks\.linkedRepairs/);
  assert.match(service, /source='cutover-archive'/);
  assert.match(service, /go_live_archived_at=\?/);
  assert.match(service, /AND NOT \$\{INVENTORY_AUDIT_LINK_WHERE\}/);
  assert.match(service, /protectionMismatch/);
  assert.match(page, /Inventory protected/);
  assert.match(page, /SAFE ARCHIVE/);
  assert.doesNotMatch(page, /CUTOVER BLOCKED/);
});

test('cutover writes a one-time audit and DVIR cutoff is consumed by Geotab sync', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS go_live_cutover_runs/);
  assert.match(migration, /dvir_go_live_cutoff_at/);
  assert.match(migration, /shop_go_live_completed_at/);
  assert.match(protectionMigration, /inventory_quantity_before/);
  assert.match(protectionMigration, /breakdown_rows_before/);
  assert.match(protectionMigration, /active_equipment_before/);
  assert.match(archiveMigration, /go_live_archived_at/);
  assert.match(archiveMigration, /sandbox_repairs_archived/);
  assert.match(service, /INSERT INTO go_live_cutover_runs/);
  assert.match(service, /shop_go_live_completed_at/);
  assert.match(geotab, /dvir_go_live_cutoff_at/);
  assert.match(geotab, /cutoffValid.*normalFromDate/);
});

test('only admins get the Go-Live Cutover setup link', () => {
  assert.match(nav, /\/admin\/go-live-cutover/);
  assert.match(nav, /Go-Live Cutover/);
  assert.match(route, /user\.role !== 'admin'/);
});


test('cutover archives are hidden from normal production work and reporting surfaces', () => {
  assert.match(workOrders, /cutover-archive/);
  assert.match(reports, /cutover-archive/);
  assert.match(reportSearch, /cutover-archive/);
  assert.match(unitHistory, /cutover-archive/);
  assert.match(productivity, /cutover-archive/);
});
