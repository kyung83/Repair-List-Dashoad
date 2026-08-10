import { env } from 'cloudflare:workers';

type LinkRow = { part_id: number; vendor_id: number; vendor_name: string; preferred_vendor_id: number | null };

function idList(value: unknown) {
  if (!Array.isArray(value)) return [] as number[];
  return [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

export async function GET() {
  try {
    const rows = await env.DB.prepare(`
      SELECT pv.part_id, pv.vendor_id, v.name AS vendor_name, p.preferred_vendor_id
      FROM part_vendors pv
      JOIN vendors v ON v.id = pv.vendor_id
      JOIN parts p ON p.id = pv.part_id
      WHERE p.active = 1 AND COALESCE(v.active, 1) = 1
      ORDER BY pv.part_id, CASE WHEN pv.vendor_id = p.preferred_vendor_id THEN 0 ELSE 1 END, v.name
    `).all<LinkRow>();
    const byPart: Record<string, Array<{ id: number; name: string; preferred: boolean }>> = {};
    for (const row of rows.results) {
      const key = String(row.part_id);
      (byPart[key] ??= []).push({ id: Number(row.vendor_id), name: row.vendor_name, preferred: Number(row.vendor_id) === Number(row.preferred_vendor_id) });
    }
    return Response.json({ byPart }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'part_vendors_get_failed', error: String(error) }));
    return Response.json({ error: 'Part vendors could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const partId = Number(body.partId);
    if (!Number.isInteger(partId) || partId <= 0) throw new Error('Part is required.');
    const vendorIds = idList(body.vendorIds);
    let preferredVendorId = Number(body.preferredVendorId);
    if (!Number.isInteger(preferredVendorId) || preferredVendorId <= 0) preferredVendorId = 0;
    if (preferredVendorId && !vendorIds.includes(preferredVendorId)) vendorIds.unshift(preferredVendorId);

    if (vendorIds.length) {
      const placeholders = vendorIds.map(() => '?').join(',');
      const valid = await env.DB.prepare(`SELECT id FROM vendors WHERE COALESCE(active, 1) = 1 AND id IN (${placeholders})`).bind(...vendorIds).all<{ id: number }>();
      const validSet = new Set(valid.results.map((row) => Number(row.id)));
      if (vendorIds.some((id) => !validSet.has(id))) throw new Error('One or more vendors are not active.');
    }

    const statements: D1PreparedStatement[] = [
      env.DB.prepare('DELETE FROM part_vendors WHERE part_id = ?').bind(partId),
    ];
    for (const vendorId of vendorIds) {
      statements.push(env.DB.prepare('INSERT INTO part_vendors (part_id, vendor_id) VALUES (?, ?)').bind(partId, vendorId));
    }
    statements.push(env.DB.prepare('UPDATE parts SET preferred_vendor_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(preferredVendorId || null, partId));
    await env.DB.batch(statements);
    return Response.json({ ok: true, partId, vendorIds, preferredVendorId: preferredVendorId || null });
  } catch (error) {
    console.error(JSON.stringify({ event: 'part_vendors_post_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Part vendors could not be saved.' }, { status: 400 });
  }
}
