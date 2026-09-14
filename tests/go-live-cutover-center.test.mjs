import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync(new URL('../lib/go-live-cutover.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/admin/go-live-cutover/route.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/admin/go-live-cutover/page.tsx', import.meta.url), 'utf8');
const nav = readFileSync(new URL('../app/navigation-config.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0136_go_live_cutover_center.sql', import.meta.url), 'utf8');

test('cutover center is a dry-run only and exposes no destructive API action', () => {
  assert.match(service, /mode:'dry-run'/);
  assert.match(service, /destructiveActionsEnabled:false/);
  assert.doesNotMatch(service, /DELETE FROM|DROP TABLE|UPDATE equipment/i);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function DELETE/);
  assert.match(page, /DRY RUN ONLY/);
  assert.match(page, /NOTHING ON THIS SCREEN CAN DELETE DATA/);
});

test('cutover preview explicitly separates sandbox repair rows from live breakdowns', () => {
  assert.match(service, /roadside-breakdown/);
  assert.match(service, /id NOT IN \(SELECT repair_id FROM roadside_breakdowns\)/);
  assert.match(service, /activeBreakdowns/);
  assert.match(page, /Protected — must survive cutover/);
  assert.match(page, /Breakdown Repairs/);
});

test('cutover preview includes history, inventory, DVIR and OOS readiness', () => {
  assert.match(service, /historical_repairs/);
  assert.match(service, /part_warehouse_stock/);
  assert.match(service, /inventory_operations/);
  assert.match(service, /dvir_defects/);
  assert.match(service, /out_of_service/);
  assert.match(page, /EMDECS work-history readiness/);
  assert.match(page, /final EMDECS inventory snapshot/);
  assert.match(page, /DVIR cutover/);
});

test('cutover settings and audit table are reserved for the eventual one-time launch action', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS go_live_cutover_runs/);
  assert.match(migration, /dvir_go_live_cutoff_at/);
  assert.match(migration, /shop_go_live_completed_at/);
});

test('only admins get the Go-Live Cutover setup link', () => {
  assert.match(nav, /\/admin\/go-live-cutover/);
  assert.match(nav, /Go-Live Cutover/);
  assert.match(route, /user\.role !== 'admin'/);
});
