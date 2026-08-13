import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

function yardValue(value: unknown) {
  const yard = String(value ?? '').trim().toLowerCase();
  return yard === 'clare' || yard === 'cadillac' ? yard : '';
}

export async function GET(request: Request) {
  const current = await getSessionUser(env.DB, request);
  if (!current) return Response.json({ error: 'Not signed in.' }, { status: 401 });
  if (current.role !== 'admin') return Response.json({ error: 'Administrator access is required.' }, { status: 403 });
  const rows = await env.DB.prepare("SELECT id,username,display_name,role,active,COALESCE(yard,'') AS yard FROM app_users WHERE role IN ('mechanic','manager') ORDER BY active DESC,role,display_name COLLATE NOCASE").all<{id:number;username:string|null;display_name:string;role:string;active:number;yard:string}>();
  return Response.json({ users: rows.results.map(row => ({ id:Number(row.id), username:row.username ?? '', displayName:row.display_name, role:row.role, active:Boolean(row.active), yard:yardValue(row.yard) })) }, { headers:{'cache-control':'no-store'} });
}

export async function POST(request: Request) {
  try {
    const current = await getSessionUser(env.DB, request);
    if (!current) return Response.json({ error: 'Not signed in.' }, { status: 401 });
    if (current.role !== 'admin') return Response.json({ error: 'Administrator access is required.' }, { status: 403 });
    const body = await request.json() as Record<string,unknown>;
    const id = Number(body.id);
    const raw = String(body.yard ?? '').trim().toLowerCase();
    if (!Number.isInteger(id) || id <= 0) throw new Error('User could not be resolved.');
    if (raw && raw !== 'clare' && raw !== 'cadillac') throw new Error('Yard must be Clare or Cadillac.');
    const user = await env.DB.prepare('SELECT role FROM app_users WHERE id=?').bind(id).first<{role:string}>();
    if (!user) throw new Error('User not found.');
    if (user.role !== 'mechanic' && user.role !== 'manager') throw new Error('Yards are assigned to technicians and managers.');
    const yard = yardValue(raw);
    await env.DB.prepare('UPDATE app_users SET yard=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(yard,id).run();
    return Response.json({ok:true,id,yard});
  } catch (error) {
    return Response.json({error:error instanceof Error?error.message:'Yard assignment could not be saved.'},{status:400});
  }
}
