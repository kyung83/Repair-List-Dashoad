import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { listBreakdownCategoryConfigs } from '@/lib/breakdown-categories';

async function requireManager(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (user.dispatchAccess || (user.role !== 'manager' && user.role !== 'admin')) throw new Error('Manager or administrator access is required.');
  return user;
}

function rejectCrossSite(request: Request) {
  return String(request.headers.get('sec-fetch-site') || '').trim().toLowerCase() === 'cross-site';
}

function text(value: unknown, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

function bool(value: unknown) {
  return value === true || value === 1 || value === '1';
}

function order(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(9999, Math.round(parsed))) : fallback;
}

export async function GET(request: Request) {
  try {
    const manage = new URL(request.url).searchParams.get('manage') === '1';
    if (manage) await requireManager(request);
    const categories = await listBreakdownCategoryConfigs(env.DB, manage);
    return Response.json({ categories }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: String((error as Error)?.message ?? error) }, { status: 403, headers: { 'cache-control': 'no-store' } });
  }
}

export async function POST(request: Request) {
  try {
    if (rejectCrossSite(request)) throw new Error('Cross-site breakdown setup request rejected.');
    await requireManager(request);
    const body = await request.json<Record<string, unknown>>();
    const action = text(body.action, 40);

    if (action === 'add-category') {
      const name = text(body.name);
      if (!name) throw new Error('Category name is required.');
      await env.DB.prepare(`
        INSERT INTO breakdown_categories(name,requires_position,requires_tire_size,active,sort_order,updated_at)
        VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)
      `).bind(name, bool(body.requiresPosition) ? 1 : 0, bool(body.requiresTireSize) ? 1 : 0, 1, order(body.sortOrder, 100)).run();
    } else if (action === 'add-subcategory') {
      const categoryId = Number(body.categoryId);
      const name = text(body.name);
      if (!Number.isInteger(categoryId) || categoryId <= 0) throw new Error('Choose a category first.');
      if (!name) throw new Error('Subcategory name is required.');
      await env.DB.prepare(`
        INSERT INTO breakdown_subcategories(category_id,name,active,sort_order,updated_at)
        VALUES(?,?,1,?,CURRENT_TIMESTAMP)
      `).bind(categoryId, name, order(body.sortOrder, 100)).run();
    } else {
      throw new Error('Choose a valid setup action.');
    }

    const categories = await listBreakdownCategoryConfigs(env.DB, true);
    return Response.json({ ok: true, categories }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    const friendly = /UNIQUE constraint failed/i.test(message) ? 'That category or subcategory already exists.' : message;
    return Response.json({ error: friendly }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
}

export async function PATCH(request: Request) {
  try {
    if (rejectCrossSite(request)) throw new Error('Cross-site breakdown setup request rejected.');
    await requireManager(request);
    const body = await request.json<Record<string, unknown>>();
    const action = text(body.action, 40);

    if (action === 'update-category') {
      const id = Number(body.id);
      const name = text(body.name);
      if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid category.');
      if (!name) throw new Error('Category name is required.');
      await env.DB.prepare(`
        UPDATE breakdown_categories
        SET name=?,requires_position=?,requires_tire_size=?,active=?,sort_order=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).bind(name, bool(body.requiresPosition) ? 1 : 0, bool(body.requiresTireSize) ? 1 : 0, bool(body.active) ? 1 : 0, order(body.sortOrder), id).run();
    } else if (action === 'update-subcategory') {
      const id = Number(body.id);
      const name = text(body.name);
      if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid subcategory.');
      if (!name) throw new Error('Subcategory name is required.');
      await env.DB.prepare(`
        UPDATE breakdown_subcategories
        SET name=?,active=?,sort_order=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).bind(name, bool(body.active) ? 1 : 0, order(body.sortOrder), id).run();
    } else {
      throw new Error('Choose a valid setup action.');
    }

    const categories = await listBreakdownCategoryConfigs(env.DB, true);
    return Response.json({ ok: true, categories }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    const friendly = /UNIQUE constraint failed/i.test(message) ? 'That category or subcategory already exists.' : message;
    return Response.json({ error: friendly }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
}
