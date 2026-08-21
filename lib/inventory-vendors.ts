import { cleanVendorDisplayName, normalizeVendorName } from './inventory-operation-rules.js';

type VendorInput = {
  id?: number | null;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  source?: string;
};

type VendorRow = { id:number; name:string; phone:string|null; email:string|null; notes:string|null };

export async function findInventoryVendorByNormalizedName(db:D1Database, rawName:string) {
  const normalized = normalizeVendorName(rawName);
  if (!normalized) return null;
  return db.prepare(`
    SELECT v.id,v.name,v.phone,v.email,v.notes
    FROM vendor_normalized_aliases a
    JOIN vendors v ON v.id = a.vendor_id
    WHERE a.normalized_alias = ? AND COALESCE(v.active,1) = 1
    LIMIT 1
  `).bind(normalized).first<VendorRow>();
}

export async function upsertInventoryVendor(db:D1Database, input:VendorInput) {
  const name = cleanVendorDisplayName(input.name);
  const normalized = normalizeVendorName(name);
  if (!name || !normalized) throw new Error('Vendor name is required');
  const phone = String(input.phone ?? '').trim();
  const email = String(input.email ?? '').trim();
  const notes = String(input.notes ?? '').trim();
  const source = String(input.source ?? 'manual').trim().slice(0,80) || 'manual';
  const requestedId = Number(input.id ?? 0);

  let vendor:VendorRow|null = null;
  if (Number.isInteger(requestedId) && requestedId > 0) {
    vendor = await db.prepare('SELECT id,name,phone,email,notes FROM vendors WHERE id = ?')
      .bind(requestedId).first<VendorRow>();
    if (!vendor) throw new Error('Vendor was not found');
  } else {
    vendor = await findInventoryVendorByNormalizedName(db,name);
  }

  if (vendor) {
    await db.batch([
      db.prepare(`
        UPDATE vendors
        SET name = ?,
            phone = CASE WHEN ? <> '' THEN ? ELSE phone END,
            email = CASE WHEN ? <> '' THEN ? ELSE email END,
            notes = CASE WHEN ? <> '' THEN ? ELSE notes END
        WHERE id = ?
      `).bind(name,phone,phone,email,email,notes,notes,vendor.id),
      db.prepare(`
        INSERT INTO vendor_normalized_aliases (normalized_alias,vendor_id,source,updated_at)
        VALUES (?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(normalized_alias) DO UPDATE SET
          vendor_id = excluded.vendor_id,
          source = excluded.source,
          updated_at = CURRENT_TIMESTAMP
      `).bind(normalized,vendor.id,source),
    ]);
    return { ok:true, id:vendor.id, normalizedName:normalized, matchedExisting:true };
  }

  const result = await db.prepare(`
    INSERT INTO vendors (name,phone,email,notes)
    VALUES (?,NULLIF(?,''),NULLIF(?,''),NULLIF(?,''))
  `).bind(name,phone,email,notes).run();
  const id = Number(result.meta.last_row_id ?? 0);
  if (!id) throw new Error('Vendor could not be created');
  try {
    await db.prepare(`
      INSERT INTO vendor_normalized_aliases (normalized_alias,vendor_id,source)
      VALUES (?,?,?)
    `).bind(normalized,id,source).run();
  } catch (error) {
    const existing = await findInventoryVendorByNormalizedName(db,name);
    if (existing && existing.id !== id) {
      await db.prepare('UPDATE vendors SET active = 0 WHERE id = ?').bind(id).run();
      return { ok:true, id:existing.id, normalizedName:normalized, matchedExisting:true };
    }
    throw error;
  }
  return { ok:true, id, normalizedName:normalized, matchedExisting:false };
}
