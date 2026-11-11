import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=(path)=>readFile(new URL(path,root),'utf8');

test('Geotab repair review has a durable manager queue',async()=>{
  const [migration,service,boardRoute]=await Promise.all([
    read('migrations/0163_geotab_repair_review.sql'),
    read('lib/geotab-repair-review.ts'),
    read('app/api/repair-board/route.ts'),
  ]);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS geotab_repair_review/);
  assert.match(migration,/status IN \('open','resolved','reopened'\)/);
  assert.match(migration,/repair_id INTEGER NOT NULL UNIQUE/);
  assert.match(service,/listOpenGeotabRepairReviews/);
  assert.match(service,/queueGeotabRepairReview/);
  assert.match(service,/retryGeotabRepairReview/);
  assert.match(service,/confirmGeotabAlreadyResolved/);
  assert.match(service,/reopenRepairFromGeotabReview/);
  assert.match(service,/local_repaired=1/);
  assert.match(service,/local_repaired=0/);
  assert.match(boardRoute,/payload\.geotabReview = geotabReview/);
  assert.match(boardRoute,/action.*retryGeotabRepair/s);
  assert.match(boardRoute,/action.*confirmGeotabResolved/s);
  assert.match(boardRoute,/action.*reopenGeotabRepair/s);
});

test('Planning Center exposes manager-only Geotab Review filter and actions',async()=>{
  const board=await read('app/repair-board/planning-center.tsx');
  assert.match(board,/type Attention=.*'geotab'/);
  assert.match(board,/label:'Geotab Review'/);
  assert.match(board,/value!=='geotab'\|\|Boolean\(data\?\.canManage\)/);
  assert.match(board,/GEOTAB REVIEW REQUIRED/);
  assert.match(board,/Retry Geotab/);
  assert.match(board,/Already Resolved/);
  assert.match(board,/Reopen Repair/);
  assert.match(board,/new URLSearchParams\(window\.location\.search\).*attention/s);
});

test('Today dashboard surfaces Geotab review in Needs attention',async()=>{
  const page=await read('app/page.tsx');
  assert.match(page,/Geotab review required/);
  assert.match(page,/GEOTAB REVIEW/);
  assert.match(page,/repair-board\?attention=geotab/);
  assert.match(page,/data\.geotabReview/);
});

test('completed work order history records Geotab reconciliation status',async()=>{
  const [workOrders,editor]=await Promise.all([
    read('lib/work-orders.ts'),
    read('app/work-orders/inline-review-editor.tsx'),
  ]);
  assert.match(workOrders,/geotabReviewStatusByRepair/);
  assert.match(workOrders,/geotabReviewStatus:/);
  assert.match(workOrders,/geotabResolutionType:/);
  assert.match(editor,/GEOTAB REVIEW REQUIRED/);
  assert.match(editor,/GEOTAB MANUALLY RECONCILED/);
  assert.match(editor,/GEOTAB RECONCILED/);
});
