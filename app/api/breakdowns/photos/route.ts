import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

type BreakdownPhotoRow = {
  breakdown_id: number;
  object_key: string;
  file_name: string;
  content_type: string | null;
};

function photoUrl(objectKey: string) {
  return `/api/photos/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
}

export async function GET(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  if (user.role !== 'manager' && user.role !== 'admin') {
    return Response.json({ error: 'Manager or administrator access is required.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const openOnly = url.searchParams.get('open') === '1';
  const rows = await env.DB.prepare(`
    SELECT b.id AS breakdown_id, a.object_key, a.file_name, a.content_type
    FROM roadside_breakdowns b
    JOIN attachments a ON a.repair_id = b.repair_id
    WHERE a.object_key LIKE 'roadside-breakdowns/%'
      ${openOnly ? 'AND b.stage < 5' : ''}
    ORDER BY b.created_at DESC, a.id ASC
  `).all<BreakdownPhotoRow>();

  return Response.json({
    photos: rows.results.map((row) => ({
      breakdownId: Number(row.breakdown_id),
      objectKey: row.object_key,
      fileName: row.file_name,
      contentType: row.content_type || 'application/octet-stream',
      url: photoUrl(row.object_key),
    })),
  }, { headers: { 'cache-control': 'no-store' } });
}
