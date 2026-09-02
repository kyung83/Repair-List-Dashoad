import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

async function read(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('working users get one-tap phone navigation without losing Repair Board access',async()=>{
  const[dock,layout,css]=await Promise.all([
    read('app/technician-mobile-dock.tsx'),
    read('app/layout.tsx'),
    read('app/technician-mobile-dock.css'),
  ]);
  assert.match(layout,/TechnicianMobileDock/);
  assert.match(layout,/technician-mobile-dock\.css/);
  assert.match(dock,/href="\/repair-board"/);
  assert.match(dock,/href="\/shop"/);
  assert.match(dock,/href="\/unit"/);
  assert.match(dock,/technicianId/);
  assert.match(dock,/WORKING NOW/);
  assert.match(dock,/tech-active-work-ribbon/);
  assert.match(dock,/activeTimer/);
  assert.match(css,/body\.technician-mobile-enabled \.app-sidebar\{display:none!important\}/);
  assert.match(css,/body\.technician-mobile-enabled \.app-shell-content\{margin-left:0!important/);
  assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
});

test('PM and annual inspection stays on existing workflow but gains guided phone and tablet controls',async()=>{
  const[panel,question,shopLayout,css]=await Promise.all([
    read('app/shop/maintenance-checklist-panel-v2.tsx'),
    read('app/shop/inspection-question.tsx'),
    read('app/shop/layout.tsx'),
    read('app/shop/tech-workflow.css'),
  ]);
  assert.match(shopLayout,/tech-shop-shell/);
  assert.match(shopLayout,/tech-workflow\.css/);
  assert.match(panel,/TECHNICIAN INSPECTION/);
  assert.match(panel,/tech-maintenance-tabs/);
  assert.match(panel,/tech-section-strip/);
  assert.match(panel,/>Inspection /);
  assert.match(panel,/>Repairs /);
  assert.match(panel,/>Future /);
  assert.match(panel,/>Finish /);
  assert.match(panel,/InspectionRepairSummary/);
  assert.match(panel,/MaintenanceFinalActions/);
  assert.match(panel,/InspectionFinal/);
  assert.match(panel,/\/api\/maintenance-checklist/);
  assert.match(panel,/\/api\/maintenance-subrepairs/);
  assert.match(panel,/PM\/Annual labor keeps running/);
  assert.match(question,/PASS/);
  assert.match(question,/FAIL/);
  assert.match(question,/N\/A/);
  assert.match(question,/capture="environment"/);
  assert.match(css,/\.tech-shop-shell \.easy-result-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important/);
  assert.match(css,/\.tech-shop-shell \.easy-check-nav\{position:sticky;bottom:82px/);
});
