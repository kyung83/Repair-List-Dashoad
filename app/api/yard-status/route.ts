import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { syncGeotabYardPresence } from '@/lib/geotab-yard';

type YardRow = {
  id: number;
  current_yard: string;
  current_yard_zone: string;
  geotab_latitude: number | null;
  geotab_longitude: number | null;
  geotab_position_at: string | null;
  yard_updated_at: string | null;
};

type SyncRow = {
  status: string;
  message: string;
  positions: number;
  clare: number;
  cadillac: number;
  outside: number;
  clare_zone_found: number;
  cadillac_zone_found: number;
  updated_at: string | null;
};

function yardKey(value: string): '' | 'clare' | 'cadillac' {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'clare' || normalized === 'cadillac' ? normalized : '';
}

async function session(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  return user;
}

export async function GET(request: Request) {
  try {
    await session(request);
    const [rows, sync] = await Promise.all([
      env.DB.prepare(`
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
      `).all<YardRow>(),
      env.DB.prepare(`
        SELECT status,message,positions,clare,cadillac,outside,clare_zone_found,cadillac_zone_found,updated_at
        FROM geotab_yard_sync_state WHERE id = 1
      `).first<SyncRow>(),
    ]);

    const byEquipment: Record<string, {
      currentYard: '' | 'clare' | 'cadillac';
      zoneName: string;
      latitude: number | null;
      longitude: number | null;
      positionAt: string;
      yardUpdatedAt: string;
    }> = {};

    for (const row of rows.results) {
      byEquipment[String(row.id)] = {
        currentYard: yardKey(row.current_yard),
        zoneName: row.current_yard_zone ?? '',
        latitude: row.geotab_latitude == null ? null : Number(row.geotab_latitude),
        longitude: row.geotab_longitude == null ? null : Number(row.geotab_longitude),
        positionAt: row.geotab_position_at ?? '',
        yardUpdatedAt: row.yard_updated_at ?? '',
      };
    }

    return Response.json({
      byEquipment,
      sync: sync ? {
        status: sync.status,
        message: sync.message,
        positions: Number(sync.positions ?? 0),
        clare: Number(sync.clare ?? 0),
        cadillac: Number(sync.cadillac ?? 0),
        outside: Number(sync.outside ?? 0),
        clareZoneFound: Boolean(sync.clare_zone_found),
        cadillacZoneFound: Boolean(sync.cadillac_zone_found),
        updatedAt: sync.updated_at ?? '',
      } : null,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'yard_status_get_failed', error: String(error) }));
    const message = error instanceof Error ? error.message : 'Yard status could not be loaded.';
    return Response.json({ error: message }, { status: message === 'Authentication required.' ? 401 : 400 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await session(request);
    if (user.role !== 'manager' && user.role !== 'admin') {
      return Response.json({ error: 'Manager or administrator access is required.' }, { status: 403 });
    }
    const result = await syncGeotabYardPresence(env);
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'yard_status_refresh_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Geotab yard refresh failed.' }, { status: 400 });
  }
}
