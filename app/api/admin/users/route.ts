import { env } from 'cloudflare:workers';
import { getSessionUser, hashPassword, isAppRole, normalizeEmail } from '@/lib/auth';

async function requireAdmin(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return { user: null, response: Response.json({ error: 'Not signed in.' }, { status: 401 }) };
  if (user.role !== 'admin') return { user: null, response: Response.json({ error: 'Administrator access is required.' }, { status: 403 }) };
  return { user, response: null };
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;

  const result = await env.DB.prepare(`
    SELECT id, email, display_name, role, active, force_password_change, last_login_at, created_at, updated_at
    FROM app_users
    ORDER BY active DESC, display_name COLLATE NOCASE, email COLLATE NOCASE
  `).all<{
    id: number;
    email: string;
    display_name: string;
    role: string;
    active: number;
    force_password_change: number;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
  }>();

  return Response.json({
    users: result.results.map((row) => ({
      id: Number(row.id),
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      active: Boolean(row.active),
      forcePasswordChange: Boolean(row.force_password_change),
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response || !auth.user) return auth.response!;

    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? 'create');

    if (action === 'create') {
      const email = normalizeEmail(body.email);
      const displayName = String(body.displayName ?? '').trim();
      const role = body.role;
      const password = String(body.password ?? '');
      if (!email || !email.includes('@')) throw new Error('A valid email address is required.');
      if (!displayName) throw new Error('Display name is required.');
      if (!isAppRole(role)) throw new Error('A valid clearance level is required.');

      const passwordData = await hashPassword(password);
      const result = await env.DB.prepare(`
        INSERT INTO app_users (
          email, display_name, role, password_hash, password_salt, password_iterations, active, force_password_change
        ) VALUES (?, ?, ?, ?, ?, ?, 1, 1)
      `).bind(
        email,
        displayName,
        role,
        passwordData.hash,
        passwordData.salt,
        passwordData.iterations,
      ).run();
      return Response.json({ ok: true, id: Number(result.meta.last_row_id) });
    }

    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error('User could not be resolved.');

    if (action === 'update') {
      const displayName = String(body.displayName ?? '').trim();
      const role = body.role;
      const active = Boolean(body.active);
      if (!displayName) throw new Error('Display name is required.');
      if (!isAppRole(role)) throw new Error('A valid clearance level is required.');

      const current = await env.DB.prepare('SELECT role, active FROM app_users WHERE id = ?').bind(id)
        .first<{ role: string; active: number }>();
      if (!current) throw new Error('User not found.');

      const removesActiveAdmin = current.role === 'admin' && Boolean(current.active) && (role !== 'admin' || !active);
      if (removesActiveAdmin) {
        const count = await env.DB.prepare(`
          SELECT COUNT(*) AS count FROM app_users WHERE role = 'admin' AND active = 1
        `).first<{ count: number }>();
        if (Number(count?.count ?? 0) <= 1) throw new Error('At least one active administrator is required.');
      }
      if (id === auth.user.id && !active) throw new Error('You cannot disable your own account.');

      await env.DB.prepare(`
        UPDATE app_users
        SET display_name = ?, role = ?, active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(displayName, role, active ? 1 : 0, id).run();
      if (!active) await env.DB.prepare('DELETE FROM app_sessions WHERE user_id = ?').bind(id).run();
      return Response.json({ ok: true, id });
    }

    if (action === 'resetPassword') {
      const passwordData = await hashPassword(String(body.password ?? ''));
      await env.DB.batch([
        env.DB.prepare(`
          UPDATE app_users
          SET password_hash = ?, password_salt = ?, password_iterations = ?, force_password_change = 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(passwordData.hash, passwordData.salt, passwordData.iterations, id),
        env.DB.prepare('DELETE FROM app_sessions WHERE user_id = ?').bind(id),
      ]);
      return Response.json({ ok: true, id });
    }

    if (action === 'acknowledgePasswordChange') {
      if (id !== auth.user.id) return Response.json({ error: 'You can only update your own password state.' }, { status: 403 });
      await env.DB.prepare('UPDATE app_users SET force_password_change = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(id).run();
      return Response.json({ ok: true, id });
    }

    return Response.json({ error: 'Unknown user action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'user_admin_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'User action failed.' }, { status: 400 });
  }
}
