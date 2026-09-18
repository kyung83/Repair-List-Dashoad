import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return new Response('Authentication required.', { status: 401 });

  const { key } = await context.params;
  const objectKey = (key ?? []).map(decodeURIComponent).join('/');
  const maintenancePhoto = objectKey.startsWith('maintenance-checklists/');
  const roadsidePhoto = objectKey.startsWith('roadside-breakdowns/');
  const repairWorkPhoto = objectKey.startsWith('repair-work/');

  if (!maintenancePhoto && !roadsidePhoto && !repairWorkPhoto) {
    return new Response('Not found.', { status: 404 });
  }
  if (roadsidePhoto && user.role !== 'manager' && user.role !== 'admin') {
    return new Response('Manager or administrator access is required.', { status: 403 });
  }
  if (repairWorkPhoto) {
    const row = await env.DB.prepare(`
      SELECT p.repair_id,r.technician_id
      FROM repair_work_photos p
      JOIN repairs r ON r.id=p.repair_id
      WHERE p.object_key=?
    `).bind(objectKey).first<{repair_id:number;technician_id:number|null}>();
    if (!row) return new Response('Not found.', { status: 404 });
    const manager = user.role === 'manager' || user.role === 'admin';
    const mechanicOwner = user.role === 'mechanic'
      && Boolean(user.technicianId)
      && Number(row.technician_id ?? 0) === Number(user.technicianId);
    if (!manager && !mechanicOwner) {
      return new Response('This repair photo is not available to your account.', { status: 403 });
    }
  }

  const object = await env.FILES.get(objectKey);
  if (!object) return new Response('Not found.', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('cache-control', 'private, max-age=31536000, immutable');
  return new Response(object.body, { headers });
}
