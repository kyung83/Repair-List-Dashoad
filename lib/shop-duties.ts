
import { getShopLaborRate } from './billing';

const TIME_ZONE = 'America/Detroit';

export type ShopDutySessionUser = {
  id: number;
  role: string;
  technicianId: number | null;
  displayName?: string;
};

type DutyTemplateRow = {
  id: number;
  template_key: string;
  name: string;
  description: string;
  cadence: 'weekly' | 'monthly' | 'shift';
  assignment_mode: 'all_mechanics_rotation' | 'selected_rotation' | 'fixed' | 'shift_rotation';
  due_day: number | null;
  shift_id: number | null;
  active: number;
  source_label: string | null;
};

type EligibleUser = { id:number; display_name:string; technician_id:number };

function q(...parts:string[]) { return parts.join(' '); }
function integer(value:unknown, fallback=0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}
function cleanText(value:unknown, max:number) {
  return String(value ?? '').trim().slice(0, max);
}
function localDateParts(now:Date|number = Date.now()) {
  const date = now instanceof Date ? now : new Date(now);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit',
  }).formatToParts(date);
  const get = (type:string) => parts.find((part) => part.type === type)?.value ?? '';
  return { year:Number(get('year')), month:Number(get('month')), day:Number(get('day')) };
}
function dateString(now:Date|number = Date.now()) {
  const p = localDateParts(now);
  return String(p.year).padStart(4,'0') + '-' + String(p.month).padStart(2,'0') + '-' + String(p.day).padStart(2,'0');
}
function addDays(value:string, days:number) {
  const [year,month,day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0,10);
}
function weekdayFor(value:string) {
  const [year,month,day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
function mondayFor(value:string) {
  const weekday = weekdayFor(value);
  return addDays(value, weekday === 0 ? -6 : 1 - weekday);
}
function timestampMs(value:string) {
  const normalized = value.includes('T') ? value : value.replace(' ','T') + 'Z';
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) throw new Error('Labor timer start time is invalid.');
  return parsed;
}

async function getTemplates(db:D1Database, activeOnly=false) {
  const result = await db.prepare(q(
    'SELECT id,template_key,name,description,cadence,assignment_mode,due_day,shift_id,active,source_label',
    'FROM shop_duty_templates',
    activeOnly ? 'WHERE active=1' : '',
    "ORDER BY CASE template_key WHEN 'bathroom-weekly' THEN 0 WHEN 'monthly-facility' THEN 1 ELSE 2 END,id"
  )).all<DutyTemplateRow>();
  return result.results;
}

async function periodSpec(db:D1Database, template:DutyTemplateRow, now:Date|number = Date.now()) {
  const today = dateString(now);
  if (template.cadence === 'weekly') {
    const monday = mondayFor(today);
    const dueDay = template.due_day == null ? 5 : Math.max(0, Math.min(6, Number(template.due_day)));
    let offset = dueDay - 1;
    if (offset < 0) offset += 7;
    return { periodKey:'week:' + monday, dueDate:addDays(monday, offset) };
  }
  if (template.cadence === 'monthly') {
    const day = Math.max(1, Math.min(28, Number(template.due_day ?? 28)));
    const month = today.slice(0,7);
    return { periodKey:'month:' + month, dueDate:month + '-' + String(day).padStart(2,'0') };
  }
  if (!template.shift_id) return null;
  const shift = await db.prepare('SELECT id,days_of_week FROM maintenance_shifts WHERE id=? AND active=1')
    .bind(template.shift_id).first<{id:number;days_of_week:string}>();
  if (!shift) return null;
  const days = new Set(String(shift.days_of_week).split(',').map(Number).filter(Number.isInteger));
  if (!days.has(weekdayFor(today))) return null;
  return { periodKey:'shift:' + template.shift_id + ':' + today, dueDate:today };
}

async function eligibleUsers(db:D1Database, template:DutyTemplateRow):Promise<EligibleUser[]> {
  if (template.assignment_mode === 'all_mechanics_rotation') {
    const rows = await db.prepare(q(
      'SELECT id,display_name,technician_id FROM app_users',
      "WHERE active=1 AND role='mechanic' AND COALESCE(dispatch_access,0)=0 AND technician_id IS NOT NULL",
      'ORDER BY display_name COLLATE NOCASE,id'
    )).all<EligibleUser>();
    return rows.results;
  }
  if (template.assignment_mode === 'shift_rotation') {
    if (!template.shift_id) return [];
    const rows = await db.prepare(q(
      'SELECT u.id,u.display_name,u.technician_id',
      'FROM maintenance_shift_assignments a JOIN app_users u ON u.id=a.user_id',
      "WHERE a.shift_id=? AND u.active=1 AND COALESCE(u.dispatch_access,0)=0 AND u.technician_id IS NOT NULL",
      "AND u.role IN ('mechanic','manager','admin')",
      'ORDER BY u.display_name COLLATE NOCASE,u.id'
    )).bind(template.shift_id).all<EligibleUser>();
    return rows.results;
  }
  const rows = await db.prepare(q(
    'SELECT u.id,u.display_name,u.technician_id',
    'FROM shop_duty_template_users tu JOIN app_users u ON u.id=tu.user_id',
    "WHERE tu.template_id=? AND u.active=1 AND COALESCE(u.dispatch_access,0)=0 AND u.technician_id IS NOT NULL",
    "AND u.role IN ('mechanic','manager','admin')",
    'ORDER BY tu.rotation_order,u.display_name COLLATE NOCASE,u.id'
  )).bind(template.id).all<EligibleUser>();
  return rows.results;
}

async function ensureAssignment(db:D1Database, template:DutyTemplateRow, now:Date|number = Date.now()) {
  const spec = await periodSpec(db, template, now);
  if (!spec) return null;
  const existing = await db.prepare(q(
    'SELECT a.id,a.template_id,a.period_key,a.due_date,a.assigned_user_id,a.status,a.repair_id,',
    'u.display_name AS assigned_name',
    'FROM shop_duty_assignments a JOIN app_users u ON u.id=a.assigned_user_id',
    'WHERE a.template_id=? AND a.period_key=?'
  )).bind(template.id, spec.periodKey).first<{
    id:number;template_id:number;period_key:string;due_date:string;assigned_user_id:number;
    status:string;repair_id:number|null;assigned_name:string;
  }>();
  if (existing) return existing;

  // Monthly facility work is intentionally assigned by a manager each month.
  if (template.template_key === 'monthly-facility' && template.assignment_mode === 'fixed') return null;

  const pool = await eligibleUsers(db, template);
  if (!pool.length) return null;
  const prior = await db.prepare('SELECT COUNT(*) AS count FROM shop_duty_assignments WHERE template_id=?')
    .bind(template.id).first<{count:number}>();
  const index = template.assignment_mode === 'fixed' ? 0 : Number(prior?.count ?? 0) % pool.length;
  const assignee = pool[index] ?? pool[0];
  const result = await db.prepare(
    "INSERT INTO shop_duty_assignments(template_id,period_key,due_date,assigned_user_id,status) VALUES(?,?,?,?,'pending')"
  ).bind(template.id, spec.periodKey, spec.dueDate, assignee.id).run();
  return {
    id:Number(result.meta.last_row_id), template_id:template.id, period_key:spec.periodKey,
    due_date:spec.dueDate, assigned_user_id:assignee.id, status:'pending', repair_id:null,
    assigned_name:assignee.display_name,
  };
}

export async function ensureCurrentShopDutyAssignments(db:D1Database, now:Date|number = Date.now()) {
  const active = await getTemplates(db, true);
  const assignments = [];
  for (const template of active) {
    const assignment = await ensureAssignment(db, template, now);
    if (assignment) assignments.push({ ...assignment, templateKey:template.template_key, templateName:template.name });
  }
  return assignments;
}

async function assignmentDetails(db:D1Database, assignmentId:number) {
  const assignment = await db.prepare(q(
    'SELECT a.id,a.template_id,a.period_key,a.due_date,a.assigned_user_id,a.status,a.repair_id,',
    'a.supplies_needed,a.notes,a.started_at,a.completed_at,',
    't.template_key,t.name,t.description,t.cadence,t.assignment_mode',
    'FROM shop_duty_assignments a JOIN shop_duty_templates t ON t.id=a.template_id',
    'WHERE a.id=?'
  )).bind(assignmentId).first<{
    id:number;template_id:number;period_key:string;due_date:string;assigned_user_id:number;status:string;
    repair_id:number|null;supplies_needed:string;notes:string;started_at:string|null;completed_at:string|null;
    template_key:string;name:string;description:string;cadence:string;assignment_mode:string;
  }>();
  if (!assignment) return null;

  const items = await db.prepare(q(
    'SELECT i.id,i.section_name,i.item_text,i.sort_order,i.required,r.result,COALESCE(r.comment,\'\') AS comment',
    'FROM shop_duty_template_items i',
    'LEFT JOIN shop_duty_item_results r ON r.item_id=i.id AND r.assignment_id=?',
    'WHERE i.template_id=? AND i.active=1',
    'ORDER BY i.sort_order,i.id'
  )).bind(assignment.id, assignment.template_id).all<{
    id:number;section_name:string;item_text:string;sort_order:number;required:number;result:string|null;comment:string;
  }>();

  return {
    id:Number(assignment.id),
    templateId:Number(assignment.template_id),
    templateKey:assignment.template_key,
    name:assignment.name,
    description:assignment.description,
    cadence:assignment.cadence,
    assignmentMode:assignment.assignment_mode,
    periodKey:assignment.period_key,
    dueDate:assignment.due_date,
    assignedUserId:Number(assignment.assigned_user_id),
    status:assignment.status,
    repairId:assignment.repair_id ? 'repair-' + assignment.repair_id : null,
    suppliesNeeded:assignment.supplies_needed,
    notes:assignment.notes,
    startedAt:assignment.started_at,
    completedAt:assignment.completed_at,
    items:items.results.map((item) => ({
      id:Number(item.id), section:item.section_name, text:item.item_text, sortOrder:Number(item.sort_order),
      required:Boolean(item.required), result:item.result, comment:item.comment,
    })),
  };
}

export async function getCurrentShopDutiesForUser(db:D1Database, user:ShopDutySessionUser, now:Date|number = Date.now()) {
  await ensureCurrentShopDutyAssignments(db, now);
  const rows = await db.prepare(q(
    'SELECT id FROM shop_duty_assignments',
    "WHERE assigned_user_id=? AND status IN ('pending','in_progress')",
    'ORDER BY due_date,id'
  )).bind(user.id).all<{id:number}>();
  const duties = [];
  for (const row of rows.results) {
    const details = await assignmentDetails(db, Number(row.id));
    if (details) duties.push(details);
  }
  return duties;
}

export async function getActiveShopDutyForUser(db:D1Database, userId:number) {
  const row = await db.prepare(q(
    'SELECT a.id FROM shop_duty_assignments a',
    'JOIN repair_labor_timers rt ON rt.repair_id=a.repair_id AND rt.user_id=?',
    "WHERE a.assigned_user_id=? AND a.status='in_progress' AND a.repair_id IS NOT NULL",
    'ORDER BY a.started_at DESC,a.id DESC LIMIT 1'
  )).bind(userId,userId).first<{id:number}>();
  return row ? assignmentDetails(db, Number(row.id)) : null;
}

async function requireOwnedAssignment(db:D1Database, user:ShopDutySessionUser, assignmentId:unknown) {
  const id = integer(assignmentId);
  if (!id) throw new Error('Shop duty was not found.');
  const assignment = await assignmentDetails(db, id);
  if (!assignment) throw new Error('Shop duty was not found.');
  if (Number(assignment.assignedUserId) !== Number(user.id)) throw new Error('This shop duty is assigned to another mechanic.');
  return assignment;
}

async function requireTechnician(db:D1Database, user:ShopDutySessionUser) {
  if (!user.technicianId) throw new Error('Your account is not linked to an active technician.');
  const technician = await db.prepare('SELECT id,name FROM technicians WHERE id=? AND active=1')
    .bind(user.technicianId).first<{id:number;name:string}>();
  if (!technician) throw new Error('Your linked technician record is not active.');
  return technician;
}

async function activeTimer(db:D1Database, userId:number) {
  return db.prepare(q(
    'SELECT user_id,repair_id,technician_id,started_at,COALESCE(notes,\'\') AS notes',
    'FROM repair_labor_timers WHERE user_id=?'
  )).bind(userId).first<{user_id:number;repair_id:number;technician_id:number;started_at:string;notes:string}>();
}

async function startTimerForRepair(
  db:D1Database, user:ShopDutySessionUser, repairId:number, technician:{id:number;name:string}, detail:string
) {
  const running = await activeTimer(db, user.id);
  if (running) {
    if (Number(running.repair_id) === repairId) return;
    throw new Error('Finish or pause your current work before starting this shop duty.');
  }
  const inserted = await db.prepare(q(
    'INSERT INTO repair_labor_timers(user_id,repair_id,technician_id,notes)',
    'SELECT ?,id,?,? FROM repairs',
    "WHERE id=? AND lower(COALESCE(status,'')) NOT LIKE '%complete%'"
  )).bind(user.id, technician.id, detail.slice(0,500), repairId).run();
  if (Number(inserted.meta.changes ?? 0) === 0) throw new Error('Shop duty labor could not be started.');
  await db.batch([
    db.prepare("UPDATE repairs SET technician_id=?,driver=?,status='Assigned',updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(technician.id, technician.name, repairId),
    db.prepare(
      "INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail) VALUES(?,?,?,'shop_duty_labor_started',?)"
    ).bind(repairId, user.id, technician.id, detail.slice(0,500)),
  ]);
}

export async function startShopDuty(db:D1Database, user:ShopDutySessionUser, assignmentId:unknown) {
  const assignment = await requireOwnedAssignment(db, user, assignmentId);
  if (assignment.status === 'completed' || assignment.status === 'skipped') throw new Error('This shop duty is already closed.');
  const technician = await requireTechnician(db, user);

  if (assignment.status === 'in_progress' && assignment.repairId) {
    const repairId = integer(String(assignment.repairId).replace('repair-',''));
    await startTimerForRepair(db, user, repairId, technician, 'Resumed shop duty: ' + assignment.name);
    return { ok:true, assignmentId:assignment.id, repairId:'repair-' + repairId, resumed:true };
  }

  const running = await activeTimer(db, user.id);
  if (running) throw new Error('Finish or pause your current work before starting this shop duty.');

  const type = await db.prepare(
    "SELECT id,unit_rule,active FROM repair_types WHERE name='INDIRECT LABOR-OTHER' COLLATE NOCASE LIMIT 1"
  ).first<{id:number;unit_rule:string;active:number}>();
  if (!type || !type.active) throw new Error('INDIRECT LABOR-OTHER is not active in Repair Type Setup.');
  if (type.unit_rule !== 'optional') throw new Error('INDIRECT LABOR-OTHER must allow work without a unit.');

  const created = await db.prepare(q(
    'INSERT INTO repairs(equipment_id,title,description,status,priority,source,technician_id,repair_type_id,opened_at,updated_at)',
    "VALUES(NULL,?,?, 'Assigned','2','shop-duty',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
  )).bind('SHOP DUTY — ' + assignment.name, assignment.description || ('Shop duty: ' + assignment.name), technician.id, type.id).run();
  const repairId = Number(created.meta.last_row_id);
  if (!repairId) throw new Error('Shop duty work order could not be created.');

  await startTimerForRepair(db, user, repairId, technician, 'Shop duty: ' + assignment.name);
  await db.prepare(q(
    "UPDATE shop_duty_assignments SET status='in_progress',repair_id=?,",
    'started_at=COALESCE(started_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP',
    "WHERE id=? AND assigned_user_id=? AND status='pending'"
  )).bind(repairId, assignment.id, user.id).run();
  await db.prepare(
    "INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail) VALUES(?,?,?,'shop_duty_started',?)"
  ).bind(repairId, user.id, technician.id, (technician.name + ' started shop duty: ' + assignment.name).slice(0,500)).run();

  return { ok:true, assignmentId:assignment.id, repairId:'repair-' + repairId, started:true };
}

async function stopDutyLabor(
  db:D1Database, user:ShopDutySessionUser, assignment:{id:number;name:string;repairId:string|null}, action:string
) {
  if (!assignment.repairId) throw new Error('This shop duty does not have an active work order.');
  const repairId = integer(String(assignment.repairId).replace('repair-',''));
  const timer = await activeTimer(db, user.id);
  if (!timer || Number(timer.repair_id) !== repairId) throw new Error('Start or resume this shop duty before stopping it.');

  const elapsedHours = Math.max(0.01, Math.round(((Date.now() - timestampMs(timer.started_at)) / 3600000) * 100) / 100);
  const rate = await getShopLaborRate(db);
  const laborDate = new Date().toISOString().slice(0,10);
  const note = ('Shop duty: ' + assignment.name).slice(0,500);

  await db.batch([
    db.prepare(
      'INSERT INTO repair_labor_entries(repair_id,technician_id,labor_date,hours,rate,notes) VALUES(?,?,?,?,?,?)'
    ).bind(repairId, timer.technician_id, laborDate, elapsedHours, rate, note),
    db.prepare('DELETE FROM repair_labor_timers WHERE user_id=?').bind(user.id),
    db.prepare(q(
      'UPDATE repairs',
      'SET labor_hours=(SELECT COALESCE(SUM(hours),0) FROM repair_labor_entries WHERE repair_id=?),',
      'labor_rate=COALESCE((SELECT SUM(hours*rate)/NULLIF(SUM(hours),0) FROM repair_labor_entries WHERE repair_id=?),?),',
      'updated_at=CURRENT_TIMESTAMP WHERE id=?'
    )).bind(repairId, repairId, rate, repairId),
    db.prepare(
      'INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail) VALUES(?,?,?,?,?)'
    ).bind(repairId, user.id, timer.technician_id, action, (assignment.name + ': saved ' + elapsedHours.toFixed(2) + ' hours.').slice(0,500)),
  ]);
  return { repairId, hours:elapsedHours, rate };
}

export async function pauseShopDuty(db:D1Database, user:ShopDutySessionUser, assignmentId:unknown) {
  const assignment = await requireOwnedAssignment(db, user, assignmentId);
  if (assignment.status !== 'in_progress') throw new Error('This shop duty is not in progress.');
  const stopped = await stopDutyLabor(db, user, assignment, 'shop_duty_paused');
  return { ok:true, assignmentId:assignment.id, repairId:'repair-' + stopped.repairId, hours:stopped.hours, paused:true };
}

export async function saveShopDutyItem(
  db:D1Database, user:ShopDutySessionUser,
  input:{assignmentId:unknown;itemId:unknown;result:unknown;comment?:unknown}
) {
  const assignment = await requireOwnedAssignment(db, user, input.assignmentId);
  if (assignment.status === 'completed' || assignment.status === 'skipped') throw new Error('Completed shop duties cannot be changed.');
  const itemId = integer(input.itemId);
  const result = String(input.result ?? '');
  if (!itemId || !['done','attention','na'].includes(result)) throw new Error('Choose Done, Attention, or N/A.');

  const item = await db.prepare(
    'SELECT id FROM shop_duty_template_items WHERE id=? AND template_id=? AND active=1'
  ).bind(itemId, assignment.templateId).first<{id:number}>();
  if (!item) throw new Error('Checklist item was not found for this duty.');

  await db.prepare(q(
    'INSERT INTO shop_duty_item_results(assignment_id,item_id,result,comment,updated_by_user_id,updated_at)',
    'VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)',
    'ON CONFLICT(assignment_id,item_id) DO UPDATE SET result=excluded.result,comment=excluded.comment,',
    'updated_by_user_id=excluded.updated_by_user_id,updated_at=CURRENT_TIMESTAMP'
  )).bind(assignment.id, itemId, result, cleanText(input.comment,500), user.id).run();

  return { ok:true, assignmentId:assignment.id, itemId, result };
}

export async function saveShopDutyNotes(
  db:D1Database, user:ShopDutySessionUser,
  input:{assignmentId:unknown;suppliesNeeded?:unknown;notes?:unknown}
) {
  const assignment = await requireOwnedAssignment(db, user, input.assignmentId);
  if (assignment.status === 'completed' || assignment.status === 'skipped') throw new Error('Completed shop duties cannot be changed.');
  await db.prepare(q(
    'UPDATE shop_duty_assignments SET supplies_needed=?,notes=?,updated_at=CURRENT_TIMESTAMP',
    'WHERE id=? AND assigned_user_id=?'
  )).bind(cleanText(input.suppliesNeeded,1500), cleanText(input.notes,1500), assignment.id, user.id).run();
  return { ok:true, assignmentId:assignment.id };
}

export async function completeShopDuty(db:D1Database, user:ShopDutySessionUser, assignmentId:unknown) {
  const assignment = await requireOwnedAssignment(db, user, assignmentId);
  if (assignment.status !== 'in_progress') throw new Error('Start this shop duty before completing it.');

  const missing = await db.prepare(q(
    'SELECT COUNT(*) AS count FROM shop_duty_template_items i',
    'LEFT JOIN shop_duty_item_results r ON r.assignment_id=? AND r.item_id=i.id',
    'WHERE i.template_id=? AND i.active=1 AND i.required=1 AND r.result IS NULL'
  )).bind(assignment.id, assignment.templateId).first<{count:number}>();
  if (Number(missing?.count ?? 0) > 0) {
    throw new Error('Complete every required checklist item first. ' + Number(missing?.count ?? 0) + ' item(s) are still unanswered.');
  }

  const stopped = await stopDutyLabor(db, user, assignment, 'shop_duty_labor_completed');
  const repairId = stopped.repairId;
  await db.batch([
    db.prepare(
      "UPDATE repairs SET status='Completed',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(repairId),
    db.prepare(q(
      "UPDATE shop_duty_assignments SET status='completed',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP",
      "WHERE id=? AND assigned_user_id=? AND status='in_progress'"
    )).bind(assignment.id, user.id),
    db.prepare(
      "INSERT INTO repair_job_events(repair_id,user_id,technician_id,action,detail) VALUES(?,?,?,'shop_duty_completed',?)"
    ).bind(repairId, user.id, user.technicianId, ('Completed shop duty: ' + assignment.name).slice(0,500)),
  ]);

  return { ok:true, assignmentId:assignment.id, repairId:'repair-' + repairId, hours:stopped.hours, completed:true };
}

export async function getShopDutySetupData(db:D1Database, now:Date|number = Date.now()) {
  await ensureCurrentShopDutyAssignments(db, now);
  const [templateRows, mechanics, shifts, selected] = await Promise.all([
    getTemplates(db, false),
    db.prepare(q(
      'SELECT id,display_name,role,technician_id FROM app_users',
      "WHERE active=1 AND COALESCE(dispatch_access,0)=0 AND technician_id IS NOT NULL",
      "AND role IN ('mechanic','manager','admin')",
      "ORDER BY CASE role WHEN 'mechanic' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,display_name COLLATE NOCASE,id"
    )).all<{id:number;display_name:string;role:string;technician_id:number}>(),
    db.prepare(
      'SELECT id,name,start_time,end_time,days_of_week,active FROM maintenance_shifts WHERE active=1 ORDER BY start_time,name'
    ).all<{id:number;name:string;start_time:string;end_time:string;days_of_week:string;active:number}>(),
    db.prepare(
      'SELECT template_id,user_id,rotation_order FROM shop_duty_template_users ORDER BY template_id,rotation_order,user_id'
    ).all<{template_id:number;user_id:number;rotation_order:number}>(),
  ]);

  const selectedByTemplate = new Map<number,number[]>();
  for (const row of selected.results) {
    const list = selectedByTemplate.get(Number(row.template_id)) ?? [];
    list.push(Number(row.user_id));
    selectedByTemplate.set(Number(row.template_id), list);
  }

  const today = dateString(now);
  const templateData = [];
  for (const template of templateRows) {
    const currentSpec = await periodSpec(db, template, now);
    const current = template.template_key === 'shift-shop-inspection'
      ? await db.prepare(q(
          'SELECT a.id,a.period_key,a.due_date,a.assigned_user_id,a.status,u.display_name AS assigned_name',
          'FROM shop_duty_assignments a JOIN app_users u ON u.id=a.assigned_user_id',
          'WHERE a.template_id=?',
          "ORDER BY CASE WHEN a.status IN ('pending','in_progress') THEN 0 ELSE 1 END,a.id DESC LIMIT 1"
        )).bind(template.id).first<{
          id:number;period_key:string;due_date:string;assigned_user_id:number;status:string;assigned_name:string;
        }>()
      : currentSpec ? await db.prepare(q(
          'SELECT a.id,a.period_key,a.due_date,a.assigned_user_id,a.status,u.display_name AS assigned_name',
          'FROM shop_duty_assignments a JOIN app_users u ON u.id=a.assigned_user_id',
          'WHERE a.template_id=? AND a.period_key=?'
        )).bind(template.id, currentSpec.periodKey).first<{
          id:number;period_key:string;due_date:string;assigned_user_id:number;status:string;assigned_name:string;
        }>() : null;
    const itemRows = await db.prepare(q(
      'SELECT id,section_name,item_text,sort_order,required',
      'FROM shop_duty_template_items WHERE template_id=? AND active=1',
      'ORDER BY sort_order,id'
    )).bind(template.id).all<{id:number;section_name:string;item_text:string;sort_order:number;required:number}>();

    templateData.push({
      id:Number(template.id), templateKey:template.template_key, name:template.name, description:template.description,
      cadence:template.cadence, assignmentMode:template.assignment_mode, dueDay:template.due_day,
      shiftId:template.shift_id, active:Boolean(template.active), sourceLabel:template.source_label ?? '',
      itemCount:itemRows.results.length, selectedUserIds:selectedByTemplate.get(Number(template.id)) ?? [],
      items:itemRows.results.map((item)=>({
        id:Number(item.id), section:item.section_name, text:item.item_text,
        sortOrder:Number(item.sort_order), required:Boolean(item.required),
      })),
      currentAssignment:current ? {
        id:Number(current.id), periodKey:current.period_key, dueDate:current.due_date,
        assignedUserId:Number(current.assigned_user_id), assignedName:current.assigned_name, status:current.status,
        overdue:current.status !== 'completed' && current.status !== 'skipped' && current.due_date < today,
        dueToday:current.status !== 'completed' && current.status !== 'skipped' && current.due_date === today,
      } : null,
    });
  }

  const overdueRows = await db.prepare(q(
    'SELECT a.id,a.due_date,a.status,a.assigned_user_id,u.display_name AS assigned_name,',
    't.id AS template_id,t.template_key,t.name AS template_name',
    'FROM shop_duty_assignments a',
    'JOIN app_users u ON u.id=a.assigned_user_id',
    'JOIN shop_duty_templates t ON t.id=a.template_id',
    "WHERE a.status IN ('pending','in_progress') AND a.due_date < ?",
    'ORDER BY a.due_date,a.id'
  )).bind(today).all<{
    id:number;due_date:string;status:string;assigned_user_id:number;assigned_name:string;
    template_id:number;template_key:string;template_name:string;
  }>();

  const dueTodayRows = await db.prepare(q(
    'SELECT a.id,a.due_date,a.status,a.assigned_user_id,u.display_name AS assigned_name,',
    't.id AS template_id,t.template_key,t.name AS template_name',
    'FROM shop_duty_assignments a',
    'JOIN app_users u ON u.id=a.assigned_user_id',
    'JOIN shop_duty_templates t ON t.id=a.template_id',
    "WHERE a.status IN ('pending','in_progress') AND a.due_date = ?",
    'ORDER BY a.id'
  )).bind(today).all<{
    id:number;due_date:string;status:string;assigned_user_id:number;assigned_name:string;
    template_id:number;template_key:string;template_name:string;
  }>();

  const mapAlert=(row:{id:number;due_date:string;status:string;assigned_user_id:number;assigned_name:string;template_id:number;template_key:string;template_name:string})=>({
    id:Number(row.id), templateId:Number(row.template_id), templateKey:row.template_key, templateName:row.template_name,
    dueDate:row.due_date, status:row.status, assignedUserId:Number(row.assigned_user_id), assignedName:row.assigned_name,
  });

  return {
    templates:templateData,
    overdueAssignments:overdueRows.results.map(mapAlert),
    dueTodayAssignments:dueTodayRows.results.map(mapAlert),
    mechanics:mechanics.results.map((row) => ({
      id:Number(row.id), displayName:row.display_name, role:row.role, technicianId:Number(row.technician_id),
    })),
    shifts:shifts.results.map((row) => ({
      id:Number(row.id), name:row.name, startTime:row.start_time, endTime:row.end_time,
      daysOfWeek:String(row.days_of_week).split(',').map(Number),
    })),
    updatedAt:new Date().toISOString(),
  };
}

export async function updateShopDutyTemplate(
  db:D1Database, userId:number, body:Record<string,unknown>
) {
  const templateId = integer(body.templateId);
  if (!templateId) throw new Error('Shop duty template was not found.');
  const template = await db.prepare(
    'SELECT id,template_key FROM shop_duty_templates WHERE id=?'
  ).bind(templateId).first<{id:number;template_key:string}>();
  if (!template) throw new Error('Shop duty template was not found.');

  const cadence = String(body.cadence ?? '');
  const assignmentMode = String(body.assignmentMode ?? '');
  if (!['weekly','monthly','shift'].includes(cadence)) throw new Error('Choose a valid recurrence.');
  if (!['all_mechanics_rotation','selected_rotation','fixed','shift_rotation'].includes(assignmentMode)) {
    throw new Error('Choose a valid assignment method.');
  }

  const active = Boolean(body.active);
  const dueDay = body.dueDay == null || body.dueDay === '' ? null : integer(body.dueDay);
  const shiftId = body.shiftId == null || body.shiftId === '' ? null : integer(body.shiftId);
  const selectedUserIds = Array.isArray(body.selectedUserIds)
    ? [...new Set(body.selectedUserIds.map((value) => integer(value)).filter((value) => value > 0))]
    : [];

  if (active && assignmentMode === 'selected_rotation' && !selectedUserIds.length) {
    throw new Error('Choose at least one mechanic before activating this duty.');
  }
  if (active && assignmentMode === 'fixed' && template.template_key !== 'monthly-facility' && !selectedUserIds.length) {
    throw new Error('Choose the mechanic for this duty before activating it.');
  }
  if (active && cadence === 'shift' && !shiftId) {
    throw new Error('Choose the maintenance shift for this Shop Check before activating it.');
  }

  await db.batch([
    db.prepare(q(
      'UPDATE shop_duty_templates SET cadence=?,assignment_mode=?,due_day=?,shift_id=?,active=?,updated_at=CURRENT_TIMESTAMP',
      'WHERE id=?'
    )).bind(cadence, assignmentMode, dueDay, shiftId, active ? 1 : 0, templateId),
    db.prepare('DELETE FROM shop_duty_template_users WHERE template_id=?').bind(templateId),
  ]);

  for (let index=0; index<selectedUserIds.length; index+=1) {
    await db.prepare(q(
      'INSERT INTO shop_duty_template_users(template_id,user_id,rotation_order)',
      'SELECT ?,id,? FROM app_users',
      'WHERE id=? AND active=1 AND technician_id IS NOT NULL AND COALESCE(dispatch_access,0)=0'
    )).bind(templateId, index, selectedUserIds[index]).run();
  }

  if (active) {
    const refreshed = (await getTemplates(db,false)).find((row) => Number(row.id) === templateId);
    if (refreshed) await ensureAssignment(db, refreshed, Date.now());
  }

  return { ok:true, templateId, templateKey:template.template_key, active, updatedByUserId:userId };
}


export async function assignCurrentShopDuty(
  db:D1Database,
  managerUserId:number,
  body:Record<string,unknown>
) {
  const templateId = integer(body.templateId);
  const assignedUserId = integer(body.assignedUserId);
  if (!templateId || !assignedUserId) throw new Error('Choose a Shop Duty and mechanic.');

  const template = (await getTemplates(db,false)).find((row) => Number(row.id) === templateId);
  if (!template) throw new Error('Shop Duty template was not found.');

  const user = await db.prepare(q(
    'SELECT id,display_name,technician_id FROM app_users',
    "WHERE id=? AND active=1 AND COALESCE(dispatch_access,0)=0 AND technician_id IS NOT NULL",
    "AND role IN ('mechanic','manager','admin')"
  )).bind(assignedUserId).first<EligibleUser>();
  if (!user) throw new Error('Choose an active working mechanic.');

  const today = dateString(Date.now());
  let spec:{periodKey:string;dueDate:string}|null = null;

  if (template.template_key === 'shift-shop-inspection') {
    const open = await db.prepare(q(
      'SELECT id,status FROM shop_duty_assignments',
      "WHERE template_id=? AND status IN ('pending','in_progress')",
      'ORDER BY id DESC LIMIT 1'
    )).bind(templateId).first<{id:number;status:string}>();

    if (open?.status === 'in_progress') {
      throw new Error('The current Shop Check is already in progress. Complete it before assigning the next one.');
    }
    if (open?.status === 'pending') {
      await db.prepare(q(
        "UPDATE shop_duty_assignments SET assigned_user_id=?,status='pending',repair_id=NULL,",
        "supplies_needed='',notes='',started_at=NULL,completed_at=NULL,due_date=?,updated_at=CURRENT_TIMESTAMP",
        'WHERE id=?'
      )).bind(assignedUserId,today,open.id).run();
      return {
        ok:true, templateId, assignmentId:Number(open.id), assignedUserId,
        assignedName:user.display_name, dueDate:today, periodKey:'manual-open',
        updatedByUserId:managerUserId,
      };
    }

    spec = { periodKey:'manual:' + today + ':' + crypto.randomUUID(), dueDate:today };
  } else {
    spec = await periodSpec(db,template,Date.now());
    if (!spec) throw new Error('The current duty period could not be resolved.');

    const existing = await db.prepare(q(
      'SELECT id,status FROM shop_duty_assignments',
      'WHERE template_id=? AND period_key=?'
    )).bind(templateId,spec.periodKey).first<{id:number;status:string}>();

    if (existing && (existing.status === 'in_progress' || existing.status === 'completed')) {
      throw new Error('This duty has already started or been completed and cannot be reassigned.');
    }

    if (existing) {
      await db.prepare(q(
        "UPDATE shop_duty_assignments SET assigned_user_id=?,status='pending',repair_id=NULL,",
        "supplies_needed='',notes='',started_at=NULL,completed_at=NULL,updated_at=CURRENT_TIMESTAMP",
        'WHERE id=?'
      )).bind(assignedUserId,existing.id).run();
      return {
        ok:true, templateId, assignmentId:Number(existing.id), assignedUserId,
        assignedName:user.display_name, dueDate:spec.dueDate, periodKey:spec.periodKey,
        updatedByUserId:managerUserId,
      };
    }
  }

  const created = await db.prepare(
    "INSERT INTO shop_duty_assignments(template_id,period_key,due_date,assigned_user_id,status) VALUES(?,?,?,?,'pending')"
  ).bind(templateId,spec.periodKey,spec.dueDate,assignedUserId).run();
  return {
    ok:true, templateId, assignmentId:Number(created.meta.last_row_id), assignedUserId,
    assignedName:user.display_name, dueDate:spec.dueDate, periodKey:spec.periodKey,
    updatedByUserId:managerUserId,
  };
}

export async function saveShopDutyChecklist(
  db:D1Database,
  managerUserId:number,
  body:Record<string,unknown>
) {
  const templateId = integer(body.templateId);
  if (!templateId) throw new Error('Shop Duty template was not found.');
  const template = await db.prepare('SELECT id,name FROM shop_duty_templates WHERE id=?')
    .bind(templateId).first<{id:number;name:string}>();
  if (!template) throw new Error('Shop Duty template was not found.');

  const activeAssignment = await db.prepare(q(
    'SELECT id FROM shop_duty_assignments',
    "WHERE template_id=? AND status='in_progress' LIMIT 1"
  )).bind(templateId).first<{id:number}>();
  if (activeAssignment) throw new Error('This checklist cannot be edited while a mechanic is actively working it. Finish that duty first.');

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems.map((raw,index)=>{
    const row = (raw ?? {}) as Record<string,unknown>;
    const text = cleanText(row.text,500);
    if (!text) throw new Error('Every checklist line needs text.');
    return {
      id:integer(row.id),
      section:cleanText(row.section,120) || 'CHECKLIST',
      text,
      required:row.required !== false,
      sortOrder:index+1,
    };
  });
  if (!items.length) throw new Error('Keep at least one checklist line.');

  const existing = await db.prepare(
    'SELECT id FROM shop_duty_template_items WHERE template_id=? AND active=1'
  ).bind(templateId).all<{id:number}>();
  const keep = new Set(items.filter((item)=>item.id>0).map((item)=>item.id));

  for (const row of existing.results) {
    if (!keep.has(Number(row.id))) {
      await db.prepare(
        'UPDATE shop_duty_template_items SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND template_id=?'
      ).bind(row.id,templateId).run();
    }
  }

  for (const item of items) {
    if (item.id > 0) {
      const updated = await db.prepare(q(
        'UPDATE shop_duty_template_items SET section_name=?,item_text=?,sort_order=?,required=?,active=1,updated_at=CURRENT_TIMESTAMP',
        'WHERE id=? AND template_id=?'
      )).bind(item.section,item.text,item.sortOrder,item.required?1:0,item.id,templateId).run();
      if (Number(updated.meta.changes ?? 0) === 0) throw new Error('One checklist line no longer belongs to this duty. Refresh and try again.');
    } else {
      await db.prepare(q(
        'INSERT INTO shop_duty_template_items(template_id,section_name,item_text,sort_order,required,active)',
        'VALUES(?,?,?,?,?,1)'
      )).bind(templateId,item.section,item.text,item.sortOrder,item.required?1:0).run();
    }
  }

  return {ok:true,templateId,itemCount:items.length,updatedByUserId:managerUserId};
}
