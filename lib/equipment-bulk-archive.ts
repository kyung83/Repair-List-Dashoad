const MAX_BULK_ARCHIVE = 2000;

function text(value: unknown, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function equipmentIds(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Choose at least one equipment record to archive.');
  const ids = [...new Set(value.map((item) => Number(item)).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) throw new Error('Choose at least one equipment record to archive.');
  if (ids.length > MAX_BULK_ARCHIVE) throw new Error(`Bulk archive is limited to ${MAX_BULK_ARCHIVE} equipment records at a time.`);
  return ids;
}

export async function bulkArchiveEquipmentMasterItems(db: D1Database, body: Record<string, unknown>) {
  const ids = equipmentIds(body.ids);
  const reason = text(body.reason);
  let archived = 0;

  // Validate every chunk BEFORE archiving any equipment. Bulk cleanup must
  // never sidestep a For Sale / parked truck's manager-controlled lifecycle.
  for (let index = 0; index < ids.length; index += 75) {
    const chunk = ids.slice(index, index + 75);
    const placeholders = chunk.map(() => '?').join(',');
    const blocked = await db.prepare(`
      SELECT e.unit FROM fleet_truck_sales s
      JOIN equipment e ON e.id=s.equipment_id
      WHERE s.equipment_id IN (${placeholders})
        AND (s.sale_status IN ('for_sale','off_road')
          OR (s.off_road_at IS NOT NULL AND s.returned_to_road_at IS NULL))
      LIMIT 1
    `).bind(...chunk).first<{unit:string}>();
    if(blocked)throw new Error('Truck '+blocked.unit+' has an active sale or Off Road hold. Finish or cancel it in Truck Assignments before bulk archive.');
  }

  for (let index = 0; index < ids.length; index += 75) {
    const chunk = ids.slice(index, index + 75);
    const placeholders = chunk.map(() => '?').join(',');
    const results = await db.batch([
      db.prepare(`
        UPDATE equipment
        SET active = 0,
            archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
            archive_reason = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id IN (${placeholders})
          AND active = 1
          AND archived_at IS NULL
      `).bind(reason || null, ...chunk),
      db.prepare(`
        UPDATE equipment_geotab_devices
        SET current = 0,
            ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP),
            last_seen_at = CURRENT_TIMESTAMP
        WHERE equipment_id IN (${placeholders})
          AND current = 1
      `).bind(...chunk),
    ]);
    archived += Number(results[0]?.meta?.changes ?? 0);
  }

  return {
    ok: true,
    requested: ids.length,
    archived,
    skipped: Math.max(0, ids.length - archived),
  };
}
