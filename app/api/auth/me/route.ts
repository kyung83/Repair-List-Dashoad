import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

export async function GET(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return Response.json({ error: 'Not signed in.' }, { status: 401 });
  const assigned = await env.DB.prepare(`
    SELECT COALESCE(u.yard,'') AS yard, COALESCE(w.code,'') AS warehouse_code
    FROM app_users u LEFT JOIN warehouses w ON w.id=u.parts_warehouse_id AND w.active=1
    WHERE u.id=?
  `).bind(user.id).first<{yard:string;warehouse_code:string}>();
  const publicUser = {
    ...(user.dispatchAccess ? { ...user, role:'dispatch' as const } : user),
    yard: assigned?.yard ?? '',
    assignedWarehouseCode: assigned?.warehouse_code ?? '',
  };
  return Response.json({ user: publicUser }, { headers: { 'cache-control': 'no-store' } });
}
