import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

function cleanIds(value: string) {
  return [...new Set(
    String(value || '')
      .replace(/^geotab-media:/i, '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  )];
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });

    const defectId = new URL(request.url).searchParams.get('defectId')?.trim() || '';
    if (!defectId) return Response.json({ error: 'Geotab defect ID is required.' }, { status: 400 });

    const row = await env.DB.prepare(`
      SELECT COALESCE(photos_url, '') AS photos_url
      FROM dvir_defects
      WHERE geotab_defect_id = ?
      LIMIT 1
    `).bind(defectId).first<{ photos_url: string }>();

    return Response.json(
      { ids: cleanIds(row?.photos_url || '') },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error(JSON.stringify({ event: 'geotab_photo_ids_failed', error: String(error) }));
    return Response.json({ error: 'Geotab photos could not be loaded.' }, { status: 400 });
  }
}
