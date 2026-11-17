import { sendGmailRuntimeEmail } from './gmail-client';

export const MAINTENANCE_SHIFT_TIME_ZONE = 'America/Detroit';
export const MAINTENANCE_SHIFT_SUMMARY_RECIPIENT = 'Maintenance@norloworld.com';
export const MAINTENANCE_SHIFT_SUMMARY_DELAY_MINUTES = 30;
export const MAINTENANCE_SHIFT_LATE_ADDENDUM_MINUTES = 120;

const CLOSEOUT_MS = MAINTENANCE_SHIFT_SUMMARY_DELAY_MINUTES * 60_000;
const LATE_ADDENDUM_MS = MAINTENANCE_SHIFT_LATE_ADDENDUM_MINUTES * 60_000;
const RETRY_LOCK_MS = 20 * 60_000;
const MAX_CATCHUP_MS = 36 * 60 * 60_000;

const zonedFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone:MAINTENANCE_SHIFT_TIME_ZONE,
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',
  hourCycle:'h23',
});
const displayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone:MAINTENANCE_SHIFT_TIME_ZONE,
  month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',
});
const dateDisplayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone:MAINTENANCE_SHIFT_TIME_ZONE,
  weekday:'short',month:'short',day:'numeric',year:'numeric',
});

type ShiftRow = {
  id:number;
  name:string;
  start_time:string;
  end_time:string;
  days_of_week:string;
  created_at:string;
};
type ShiftUser = {
  id:number;
  display_name:string;
  role:'mechanic'|'manager';
  technician_id:number|null;
};
type LocalDate = { year:number;month:number;day:number };

type OutstandingPart = { description:string;partNumber:string;requested:number;remaining:number;warehouse:string;source:'catalog'|'unmatched' };
type UnfinishedJob = { repairId:number;unit:string;title:string;status:string;notes:string[];pendingParts:OutstandingPart[] };

type PersonActivity = {
  user:ShiftUser;
  labor:{repairId:number;unit:string;title:string;hours:number;notes:string}[];
  events:{repairId:number;unit:string;title:string;action:string;detail:string;createdAt:string}[];
  parts:{repairId:number;unit:string;partNumber:string;description:string;quantity:number}[];
  activeTimer:{repairId:number;unit:string;title:string;startedAt:string}|null;
  unfinishedJobs:UnfinishedJob[];
};

function parseDbDate(value: string | null | undefined) {
  if (!value) return 0;
  const text = value.includes('T') ? value : `${value.replace(' ','T')}Z`;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : 0;
}

function dbTime(date: Date) {
  return date.toISOString().slice(0,19).replace('T',' ');
}

function localParts(date: Date) {
  const values:Record<string,number> = {};
  for (const part of zonedFormatter.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year:values.year,month:values.month,day:values.day,
    hour:values.hour,minute:values.minute,second:values.second,
  };
}

function localDate(date: Date):LocalDate {
  const parts = localParts(date);
  return { year:parts.year,month:parts.month,day:parts.day };
}

function addLocalDays(value: LocalDate, amount: number):LocalDate {
  const date = new Date(Date.UTC(value.year,value.month-1,value.day+amount,12));
  return { year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate() };
}

function localDayOfWeek(value: LocalDate) {
  return new Date(Date.UTC(value.year,value.month-1,value.day,12)).getUTCDay();
}

function dateKey(value: LocalDate) {
  return `${value.year}-${String(value.month).padStart(2,'0')}-${String(value.day).padStart(2,'0')}`;
}

function timeParts(value:string) {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid shift time: ${value}`);
  return { hour:Number(match[1]),minute:Number(match[2]) };
}

function localDateTimeToUtc(value:LocalDate,time:string) {
  const clock = timeParts(time);
  const target = Date.UTC(value.year,value.month-1,value.day,clock.hour,clock.minute,0);
  let guess = target;
  for (let index=0;index<4;index+=1) {
    const parts = localParts(new Date(guess));
    const represented = Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second || 0);
    const delta = represented-target;
    if (Math.abs(delta)<1000) break;
    guess -= delta;
  }
  return new Date(guess);
}

export function maintenanceShiftWindow(shift:{startTime:string;endTime:string},workDate:LocalDate) {
  const startClock = timeParts(shift.startTime);
  const endClock = timeParts(shift.endTime);
  const startMinutes = startClock.hour*60+startClock.minute;
  const endMinutes = endClock.hour*60+endClock.minute;
  const endDate = endMinutes <= startMinutes ? addLocalDays(workDate,1) : workDate;
  const start = localDateTimeToUtc(workDate,shift.startTime);
  const end = localDateTimeToUtc(endDate,shift.endTime);
  const due = new Date(end.getTime()+CLOSEOUT_MS);
  return { start,end,due,workDate:dateKey(workDate) };
}

function htmlEscape(value:unknown) {
  return String(value ?? '').replace(/[&<>"']/g,(character)=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[character] || character));
}

function roleLabel(role:string) { return role === 'manager' ? 'Manager' : 'Technician'; }
function hours(value:number) { return `${Math.round(value*100)/100}`; }

async function assignedUsers(db:D1Database,shiftId:number) {
  const rows = await db.prepare(`
    SELECT u.id,u.display_name,u.role,u.technician_id
    FROM maintenance_shift_assignments a
    JOIN app_users u ON u.id=a.user_id
    WHERE a.shift_id=? AND u.active=1 AND COALESCE(u.dispatch_access,0)=0
      AND u.role IN ('mechanic','manager')
    ORDER BY u.display_name COLLATE NOCASE,u.id
  `).bind(shiftId).all<ShiftUser>();
  return rows.results;
}

async function personActivity(db:D1Database,user:ShiftUser,start:Date,end:Date):Promise<PersonActivity> {
  const startDb = dbTime(start);
  const endDb = dbTime(end);
  let labor:{repairId:number;unit:string;title:string;hours:number;notes:string}[]=[];
  if (user.technician_id) {
    const rows = await db.prepare(`
      SELECT l.repair_id,COALESCE(eq.unit,'') AS unit,COALESCE(r.title,'Repair') AS title,
             l.hours,COALESCE(l.notes,'') AS notes
      FROM repair_labor_entries l
      JOIN repairs r ON r.id=l.repair_id
      LEFT JOIN equipment eq ON eq.id=r.equipment_id
      WHERE l.technician_id=?
        AND COALESCE(l.started_at,l.created_at) <= ?
        AND COALESCE(l.ended_at,l.created_at) >= ?
      ORDER BY COALESCE(l.started_at,l.created_at),l.id
    `).bind(user.technician_id,endDb,startDb).all<{repair_id:number;unit:string;title:string;hours:number;notes:string}>();
    labor = rows.results.map((row)=>({repairId:Number(row.repair_id),unit:row.unit,title:row.title,hours:Number(row.hours||0),notes:row.notes}));
  }

  const eventSql = user.technician_id ? `
    SELECT e.repair_id,COALESCE(eq.unit,'') AS unit,COALESCE(r.title,'Repair') AS title,
           e.action,COALESCE(e.detail,'') AS detail,e.created_at
    FROM repair_job_events e
    JOIN repairs r ON r.id=e.repair_id
    LEFT JOIN equipment eq ON eq.id=r.equipment_id
    WHERE (e.user_id=? OR e.technician_id=?) AND e.created_at>=? AND e.created_at<=?
      AND e.action IN ('completed','waiting_on_part','shift_handoff','found_repair','repair_created','self_assigned','unmatched_part_requested','part_requested_awaiting','technician_note','unit_session_ended','labor_stopped')
    ORDER BY e.created_at,e.id
  ` : `
    SELECT e.repair_id,COALESCE(eq.unit,'') AS unit,COALESCE(r.title,'Repair') AS title,
           e.action,COALESCE(e.detail,'') AS detail,e.created_at
    FROM repair_job_events e
    JOIN repairs r ON r.id=e.repair_id
    LEFT JOIN equipment eq ON eq.id=r.equipment_id
    WHERE e.user_id=? AND e.created_at>=? AND e.created_at<=?
      AND e.action IN ('completed','waiting_on_part','shift_handoff','found_repair','repair_created','self_assigned','unmatched_part_requested','part_requested_awaiting')
    ORDER BY e.created_at,e.id
  `;
  const eventStmt = user.technician_id
    ? db.prepare(eventSql).bind(user.id,user.technician_id,startDb,endDb)
    : db.prepare(eventSql).bind(user.id,startDb,endDb);
  const eventRows = await eventStmt.all<{repair_id:number;unit:string;title:string;action:string;detail:string;created_at:string}>();
  const events = eventRows.results.map((row)=>({repairId:Number(row.repair_id),unit:row.unit,title:row.title,action:row.action,detail:row.detail,createdAt:row.created_at}));

  const partRows = await db.prepare(`
    SELECT o.repair_id,COALESCE(eq.unit,'') AS unit,p.part_number,p.description,
           ABS(l.quantity_delta) AS quantity
    FROM inventory_operations o
    JOIN inventory_operation_lines l ON l.operation_id=o.id
    JOIN parts p ON p.id=l.part_id
    LEFT JOIN repairs r ON r.id=o.repair_id
    LEFT JOIN equipment eq ON eq.id=r.equipment_id
    WHERE o.user_id=? AND o.status='applied' AND l.line_type='part_issue'
      AND o.created_at>=? AND o.created_at<=?
    ORDER BY o.created_at,o.id,l.id
  `).bind(user.id,startDb,endDb).all<{repair_id:number|null;unit:string;part_number:string;description:string;quantity:number}>();
  const parts = partRows.results.map((row)=>({repairId:Number(row.repair_id||0),unit:row.unit,partNumber:row.part_number,description:row.description,quantity:Number(row.quantity||0)}));

  const timer = await db.prepare(`
    SELECT rt.repair_id,COALESCE(eq.unit,'') AS unit,COALESCE(r.title,'Repair') AS title,rt.started_at
    FROM repair_labor_timers rt
    JOIN repairs r ON r.id=rt.repair_id
    LEFT JOIN equipment eq ON eq.id=r.equipment_id
    WHERE rt.user_id=?
  `).bind(user.id).first<{repair_id:number;unit:string;title:string;started_at:string}>();

  const activity:PersonActivity={
    user,labor,events,parts,
    activeTimer:timer&&parseDbDate(timer.started_at)<=end.getTime()?{repairId:Number(timer.repair_id),unit:timer.unit,title:timer.title,startedAt:timer.started_at}:null,
    unfinishedJobs:[],
  };
  activity.unfinishedJobs=await unfinishedJobsForActivity(db,activity);
  return activity;
}


/**
 * Unfinished repairs are determined by their current state at the shift closeout,
 * but only for jobs with this person's recorded activity inside the shift.
 * Outstanding requests include both catalog parts and not-yet-matched requests.
 * Existing part usage is not represented as demand.
 */
async function unfinishedJobsForActivity(db:D1Database,activity:PersonActivity):Promise<UnfinishedJob[]> {
  const jobIds=[...new Set([
    ...activity.labor.map(row=>row.repairId),
    ...activity.events.map(row=>row.repairId),
    ...activity.parts.map(row=>row.repairId),
    ...(activity.activeTimer?[activity.activeTimer.repairId]:[]),
  ].filter(id=>Number.isSafeInteger(id)&&id>0))];
  if(!jobIds.length)return[];
  const placeholders=jobIds.map(()=>'?').join(',');
  const rows=await db.prepare(`
    SELECT r.id,COALESCE(eq.unit,'') AS unit,COALESCE(r.title,'Repair') AS title,
           COALESCE(r.status,'Open') AS status
    FROM repairs r LEFT JOIN equipment eq ON eq.id=r.equipment_id
    WHERE r.id IN (${placeholders})
      AND lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
      AND lower(trim(COALESCE(r.status,''))) NOT IN ('repaired','closed')
      AND COALESCE(r.source,'') <> 'cutover-archive'
    ORDER BY eq.unit,r.id
  `).bind(...jobIds).all<{id:number;unit:string;title:string;status:string}>();
  if(!rows.results.length)return[];
  const pending=rows.results.map(row=>Number(row.id));
  const waitingPlaceholders=pending.map(()=>'?').join(',');
  const catalog=await db.prepare(`
    SELECT q.repair_id,p.part_number,p.description,w.name AS warehouse,
           q.requested_quantity,q.used_quantity
    FROM repair_part_requests q
    JOIN parts p ON p.id=q.part_id
    JOIN warehouses w ON w.id=q.warehouse_id
    WHERE q.repair_id IN (${waitingPlaceholders}) AND q.status='open'
      AND q.requested_quantity>q.used_quantity
    ORDER BY q.repair_id,p.part_number,q.id
  `).bind(...pending).all<{repair_id:number;part_number:string;description:string;warehouse:string;requested_quantity:number;used_quantity:number}>();
  const unmatched=await db.prepare(`
    SELECT q.repair_id,q.requested_text,q.requested_quantity,COALESCE(q.warehouse_code,'') AS warehouse_code
    FROM unmatched_part_requests q
    WHERE q.repair_id IN (${waitingPlaceholders}) AND q.status='open'
    ORDER BY q.repair_id,q.id
  `).bind(...pending).all<{repair_id:number;requested_text:string;requested_quantity:number;warehouse_code:string}>();
  const partsByRepair=new Map<number,OutstandingPart[]>();
  const addPart=(repairId:number,part:OutstandingPart)=>{
    const list=partsByRepair.get(repairId)??[];
    list.push(part);partsByRepair.set(repairId,list);
  };
  for(const row of catalog.results){
    const requested=Number(row.requested_quantity||0);
    const remaining=Math.max(0,requested-Number(row.used_quantity||0));
    if(remaining>0)addPart(Number(row.repair_id),{
      partNumber:row.part_number,description:row.description,requested,remaining,warehouse:row.warehouse,source:'catalog',
    });
  }
  for(const row of unmatched.results){
    const remaining=Number(row.requested_quantity||0);
    if(remaining>0)addPart(Number(row.repair_id),{
      partNumber:'Not matched',description:row.requested_text,requested:remaining,remaining,
      warehouse:row.warehouse_code||'Warehouse not assigned',source:'unmatched',
    });
  }
  return rows.results.map(row=>{
    const id=Number(row.id);
    const notes=new Set<string>();
    for(const labor of activity.labor)if(labor.repairId===id&&labor.notes.trim())notes.add(labor.notes.trim());
    for(const event of activity.events)if(event.repairId===id&&
      ['technician_note','shift_handoff','waiting_on_part','unmatched_part_requested'].includes(event.action)&&event.detail.trim()
    )notes.add(event.detail.trim());
    return {repairId:id,unit:row.unit,title:row.title,status:row.status,
      notes:[...notes],pendingParts:partsByRepair.get(id)??[]};
  });
}


type SummaryJob = {
  repairId:number;unit:string;title:string;labor:number;notes:Set<string>;
  completed:boolean;worked:boolean;reported:boolean;status:string;
  partsUsed:{partNumber:string;description:string;quantity:number}[];
  pendingParts:OutstandingPart[];
};

function shortRepairTitle(title:string) {
  if (title.startsWith('MILEAGE STALE')) return 'PM status — mileage not verified';
  return title;
}

function technicianJobs(activity:PersonActivity):SummaryJob[] {
  const jobs=new Map<number,SummaryJob>();
  const get=(id:number,unit:string,title:string)=>{
    const found=jobs.get(id);
    if(found)return found;
    const job:SummaryJob={repairId:id,unit:unit||'No unit',title:shortRepairTitle(title),
      labor:0,notes:new Set(),completed:false,worked:false,reported:false,status:'',
      partsUsed:[],pendingParts:[]};
    jobs.set(id,job);return job;
  };
  for(const labor of activity.labor){
    const job=get(labor.repairId,labor.unit,labor.title);
    job.labor+=labor.hours;job.worked=true;
    if(labor.notes.trim())job.notes.add(labor.notes.trim());
  }
  for(const event of activity.events){
    const job=get(event.repairId,event.unit,event.title);
    if(event.action==='completed'){job.completed=true;job.worked=true;}
    if(['waiting_on_part','shift_handoff','found_repair'].includes(event.action))job.worked=true;
    if(['repair_created','self_assigned'].includes(event.action))job.reported=true;
    if(['technician_note','shift_handoff'].includes(event.action)&&event.detail.trim())
      job.notes.add(event.detail.trim());
  }
  for(const part of activity.parts){
    const job=get(part.repairId,part.unit,part.description);
    job.partsUsed.push({partNumber:part.partNumber,description:part.description,quantity:part.quantity});
    job.worked=true;
  }
  for(const unfinished of activity.unfinishedJobs){
    const job=get(unfinished.repairId,unfinished.unit,unfinished.title);
    job.status=unfinished.status;
    job.pendingParts=unfinished.pendingParts;
    for(const note of unfinished.notes)if(note.trim())job.notes.add(note.trim());
  }
  if(activity.activeTimer){
    const timer=activity.activeTimer;
    get(timer.repairId,timer.unit,timer.title).worked=true;
  }
  return [...jobs.values()].filter(job=>job.worked||job.reported||job.notes.size>0)
    .sort((a,b)=>a.unit.localeCompare(b.unit,undefined,{numeric:true})||a.repairId-b.repairId);
}

function reportJobState(job:SummaryJob) {
  if(job.status)return 'Unfinished';
  if(job.completed)return 'Completed';
  if(job.worked)return 'Worked — status not confirmed';
  return 'Repair reported / assigned';
}

function renderSummary(shift:ShiftRow,workDate:string,start:Date,end:Date,due:Date,activities:PersonActivity[],lateAddendum=false) {
  const prepared=activities.map(activity=>{
    const jobs=technicianJobs(activity);
    const labor=activity.labor.reduce((sum,row)=>sum+row.hours,0);
    const completed=jobs.filter(job=>job.completed&&!job.status);
    const unfinished=jobs.filter(job=>Boolean(job.status));
    const worked=jobs.filter(job=>job.worked);
    const reported=jobs.filter(job=>!job.worked&&job.reported);
    return {activity,jobs,labor,completed,unfinished,worked,reported};
  });
  const totalLabor=prepared.reduce((sum,person)=>sum+person.labor,0);
  const completedIds=new Set(prepared.flatMap(person=>person.completed.map(job=>job.repairId)));
  const unfinishedIds=new Set(prepared.flatMap(person=>person.unfinished.map(job=>job.repairId)));
  const workedIds=new Set(prepared.flatMap(person=>person.worked.map(job=>job.repairId)));
  const totalParts=activities.reduce((sum,person)=>sum+person.parts.reduce((n,part)=>n+part.quantity,0),0);
  // A shared repair counts once for the shift, while each technician keeps their own labor.
  const pendingByJob=new Map<string,{unit:string;techs:Set<string>;part:OutstandingPart;repairId:number}>();
  for(const person of prepared)for(const job of person.unfinished)for(const part of job.pendingParts){
    const key=`${job.repairId}:${part.source}:${part.partNumber}:${part.warehouse}:${part.description}`;
    const existing=pendingByJob.get(key);
    if(existing)existing.techs.add(person.activity.user.display_name);
    else pendingByJob.set(key,{unit:job.unit,repairId:job.repairId,techs:new Set([person.activity.user.display_name]),part});
  }
  const pending=[...pendingByJob.values()];
  const heading=lateAddendum?'Late Work Addendum':'Technician Performance Summary';
  const titleDate=dateDisplayFormatter.format(start);
  const subject=`Maintenance ${heading} — ${shift.name} — ${titleDate}`;
  const range=`${displayFormatter.format(start)} – ${displayFormatter.format(end)}`;
  const noActivity='No recorded repair activity in this reporting window.';
  const badge=(label:string)=>`<span style="display:inline-block;border-radius:6px;padding:3px 7px;font-size:11px;font-weight:700;background:#edf2f7;color:#34485e">${htmlEscape(label)}</span>`;
  const unitTitle=(unit:string,name:string)=>`${htmlEscape(unit)} <span style="color:#607080;font-weight:600">— ${htmlEscape(name)}</span>`;
  const detail=(job:SummaryJob,techName:string)=>{
    const state=reportJobState(job);
    const notes=[...job.notes];
    const partList=job.partsUsed.length?`<div style="font-size:12px;color:#526579;margin-top:3px"><strong>Parts used:</strong> ${job.partsUsed.map(part=>`${htmlEscape(part.partNumber)} × ${htmlEscape(hours(part.quantity))}`).join('; ')}</div>`:'';
    const waiting=job.pendingParts.length?`<div style="font-size:12px;color:#915b13;margin-top:4px"><strong>Waiting for:</strong> ${job.pendingParts.map(part=>`${htmlEscape(part.partNumber)} × ${htmlEscape(hours(part.remaining))} (${htmlEscape(part.warehouse)})`).join('; ')}</div>`:'';
    return `<div style="padding:9px 0;border-top:1px solid #edf0f2">
      <div style="font-size:13px"><strong>${unitTitle(job.unit,techName)}</strong> · ${htmlEscape(job.title)}</div>
      <div style="margin-top:3px;font-size:12px;color:#45566b">${badge(state)} · ${hours(job.labor)} saved labor hr</div>
      ${notes.length?`<div style="margin-top:5px;font-size:12px"><strong>Tech notes:</strong> ${notes.map(htmlEscape).join(' · ')}</div>`:''}
      ${partList}${waiting}
    </div>`;
  };
  const overviewRows=prepared.map(person=>`<tr>
    <td style="padding:9px 7px;border-bottom:1px solid #e8edf1;font-weight:700">${htmlEscape(person.activity.user.display_name)}</td>
    <td align="center" style="padding:9px 5px;border-bottom:1px solid #e8edf1">${person.completed.length}</td>
    <td align="center" style="padding:9px 5px;border-bottom:1px solid #e8edf1">${person.unfinished.length}</td>
    <td align="center" style="padding:9px 5px;border-bottom:1px solid #e8edf1">${person.worked.length}</td>
    <td align="right" style="padding:9px 7px;border-bottom:1px solid #e8edf1">${hours(person.labor)}</td>
  </tr>`).join('');
  const personHtml=prepared.map(person=>{
    const name=person.activity.user.display_name;
    const groups=[
      {label:'Completed work',items:person.completed},
      {label:'Worked — not finished',items:person.unfinished},
      {label:'Other work recorded',items:person.jobs.filter(job=>job.worked&&!job.completed&&!job.status)},
      {label:'New repairs reported (not yet worked)',items:person.reported},
    ];
    const sections=groups.filter(group=>group.items.length).map(group=>`
      <div style="margin-top:12px"><div style="font-weight:800;font-size:13px;color:#263a4f">${group.label} (${group.items.length})</div>
      ${group.items.map(job=>detail(job,name)).join('')}</div>`).join('');
    const timer=person.activity.activeTimer?`<p style="color:#895b15;font-size:12px">Timer still running on ${htmlEscape(person.activity.activeTimer.unit)} at the report cutoff.</p>`:'';
    return `<section style="border-top:2px solid #dfe7ee;padding:15px 0">
      <h3 style="margin:0 0 5px;color:#17324d">${htmlEscape(name)} <span style="font-size:12px;font-weight:400;color:#6c7886">(${roleLabel(person.activity.user.role)})</span></h3>
      <div style="font-size:12px;color:#536678">${person.completed.length} completed · ${person.unfinished.length} unfinished · ${person.worked.length} jobs worked · ${hours(person.labor)} saved labor hr</div>
      ${timer}${sections||`<p style="font-size:12px;color:#657489">${noActivity}</p>`}
    </section>`;
  }).join('');
  const handoffs=new Map<number,{job:SummaryJob;names:Set<string>}>();
  for(const person of prepared)for(const job of person.unfinished){
    const existing=handoffs.get(job.repairId);
    if(existing)existing.names.add(person.activity.user.display_name);
    else handoffs.set(job.repairId,{job,names:new Set([person.activity.user.display_name])});
  }
  const handoffHtml=[...handoffs.values()].map(item=>`<tr>
    <td style="padding:8px;border-bottom:1px solid #e5eaf0"><strong>${htmlEscape(item.job.unit)}</strong> — ${[...item.names].map(htmlEscape).join(', ')}</td>
    <td style="padding:8px;border-bottom:1px solid #e5eaf0">${htmlEscape(item.job.title)}</td>
    <td style="padding:8px;border-bottom:1px solid #e5eaf0">${htmlEscape(item.job.status)}</td>
  </tr>`).join('');
  const partsHtml=pending.map(item=>`<tr>
    <td style="padding:8px;border-bottom:1px solid #e5eaf0">${htmlEscape(item.unit)} — ${[...item.techs].map(htmlEscape).join(', ')}</td>
    <td style="padding:8px;border-bottom:1px solid #e5eaf0">${htmlEscape(item.part.partNumber)} · ${htmlEscape(item.part.description)}</td>
    <td style="padding:8px;border-bottom:1px solid #e5eaf0">${hours(item.part.remaining)} remaining · ${htmlEscape(item.part.warehouse)}</td>
  </tr>`).join('');
  const caption=lateAddendum
    ?'This is an additional activity window only; it does not repeat the original shift totals.'
    :'Reported 30 minutes after shift end; activity recorded later may appear in a separate late-work addendum.';
  const tableHead='style="padding:9px 7px;text-align:left;font-size:11px;background:#f2f5f8;color:#536678"';
  const html=`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1b2733;line-height:1.4">
    <div style="max-width:800px;margin:0 auto;padding:20px">
      <p style="font-size:11px;letter-spacing:.12em;color:#ee741b;font-weight:900">NORTHERN LOGISTICS MAINTENANCE</p>
      <h1 style="margin:5px 0;color:#0d1b2b;font-size:25px">${htmlEscape(shift.name)} — ${heading}</h1>
      <p style="font-size:12px;color:#607080">${htmlEscape(range)} · Detroit time</p>
      <p style="font-size:12px;color:#607080">${caption}</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f9;border-radius:8px;margin:16px 0"><tr>
        <td style="padding:12px 7px;text-align:center"><strong>${prepared.length}</strong><br><small>Techs/managers</small></td>
        <td style="padding:12px 7px;text-align:center"><strong>${completedIds.size}</strong><br><small>Jobs completed</small></td>
        <td style="padding:12px 7px;text-align:center"><strong>${workedIds.size}</strong><br><small>Jobs worked</small></td>
        <td style="padding:12px 7px;text-align:center"><strong>${unfinishedIds.size}</strong><br><small>Still open</small></td>
        <td style="padding:12px 7px;text-align:center"><strong>${hours(totalLabor)}</strong><br><small>Labor hr</small></td>
      </tr></table>
      <h2 style="font-size:17px;color:#17324d;margin:18px 0 8px">Technician performance at a glance</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px">
        <tr><th ${tableHead}>Technician</th><th ${tableHead}>Done</th><th ${tableHead}>Open</th><th ${tableHead}>Worked</th><th ${tableHead}>Labor hr</th></tr>
        ${overviewRows}
      </table>
      <h2 style="font-size:17px;color:#17324d;margin-top:22px">What each technician accomplished</h2>
      ${personHtml||`<p>There are no technicians assigned to this shift.</p>`}
      <h2 style="font-size:17px;color:#17324d;margin-top:22px">Next shift — unfinished work (${handoffs.size})</h2>
      ${handoffs.size?`<table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px"><tr><th ${tableHead}>Unit / technicians</th><th ${tableHead}>Repair</th><th ${tableHead}>Status</th></tr>${handoffHtml}</table>`:'<p style="font-size:12px;color:#5d6e7e">No unfinished work recorded by these technicians.</p>'}
      <h2 style="font-size:17px;color:#17324d;margin-top:22px">Outstanding requested parts (${pending.length})</h2>
      ${pending.length?`<table width="100%" cellpadding="0" cellspacing="0" style="font-size:12px"><tr><th ${tableHead}>Unit / technicians</th><th ${tableHead}>Part</th><th ${tableHead}>Needed</th></tr>${partsHtml}</table>`:'<p style="font-size:12px;color:#5d6e7e">No outstanding parts identified in this reporting window.</p>'}
      <p style="font-size:11px;color:#7a8794;border-top:1px solid #dfe5ea;padding-top:12px">${htmlEscape(workDate)} · Saved labor, not scheduled hours or productivity percentage. Total parts used: ${hours(totalParts)}. Per-tech job counts may overlap when multiple technicians work on one repair.</p>
    </div></body></html>`;

  const textPeople=prepared.map(person=>{
    const name=person.activity.user.display_name;
    const lines=[`${name} — ${person.completed.length} completed, ${person.unfinished.length} unfinished, ${person.worked.length} worked, ${hours(person.labor)} labor hr`];
    for(const job of person.jobs){
      lines.push(`  ${job.unit} — ${name}: ${job.title} [${reportJobState(job)}] · ${hours(job.labor)} hr`);
      if(job.notes.size)lines.push(`    Tech notes: ${[...job.notes].join(' | ')}`);
      for(const part of job.partsUsed)lines.push(`    Used: ${part.partNumber} x${hours(part.quantity)}`);
      for(const part of job.pendingParts)lines.push(`    Waiting: ${part.partNumber} x${hours(part.remaining)} from ${part.warehouse}`);
    }
    if(person.jobs.length===0)lines.push('  '+noActivity);
    return lines.join('\n');
  }).join('\n\n');
  const text=`NORTHERN LOGISTICS MAINTENANCE
${shift.name} — ${heading}
${range} · Detroit time
${caption}

${prepared.length} techs/managers | ${completedIds.size} completed | ${workedIds.size} jobs worked | ${unfinishedIds.size} unfinished | ${hours(totalLabor)} labor hr

TECHNICIAN RESULTS
${prepared.map(p=>`${p.activity.user.display_name}: ${p.completed.length} done, ${p.unfinished.length} open, ${p.worked.length} worked, ${hours(p.labor)} hr`).join('\n')}

WHAT EACH TECHNICIAN ACCOMPLISHED
${textPeople}

NEXT SHIFT — UNFINISHED
${[...handoffs.values()].map(x=>`${x.job.unit} — ${[...x.names].join(', ')}: ${x.job.title} [${x.job.status}]`).join('\n')||'None recorded'}

OUTSTANDING PART REQUESTS
${pending.map(x=>`${x.unit} — ${[...x.techs].join(', ')}: ${x.part.partNumber} x${hours(x.part.remaining)} (${x.part.warehouse})`).join('\n')||'None recorded'}

Work date ${workDate}. Shared repairs counted once in shift total. Labor is saved labor, not productivity %.`;
  return {subject,html,text};
}

async function reserveSummaryRun(db:D1Database,shift:ShiftRow,workDate:string,start:Date,end:Date,due:Date) {
  const existing = await db.prepare(`
    SELECT id,status,last_attempt_at FROM maintenance_shift_summary_runs
    WHERE shift_id=? AND shift_work_date=?
  `).bind(shift.id,workDate).first<{id:number;status:string;last_attempt_at:string|null}>();
  if (existing?.status === 'sent') return null;
  if (existing?.status === 'sending' && existing.last_attempt_at && Date.now()-parseDbDate(existing.last_attempt_at)<RETRY_LOCK_MS) return null;

  const result = await db.prepare(`
    INSERT INTO maintenance_shift_summary_runs
      (shift_id,shift_work_date,shift_started_at,shift_ended_at,scheduled_for,status,attempts,last_attempt_at,error)
    VALUES (?,?,?,?,?,'sending',1,CURRENT_TIMESTAMP,NULL)
    ON CONFLICT(shift_id,shift_work_date) DO UPDATE SET
      shift_started_at=excluded.shift_started_at,
      shift_ended_at=excluded.shift_ended_at,
      scheduled_for=excluded.scheduled_for,
      status='sending',
      attempts=maintenance_shift_summary_runs.attempts+1,
      last_attempt_at=CURRENT_TIMESTAMP,
      error=NULL,
      updated_at=CURRENT_TIMESTAMP
    WHERE maintenance_shift_summary_runs.status<>'sent'
  `).bind(shift.id,workDate,dbTime(start),dbTime(end),dbTime(due)).run();
  if (Number(result.meta.changes ?? 0) === 0) return null;
  const row = await db.prepare(`SELECT id FROM maintenance_shift_summary_runs WHERE shift_id=? AND shift_work_date=?`).bind(shift.id,workDate).first<{id:number}>();
  return row?Number(row.id):null;
}

async function sendShiftSummary(db:D1Database,shift:ShiftRow,workDate:string,start:Date,end:Date,due:Date) {
  const users = await assignedUsers(db,shift.id);
  if (!users.length) return { sent:false,reason:'no_assigned_technicians_or_managers' };
  const runId = await reserveSummaryRun(db,shift,workDate,start,end,due);
  if (!runId) return { sent:false,reason:'already_sent_or_locked' };
  try {
    const activities:PersonActivity[]=[];
    for (const user of users) activities.push(await personActivity(db,user,start,due));
    const message = renderSummary(shift,workDate,start,end,due,activities);
    const sent = await sendGmailRuntimeEmail({
      to:MAINTENANCE_SHIFT_SUMMARY_RECIPIENT,
      subject:message.subject,
      html:message.html,
      text:message.text,
    });
    await db.prepare(`
      UPDATE maintenance_shift_summary_runs
      SET status='sent',sent_at=CURRENT_TIMESTAMP,error=NULL,gmail_message_id=?,gmail_thread_id=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(sent.gmailMessageId||sent.messageId,sent.gmailThreadId||'',runId).run();
    return { sent:true,runId,users:users.length,workDate,shiftId:shift.id,shiftName:shift.name };
  } catch (error) {
    await db.prepare(`
      UPDATE maintenance_shift_summary_runs
      SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(String(error).slice(0,900),runId).run().catch(()=>undefined);
    throw error;
  }
}

/**
 * Preserve the on-time 30-minute email; send one separately labeled catch-up
 * only when extra activity appears between that email's cutoff and two hours later.
 * The independent ledger prevents duplicate sends on five-minute cron retries.
 */
async function sendLateShiftAddendum(db:D1Database,shift:ShiftRow,workDate:string,originalDue:Date,addendumDue:Date) {
  const original=await db.prepare(`
    SELECT status FROM maintenance_shift_summary_runs
    WHERE shift_id=? AND shift_work_date=?
  `).bind(shift.id,workDate).first<{status:string}>();
  if(original?.status!=='sent')return {sent:false,reason:'original_summary_not_sent'};

  const old=await db.prepare(`
    SELECT id,status,last_attempt_at FROM maintenance_shift_late_addendum_runs
    WHERE shift_id=? AND shift_work_date=?
  `).bind(shift.id,workDate).first<{id:number;status:string;last_attempt_at:string|null}>();
  if(old?.status==='sent'||old?.status==='skipped')return {sent:false,reason:'already_processed'};
  if(old?.status==='sending'&&old.last_attempt_at&&Date.now()-parseDbDate(old.last_attempt_at)<RETRY_LOCK_MS)
    return {sent:false,reason:'send_in_progress'};
  const reserved=await db.prepare(`
    INSERT INTO maintenance_shift_late_addendum_runs
      (shift_id,shift_work_date,range_started_at,range_ended_at,status,attempts,last_attempt_at)
    VALUES (?,?,?,?,'sending',1,CURRENT_TIMESTAMP)
    ON CONFLICT(shift_id,shift_work_date) DO UPDATE SET
      status='sending',attempts=maintenance_shift_late_addendum_runs.attempts+1,
      last_attempt_at=CURRENT_TIMESTAMP,error=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE maintenance_shift_late_addendum_runs.status NOT IN ('sent','skipped')
  `).bind(shift.id,workDate,dbTime(originalDue),dbTime(addendumDue)).run();
  if(Number(reserved.meta.changes??0)===0)return {sent:false,reason:'already_processed'};
  const run=await db.prepare(`
    SELECT id FROM maintenance_shift_late_addendum_runs WHERE shift_id=? AND shift_work_date=?
  `).bind(shift.id,workDate).first<{id:number}>();
  if(!run)throw new Error('Late summary ledger entry could not be found.');
  try {
    const users=await assignedUsers(db,shift.id);
    const activities:PersonActivity[]=[];
    for(const user of users)activities.push(await personActivity(db,user,originalDue,addendumDue));
    // An active timer alone from the original email is not new work unless it
    // actually began after that email's cutoff.
    const lateActivities=activities.filter(activity=>
      activity.labor.length>0||activity.events.length>0||activity.parts.length>0||
      Boolean(activity.activeTimer&&parseDbDate(activity.activeTimer.startedAt)>=originalDue.getTime()&&parseDbDate(activity.activeTimer.startedAt)<=addendumDue.getTime())
    );
    const hasLateWork=lateActivities.length>0;
    if(!hasLateWork){
      await db.prepare(`
        UPDATE maintenance_shift_late_addendum_runs SET status='skipped',updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).bind(run.id).run();
      return {sent:false,reason:'no_late_activity'};
    }
    const message=renderSummary(shift,workDate,originalDue,addendumDue,addendumDue,lateActivities,true);
    const sent=await sendGmailRuntimeEmail({
      to:MAINTENANCE_SHIFT_SUMMARY_RECIPIENT,
      subject:message.subject,html:message.html,text:message.text,
    });
    await db.prepare(`
      UPDATE maintenance_shift_late_addendum_runs
      SET status='sent',sent_at=CURRENT_TIMESTAMP,error=NULL,gmail_message_id=?,gmail_thread_id=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(sent.gmailMessageId||sent.messageId,sent.gmailThreadId||'',run.id).run();
    return {sent:true,addendum:true,runId:run.id,workDate,shiftId:shift.id};
  }catch(error){
    await db.prepare(`
      UPDATE maintenance_shift_late_addendum_runs SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).bind(String(error).slice(0,900),run.id).run().catch(()=>undefined);
    throw error;
  }
}

export async function processDueMaintenanceShiftSummaries(db:D1Database,scheduledTime:number|Date=Date.now()) {
  const now = scheduledTime instanceof Date ? scheduledTime : new Date(scheduledTime);
  const shifts = await db.prepare(`
    SELECT id,name,start_time,end_time,days_of_week,created_at
    FROM maintenance_shifts
    WHERE active=1
    ORDER BY id
  `).all<ShiftRow>();
  const today = localDate(now);
  const results:unknown[]=[];
  for (const shift of shifts.results) {
    const workdays = new Set(String(shift.days_of_week).split(',').map(Number));
    for (let offset=-2;offset<=0;offset+=1) {
      const candidate = addLocalDays(today,offset);
      if (!workdays.has(localDayOfWeek(candidate))) continue;
      const window = maintenanceShiftWindow({startTime:shift.start_time,endTime:shift.end_time},candidate);
      const dueMs = window.due.getTime();
      if (dueMs > now.getTime()) continue;
      if (now.getTime()-dueMs > MAX_CATCHUP_MS) continue;
      if (dueMs < parseDbDate(shift.created_at)) continue;
      try {
        results.push(await sendShiftSummary(db,shift,window.workDate,window.start,window.end,window.due));
      } catch (error) {
        console.error(JSON.stringify({ event:'maintenance_shift_summary_failed',shiftId:shift.id,shiftName:shift.name,workDate:window.workDate,error:String(error) }));
        results.push({ sent:false,shiftId:shift.id,workDate:window.workDate,error:String(error) });
      }
      const addendumDue=new Date(window.due.getTime()+LATE_ADDENDUM_MS);
      if(addendumDue.getTime()<=now.getTime()&&now.getTime()-addendumDue.getTime()<=MAX_CATCHUP_MS){
        try{
          results.push(await sendLateShiftAddendum(db,shift,window.workDate,window.due,addendumDue));
        }catch(error){
          console.error(JSON.stringify({event:'maintenance_shift_late_addendum_failed',shiftId:shift.id,workDate:window.workDate,error:String(error)}));
          results.push({sent:false,addendum:true,shiftId:shift.id,workDate:window.workDate,error:String(error)});
        }
      }
    }
  }
  return { checkedAt:now.toISOString(),timeZone:MAINTENANCE_SHIFT_TIME_ZONE,recipient:MAINTENANCE_SHIFT_SUMMARY_RECIPIENT,results };
}
