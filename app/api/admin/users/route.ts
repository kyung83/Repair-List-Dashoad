import { env } from 'cloudflare:workers';
import { getSessionUser, hashPassword, isAppRole, normalizeUsername, validUsername } from '@/lib/auth';

async function requireAdmin(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return { user: null, response: Response.json({ error: 'Not signed in.' }, { status: 401 }) };
  if (user.role !== 'admin') return { user: null, response: Response.json({ error: 'Administrator access is required.' }, { status: 403 }) };
  return { user, response: null };
}

async function ensureTechnicianAvailable(technicianId: number, ownerUserId: number | null) {
  const linked = ownerUserId
    ? await env.DB.prepare(`
        SELECT id, display_name FROM app_users
        WHERE technician_id = ? AND active = 1 AND id <> ?
        ORDER BY id LIMIT 1
      `).bind(technicianId, ownerUserId).first<{ id:number; display_name:string }>()
    : await env.DB.prepare(`
        SELECT id, display_name FROM app_users
        WHERE technician_id = ? AND active = 1
        ORDER BY id LIMIT 1
      `).bind(technicianId).first<{ id:number; display_name:string }>();
  if (linked) throw new Error(`That technician identity is already linked to ${linked.display_name}. Disable or unlink that account first.`);
}

async function ensureTechnician(displayName: string, currentId: number | null = null, ownerUserId: number | null = null) {
  if (currentId) {
    const current = await env.DB.prepare('SELECT id FROM technicians WHERE id = ? AND active = 1').bind(currentId).first<{ id: number }>();
    if (current) {
      await ensureTechnicianAvailable(currentId, ownerUserId);
      await env.DB.prepare('UPDATE technicians SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(displayName, currentId).run();
      return currentId;
    }
  }
  const existing = await env.DB.prepare(`
    SELECT id FROM technicians WHERE lower(trim(name)) = lower(trim(?)) AND active = 1 ORDER BY id LIMIT 1
  `).bind(displayName).first<{ id: number }>();
  if (existing) {
    const technicianId = Number(existing.id);
    await ensureTechnicianAvailable(technicianId, ownerUserId);
    return technicianId;
  }
  const result = await env.DB.prepare('INSERT INTO technicians (name, email, phone, active) VALUES (?, ?, ?, 1)')
    .bind(displayName, '', '').run();
  return Number(result.meta.last_row_id);
}

function shouldLinkTechnician(role: unknown, worksOnRepairs: boolean) {
  return role === 'mechanic' || ((role === 'manager' || role === 'admin') && worksOnRepairs);
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.response) return auth.response;
  const result = await env.DB.prepare(`
    SELECT id, username, email, display_name, role, active, technician_id, last_login_at, created_at, updated_at
    FROM app_users
    ORDER BY active DESC, display_name COLLATE NOCASE, username COLLATE NOCASE
  `).all<{
    id:number; username:string|null; email:string; display_name:string; role:string; active:number;
    technician_id:number|null; last_login_at:string|null; created_at:string; updated_at:string;
  }>();
  return Response.json({ users: result.results.map((row) => ({
    id:Number(row.id), username:row.username ?? '', displayName:row.display_name, role:row.role,
    active:Boolean(row.active), technicianId:row.technician_id === null ? null : Number(row.technician_id),
    worksOnRepairs:row.technician_id !== null,
    lastLoginAt:row.last_login_at, createdAt:row.created_at, updatedAt:row.updated_at,
    legacyEmail: row.email.endsWith('@local.norlow') ? '' : row.email,
  })) }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response || !auth.user) return auth.response!;
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? 'create');

    if (action === 'create') {
      const username = normalizeUsername(body.username);
      const displayName = String(body.displayName ?? '').trim();
      const role = body.role;
      const password = String(body.password ?? '');
      if (!validUsername(username)) throw new Error('Username must be 3-32 characters using letters, numbers, dot, dash, or underscore.');
      if (!displayName) throw new Error('Display name is required.');
      if (!isAppRole(role)) throw new Error('A valid clearance level is required.');
      const duplicate = await env.DB.prepare('SELECT id FROM app_users WHERE username = ? COLLATE NOCASE').bind(username).first<{ id: number }>();
      if (duplicate) throw new Error('That username is already in use.');
      const worksOnRepairs = shouldLinkTechnician(role, Boolean(body.worksOnRepairs));
      const technicianId = worksOnRepairs ? await ensureTechnician(displayName) : null;
      const passwordData = await hashPassword(password);
      const internalEmail = `${username}@local.norlow`;
      const result = await env.DB.prepare(`
        INSERT INTO app_users (
          username, email, display_name, role, technician_id, password_hash, password_salt,
          password_iterations, password_algorithm, active, force_password_change
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
      `).bind(username, internalEmail, displayName, role, technicianId, passwordData.hash, passwordData.salt, passwordData.iterations, passwordData.algorithm).run();
      return Response.json({ ok:true, id:Number(result.meta.last_row_id), username, technicianId, worksOnRepairs });
    }

    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error('User could not be resolved.');

    if (action === 'update') {
      const username = normalizeUsername(body.username);
      const displayName = String(body.displayName ?? '').trim();
      const role = body.role;
      const active = Boolean(body.active);
      if (!validUsername(username)) throw new Error('Username must be 3-32 characters using letters, numbers, dot, dash, or underscore.');
      if (!displayName) throw new Error('Display name is required.');
      if (!isAppRole(role)) throw new Error('A valid clearance level is required.');
      const current = await env.DB.prepare('SELECT role, active, technician_id FROM app_users WHERE id = ?').bind(id)
        .first<{ role:string; active:number; technician_id:number|null }>();
      if (!current) throw new Error('User not found.');
      const duplicate = await env.DB.prepare('SELECT id FROM app_users WHERE username = ? COLLATE NOCASE AND id <> ?').bind(username, id).first<{ id:number }>();
      if (duplicate) throw new Error('That username is already in use.');
      const removesActiveAdmin = current.role === 'admin' && Boolean(current.active) && (role !== 'admin' || !active);
      if (removesActiveAdmin) {
        const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM app_users WHERE role = 'admin' AND active = 1").first<{ count:number }>();
        if (Number(count?.count ?? 0) <= 1) throw new Error('At least one active administrator is required.');
      }
      if (id === auth.user.id && !active) throw new Error('You cannot disable your own account.');
      const explicitWorkingChoice = Object.prototype.hasOwnProperty.call(body,'worksOnRepairs')
        ? Boolean(body.worksOnRepairs)
        : current.technician_id !== null;
      const worksOnRepairs = shouldLinkTechnician(role, explicitWorkingChoice);
      const technicianId = worksOnRepairs ? await ensureTechnician(displayName, current.technician_id, id) : null;
      await env.DB.prepare(`
        UPDATE app_users SET username = ?, display_name = ?, role = ?, technician_id = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).bind(username, displayName, role, technicianId, active ? 1 : 0, id).run();
      if (!active) await env.DB.prepare('DELETE FROM app_sessions WHERE user_id = ?').bind(id).run();
      return Response.json({ ok:true, id, username, technicianId, worksOnRepairs });
    }

    if (action === 'resetPassword') {
      const passwordData = await hashPassword(String(body.password ?? ''));
      await env.DB.batch([
        env.DB.prepare(`UPDATE app_users SET password_hash=?,password_salt=?,password_iterations=?,password_algorithm=?,force_password_change=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(passwordData.hash,passwordData.salt,passwordData.iterations,passwordData.algorithm,id),
        env.DB.prepare('DELETE FROM app_sessions WHERE user_id = ?').bind(id),
      ]);
      return Response.json({ ok:true, id });
    }
    return Response.json({ error:'Unknown user action.' }, { status:400 });
  } catch (error) {
    console.error(JSON.stringify({ event:'user_admin_failed', error:String(error) }));
    return Response.json({ error:error instanceof Error ? error.message : 'User action failed.' }, { status:400 });
  }
}
