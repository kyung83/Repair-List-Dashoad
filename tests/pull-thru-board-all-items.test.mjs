import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
test('raw PM, annual and DVIR Pull Thru is authorized and materialized',()=>{
 const api=read('app/api/repair-board/route.ts');
 assert.match(api,/String\(body\.action \?\? ''\) === 'setPullThru'/);
 assert.match(api,/createMaintenanceRepair/);
 assert.match(api,/createDvirRepair/);
 assert.match(api,/action:'setPullThru',repairId:creation\.repairId,pullThru:true/);
 assert.match(api,/await managerUser\(request\.clone\(\)\)/);
});
test('both board layouts display Pull Thru on raw DVIR, PM and annual rows',()=>{
 for (const path of ['app/repair-board/planning-center.tsx','app/repair-board/dashboard-v2.tsx']) {
  const ui=read(path);
  const d=ui.indexOf("source==='dvir'")>=0?ui.lastIndexOf("if(row.source==='dvir')return"):ui.indexOf('if(r.source==="dvir"&&data?.canManage)return');
  const m=ui.indexOf("if(raw(row.source))return")>=0?ui.indexOf("if(raw(row.source))return"):ui.indexOf('if(raw(r.source)&&data?.canManage)return');
  assert.ok(d>=0&&m>=0);
  assert.match(ui.slice(d,d+550),/setPullThru/);
  assert.match(ui.slice(m,m+550),/setPullThru/);
 }
});
