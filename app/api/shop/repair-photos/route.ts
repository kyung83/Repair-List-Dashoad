import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function isManagerRole(role: string) {
  return role === 'manager' || role === 'admin';
}

function photoUrl(key: string) {
  return `/api/photos/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function loadRepair(id: number) {
  return env.DB.prepare(`
    SELECT r.id, r.technician_id, COALESCE(r.status, '') AS status,
           COALESCE(r.title, '') AS title, COALESCE(e.unit, '') AS unit
    FROM repairs r
    LEFT JOIN equipment e ON e.id = r.equipment_id
    WHERE r.id = ?
  `).bind(id).first<{
    id:number;
    technician_id:number|null;
    status:string;
    title:string;
    unit:string;
  }>();
}

function mechanicOwnsRepair(user: { role:string; technicianId:number|null }, repair: { technician_id:number|null }) {
  return user.role === 'mechanic'
    && Boolean(user.technicianId)
    && Number(repair.technician_id ?? 0) === Number(user.technicianId);
}

async function requireAccess(request: Request, repairId: number) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (!['mechanic', 'manager', 'admin'].includes(user.role)) throw new Error('This account cannot access repair photos.');
  const repair = await loadRepair(repairId);
  if (!repair) throw new Error('Repair was not found.');
  const manager = isManagerRole(user.role);
  const mechanicOwner = mechanicOwnsRepair(user, repair);
  if (!manager && !mechanicOwner) throw new Error('This repair is not assigned to you.');
  return { user, repair, manager, mechanicOwner };
}

async function payload(repairId: number) {
  const rows = await env.DB.prepare(`
    SELECT p.id, p.object_key, p.file_name, p.content_type, COALESCE(p.note, '') AS note,
           p.created_at, p.uploaded_by_user_id, p.technician_id,
           COALESCE(NULLIF(u.display_name,''), NULLIF(u.username,''), NULLIF(t.name,''), 'Shop user') AS uploaded_by
    FROM repair_work_photos p
    LEFT JOIN app_users u ON u.id = p.uploaded_by_user_id
    LEFT JOIN technicians t ON t.id = p.technician_id
    WHERE p.repair_id = ?
    ORDER BY p.created_at ASC, p.id ASC
  `).bind(repairId).all<{
    id:number;
    object_key:string;
    file_name:string|null;
    content_type:string|null;
    note:string;
    created_at:string;
    uploaded_by_user_id:number|null;
    technician_id:number|null;
    uploaded_by:string;
  }>();
  return rows.results.map(row=>({
    id:Number(row.id),
    fileName:row.file_name || 'Photo',
    contentType:row.content_type || '',
    note:row.note || '',
    createdAt:row.created_at,
    uploadedBy:row.uploaded_by,
    uploadedByUserId:row.uploaded_by_user_id,
    technicianId:row.technician_id,
    url:photoUrl(row.object_key),
  }));
}

export async function GET(request: Request) {
  try {
    const id = numericRepairId(new URL(request.url).searchParams.get('repairId'));
    if (!id) throw new Error('Repair was not found.');
    await requireAccess(request, id);
    return Response.json({ ok:true, photos:await payload(id) }, { headers:{ 'cache-control':'no-store' } });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : 'Repair photos could not be loaded.' }, { status:400, headers:{ 'cache-control':'no-store' } });
  }
}

export async function POST(request: Request) {
  let uploadedKey = '';
  try {
    const form = await request.formData();
    const id = numericRepairId(form.get('repairId'));
    if (!id) throw new Error('Repair was not found.');
    const { user, repair } = await requireAccess(request, id);
    if (repair.status.toLowerCase().includes('complete')) throw new Error('Completed repairs cannot accept new work photos.');

    const fileValue = form.get('photo');
    if (!fileValue || typeof fileValue === 'string') throw new Error('Choose a photo to upload.');
    const file = fileValue as File;
    if (!file.size || file.size > 12 * 1024 * 1024) throw new Error('Repair photos must be between 1 byte and 12 MB.');
    if (!String(file.type || '').toLowerCase().startsWith('image/')) throw new Error('Repair photo uploads must be image files.');
    const note = String(form.get('note') ?? '').trim().slice(0, 500);
    const cleanName = String(file.name || 'photo').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'photo';
    uploadedKey = `repair-work/${id}/${crypto.randomUUID()}-${cleanName}`;
    await env.FILES.put(uploadedKey, file.stream(), { httpMetadata:{ contentType:file.type || 'application/octet-stream' } });

    try {
      await env.DB.prepare(`
        INSERT INTO repair_work_photos (
          repair_id, object_key, file_name, content_type, note, uploaded_by_user_id, technician_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, uploadedKey, file.name || cleanName, file.type || null, note || null, user.id, user.technicianId ?? null).run();
      await env.DB.prepare(`
        INSERT INTO repair_job_events (repair_id, user_id, technician_id, action, detail)
        VALUES (?, ?, ?, 'work_photo_added', ?)
      `).bind(id, user.id, user.technicianId ?? null, note ? `Work photo added: ${note}` : 'Work photo added.').run();
    } catch (error) {
      await env.FILES.delete(uploadedKey);
      uploadedKey = '';
      throw error;
    }

    return Response.json({ ok:true, photos:await payload(id) });
  } catch (error) {
    if (uploadedKey) {
      try { await env.FILES.delete(uploadedKey); } catch {}
    }
    return Response.json({ error:error instanceof Error ? error.message : 'Repair photo could not be saved.' }, { status:400 });
  }
}
