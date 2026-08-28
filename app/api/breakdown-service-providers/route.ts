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

async function requireManager(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') {
    throw new Error('Manager or administrator access is required.');
  }
  return user;
}

function providerPayload(row: ServiceProviderRow) {
  return {
    id: Number(row.id),
    name: row.name,
    phone: row.phone,
    city: row.city,
    state: row.state,
    zip: row.zip,
  };
}

export async function GET(request: Request) {
  try {
    await requireManager(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === 'Authentication required.' ? 401 : 403;
    return Response.json({ error: message }, { status });
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
    providers: rows.results.map(providerPayload),
  }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  try {
    await requireManager(request);
    const body = await request.json<Record<string, unknown>>();
    const name = String(body.name || '').trim().slice(0, 160);
    const phone = String(body.phone || '').trim().slice(0, 40);
    const city = String(body.city || '').trim().slice(0, 120);
    const state = String(body.state || '').trim().toUpperCase().slice(0, 2);
    const zip = String(body.zip || '').trim().slice(0, 20);

    if (!name) throw new Error('Company name is required.');
    if (!city) throw new Error('City is required.');
    if (!/^[A-Z]{2}$/.test(state)) throw new Error('Enter a 2-letter state abbreviation.');

    const phoneDigits = phone.replace(/\D/g, '');
    await env.DB.prepare(`
      INSERT INTO roadside_service_providers (
        name, phone, phone_digits, city, state, zip, active, source, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 'manual', CURRENT_TIMESTAMP)
      ON CONFLICT(name, phone, city, state, zip) DO UPDATE SET
        phone_digits = excluded.phone_digits,
        active = 1,
        updated_at = CURRENT_TIMESTAMP
    `).bind(name, phone, phoneDigits, city, state, zip).run();

    const provider = await env.DB.prepare(`
      SELECT id, name, phone, city, state, zip
      FROM roadside_service_providers
      WHERE name = ? AND phone = ? AND city = ? AND state = ? AND zip = ?
      LIMIT 1
    `).bind(name, phone, city, state, zip).first<ServiceProviderRow>();
    if (!provider) throw new Error('Provider could not be saved.');

    return Response.json({ ok: true, provider: providerPayload(provider) }, {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === 'Authentication required.' ? 401
      : message.includes('Manager or administrator') ? 403
      : 400;
    return Response.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } });
  }
}
