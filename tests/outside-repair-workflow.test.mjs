import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration=readFileSync(new URL('../migrations/0120_outside_repair_workflow.sql',import.meta.url),'utf8');
const api=readFileSync(new URL('../app/api/outside-repairs/route.ts',import.meta.url),'utf8');
const invoice=readFileSync(new URL('../app/api/outside-repairs/invoice/route.ts',import.meta.url),'utf8');
const board=readFileSync(new URL('../app/api/repair-board/route.ts',import.meta.url),'utf8');
const boardPage=readFileSync(new URL('../app/repair-board/page.tsx',import.meta.url),'utf8');
const transfer=readFileSync(new URL('../app/repair-board/outside-vendor-transfer-panel.tsx',import.meta.url),'utf8');
const queue=readFileSync(new URL('../app/outside-work/live-outside-repairs.tsx',import.meta.url),'utf8');
const bridge=readFileSync(new URL('../app/outside-work/existing-repair-invoice-bridge.tsx',import.meta.url),'utf8');
const intake=readFileSync(new URL('../app/outside-work/intake-v3.tsx',import.meta.url),'utf8');

test('outside repair workflow keeps one repair id from board through invoice',()=>{
  assert.match(migration,/repair_id INTEGER NOT NULL UNIQUE/);
  assert.match(invoice,/INSERT INTO outside_work_documents[\s\S]*repair_id/);
  assert.match(invoice,/assignment\.equipment_id,id,assignment\.outside_vendor_id/);
  assert.match(invoice,/UPDATE repairs[\s\S]*status='Completed'/);
  assert.doesNotMatch(invoice,/INSERT INTO repairs/);
});

test('Repair Board handoff removes active outside vendor work from the shop board',()=>{
  assert.match(board,/function outsideRepair/);
  assert.match(board,/!outsideRepair\(repair\.status\)/);
  assert.match(api,/status='Outside - Waiting on Vendor'/);
  assert.match(api,/status='Outside - Waiting on Invoice'/);
  assert.match(boardPage,/OutsideVendorTransferPanel/);
  assert.match(transfer,/Move to Outside Repairs/);
});

test('outside queue follows waiting vendor to waiting invoice and can return to shop',()=>{
  assert.match(migration,/waiting_vendor/);
  assert.match(migration,/waiting_invoice/);
  assert.match(api,/action==='vendor-finished'/);
  assert.match(api,/action==='return-shop'/);
  assert.match(api,/previous_repair_status/);
  assert.match(api,/previous_technician_id/);
  assert.match(queue,/Vendor Says Fixed/);
  assert.match(queue,/Move Back to Shop/);
  assert.match(queue,/Upload Invoice/);
});

test('outside invoice screen routes selected live repair to existing-repair upload endpoint',()=>{
  assert.match(intake,/LiveOutsideRepairs/);
  assert.match(intake,/ExistingRepairInvoiceBridge/);
  assert.match(bridge,/body\.set\('repairId',requested\)/);
  assert.match(bridge,/\/api\/outside-repairs\/invoice/);
  assert.match(invoice,/outside_invoice_attached/);
});
