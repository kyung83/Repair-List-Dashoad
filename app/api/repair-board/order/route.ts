import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

const SCOPE = /^(all|clare|cadillac):(truck-repairs|truck-pms|truck-annuals|trailers|other)$/;

async function userFor(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  return user;
}

export async function GET(request: Request) {
  try {
    await userFor(request);
    const rows = await env.DB.prepare(`
      SELECT scope, group_key, sort_order
      FROM repair_board_order
      ORDER BY scope, sort_order, group_key
    `).all<{ scope: string; group_key: string; sort_order: number }>();
    const orderByScope: Record<string, string[]> = {};
    for (const row of rows.results) {
      (orderByScope[row.scope] ||= []).push(row.group_key);
    }
    return Response.json({ orderByScope }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Board order could not be loaded.';
    return Response.json({ error: message }, { status: message === 'Authentication required.' ? 401 : 400 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await userFor(request);
    if (user.role !== 'manager' && user.role !== 'admin') {
      return Response.json({ error: 'Manager or administrator access is required.' }, { status: 403 });
    }
    const body = await request.json() as Record<string, unknown>;
    const scope = String(body.scope ?? '').trim();
    if (!SCOPE.test(scope)) throw new Error('Choose a valid repair-board section.');
    const raw = Array.isArray(body.groupKeys) ? body.groupKeys : [];
    const groupKeys = [...new Set(raw.map((value) => String(value ?? '').trim()).filter((value) => value && value.length <= 120))];
    if (!groupKeys.length || groupKeys.length > 500) throw new Error('Repair-board order is empty or too large.');
    const statements = groupKeys.map((groupKey, index) => env.DB.prepare(`
      INSERT INTO repair_board_order (scope,group_key,sort_order,updated_by_user_id,updated_at)
      VALUES (?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(scope,group_key) DO UPDATE SET
        sort_order=excluded.sort_order,
        updated_by_user_id=excluded.updated_by_user_id,
        updated_at=CURRENT_TIMESTAMP
    `).bind(scope, groupKey, (index + 1) * 10, user.id));
    for (let index = 0; index < statements.length; index += 75) {
      await env.DB.batch(statements.slice(index, index + 75));
    }
    return Response.json({ ok: true, scope, groupKeys });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Repair-board order could not be saved.' }, { status: 400 });
  }
}
