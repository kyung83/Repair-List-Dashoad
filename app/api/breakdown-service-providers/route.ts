import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

type ServiceProviderRow = {
  id: number;
  name: string;
  phone: string;
  city: string;
  state: string;
  zip: string;
};

export async function GET(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  if (user.role !== 'manager' && user.role !== 'admin') {
    return Response.json({ error: 'Manager or administrator access is required.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const state = String(url.searchParams.get('state') || '').trim().toUpperCase().slice(0, 3);
  const city = String(url.searchParams.get('city') || '').trim().slice(0, 120);
  const query = String(url.searchParams.get('q') || '').trim().slice(0, 80);

  if (!state) {
    return Response.json({ error: 'State is required.' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }

  const where = ['active = 1', 'state = ?'];
  const bindings: unknown[] = [state];

  if (query) {
    const like = `%${query}%`;
    const digits = query.replace(/\D/g, '');
    where.push(`(
      name LIKE ? COLLATE NOCASE
      OR city LIKE ? COLLATE NOCASE
      OR zip LIKE ? COLLATE NOCASE
      OR phone LIKE ? COLLATE NOCASE
      ${digits ? 'OR phone_digits LIKE ?' : ''}
    )`);
    bindings.push(like, like, like, like);
    if (digits) bindings.push(`%${digits}%`);
  }

  const orderBindings: unknown[] = [];
  const cityPriority = city
    ? 'CASE WHEN lower(city) = lower(?) THEN 0 ELSE 1 END,'
    : '';
  if (city) orderBindings.push(city);

  const rows = await env.DB.prepare(`
    SELECT id, name, phone, city, state, zip
    FROM roadside_service_providers
    WHERE ${where.join(' AND ')}
    ORDER BY ${cityPriority} city COLLATE NOCASE, name COLLATE NOCASE, id
    LIMIT 250
  `).bind(...bindings, ...orderBindings).all<ServiceProviderRow>();

  return Response.json({
    state,
    city,
    providers: rows.results.map((row) => ({
      id: Number(row.id),
      name: row.name,
      phone: row.phone,
      city: row.city,
      state: row.state,
      zip: row.zip,
    })),
  }, { headers: { 'cache-control': 'no-store' } });
}
