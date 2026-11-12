import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const prefs=read('lib/annual-lead-preferences.ts');
const schedule=read('lib/annual-schedules.ts');
const board=read('lib/maintenance-board.ts');
const ui=read('app/annual-schedules/page.tsx');
const api=read('app/api/annual-schedules/route.ts');
test('annual warning and Repair Board lead days are separately stored and validated',()=>{
 assert.match(prefs,/annual_warning_lead_days/);
 assert.match(prefs,/annual_repair_board_lead_days/);
 assert.match(prefs,/getAnnualLeadPreferences/);
 assert.match(prefs,/saveAnnualLeadPreferences/);
 assert.match(prefs,/number<0\|\|number>365/);
 assert.match(prefs,/DEFAULT_WARNING_DAYS=45/);
 assert.match(prefs,/DEFAULT_REPAIR_BOARD_DAYS=45/);
});
test('annual repair board uses saved lead days without changing inspection intervals',()=>{
 assert.match(board,/getAnnualLeadPreferences\(db\)/);
 assert.match(board,/annualRemaining <= annualPreferences\.repairBoardDays/);
 assert.doesNotMatch(board,/annualRemaining <= 45/);
 assert.match(schedule,/preferences,/);
 assert.match(api,/saveAnnualLeadPreferences/);
 assert.match(api,/user\.role !== 'manager' && user\.role !== 'admin'/);
 assert.doesNotMatch(prefs,/UPDATE equipment_annual_settings|UPDATE pm_status|UPDATE repairs/);
});
test('Annual Schedule Setup independently controls due warning and Repair Board timing',()=>{
 assert.match(ui,/Warn before due \(days\)/);
 assert.match(ui,/Show on Repair Board \(days\)/);
 assert.match(ui,/dueDetails\(item,data\?\.preferences\?\.warningDays\?\?45\)/);
 assert.match(ui,/days <= warningDays/);
 assert.match(ui,/saveAnnualLeadPreferences/);
});
