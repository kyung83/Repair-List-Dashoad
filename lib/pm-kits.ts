type KitRow = {
  id: string;
  name: string;
  pm_type: string;
  year_from: number | null;
  year_to: number | null;
  make: string | null;
  model: string | null;
  engine: string | null;
  active: number;
};

type KitPartRow = {
  pm_kit_id: string;
  part_id: number;
  part_number: string;
  description: string;
  quantity: number;
  sort_order: number;
};

type TruckRow = {
  id: number;
  unit: string;
  model_year: number | null;
  make: string | null;
  model: string | null;
  engine: string | null;
  equipment_type: string;
};

type ProfileRow = { sequence_json: string };
type PartRow = { id: number; part_number: string; description: string; quantity_on_hand: number };
type KitPartInput = { partId: number; quantity: number };

function text(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function optionalYear(value: unknown, label: string) {
  if (value == null || String(value).trim() === '') return null;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new Error(`${label} must be a valid year.`);
  return year;
}

function positiveQuantity(value: unknown) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000) throw new Error('PM kit part quantities must be greater than zero.');
  return Math.round(quantity * 100) / 100;
}

function sequenceValues(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => text(item, 40)).filter(Boolean);
  } catch {
    return [];
  }
}

async function activePmTypes(db: D1Database) {
  const profiles = await db.prepare('SELECT sequence_json FROM pm_profiles WHERE active = 1 ORDER BY id').all<ProfileRow>();
  const seen = new Set<string>();
  const values: string[] = [];
  for (const profile of profiles.results) {
    for (const type of sequenceValues(profile.sequence_json)) {
      const key = type.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        values.push(type);
      }
    }
  }
  return values;
}

function parseKitParts(value: unknown): KitPartInput[] {
  if (!Array.isArray(value)) throw new Error('Add at least one inventory part to the PM kit.');
  const merged = new Map<number, number>();
  for (const raw of value) {
    const item = raw as Record<string, unknown>;
    const partId = Number(item.partId ?? 0);
    if (!Number.isInteger(partId) || partId <= 0) throw new Error('Choose a valid inventory part.');
    const quantity = positiveQuantity(item.quantity);
    merged.set(partId, (merged.get(partId) ?? 0) + quantity);
  }
  const parts = [...merged.entries()].map(([partId, quantity]) => ({ partId, quantity: Math.round(quantity * 100) / 100 }));
  if (!parts.length) throw new Error('Add at least one inventory part to the PM kit.');
  if (parts.length > 100) throw new Error('A PM kit can contain at most 100 part lines.');
  return parts;
}

async function validateParts(db: D1Database, parts: KitPartInput[]) {
  const placeholders = parts.map(() => '?').join(',');
  const result = await db.prepare(`SELECT id FROM parts WHERE active = 1 AND id IN (${placeholders})`).bind(...parts.map((part) => part.partId)).all<{ id: number }>();
  if (result.results.length !== parts.length) throw new Error('One or more PM kit parts are no longer active in inventory.');
}

export async function getPmKitData(db: D1Database) {
  const [kits, kitParts, parts, trucks, pmTypes] = await Promise.all([
    db.prepare(`
      SELECT id, name, pm_type, year_from, year_to, make, model, engine, active
      FROM pm_kits
      ORDER BY active DESC, pm_type COLLATE NOCASE, name COLLATE NOCASE
    `).all<KitRow>(),
    db.prepare(`
      SELECT kp.pm_kit_id, kp.part_id, p.part_number, p.description, kp.quantity, kp.sort_order
      FROM pm_kit_parts kp
      JOIN parts p ON p.id = kp.part_id
      ORDER BY kp.pm_kit_id, kp.sort_order, p.part_number
    `).all<KitPartRow>(),
    db.prepare(`
      SELECT id, part_number, description, quantity_on_hand
      FROM parts
      WHERE active = 1
      ORDER BY description COLLATE NOCASE, part_number COLLATE NOCASE
    `).all<PartRow>(),
    db.prepare(`
      SELECT id, unit, model_year, make, model, engine, equipment_type
      FROM equipment
      WHERE active = 1
        AND lower(COALESCE(equipment_type,'')) IN ('truck','vehicle','glider','switcher')
      ORDER BY unit COLLATE NOCASE
    `).all<TruckRow>(),
    activePmTypes(db),
  ]);

  const partsByKit = new Map<string, KitPartRow[]>();
  for (const part of kitParts.results) {
    const list = partsByKit.get(part.pm_kit_id) ?? [];
    list.push(part);
    partsByKit.set(part.pm_kit_id, list);
  }

  return {
    pmTypes,
    kits: kits.results.map((kit) => ({
      id: kit.id,
      name: kit.name,
      pmType: kit.pm_type,
      yearFrom: kit.year_from == null ? null : Number(kit.year_from),
      yearTo: kit.year_to == null ? null : Number(kit.year_to),
      make: kit.make ?? '',
      model: kit.model ?? '',
      engine: kit.engine ?? '',
      active: Boolean(kit.active),
      parts: (partsByKit.get(kit.id) ?? []).map((part) => ({
        partId: part.part_id,
        partNumber: part.part_number,
        description: part.description,
        quantity: Number(part.quantity),
      })),
    })),
    parts: parts.results.map((part) => ({
      id: part.id,
      partNumber: part.part_number,
      description: part.description,
      quantityOnHand: Number(part.quantity_on_hand),
    })),
    trucks: trucks.results.map((truck) => ({
      id: truck.id,
      unit: truck.unit,
      modelYear: truck.model_year == null ? null : Number(truck.model_year),
      make: truck.make ?? '',
      model: truck.model ?? '',
      engine: truck.engine ?? '',
      equipmentType: truck.equipment_type,
    })),
    updatedAt: new Date().toISOString(),
  };
}

export async function savePmKit(db: D1Database, body: Record<string, unknown>) {
  const suppliedId = text(body.id, 80);
  const id = suppliedId || crypto.randomUUID();
  const name = text(body.name, 120);
  if (!name) throw new Error('PM kit name is required.');

  const requestedPmType = text(body.pmType, 40);
  const pmTypes = await activePmTypes(db);
  const pmType = pmTypes.find((type) => type.toLowerCase() === requestedPmType.toLowerCase());
  if (!pmType) throw new Error('Choose a PM type from the active PM profiles.');

  const yearFrom = optionalYear(body.yearFrom, 'Starting year');
  const yearTo = optionalYear(body.yearTo, 'Ending year');
  if (yearFrom != null && yearTo != null && yearFrom > yearTo) throw new Error('Starting year cannot be after ending year.');
  const make = text(body.make, 100);
  const model = text(body.model, 100);
  const engine = text(body.engine, 160);
  const parts = parseKitParts(body.parts);
  await validateParts(db, parts);

  if (suppliedId) {
    const existing = await db.prepare('SELECT id FROM pm_kits WHERE id = ?').bind(id).first<{ id: string }>();
    if (!existing) throw new Error('PM kit was not found.');
  }

  const kitStatement = suppliedId
    ? db.prepare(`
        UPDATE pm_kits
        SET name = ?, pm_type = ?, year_from = ?, year_to = ?, make = ?, model = ?, engine = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(name, pmType, yearFrom, yearTo, make || null, model || null, engine || null, id)
    : db.prepare(`
        INSERT INTO pm_kits (id, name, pm_type, year_from, year_to, make, model, engine, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).bind(id, name, pmType, yearFrom, yearTo, make || null, model || null, engine || null);

  const statements: D1PreparedStatement[] = [kitStatement, db.prepare('DELETE FROM pm_kit_parts WHERE pm_kit_id = ?').bind(id)];
  parts.forEach((part, index) => {
    statements.push(db.prepare(`
      INSERT INTO pm_kit_parts (pm_kit_id, part_id, quantity, sort_order)
      VALUES (?, ?, ?, ?)
    `).bind(id, part.partId, part.quantity, index));
  });
  await db.batch(statements);
  return { ok: true, id, created: !suppliedId };
}

export async function setPmKitActive(db: D1Database, body: Record<string, unknown>) {
  const id = text(body.id, 80);
  if (!id) throw new Error('PM kit is required.');
  const active = body.active === false || body.active === 0 || body.active === '0' ? 0 : 1;
  const result = await db.prepare('UPDATE pm_kits SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(active, id).run();
  if (!Number(result.meta.changes ?? 0)) throw new Error('PM kit was not found.');
  return { ok: true, id, active: Boolean(active) };
}

export async function applyMatchingPmKitToRepair(db: D1Database, repairId: number, equipmentId: number) {
  const equipment = await db.prepare(`
    SELECT e.id, e.unit, e.model_year, COALESCE(e.make,'') AS make, COALESCE(e.model,'') AS model,
           COALESCE(e.engine,'') AS engine, COALESCE(e.equipment_type,'') AS equipment_type,
           ps.pm_type, p.sequence_json
    FROM equipment e
    LEFT JOIN equipment_pm_settings s ON s.equipment_id = e.id
    LEFT JOIN pm_profiles p ON p.id = s.profile_id
    LEFT JOIN pm_status ps ON ps.equipment_id = e.id
    WHERE e.id = ? AND e.active = 1
  `).bind(equipmentId).first<{
    id: number; unit: string; model_year: number | null; make: string; model: string; engine: string;
    equipment_type: string; pm_type: string | null; sequence_json: string | null;
  }>();
  if (!equipment) return { applied: false, reason: 'equipment-not-found' } as const;
  if (!['truck','vehicle','glider','switcher'].includes(equipment.equipment_type.toLowerCase())) {
    return { applied: false, reason: 'not-truck' } as const;
  }
  const sequence = equipment.sequence_json ? sequenceValues(equipment.sequence_json) : [];
  const pmType = text(equipment.pm_type, 40) || sequence[0] || '';
  if (!pmType) return { applied: false, reason: 'pm-type-missing' } as const;

  const kit = await db.prepare(`
    SELECT id, name, pm_type, year_from, year_to, make, model, engine, active
    FROM pm_kits
    WHERE active = 1
      AND lower(trim(pm_type)) = lower(trim(?))
      AND (year_from IS NULL OR (? IS NOT NULL AND ? >= year_from))
      AND (year_to IS NULL OR (? IS NOT NULL AND ? <= year_to))
      AND (trim(COALESCE(make,'')) = '' OR lower(trim(make)) = lower(trim(?)))
      AND (trim(COALESCE(model,'')) = '' OR lower(trim(model)) = lower(trim(?)))
      AND (trim(COALESCE(engine,'')) = '' OR lower(trim(engine)) = lower(trim(?)))
    ORDER BY
      (CASE WHEN year_from IS NOT NULL OR year_to IS NOT NULL THEN 1 ELSE 0 END
       + CASE WHEN trim(COALESCE(make,'')) <> '' THEN 1 ELSE 0 END
       + CASE WHEN trim(COALESCE(model,'')) <> '' THEN 1 ELSE 0 END
       + CASE WHEN trim(COALESCE(engine,'')) <> '' THEN 1 ELSE 0 END) DESC,
      CASE WHEN year_from IS NOT NULL AND year_to IS NOT NULL THEN year_to - year_from ELSE 9999 END ASC,
      updated_at DESC,
      id DESC
    LIMIT 1
  `).bind(
    pmType,
    equipment.model_year, equipment.model_year,
    equipment.model_year, equipment.model_year,
    equipment.make, equipment.model, equipment.engine,
  ).first<KitRow>();
  if (!kit) return { applied: false, reason: 'no-match', pmType, unit: equipment.unit } as const;

  const parts = await db.prepare(`
    SELECT kp.part_id, kp.quantity, kp.sort_order, p.part_number, p.description
    FROM pm_kit_parts kp
    JOIN parts p ON p.id = kp.part_id AND p.active = 1
    WHERE kp.pm_kit_id = ?
    ORDER BY kp.sort_order, kp.id
  `).bind(kit.id).all<{ part_id: number; quantity: number; sort_order: number; part_number: string; description: string }>();

  const statements = parts.results.map((part) => db.prepare(`
    INSERT INTO repair_planned_parts (repair_id, part_id, pm_kit_id, quantity, used_quantity)
    VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(repair_id, part_id) DO NOTHING
  `).bind(repairId, part.part_id, kit.id, Number(part.quantity)));
  if (statements.length) await db.batch(statements);

  return {
    applied: true,
    kitId: kit.id,
    kitName: kit.name,
    pmType,
    unit: equipment.unit,
    partCount: parts.results.length,
    parts: parts.results.map((part) => ({ partId: part.part_id, partNumber: part.part_number, description: part.description, quantity: Number(part.quantity) })),
  } as const;
}
