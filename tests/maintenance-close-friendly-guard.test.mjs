import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('PM and annual work orders require a ready checklist before closing',()=>{
 const guard=read('lib/maintenance-close-guard.ts');
 assert.match(guard,/scheduled-pm/);
 assert.match(guard,/scheduled-annual/);
 assert.match(guard,/checklist\?\.status==='ready'/);
 assert.match(guard,/Labor has not been stopped/);
});

test('technician completion validates maintenance before the labor-stop path',()=>{
 const shop=read('app/api/shop/route.ts');
 const guardIndex=shop.indexOf('await requireReadyMaintenanceChecklist(env.DB,repairId)');
 const legacy=shop.indexOf('const response = await legacyPOST(request)',guardIndex);
 assert.ok(guardIndex>0&&legacy>guardIndex,'maintenance must be validated before legacyPOST stops a timer');
});

test('Repair Board manager status flow validates the same invariant',()=>{
 const board=read('app/api/repair-board/original.ts');
 assert.match(board,/if \(status === 'Completed'\) await requireReadyMaintenanceChecklist\(env.DB,id\)/);
});
