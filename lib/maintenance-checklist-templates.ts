import { checklistFor } from './maintenance-checklists';

export type ChecklistEventType = 'pm' | 'annual';

export type ChecklistTemplateItem = {
  position: number;
  section: string;
  text: string;
  enabled: boolean;
  allowPass: boolean;
  allowFail: boolean;
  allowNa: boolean;
  requireNotes: boolean;
  requirePhoto: boolean;
  requireMeasurement: boolean;
  measurementLabel: string;
  measurementUnit: string;
};

export type ChecklistTemplate = {
  id: number;
  eventType: ChecklistEventType;
  templateKey: string;
  name: string;
  version: number;
  active: boolean;
  createdAt: string;
  items: ChecklistTemplateItem[];
};

type TemplateRow = {
  id: number;
  event_type: ChecklistEventType;
  template_key: string;
  name: string;
  version: number;
  active: number;
  created_at: string;
};

type TemplateItemRow = {
  position: number;
  section: string;
  item_text: string;
  enabled: number;
  allow_pass: number;
  allow_fail: number;
  allow_na: number;
  require_notes: number;
  require_photo: number;
  require_measurement: number;
  measurement_label: string | null;
  measurement_unit: string | null;
};

type VersionRow = {
  id: number;
  name: string;
  version: number;
  active: number;
  created_at: string;
  item_count: number;
};

const DEFAULT_KEY = 'default';
const INSERT_BATCH = 70;

function builtInName(eventType: ChecklistEventType) {
  return eventType === 'annual' ? 'Annual Inspection Checklist' : 'Performance PM Checklist';
}

function builtInItems(eventType: ChecklistEventType): ChecklistTemplateItem[] {
  return checklistFor(eventType).map((item, index) => ({
    position: index + 1,
    section: item.section,
    text: item.text,
    enabled: true,
    allowPass: true,
    allowFail: true,
    allowNa: true,
    requireNotes: false,
    requirePhoto: false,
    requireMeasurement: false,
    measurementLabel: '',
    measurementUnit: '',
  }));
}

async function loadItems(db: D1Database, templateId: number) {
  const rows = await db.prepare(`
    SELECT position, section, item_text, enabled,
           allow_pass, allow_fail, allow_na,
           require_notes, require_photo, require_measurement,
           measurement_label, measurement_unit
    FROM maintenance_checklist_template_items
    WHERE template_id = ?
    ORDER BY position, id
  `).bind(templateId).all<TemplateItemRow>();
  return rows.results.map((row) => ({
    position: Number(row.position),
    section: row.section,
    text: row.item_text,
    enabled: Boolean(row.enabled),
    allowPass: Boolean(row.allow_pass),
    allowFail: Boolean(row.allow_fail),
    allowNa: Boolean(row.allow_na),
    requireNotes: Boolean(row.require_notes),
    requirePhoto: Boolean(row.require_photo),
    requireMeasurement: Boolean(row.require_measurement),
    measurementLabel: row.measurement_label ?? '',
    measurementUnit: row.measurement_unit ?? '',
  }));
}

async function seedItems(db: D1Database, templateId: number, items: ChecklistTemplateItem[]) {
  const statements = items.map((item, index) => db.prepare(`
    INSERT OR IGNORE INTO maintenance_checklist_template_items (
      template_id, position, section, item_text, enabled,
      allow_pass, allow_fail, allow_na,
      require_notes, require_photo, require_measurement,
      measurement_label, measurement_unit, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    templateId,
    index + 1,
    item.section,
    item.text,
    item.enabled ? 1 : 0,
    item.allowPass ? 1 : 0,
    item.allowFail ? 1 : 0,
    item.allowNa ? 1 : 0,
    item.requireNotes ? 1 : 0,
    item.requirePhoto ? 1 : 0,
    item.requireMeasurement ? 1 : 0,
    item.measurementLabel || null,
    item.measurementUnit || null,
  ));
  for (let index = 0; index < statements.length; index += INSERT_BATCH) {
    await db.batch(statements.slice(index, index + INSERT_BATCH));
  }
}

async function activeRow(db: D1Database, eventType: ChecklistEventType) {
  return db.prepare(`
    SELECT id, event_type, template_key, name, version, active, created_at
    FROM maintenance_checklist_templates
    WHERE event_type = ? AND template_key = ? AND active = 1
    ORDER BY version DESC
    LIMIT 1
  `).bind(eventType, DEFAULT_KEY).first<TemplateRow>();
}

async function rowToTemplate(db: D1Database, row: TemplateRow): Promise<ChecklistTemplate> {
  return {
    id: Number(row.id),
    eventType: row.event_type,
    templateKey: row.template_key,
    name: row.name,
    version: Number(row.version),
    active: Boolean(row.active),
    createdAt: row.created_at,
    items: await loadItems(db, Number(row.id)),
  };
}

export async function ensureDefaultChecklistTemplate(db: D1Database, eventType: ChecklistEventType) {
  let row = await activeRow(db, eventType);
  if (row) {
    const items = await loadItems(db, Number(row.id));
    if (items.length) return { ...await rowToTemplate(db, row), items };
    await seedItems(db, Number(row.id), builtInItems(eventType));
    return rowToTemplate(db, row);
  }

  const max = await db.prepare(`
    SELECT COALESCE(MAX(version), 0) AS version
    FROM maintenance_checklist_templates
    WHERE event_type = ? AND template_key = ?
  `).bind(eventType, DEFAULT_KEY).first<{ version: number }>();
  const version = Math.max(1, Number(max?.version ?? 0) + 1);

  await db.prepare(`
    INSERT OR IGNORE INTO maintenance_checklist_templates (
      event_type, template_key, name, version, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(eventType, DEFAULT_KEY, builtInName(eventType), version).run();

  row = await activeRow(db, eventType);
  if (!row) throw new Error('The checklist template could not be initialized.');
  const currentItems = await loadItems(db, Number(row.id));
  if (!currentItems.length) await seedItems(db, Number(row.id), builtInItems(eventType));
  return rowToTemplate(db, row);
}

export async function getActiveChecklistTemplate(db: D1Database, eventType: ChecklistEventType) {
  return ensureDefaultChecklistTemplate(db, eventType);
}

export async function listChecklistTemplateVersions(db: D1Database, eventType: ChecklistEventType) {
  const rows = await db.prepare(`
    SELECT t.id, t.name, t.version, t.active, t.created_at,
           SUM(CASE WHEN i.enabled = 1 THEN 1 ELSE 0 END) AS item_count
    FROM maintenance_checklist_templates t
    LEFT JOIN maintenance_checklist_template_items i ON i.template_id = t.id
    WHERE t.event_type = ? AND t.template_key = ?
    GROUP BY t.id, t.name, t.version, t.active, t.created_at
    ORDER BY t.version DESC
  `).bind(eventType, DEFAULT_KEY).all<VersionRow>();
  return rows.results.map((row) => ({
    id: Number(row.id),
    name: row.name,
    version: Number(row.version),
    active: Boolean(row.active),
    createdAt: row.created_at,
    itemCount: Number(row.item_count ?? 0),
  }));
}

export async function publishChecklistTemplate(
  db: D1Database,
  eventType: ChecklistEventType,
  name: string,
  items: ChecklistTemplateItem[],
  userId: number,
) {
  const max = await db.prepare(`
    SELECT COALESCE(MAX(version), 0) AS version
    FROM maintenance_checklist_templates
    WHERE event_type = ? AND template_key = ?
  `).bind(eventType, DEFAULT_KEY).first<{ version: number }>();
  const version = Number(max?.version ?? 0) + 1;

  await db.prepare(`
    INSERT INTO maintenance_checklist_templates (
      event_type, template_key, name, version, active, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(eventType, DEFAULT_KEY, name, version, userId).run();

  const row = await db.prepare(`
    SELECT id, event_type, template_key, name, version, active, created_at
    FROM maintenance_checklist_templates
    WHERE event_type = ? AND template_key = ? AND version = ?
    LIMIT 1
  `).bind(eventType, DEFAULT_KEY, version).first<TemplateRow>();
  if (!row) throw new Error('The new checklist version could not be created.');

  await seedItems(db, Number(row.id), items);
  await db.batch([
    db.prepare(`
      UPDATE maintenance_checklist_templates
      SET active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE event_type = ? AND template_key = ? AND active = 1
    `).bind(eventType, DEFAULT_KEY),
    db.prepare(`
      UPDATE maintenance_checklist_templates
      SET active = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(row.id),
  ]);

  const active = await activeRow(db, eventType);
  if (!active) throw new Error('The new checklist version could not be activated.');
  return rowToTemplate(db, active);
}
