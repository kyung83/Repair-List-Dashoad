import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { createBreakdown, listBreakdowns } from '@/lib/roadside-breakdowns';

const SAFE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

function safeText(value: FormDataEntryValue | null, max: number) {
  return String(value ?? '').trim().slice(0, max);
}

/**
 * PUBLIC endpoint -- no session required. This is what the driver-facing
 * report page posts to. Keep this route's surface area tight: only what a
 * driver on the shoulder of a highway needs to submit, nothing that reveals
 * shop-repair data.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const unitType = safeText(form.get('unitType'), 10);
    const unitNumber = safeText(form.get('unitNumber'), 20);
    const driverName = safeText(form.get('driverName'), 120);
    const state = safeText(form.get('state'), 2).toUpperCase();
    const city = safeText(form.get('city'), 120);
    const repairCategory = safeText(form.get('repairCategory'), 60);
    const description = safeText(form.get('description'), 2000);

    if (unitType !== 'truck' && unitType !== 'trailer') throw new Error('Pick Truck or Trailer.');
    if (!unitNumber) throw new Error('Unit # is required.');
    if (!driverName) throw new Error('Driver name is required.');
    if (!state) throw new Error('State is required.');
    if (!city) throw new Error('City is required.');
    if (!repairCategory) throw new Error('Repair type is required.');
    if (!description) throw new Error('Description is required.');

    const photoObjectKeys: string[] = [];
    const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
    for (const file of files.slice(0, 6)) {
      if (!SAFE_IMAGE_TYPES.has(file.type)) continue;
      const bytes = await file.arrayBuffer();
      const key = `roadside-breakdowns/${new Date().toISOString().slice(0, 4)}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-140)}`;
      await env.FILES.put(key, bytes, { httpMetadata: { contentType: file.type } });
      photoObjectKeys.push(key);
    }

    const { breakdownId } = await createBreakdown({
      unitType: unitType as 'truck' | 'trailer',
      unitNumber, driverName, state, city, repairCategory, description, photoObjectKeys,
    });

    return Response.json({ ok: true, breakdownId }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return Response.json({ error: String((err as Error)?.message ?? err) }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
}

/** ADMIN-ONLY: list breakdowns for the dashboard tab. */
export async function GET(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  if (user.role !== 'manager' && user.role !== 'admin') return Response.json({ error: 'Manager or administrator access is required.' }, { status: 403 });

  const url = new URL(request.url);
  const openOnly = url.searchParams.get('open') === '1';
  const breakdowns = await listBreakdowns({ openOnly });
  return Response.json({ breakdowns }, { headers: { 'cache-control': 'no-store' } });
}
