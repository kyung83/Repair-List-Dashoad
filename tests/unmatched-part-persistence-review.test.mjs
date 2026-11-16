import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('Parts Desk includes open unmatched requests even when a repair is completed',()=>{
 const source=read('lib/unmatched-parts.ts');
 const section=source.slice(source.indexOf('export async function getUnmatchedPartRequests'),source.indexOf('export async function handleUnmatchedPartRequest'));
 assert.match(section,/WHERE q\.status = 'open'/);
 assert.doesNotMatch(section,/NOT LIKE '%complete%'/);
 assert.match(section,/repairStatus:row\.repair_status/);
});

test('Parts Desk warns when an open request is attached to a completed repair',()=>{
 const ui=read('app/parts-desk/page.tsx');
 assert.match(ui,/request still OPEN/);
 assert.match(ui,/reopen the repair if parts must be attached/);
});

test('repair review returns both catalog and unmatched technician requests',()=>{
 const api=read('app/api/shop/repair-review/route.ts');
 assert.match(api,/FROM unmatched_part_requests q/);
 assert.match(api,/unmatchedRequests:unmatchedRequests\.results\.map/);
 const ui=read('app/shop/technician-repair-review.tsx');
 assert.match(ui,/PARTS REQUESTED FROM PARTS DESK/);
 assert.match(ui,/AWAITING PARTS DESK/);
});
