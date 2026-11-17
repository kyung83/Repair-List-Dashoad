import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const work=read("app/shop/current-work-home.tsx");
const repairType=read("app/shop/current-repair-type-control.tsx");
const tire=read("app/shop/found-repair-control.tsx");
const shopPage=read("app/shop/page-v2.tsx");
const closeRoute=read("app/api/shop/route.ts");

test("Logan alone has Repair Type directly after the Notes tool",()=>{
  const notes=work.slice(work.indexOf('id="pilot-panel-notes"'),work.indexOf('id="pilot-panel-parts"'));
  assert.ok(notes.includes('<TechnicianRepairTools repairId={repair.id} canWork mode="notes" compact/>'));
  assert.ok(notes.includes('<CurrentRepairTypeControl repairId={repair.id}/>'));
  assert.ok(notes.indexOf('<TechnicianRepairTools')<notes.indexOf('<CurrentRepairTypeControl'));
  assert.match(work,/\{pilot\?<>{repair\.technicianId===technicianId/);
  assert.match(work,/!pilot&&maintenanceBlock/);
  assert.match(work,/\{repairMine&&<CurrentRepairTypeControl repairId=\{repair\.id\}\/>\}/);
});

test("Helpers are a separate collapsed action near the repair, not bundled with Repair Type",()=>{
  const helper=work.slice(work.indexOf('id="pilot-helper-panel"'),work.indexOf('</details>',work.indexOf('id="pilot-helper-panel"')));
  assert.match(helper,/ADD \/ MANAGE HELPER/);
  assert.match(helper,/<RepairTeamPanel/);
  assert.doesNotMatch(helper,/CurrentRepairTypeControl/);
  assert.doesNotMatch(helper,/defaultOpen|open=\{true\}/);
  assert.ok(work.indexOf('id="pilot-helper-panel"')<work.indexOf('id={pilot?"pilot-actions"'));
});

test("REPAIRED blockers are shown by the action and navigate to the missing step",()=>{
  assert.match(work,/id="pilot-close-guidance"/);
  assert.match(work,/role="alert"/);
  assert.match(work,/Cannot mark repaired yet:/);
  assert.match(work,/data-shop-action="repaired"/);
  assert.match(work,/data-shop-action="done-working"/);
  assert.match(work,/shop-repair-close-blocked/);
  assert.match(work,/setPilotTool\(info\.reason==="repair-type"\?"notes":"checklist"\)/);
  assert.match(work,/shop-tire-position-required/);
  assert.match(shopPage,/shop-repair-close-blocked/);
  assert.match(shopPage,/body\.action==="repairOutcome"&&body\.outcome==="repaired"/);
});

test("Tire and Repair Type clicks detect REPAIRED even when its check icon precedes the text",()=>{
  assert.match(tire,/target\.matches\('\[data-shop-action="repaired"\]'\)/);
  assert.match(repairType,/target\.matches\('\[data-shop-action="repaired"\]'\)/);
  assert.match(repairType,/data-shop-action="done-working"/);
  assert.match(tire,/shop-repair-close-updated/);
  assert.match(repairType,/shop-repair-close-updated/);
  assert.match(tire,/Tire position requirement complete; other required checks still apply/);
});

test("Server-side checklist and helper safety checks remain in place",()=>{
  assert.match(closeRoute,/await requireReadyMaintenanceChecklist\(env\.DB,repairId\)/);
  assert.match(closeRoute,/await validateRepairTypeChecklistBeforeClose\(env\.DB,repairId\)/);
  assert.match(closeRoute,/Another technician is still working on this repair/);
});
