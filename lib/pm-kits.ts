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
  updated_at?: string;
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

type FamilyRow = {
  id: string;
  name: string;
  pm_type: string;
  active: number;
};

type FamilyMemberRow = {
  family_id: string;
  pm_kit_id: string;
  sort_order: number;
  retired_at: string | null;
};

type ProfileRow = { sequence_json: string };
type PartRow = { id: number; part_number: string; description: string; quantity_on_hand: number };
type KitPartInput = { partId: number; quantity: number };
type YearRange = { from: number | null; to: number | null };
type Fitment = YearRange & { make: string | null; model: string | null; engine: string | null };

const MAX_FITMENT_COMBINATIONS = 200;

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

function parseStringList(value: unknown, label: string, maxLength: number) {
  if (value == null) return [] as string[];
  if (!Array.isArray(value)) throw new Error(`${label} selections are invalid.`);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value) {
    const item = text(raw, maxLength);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  if (result.length > 40) throw new Error(`Choose no more than 40 ${label.toLowerCase()} values for one PM kit.`);
  return result;
}

function parseYears(value: unknown) {
  if (value == null) return [] as number[];
  if (!Array.isArray(value)) throw new Error('Year selections are invalid.');
  const years = [...new Set(value.map((item) => optionalYear(item, 'Year')).filter((item): item is number => item != null))].sort((a, b) => a - b);
  if (years.length > 120) throw new Error('Choose no more than 120 years for one PM kit.');
  return years;
}

function compressYears(years: number[]): YearRange[] {
  if (!years.length) return [{ from: null, to: null }];
  const sorted = [...years].sort((a, b) => a - b);
  const ranges: YearRange[] = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (const year of sorted.slice(1)) {
    if (year === previous + 1) {
      previous = year;
      continue;
    }
    ranges.push({ from: start, to: previous });
    start = year;
    previous = year;
  }
  ranges.push({ from: start, to: previous });
  return ranges;
}

function expandFitments(years: number[], makes: string[], models: string[], engines: string[]): Fitment[] {
  const yearRanges = compressYears(years);
  const makeValues: Array<string | null> = makes.length ? makes : [null];
  const modelValues: Array<string | null> = models.length ? models : [null];
  const engineValues: Array<string | null> = engines.length ? engines : [null];
  const count = yearRanges.length * makeValues.length * modelValues.length * engineValues.length;
  if (count > MAX_FITMENT_COMBINATIONS) {
    throw new Error(`These selections create ${count} fitment combinations. Narrow them to ${MAX_FITMENT_COMBINATIONS} or fewer.`);
  }
  const fitments: Fitment[] = [];
  for (const range of yearRanges) {
    for (const make of makeValues) {
      for (const model of modelValues) {
        for (const engine of engineValues) {
          fitments.push({ from: range.from, to: range.to, make, model, engine });
        }
      }
    }
  }
  return fitments;
}

function uniqueText(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = text(raw, 160);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function expandedYears(rows: KitRow[]) {
  if (!rows.length || rows.some((row) => row.year_from == null && row.year_to == null)) return [] as number[];
  const years = new Set<number>();
  for (const row of rows) {
    if (row.year_from == null || row.year_to == null) return [];
    for (let year = row.year_from; year <= row.year_to && year <= 2100; year += 1) years.add(year);
  }
  return [...years].sort((a, b) => a - b);
}

function aggregatedValues(rows: KitRow[], key: 'make' | 'model' | 'engine') {
  if (!rows.length || rows.some((row) => !text(row[key], 160))) return [] as string[];
  return uniqueText(rows.map((row) => row[key]));
}

function legacyYears(row: KitRow) {
  if (row.year_from == null && row.year_to == null) return [] as number[];
  if (row.year_from != null && row.year_to != null) {
    const years: number[] = [];
    for (let year = row.year_from; year <= row.year_to && year <= 2100; year += 1) years.push(year);
    return years;
  }
  return [] as number[];
}

export async function getPmKitData(db: D1Database) {
  const [kits, kitParts, parts, trucks, pmTypes, families, familyMembers] = await Promise.all([
    db.prepare(`
      SELECT id, name, pm_type, year_from, year_to, make, model, engine, active, updated_at
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
    db.prepare(`
      SELECT id, name, pm_type, active
      FROM pm_kit_families
      ORDER BY active DESC, pm_type COLLATE NOCASE, name COLLATE NOCASE
    `).all<FamilyRow>(),
    db.prepare(`
      SELECT family_id, pm_kit_id, sort_order, retired_at
      FROM pm_kit_family_members
      ORDER BY family_id, sort_order, pm_kit_id
    `).all<FamilyMemberRow>(),
  ]);

  const kitById = new Map(kits.results.map((kit) => [kit.id, kit]));
  const partsByKit = new Map<string, KitPartRow[]>();
  for (const part of kitParts.results) {
    const list = partsByKit.get(part.pm_kit_id) ?? [];
    list.push(part);
    partsByKit.set(part.pm_kit_id, list);
  }

  const membersByFamily = new Map<string, FamilyMemberRow[]>();
  const mappedKitIds = new Set<string>();
  for (const member of familyMembers.results) {
    mappedKitIds.add(member.pm_kit_id);
    const list = membersByFamily.get(member.family_id) ?? [];
    list.push(member);
    membersByFamily.set(member.family_id, list);
  }

  const visibleKits: Array<Record<string, unknown>> = [];
  for (const family of families.results) {
    const currentRows = (membersByFamily.get(family.id) ?? [])
      .filter((member) => member.retired_at == null)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((member) => kitById.get(member.pm_kit_id))
      .filter((kit): kit is KitRow => Boolean(kit));
    if (!currentRows.length) continue;
    const template = currentRows[0];
    visibleKits.push({
      id: family.id,
      name: family.name,
      pmType: family.pm_type,
      years: expandedYears(currentRows),
      makes: aggregatedValues(currentRows, 'make'),
      models: aggregatedValues(currentRows, 'model'),
      engines: aggregatedValues(currentRows, 'engine'),
      yearFrom: null,
      yearTo: null,
      active: Boolean(family.active),
      fitmentCount: currentRows.length,
      parts: (partsByKit.get(template.id) ?? []).map((part) => ({
        partId: part.part_id,
        partNumber: part.part_number,
        description: part.description,
        quantity: Number(part.quantity),
      })),
    });
  }

  for (const kit of kits.results) {
    if (mappedKitIds.has(kit.id)) continue;
    visibleKits.push({
      id: kit.id,
      name: kit.name,
      pmType: kit.pm_type,
      years: legacyYears(kit),
      makes: text(kit.make) ? [text(kit.make)] : [],
      models: text(kit.model) ? [text(kit.model)] : [],
      engines: text(kit.engine) ? [text(kit.engine)] : [],
      yearFrom: kit.year_from == null ? null : Number(kit.year_from),
      yearTo: kit.year_to == null ? null : Number(kit.year_to),
      active: Boolean(kit.active),
      fitmentCount: 1,
      parts: (partsByKit.get(kit.id) ?? []).map((part) => ({
        partId: part.part_id,
        partNumber: part.part_number,
        description: part.description,
        quantity: Number(part.quantity),
      })),
    });
  }

  visibleKits.sort((left, right) => {
    const active = Number(Boolean(right.active)) - Number(Boolean(left.active));
    if (active) return active;
    const pm = String(left.pmType).localeCompare(String(right.pmType), undefined, { numeric: true, sensitivity: 'base' });
    if (pm) return pm;
    return String(left.name).localeCompare(String(right.name), undefined, { numeric: true, sensitivity: 'base' });
  });

  return {
    pmTypes,
    kits: visibleKits,
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
  const familyId = suppliedId || crypto.randomUUID();
  const name = text(body.name, 120);
  if (!name) throw new Error('PM kit name is required.');

  const requestedPmType = text(body.pmType, 40);
  const pmTypes = await activePmTypes(db);
  const pmType = pmTypes.find((type) => type.toLowerCase() === requestedPmType.toLowerCase());
  if (!pmType) throw new Error('Choose a PM type from the active PM profiles.');

  const years = parseYears(body.years);
  const makes = parseStringList(body.makes, 'Make', 100);
  const models = parseStringList(body.models, 'Model', 100);
  const engines = parseStringList(body.engines, 'Engine / motor', 160);
  const fitments = expandFitments(years, makes, models, engines);
  const parts = parseKitParts(body.parts);
  await validateParts(db, parts);

  const existingFamily = suppliedId
    ? await db.prepare('SELECT id, active FROM pm_kit_families WHERE id = ?').bind(familyId).first<{ id: string; active: number }>()
    : null;
  const legacyKit = suppliedId && !existingFamily
    ? await db.prepare(`
        SELECT id, active
        FROM pm_kits
        WHERE id = ?
          AND NOT EXISTS (SELECT 1 FROM pm_kit_family_members m WHERE m.pm_kit_id = pm_kits.id)
      `).bind(suppliedId).first<{ id: string; active: number }>()
    : null;
  if (suppliedId && !existingFamily && !legacyKit) throw new Error('PM kit was not found.');

  const active = existingFamily ? Number(existingFamily.active) : legacyKit ? Number(legacyKit.active) : 1;
  const statements: D1PreparedStatement[] = [];

  statements.push(db.prepare(`
    INSERT INTO pm_kit_families (id, name, pm_type, active)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      pm_type = excluded.pm_type,
      updated_at = CURRENT_TIMESTAMP
  `).bind(familyId, name, pmType, active));

  if (existingFamily) {
    statements.push(db.prepare(`
      UPDATE pm_kits
      SET active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id IN (
        SELECT pm_kit_id FROM pm_kit_family_members
        WHERE family_id = ? AND retired_at IS NULL
      )
    `).bind(familyId));
    statements.push(db.prepare(`
      UPDATE pm_kit_family_members
      SET retired_at = CURRENT_TIMESTAMP
      WHERE family_id = ? AND retired_at IS NULL
    `).bind(familyId));
  } else if (legacyKit) {
    statements.push(db.prepare('UPDATE pm_kits SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(legacyKit.id));
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO pm_kit_family_members (family_id, pm_kit_id, sort_order, retired_at)
      VALUES (?, ?, 0, CURRENT_TIMESTAMP)
    `).bind(familyId, legacyKit.id));
  }

  let templateKitId = '';
  fitments.forEach((fitment, index) => {
    const kitId = crypto.randomUUID();
    statements.push(db.prepare(`
      INSERT INTO pm_kits (id, name, pm_type, year_from, year_to, make, model, engine, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      kitId,
      name,
      pmType,
      fitment.from,
      fitment.to,
      fitment.make,
      fitment.model,
      fitment.engine,
      active,
    ));
    statements.push(db.prepare(`
      INSERT INTO pm_kit_family_members (family_id, pm_kit_id, sort_order, retired_at)
      VALUES (?, ?, ?, NULL)
    `).bind(familyId, kitId, index));

    if (index === 0) {
      templateKitId = kitId;
      parts.forEach((part, partIndex) => {
        statements.push(db.prepare(`
          INSERT INTO pm_kit_parts (pm_kit_id, part_id, quantity, sort_order)
          VALUES (?, ?, ?, ?)
        `).bind(kitId, part.partId, part.quantity, partIndex));
      });
    } else {
      statements.push(db.prepare(`
        INSERT INTO pm_kit_parts (pm_kit_id, part_id, quantity, sort_order)
        SELECT ?, part_id, quantity, sort_order
        FROM pm_kit_parts
        WHERE pm_kit_id = ?
        ORDER BY sort_order, id
      `).bind(kitId, templateKitId));
    }
  });

  await db.batch(statements);
  return { ok: true, id: familyId, created: !suppliedId, fitmentCount: fitments.length };
}

export async function setPmKitActive(db: D1Database, body: Record<string, unknown>) {
  const id = text(body.id, 80);
  if (!id) throw new Error('PM kit is required.');
  const active = body.active === false || body.active === 0 || body.active === '0' ? 0 : 1;
  const family = await db.prepare('SELECT id FROM pm_kit_families WHERE id = ?').bind(id).first<{ id: string }>();
  if (family) {
    await db.batch([
      db.prepare('UPDATE pm_kit_families SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(active, id),
      db.prepare(`
        UPDATE pm_kits
        SET active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id IN (
          SELECT pm_kit_id FROM pm_kit_family_members
          WHERE family_id = ? AND retired_at IS NULL
        )
      `).bind(active, id),
    ]);
    return { ok: true, id, active: Boolean(active) };
  }

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
