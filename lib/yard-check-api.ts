import { getMaintenanceBoardItems } from './maintenance-board';
import { syncCustomMaintenanceRepairs } from './custom-maintenance-repairs';
import { normalizeYard, yardLabel, type YardSelection } from './yards';

type KeyRow = {
  id:number;
  label:string;
  token_prefix:string;
  created_at:string;
  last_used_at:string|null;
  revoked_at:string|null;
};

type EquipmentYardRow = {
  id:number;
  unit:string;
  equipment_type:string;
  location:string;
  out_of_service:number;
  yard:string|null;
};

type RepairRow = {
  id:number;
  equipment_id:number|null;
  unit:string;
  equipment_type:string;
  location:string;
  title:string;
  status:string;
  source:string;
  geotab_defect_id:string|null;
  technician_name:string;
  out_of_service:number;
  timer_started_at:string|null;
};

type DvirRow = {
  geotab_defect_id:string;
  asset_unit:string;
  defect:string;
  equipment_id:number|null;
  equipment_type:string;
  location:string;
  out_of_service:number;
};

export type YardCheckExportItem = {
  id:string;
  unit:string;
  equipmentId:number|null;
  equipmentType:string;
  yardKey:YardSelection;
  yard:string;
  repairType:'Repair'|'DVIR'|'PM'|'Annual'|'Custom Maintenance';
  issue:string;
  status:string;
  assignedTo:string;
  outOfService:boolean;
  workingNow:boolean;
};

function bytesToHex(bytes:Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value:string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function randomHex(bytes = 24) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return bytesToHex(buffer);
}

export async function createYardCheckApiKey(db:D1Database, labelValue:string, createdByUserId:number) {
  const label = String(labelValue ?? '').trim().slice(0, 80);
  if (!label) throw new Error('Enter a name for this Yard Check connection.');
  const token = `nl_yard_${randomHex(24)}`;
  const tokenHash = await sha256Hex(token);
  const tokenPrefix = `${token.slice(0, 16)}…`;
  const result = await db.prepare(`
    INSERT INTO yard_check_api_keys (label, token_hash, token_prefix, created_by_user_id)
    VALUES (?, ?, ?, ?)
  `).bind(label, tokenHash, tokenPrefix, createdByUserId).run();
  return {
    id:Number(result.meta.last_row_id ?? 0),
    label,
    token,
    tokenPrefix,
  };
}

export async function listYardCheckApiKeys(db:D1Database) {
  const result = await db.prepare(`
    SELECT id, label, token_prefix, created_at, last_used_at, revoked_at
    FROM yard_check_api_keys
    ORDER BY CASE WHEN revoked_at IS NULL THEN 0 ELSE 1 END, id DESC
  `).all<KeyRow>();
  return result.results.map((row) => ({
    id:Number(row.id),
    label:row.label,
    tokenPrefix:row.token_prefix,
    createdAt:row.created_at,
    lastUsedAt:row.last_used_at,
    revokedAt:row.revoked_at,
    active:!row.revoked_at,
  }));
}

export async function revokeYardCheckApiKey(db:D1Database, idValue:unknown) {
  const id = Number(idValue ?? 0);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Yard Check API key was not found.');
  const result = await db.prepare(`
    UPDATE yard_check_api_keys
    SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
    WHERE id = ?
  `).bind(id).run();
  if (Number(result.meta.changes ?? 0) === 0) throw new Error('Yard Check API key was not found.');
  return { ok:true as const, id };
}

function requestToken(request:Request) {
  const direct = String(request.headers.get('x-northern-yard-key') ?? '').trim();
  if (direct) return direct;
  const authorization = String(request.headers.get('authorization') ?? '').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

export async function authenticateYardCheckApiRequest(db:D1Database, request:Request) {
  const token = requestToken(request);
  if (!token || token.length > 160) return null;
  const tokenHash = await sha256Hex(token);
  const row = await db.prepare(`
    SELECT id, label, token_prefix, created_at, last_used_at, revoked_at
    FROM yard_check_api_keys
    WHERE token_hash = ? AND revoked_at IS NULL
    LIMIT 1
  `).bind(tokenHash).first<KeyRow>();
  if (!row) return null;
  await db.prepare(`
    UPDATE yard_check_api_keys
    SET last_used_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND (last_used_at IS NULL OR last_used_at < datetime('now','-5 minutes'))
  `).bind(row.id).run();
  return { id:Number(row.id), label:row.label, tokenPrefix:row.token_prefix };
}

function deferred(status:unknown) {
  return String(status ?? '').trim().toLowerCase().startsWith('deferred to next');
}

function outsideRepair(status:unknown) {
  return String(status ?? '').trim().toLowerCase().startsWith('outside - waiting on');
}

function repairType(row:Pick<RepairRow,'source'|'geotab_defect_id'>):YardCheckExportItem['repairType'] {
  if (row.source === 'scheduled-pm') return 'PM';
  if (row.source === 'scheduled-annual') return 'Annual';
  if (row.source === 'custom-maintenance') return 'Custom Maintenance';
  if (row.geotab_defect_id) return 'DVIR';
  return 'Repair';
}

function yardFor(equipment:EquipmentYardRow|undefined, fallbackLocation='') {
  const yardKey = normalizeYard(equipment?.yard ?? '') || normalizeYard(fallbackLocation);
  const label = yardLabel(yardKey);
  return {
    yardKey,
    yard:label || String(fallbackLocation || equipment?.location || '').trim() || 'Outside / Unknown',
  };
}

function maintenanceEquipmentId(id:string) {
  const match = id.match(/^(?:pm|annual)-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function unique(values:string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export async function getYardCheckRepairBoardData(db:D1Database) {
  // This is the same harmless materialization the authenticated Repair Board does:
  // due custom maintenance becomes an open repair, but the API itself exposes no write actions.
  await syncCustomMaintenanceRepairs(db);

  const [equipmentResult, repairsResult, dvirResult, maintenanceItems] = await Promise.all([
    db.prepare(`
      SELECT e.id, e.unit, COALESCE(e.equipment_type,'other') AS equipment_type,
             COALESCE(e.location,'') AS location, COALESCE(e.out_of_service,0) AS out_of_service,
             s.yard
      FROM equipment e
      LEFT JOIN equipment_geotab_devices d ON d.equipment_id = e.id AND d.current = 1
      LEFT JOIN geotab_unit_state s ON s.equipment_id = e.id AND s.geotab_device_id = d.geotab_device_id
      WHERE e.active = 1 AND e.archived_at IS NULL AND e.merged_into_equipment_id IS NULL
      ORDER BY e.unit COLLATE NOCASE
    `).all<EquipmentYardRow>(),
    db.prepare(`
      SELECT r.id, r.equipment_id, COALESCE(e.unit,'') AS unit,
             COALESCE(e.equipment_type,'other') AS equipment_type,
             COALESCE(NULLIF(r.location,''), NULLIF(e.location,''), '') AS location,
             COALESCE(r.title,'') AS title, COALESCE(r.status,'New') AS status,
             COALESCE(r.source,'manual') AS source, r.geotab_defect_id,
             COALESCE(t.name,'') AS technician_name,
             COALESCE(e.out_of_service,0) AS out_of_service,
             rt.started_at AS timer_started_at
      FROM repairs r
      LEFT JOIN equipment e ON e.id = r.equipment_id
      LEFT JOIN technicians t ON t.id = r.technician_id
      LEFT JOIN repair_labor_timers rt ON rt.repair_id = r.id
      WHERE lower(COALESCE(r.status,'')) NOT LIKE '%complete%'
        AND COALESCE(r.source,'') <> 'roadside-breakdown'
      ORDER BY COALESCE(e.unit,''), r.id DESC
    `).all<RepairRow>(),
    db.prepare(`
      SELECT d.geotab_defect_id, d.asset_unit, d.defect,
             e.id AS equipment_id, COALESCE(e.equipment_type,'other') AS equipment_type,
             COALESCE(e.location,'') AS location, COALESCE(e.out_of_service,0) AS out_of_service
      FROM dvir_defects d
      LEFT JOIN equipment e
        ON lower(trim(e.unit)) = lower(trim(d.asset_unit))
       AND e.active = 1 AND e.archived_at IS NULL AND e.merged_into_equipment_id IS NULL
      WHERE d.repaired = 0
        AND NOT EXISTS (SELECT 1 FROM repairs r WHERE r.geotab_defect_id = d.geotab_defect_id)
      ORDER BY d.asset_unit, d.updated_at DESC
    `).all<DvirRow>(),
    getMaintenanceBoardItems(db),
  ]);

  const equipmentById = new Map(equipmentResult.results.map((row) => [Number(row.id), row]));
  const activeMaintenance = new Set<string>();
  const items:YardCheckExportItem[] = [];

  for (const row of repairsResult.results) {
    if (deferred(row.status) || outsideRepair(row.status)) continue;
    if (row.source === 'scheduled-pm' && row.equipment_id) activeMaintenance.add(`pm-${row.equipment_id}`);
    if (row.source === 'scheduled-annual' && row.equipment_id) activeMaintenance.add(`annual-${row.equipment_id}`);
    const equipment = row.equipment_id ? equipmentById.get(Number(row.equipment_id)) : undefined;
    const yard = yardFor(equipment, row.location);
    items.push({
      id:`repair-${row.id}`,
      unit:row.unit,
      equipmentId:row.equipment_id === null ? null : Number(row.equipment_id),
      equipmentType:row.equipment_type,
      yardKey:yard.yardKey,
      yard:yard.yard,
      repairType:repairType(row),
      issue:row.title,
      status:row.status,
      assignedTo:row.technician_name,
      outOfService:Boolean(row.out_of_service),
      workingNow:Boolean(row.timer_started_at),
    });
  }

  for (const row of dvirResult.results) {
    const equipment = row.equipment_id ? equipmentById.get(Number(row.equipment_id)) : undefined;
    const yard = yardFor(equipment, row.location);
    items.push({
      id:`dvir-${row.geotab_defect_id}`,
      unit:row.asset_unit,
      equipmentId:row.equipment_id === null ? null : Number(row.equipment_id),
      equipmentType:row.equipment_type,
      yardKey:yard.yardKey,
      yard:yard.yard,
      repairType:'DVIR',
      issue:row.defect,
      status:'DVIR - Needs Repair',
      assignedTo:'',
      outOfService:Boolean(row.out_of_service),
      workingNow:false,
    });
  }

  for (const item of maintenanceItems) {
    if (activeMaintenance.has(item.id)) continue;
    const equipmentId = maintenanceEquipmentId(item.id);
    if (!equipmentId) continue;
    const equipment = equipmentById.get(equipmentId);
    const yard = yardFor(equipment, item.location);
    items.push({
      id:item.id,
      unit:item.unit,
      equipmentId,
      equipmentType:item.equipmentType,
      yardKey:yard.yardKey,
      yard:yard.yard,
      repairType:item.maintenanceKind === 'annual' ? 'Annual' : 'PM',
      issue:item.issue,
      status:item.status,
      assignedTo:'',
      outOfService:Boolean(equipment?.out_of_service),
      workingNow:false,
    });
  }

  items.sort((a,b) => a.unit.localeCompare(b.unit, undefined, { numeric:true, sensitivity:'base' }) || a.repairType.localeCompare(b.repairType) || a.issue.localeCompare(b.issue));

  const unitMap = new Map<string,YardCheckExportItem[]>();
  for (const item of items) {
    const key = item.unit.trim().toUpperCase();
    if (!key) continue;
    const current = unitMap.get(key) ?? [];
    current.push(item);
    unitMap.set(key, current);
  }

  const units = [...unitMap.values()].map((rows) => {
    const lead = rows[0];
    return {
      unit:lead.unit,
      equipmentId:lead.equipmentId,
      equipmentType:lead.equipmentType,
      yardKey:lead.yardKey,
      yard:lead.yard,
      outOfService:rows.some((row) => row.outOfService),
      workingNow:rows.some((row) => row.workingNow),
      repairCount:rows.length,
      repairTypes:unique(rows.map((row) => row.repairType)),
      statuses:unique(rows.map((row) => row.status)),
      assignedTo:unique(rows.map((row) => row.assignedTo)),
      issues:unique(rows.map((row) => row.issue)),
    };
  }).sort((a,b) => a.unit.localeCompare(b.unit, undefined, { numeric:true, sensitivity:'base' }));

  return { items, units, updatedAt:new Date().toISOString() };
}
