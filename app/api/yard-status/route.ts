import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

type YardRow = {
  id: number;
  current_yard: string;
  current_yard_zone: string;
  geotab_latitude: number | null;
  geotab_longitude: number | null;
  geotab_position_at: string | null;
  yard_updated_at: string | null;
};

function yardKey(value: string): '' | 'clare' | 'cadillac' {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'clare' || normalized === 'cadillac' ? normalized : '';
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });

    const rows = await env.DB.prepare(`
      SELECT id,
             COALESCE(current_yard, '') AS current_yard,
             COALESCE(current_yard_zone, '') AS current_yard_zone,
             geotab_latitude,
             geotab_longitude,
             geotab_position_at,
             yard_updated_at
      FROM equipment
      WHERE active = 1
      ORDER BY id
    `).all<YardRow>();

    const byEquipment: Record<string, {
      currentYard: '' | 'clare' | 'cadillac';
      zoneName: string;
      latitude: number | null;
      longitude: number | null;
      positionAt: string;
      yardUpdatedAt: string;
    }> = {};
    let updatedAt = '';

    for (const row of rows.results) {
      const yardUpdatedAt = row.yard_updated_at ?? '';
      if (yardUpdatedAt > updatedAt) updatedAt = yardUpdatedAt;
      byEquipment[String(row.id)] = {
        currentYard: yardKey(row.current_yard),
        zoneName: row.current_yard_zone ?? '',
        latitude: row.geotab_latitude == null ? null : Number(row.geotab_latitude),
        longitude: row.geotab_longitude == null ? null : Number(row.geotab_longitude),
        positionAt: row.geotab_position_at ?? '',
        yardUpdatedAt,
      };
    }

    return Response.json({ byEquipment, updatedAt }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'yard_status_get_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Yard status could not be loaded.' }, { status: 400 });
  }
}
