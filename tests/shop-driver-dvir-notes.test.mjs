import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shop=load('app/api/shop/original.ts');
const page=load('app/shop/page-v2.tsx');
const work=load('app/shop/current-work-home.tsx');
test('Geotab category Other never hides the driver detailed DVIR writeup in My Work',()=>{
 assert.match(shop,/LEFT JOIN dvir_defects dvir ON dvir\.geotab_defect_id = r\.geotab_defect_id/);
 assert.match(shop,/NULLIF\(TRIM\(dvir\.comments\),''\)/);
 assert.match(shop,/NULLIF\(TRIM\(r\.description\),''\)/);
 assert.match(shop,/driverDvirNotes: row\.source === 'geotab-dvir' \? row\.driver_dvir_notes : ''/);
 assert.match(page,/driverDvirNotes\?:string/);
 assert.match(work,/data-shop-driver-dvir-notes/);
 assert.match(work,/DRIVER DVIR NOTES/);
 assert.match(work,/\{repair\.driverDvirNotes\}/);
 assert.match(work,/\{item\.driverDvirNotes\}/);
 assert.match(work,/Driver DVIR:/);
});
test('note panel preserves exact driver text, safe React rendering, and other repair workflows',()=>{
 assert.match(work,/whiteSpace:'pre-wrap'/);
 assert.match(work,/overflowWrap:'anywhere'/);
 assert.match(work,/CurrentRepairTypeControl/);
 assert.match(work,/onChooseRepair\(item\)/);
 assert.match(work,/data-shop-action="done-working"/);
});
