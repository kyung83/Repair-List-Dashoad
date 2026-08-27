import { env } from 'cloudflare:workers';

const UNIT_TYPES = new Set(['truck', 'trailer']);
const RESULT_LIMIT = 24;

function text(value: string | null, max: number) {
  return String(value ?? '').trim().slice(0, max);
}

/**
 * PUBLIC and intentionally narrow. The driver form only needs active unit
 * numbers for the selected truck/trailer type. No driver, location, VIN,
 * maintenance, repair, or other fleet data is exposed here.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const unitType = text(url.searchParams.get('type'), 10).toLowerCase();
    const query = text(url.searchParams.get('q'), 24).toLowerCase();

    if (!UNIT_TYPES.has(unitType)) {
      return Response.json(
        { error: 'Pick Truck or Trailer first.' },
        { status: 400, headers: { 'cache-control': 'no-store' } },
      );
    }

    const like = `%${query.replace(/[\\%_]/g, '')}%`;
    const result = await env.DB.prepare(`
      SELECT unit, lower(COALESCE(equipment_type,'')) AS equipment_type
      FROM equipment
      WHERE active = 1
        AND lower(COALESCE(equipment_type,'')) = ?
        AND lower(trim(COALESCE(unit,''))) LIKE ?
        AND trim(COALESCE(unit,'')) <> ''
      ORDER BY unit COLLATE NOCASE
      LIMIT ?
    `).bind(unitType, like, RESULT_LIMIT + 1).all<{ unit: string; equipment_type: string }>();

    const rows = result.results.slice(0, RESULT_LIMIT).map((row) => ({
      unit: row.unit,
      equipmentType: row.equipment_type,
    }));

    return Response.json(
      { units: rows, hasMore: result.results.length > RESULT_LIMIT },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error(JSON.stringify({ event: 'public_equipment_search_failed', error: String(error) }));
    return Response.json(
      { error: 'Unit search is temporarily unavailable.' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
