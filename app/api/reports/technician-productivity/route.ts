import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getTechnicianProductivity } from '@/lib/technician-productivity';

function utcDay(date: Date) { return date.toISOString().slice(0, 10); }

export async function GET(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return Response.json({ error: 'Sign in to view technician productivity.' }, { status: 401 });
  if (user.role !== 'manager' && user.role !== 'admin') {
    return Response.json({ error: 'Manager or administrator access is required to view technician productivity.' }, { status: 403 });
  }
  try {
    const search = new URL(request.url).searchParams;
    const now = new Date();
    const defaultStart = new Date(now.getTime() - 29 * 86400000);
    const start = search.get('start') ?? utcDay(defaultStart);
    const end = search.get('end') ?? utcDay(now);
    const requestedTech = search.get('technician');
    const technicianId = requestedTech === null || requestedTech === '' ? undefined : Number(requestedTech);
    const data = await getTechnicianProductivity(env.DB, start, end, technicianId);
    return Response.json(data, { headers: { 'cache-control': 'private, no-store', vary: 'Cookie' } });
  } catch (error) {
    if (error instanceof RangeError) {
      return Response.json({ error: error.message }, { status: 400, headers: { 'cache-control': 'no-store' } });
    }
    console.error(JSON.stringify({ event: 'technician_productivity_report_failed', error: String(error) }));
    return Response.json({ error: 'Technician productivity could not be loaded.' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
