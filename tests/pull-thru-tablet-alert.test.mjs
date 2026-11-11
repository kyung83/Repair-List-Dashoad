import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=(path)=>readFile(new URL(path,root),'utf8');

test('Pull Thru has a persistent repair flag and technician alert queue',async()=>{
  const migration=await read('migrations/0162_pull_thru_repairs.sql');
  assert.match(migration,/ALTER TABLE repairs ADD COLUMN pull_thru/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS technician_alerts/);
  assert.match(migration,/acknowledged_at/);
  assert.match(migration,/idx_technician_alerts_pending/);
});

test('Repair Board can mark Pull Thru and queues tablet alerts on assignment',async()=>{
  const [api,board,planning,bulk]=await Promise.all([
    read('app/api/repair-board/original.ts'),
    read('app/repair-board/dashboard-v2.tsx'),
    read('app/repair-board/planning-center.tsx'),
    read('app/api/repair-board/bulk-assign/route.ts'),
  ]);
  assert.match(board,/setPullThru/);
  assert.match(board,/PULL THRU/);
  assert.match(board,/pullThruActive/);
  assert.match(planning,/setPullThru/);
  assert.match(planning,/pullThruButton/);
  assert.match(planning,/PULL THRU/);
  assert.match(planning,/row\.pullThru/);
  assert.match(api,/action === 'setPullThru'/);
  assert.match(api,/INSERT INTO technician_alerts/);
  assert.match(api,/pull_thru_alert_queued/);
  assert.match(api,/repair\.technician_id/);
  assert.match(api,/NOT EXISTS \([\s\S]*technician_alerts/);
  assert.match(bulk,/INSERT INTO technician_alerts/);
  assert.match(bulk,/pull_thru_alert_queued/);
});

test('Pull Thru alert is in-app tablet audio only, not SMS',async()=>{
  const [component,endpoint,layout]=await Promise.all([
    read('app/pull-thru-tablet-alert.tsx'),
    read('app/api/shop/pull-thru-alert/route.ts'),
    read('app/layout.tsx'),
  ]);
  assert.match(component,/createOscillator/);
  assert.match(component,/frequency\.setValueAtTime/);
  assert.match(component,/setInterval\(\(\)=>void load\(\),4000\)/);
  assert.match(component,/PULL THRU COMING/);
  assert.match(component,/GOT IT/);
  assert.match(endpoint,/technician_alerts/);
  assert.match(endpoint,/acknowledged_at IS NULL/);
  assert.match(endpoint,/acknowledged_at=CURRENT_TIMESTAMP/);
  assert.match(layout,/PullThruTabletAlert/);
  assert.doesNotMatch(component,/Twilio|SMS/i);
  assert.doesNotMatch(endpoint,/Twilio|SMS/i);
});

test('technician shop data and screens preserve Pull Thru visibility',async()=>{
  const [api,page,current]=await Promise.all([
    read('app/api/shop/original.ts'),
    read('app/shop/page-v2.tsx'),
    read('app/shop/current-work-home.tsx'),
  ]);
  assert.match(api,/COALESCE\(r\.pull_thru,0\) AS pull_thru/);
  assert.match(api,/pullThru: Boolean\(row\.pull_thru\)/);
  assert.match(page,/pullThru:boolean/);
  assert.match(page,/pullThruBadge/);
  assert.match(current,/pullThru:boolean/);
  assert.match(current,/This unit is coming through the shop/);
});
