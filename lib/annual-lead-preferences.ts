/**
 * Annual compliance lead times are presentation/scheduling preferences only.
 * The legally due date is always last completed annual date + stored inspection interval.
 * An automatic Repair Board item is a due queue entry, not a newly created repair.
 */
export type AnnualLeadPreferences = {warningDays:number;repairBoardDays:number};
const DEFAULT_WARNING_DAYS=45;
const DEFAULT_REPAIR_BOARD_DAYS=45;
function preferenceDays(value:unknown,label:string){
 const number=Number(value);
 if(!Number.isSafeInteger(number)||number<0||number>365)throw new Error(`${label} must be a whole number from 0 to 365 days.`);
 return number;
}
export async function getAnnualLeadPreferences(db:D1Database):Promise<AnnualLeadPreferences>{
 const rows=await db.prepare(`SELECT key,value FROM app_settings WHERE key IN ('annual_warning_lead_days','annual_repair_board_lead_days')`).all<{key:string;value:string}>();
 const map=new Map(rows.results.map(row=>[row.key,row.value]));
 function read(key:string,fallback:number){
  const raw=map.get(key);
  if(raw===undefined)return fallback;
  const number=Number(raw);
  return Number.isSafeInteger(number)&&number>=0&&number<=365?number:fallback;
 }
 return {warningDays:read('annual_warning_lead_days',DEFAULT_WARNING_DAYS),
   repairBoardDays:read('annual_repair_board_lead_days',DEFAULT_REPAIR_BOARD_DAYS)};
}
export async function saveAnnualLeadPreferences(db:D1Database,input:Record<string,unknown>){
 const warningDays=preferenceDays(input.warningDays,'Annual warning lead time');
 const repairBoardDays=preferenceDays(input.repairBoardDays,'Repair Board lead time');
 await db.batch([
  db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES('annual_warning_lead_days',?,CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(String(warningDays)),
  db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES('annual_repair_board_lead_days',?,CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(String(repairBoardDays)),
 ]);
 return {ok:true,warningDays,repairBoardDays};
}
