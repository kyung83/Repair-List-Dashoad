import { sendGmailRuntimeEmail } from './gmail-client';

export const MAINTENANCE_SHIFT_TIME_ZONE = 'America/Detroit';
export const MAINTENANCE_SHIFT_SUMMARY_RECIPIENT = 'Maintenance@norloworld.com';
export const MAINTENANCE_SHIFT_SUMMARY_DELAY_MINUTES = 30;

const CLOSEOUT_MS = MAINTENANCE_SHIFT_SUMMARY_DELAY_MINUTES * 60_000;
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

type PersonActivity = {
  user:ShiftUser;
  labor:{repairId:number;unit:string;title:string;hours:number;notes:string}[];
  events:{repairId:number;unit:string;title:string;action:string;detail:string;createdAt:string}[];
  parts:{repairId:number;unit:string;partNumber:string;description:string;quantity:number}[];
  activeTimer:{repairId:number;unit:string;title:string;startedAt:string}|null;
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
      AND e.action IN ('completed','waiting_on_part','shift_handoff','found_repair','repair_created','self_assigned','unmatched_part_requested')
    ORDER BY e.created_at,e.id
  ` : `
    SELECT e.repair_id,COALESCE(eq.unit,'') AS unit,COALESCE(r.title,'Repair') AS title,
           e.action,COALESCE(e.detail,'') AS detail,e.created_at
    FROM repair_job_events e
    JOIN repairs r ON r.id=e.repair_id
    LEFT JOIN equipment eq ON eq.id=r.equipment_id
    WHERE e.user_id=? AND e.created_at>=? AND e.created_at<=?
      AND e.action IN ('completed','waiting_on_part','shift_handoff','found_repair','repair_created','self_assigned','unmatched_part_requested')
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

  return {
    user,labor,events,parts,
    activeTimer:timer?{repairId:Number(timer.repair_id),unit:timer.unit,title:timer.title,startedAt:timer.started_at}:null,
  };
}

function uniqueJobs(activity:PersonActivity) {
  const jobs = new Map<number,{unit:string;title:string;notes:Set<string>}>();
  for (const row of activity.labor) {
    const current = jobs.get(row.repairId) ?? {unit:row.unit,title:row.title,notes:new Set<string>()};
    if (row.notes.trim()) current.notes.add(row.notes.trim());
    jobs.set(row.repairId,current);
  }
  for (const event of activity.events) {
    if (!jobs.has(event.repairId)) jobs.set(event.repairId,{unit:event.unit,title:event.title,notes:new Set<string>()});
  }
  return [...jobs.entries()].map(([repairId,value])=>({repairId,...value,notes:[...value.notes]}));
}

function actionLabel(action:string) {
  return ({
    completed:'Completed',waiting_on_part:'Waiting on Part',shift_handoff:'Shift Handoff',found_repair:'Found Repair',
    repair_created:'Repair Added',self_assigned:'Picked Up Work',unmatched_part_requested:'Part Requested',
  } as Record<string,string>)[action] ?? action;
}

function renderSummary(shift:ShiftRow,workDate:string,start:Date,end:Date,due:Date,activities:PersonActivity[]) {
  const totalLabor = activities.reduce((sum,item)=>sum+item.labor.reduce((subtotal,row)=>subtotal+row.hours,0),0);
  const totalCompleted = activities.reduce((sum,item)=>sum+item.events.filter((event)=>event.action==='completed').length,0);
  const totalParts = activities.reduce((sum,item)=>sum+item.parts.reduce((subtotal,row)=>subtotal+row.quantity,0),0);
  const titleDate = dateDisplayFormatter.format(start);
  const subject = `Maintenance Shift Summary — ${shift.name} — ${titleDate}`;
  const range = `${displayFormatter.format(start)} – ${displayFormatter.format(end)}`;

  const htmlPeople = activities.map((activity)=>{
    const laborTotal = activity.labor.reduce((sum,row)=>sum+row.hours,0);
    const jobs = uniqueJobs(activity);
    const hasActivity = laborTotal>0 || jobs.length>0 || activity.events.length>0 || activity.parts.length>0 || Boolean(activity.activeTimer);
    const jobList = jobs.length ? `<ul>${jobs.map((job)=>`<li><strong>${htmlEscape(job.unit||'No unit')} — ${htmlEscape(job.title)}</strong>${job.notes.length?`<br><span style="color:#5f6f7f">${job.notes.map(htmlEscape).join(' · ')}</span>`:''}</li>`).join('')}</ul>` : '';
    const eventList = activity.events.length ? `<ul>${activity.events.map((event)=>`<li><strong>${htmlEscape(actionLabel(event.action))}</strong> — ${htmlEscape(event.unit||event.title)}${event.detail?`: ${htmlEscape(event.detail)}`:''}</li>`).join('')}</ul>` : '';
    const partList = activity.parts.length ? `<ul>${activity.parts.map((part)=>`<li>${htmlEscape(part.partNumber)} — ${htmlEscape(part.description)} × ${htmlEscape(part.quantity)}${part.unit?` on ${htmlEscape(part.unit)}`:''}</li>`).join('')}</ul>` : '';
    const timer = activity.activeTimer ? `<p style="margin:8px 0;padding:9px 11px;background:#fff3cd;border-radius:7px"><strong>Still clocked in:</strong> ${htmlEscape(activity.activeTimer.unit||activity.activeTimer.title)} since ${htmlEscape(displayFormatter.format(new Date(parseDbDate(activity.activeTimer.startedAt))))}</p>` : '';
    return `<section style="border-top:1px solid #dfe5ea;padding:16px 0">
      <h3 style="margin:0 0 8px;color:#17324d">${htmlEscape(activity.user.display_name)} <span style="font-size:13px;color:#6c7886">(${roleLabel(activity.user.role)})</span></h3>
      <p style="margin:4px 0"><strong>Saved labor:</strong> ${hours(laborTotal)} hr</p>
      ${timer}
      ${!hasActivity?'<p style="color:#6c7886">No recorded repair activity during this shift.</p>':''}
      ${jobList?`<p style="margin-bottom:4px"><strong>Repairs / units worked:</strong></p>${jobList}`:''}
      ${eventList?`<p style="margin-bottom:4px"><strong>Key outcomes:</strong></p>${eventList}`:''}
      ${partList?`<p style="margin-bottom:4px"><strong>Parts used:</strong></p>${partList}`:''}
    </section>`;
  }).join('');

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1b2733;line-height:1.45">
    <div style="max-width:760px;margin:0 auto;padding:22px">
      <p style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#f47b20;margin:0">NORTHERN LOGISTICS MAINTENANCE</p>
      <h1 style="margin:7px 0 4px;color:#0d1b2b">${htmlEscape(shift.name)} Shift Summary</h1>
      <p style="margin:0;color:#607080">${htmlEscape(range)} · Detroit time</p>
      <p style="margin:4px 0 18px;color:#607080">Sent 30 minutes after shift end to capture closeout, parts requests, and handoffs.</p>
      <div style="display:flex;gap:18px;flex-wrap:wrap;background:#f4f7f9;border-radius:9px;padding:12px 14px">
        <span><strong>${activities.length}</strong> techs/managers</span><span><strong>${hours(totalLabor)}</strong> labor hr</span><span><strong>${totalCompleted}</strong> repairs completed</span><span><strong>${hours(totalParts)}</strong> parts qty used</span>
      </div>
      ${htmlPeople || '<p>No active technicians or managers were assigned to this shift.</p>'}
      <p style="font-size:12px;color:#7a8794;border-top:1px solid #dfe5ea;padding-top:12px">Work date ${htmlEscape(workDate)}. Summary window ends ${htmlEscape(displayFormatter.format(due))} and includes the 30-minute closeout period.</p>
    </div></body></html>`;

  const textPeople = activities.map((activity)=>{
    const laborTotal = activity.labor.reduce((sum,row)=>sum+row.hours,0);
    const jobs = uniqueJobs(activity);
    const lines = [`${activity.user.display_name} (${roleLabel(activity.user.role)})`,`Saved labor: ${hours(laborTotal)} hr`];
    if (activity.activeTimer) lines.push(`STILL CLOCKED IN: ${activity.activeTimer.unit||activity.activeTimer.title}`);
    if (jobs.length) lines.push(`Repairs / units: ${jobs.map((job)=>`${job.unit||'No unit'} - ${job.title}`).join('; ')}`);
    if (activity.events.length) lines.push(`Key outcomes: ${activity.events.map((event)=>`${actionLabel(event.action)} - ${event.unit||event.title}${event.detail?` (${event.detail})`:''}`).join('; ')}`);
    if (activity.parts.length) lines.push(`Parts used: ${activity.parts.map((part)=>`${part.partNumber} x${part.quantity}${part.unit?` on ${part.unit}`:''}`).join('; ')}`);
    if (lines.length===2 && laborTotal===0) lines.push('No recorded repair activity during this shift.');
    return lines.join('\n');
  }).join('\n\n');
  const text = `NORTHERN LOGISTICS MAINTENANCE\n${shift.name} Shift Summary\n${range} · Detroit time\n\n${activities.length} techs/managers · ${hours(totalLabor)} labor hr · ${totalCompleted} repairs completed · ${hours(totalParts)} parts qty used\n\n${textPeople}\n\nSent 30 minutes after shift end. Work date ${workDate}.`;
  return { subject,html,text };
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
    }
  }
  return { checkedAt:now.toISOString(),timeZone:MAINTENANCE_SHIFT_TIME_ZONE,recipient:MAINTENANCE_SHIFT_SUMMARY_RECIPIENT,results };
}
