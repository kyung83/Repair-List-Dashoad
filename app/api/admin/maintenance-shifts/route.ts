import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

export const MAINTENANCE_SHIFT_SUMMARY_RECIPIENT = 'Maintenance@norloworld.com';
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

async function requireAdmin(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return { user:null, response:Response.json({ error:'Not signed in.' }, { status:401 }) };
  if (user.role !== 'admin') return { user:null, response:Response.json({ error:'Administrator access is required.' }, { status:403 }) };
  return { user, response:null };
}

function cleanDays(value: unknown) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(',');
  const days = [...new Set(source.map((item) => Number(item)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a,b)=>a-b);
  if (!days.length) throw new Error('Choose at least one workday for the shift.');
  return days.join(',');
}

function cleanShift(body: Record<string, unknown>) {
  const name = String(body.name ?? '').trim().replace(/\s+/g,' ').slice(0,80);
  const startTime = String(body.startTime ?? '').trim();
  const endTime = String(body.endTime ?? '').trim();
  if (!name) throw new Error('Shift name is required.');
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) throw new Error('Shift start and end times are required.');
  if (startTime === endTime) throw new Error('Shift start and end times must be different.');
  return { name, startTime, endTime, daysOfWeek:cleanDays(body.daysOfWeek), active:body.active !== false };
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const rows = await env.DB.prepare(`
    SELECT s.id,s.name,s.start_time,s.end_time,s.days_of_week,s.active,
           s.summary_delay_minutes,s.summary_recipient,s.created_at,s.updated_at,
           COUNT(a.user_id) AS assigned_count
    FROM maintenance_shifts s
    LEFT JOIN maintenance_shift_assignments a ON a.shift_id=s.id
    GROUP BY s.id
    ORDER BY s.active DESC,s.start_time,s.name COLLATE NOCASE
  `).all<{
    id:number;name:string;start_time:string;end_time:string;days_of_week:string;active:number;
    summary_delay_minutes:number;summary_recipient:string;created_at:string;updated_at:string;assigned_count:number;
  }>();
  return Response.json({
    recipient:MAINTENANCE_SHIFT_SUMMARY_RECIPIENT,
    delayMinutes:30,
    timeZone:'America/Detroit',
    shifts:rows.results.map((row)=>({
      id:Number(row.id),name:row.name,startTime:row.start_time,endTime:row.end_time,
      daysOfWeek:String(row.days_of_week).split(',').map(Number).filter(Number.isInteger),
      active:Boolean(row.active),summaryDelayMinutes:Number(row.summary_delay_minutes),summaryRecipient:row.summary_recipient,
      assignedCount:Number(row.assigned_count ?? 0),createdAt:row.created_at,updatedAt:row.updated_at,
    })),
  }, { headers:{ 'cache-control':'no-store' } });
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response || !auth.user) return auth.response!;
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? 'save');
    if (!['save','archive'].includes(action)) throw new Error('Unknown shift action.');

    if (action === 'archive') {
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) throw new Error('Shift could not be resolved.');
      await env.DB.prepare(`UPDATE maintenance_shifts SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run();
      return Response.json({ ok:true,id,active:false });
    }

    const shift = cleanShift(body);
    const id = Number(body.id ?? 0);
    if (Number.isInteger(id) && id > 0) {
      const exists = await env.DB.prepare('SELECT id FROM maintenance_shifts WHERE id=?').bind(id).first<{id:number}>();
      if (!exists) throw new Error('Shift was not found.');
      await env.DB.prepare(`
        UPDATE maintenance_shifts
        SET name=?,start_time=?,end_time=?,days_of_week=?,active=?,summary_delay_minutes=30,
            summary_recipient=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).bind(shift.name,shift.startTime,shift.endTime,shift.daysOfWeek,shift.active?1:0,MAINTENANCE_SHIFT_SUMMARY_RECIPIENT,id).run();
      return Response.json({ ok:true,id });
    }

    const duplicate = await env.DB.prepare('SELECT id FROM maintenance_shifts WHERE lower(trim(name))=lower(trim(?))').bind(shift.name).first<{id:number}>();
    if (duplicate) throw new Error('A shift with that name already exists.');
    const result = await env.DB.prepare(`
      INSERT INTO maintenance_shifts
        (name,start_time,end_time,days_of_week,active,summary_delay_minutes,summary_recipient,created_by_user_id)
      VALUES (?,?,?,?,?,30,?,?)
    `).bind(shift.name,shift.startTime,shift.endTime,shift.daysOfWeek,shift.active?1:0,MAINTENANCE_SHIFT_SUMMARY_RECIPIENT,auth.user.id).run();
    return Response.json({ ok:true,id:Number(result.meta.last_row_id) });
  } catch (error) {
    console.error(JSON.stringify({ event:'maintenance_shift_admin_failed',error:String(error) }));
    return Response.json({ error:error instanceof Error?error.message:'Shift could not be saved.' }, { status:400 });
  }
}
