// Corrections for imported repair orders. Only total cost changes:
// existing labor/sublet are retained; the difference is assigned to parts.
export const HISTORICAL_RO_IMPORT_KEY = 'ro-history-9309499-v1';

export type HistoricalRo = {
  id: number; import_key: string; ro_number: string; equipment_id: number;
  unit: string; ro_date: string; source_status: string; labor_hours: number;
  labor_cost: number; parts_cost: number; sublet_cost: number; total_cost: number; line_count: number;
};
export type HistoricalRoLine = {
  id: number; historical_repair_id: number;
  parts_cost: number; labor_cost: number; sublet_cost: number; total_cost: number;
  vmrs_description: string;
};
type ChangeLog = {
  id: number; ro_number: string; changed_by: string; previous_parts_cost: number;
  previous_total_cost: number; new_parts_cost: number; new_total_cost: number;
  reason: string; changed_at: string;
};

export class HistoricalRoCorrectionError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
const cents = (value: number) => Math.round(value * 100);
const money = (value: number) => Math.round(value * 100) / 100;

function parseAmount(value: unknown, label: string) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new HistoricalRoCorrectionError('Enter a valid ' + label + '.');
  }
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new HistoricalRoCorrectionError(label + ' must have no more than two decimal places.');
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) {
    throw new HistoricalRoCorrectionError(label + ' must be between $0 and $1,000,000.');
  }
  return cents(parsed);
}

function parseRoNumber(value: unknown) {
  const ro = String(value ?? '').trim().toUpperCase();
  if (!/^WO\d{5,12}$/.test(ro)) {
    throw new HistoricalRoCorrectionError('Enter a valid RO number such as WO085385.');
  }
  return ro;
}

// Distribute the corrected parts total across the existing VMRS categories,
// preserving proportional allocations. The last line absorbs rounding cents.
export function allocateHistoricalParts(parts: number[], correctedPartsCents: number): number[] {
  if (!parts.length || !Number.isInteger(correctedPartsCents) || correctedPartsCents < 0) {
    throw new HistoricalRoCorrectionError('Invalid corrected parts amount.');
  }
  const weights = parts.map((v) => Math.max(0, cents(v)));
  const original = weights.reduce((sum, v) => sum + v, 0);
  let remaining = correctedPartsCents;
  return weights.map((weight, index) => {
    const amount = index === weights.length - 1 ? remaining :
      Math.min(remaining, original ? Math.round(correctedPartsCents * weight / original) : 0);
    remaining -= amount;
    return amount;
  });
}

export async function findHistoricalRoForCostEdit(db: D1Database, value: unknown) {
  const ro = parseRoNumber(value);
  const [record, log] = await Promise.all([
    db.prepare('SELECT h.id,h.import_key,h.ro_number,h.equipment_id,e.unit,h.ro_date,h.source_status,h.labor_hours,h.labor_cost,h.parts_cost,h.sublet_cost,h.total_cost,h.line_count FROM historical_repairs h JOIN equipment e ON e.id=h.equipment_id WHERE h.import_key=? AND h.ro_number=? AND e.active=1')
      .bind(HISTORICAL_RO_IMPORT_KEY, ro).first<HistoricalRo>(),
    db.prepare('SELECT id,ro_number,changed_by,previous_parts_cost,previous_total_cost,new_parts_cost,new_total_cost,reason,changed_at FROM historical_ro_cost_change_log WHERE import_key=? AND ro_number=? ORDER BY id DESC LIMIT 30')
      .bind(HISTORICAL_RO_IMPORT_KEY, ro).all<ChangeLog>(),
  ]);
  if (!record) throw new HistoricalRoCorrectionError('Historical RO not found. Check the number.', 404);
  const lines = await db.prepare('SELECT id,historical_repair_id,parts_cost,labor_cost,sublet_cost,total_cost,vmrs_description FROM historical_repair_lines WHERE historical_repair_id=? ORDER BY id')
    .bind(record.id).all<HistoricalRoLine>();
  return {
    roNumber: record.ro_number, equipmentId: record.equipment_id, unit: record.unit, date: record.ro_date,
    status: record.source_status, laborHours: record.labor_hours,
    partsCost: money(Number(record.parts_cost)), laborCost: money(Number(record.labor_cost)),
    outsideCost: money(Number(record.sublet_cost)), totalCost: money(Number(record.total_cost)),
    details: lines.results.map((line) => ({
      id: line.id, description: line.vmrs_description, partsCost: money(line.parts_cost),
      laborCost: money(line.labor_cost), outsideCost: money(line.sublet_cost), totalCost: money(line.total_cost),
    })),
    history: log.results,
  };
}

export async function correctHistoricalRoTotal(
  db: D1Database, body: Record<string, unknown>,
  actor: { id: number; username: string; displayName: string },
) {
  const ro = parseRoNumber(body.roNumber);
  const expected = parseAmount(body.expectedTotalCost, 'current total');
  const proposed = parseAmount(body.correctedTotalCost, 'corrected total');
  const reason = String(body.reason ?? '').trim();
  if (reason.length < 8 || reason.length > 500) {
    throw new HistoricalRoCorrectionError('Explain the correction in 8 to 500 characters.');
  }
  const [record, detail] = await Promise.all([
    db.prepare('SELECT h.id,h.import_key,h.ro_number,h.equipment_id,e.unit,h.ro_date,h.source_status,h.labor_hours,h.labor_cost,h.parts_cost,h.sublet_cost,h.total_cost,h.line_count FROM historical_repairs h JOIN equipment e ON e.id=h.equipment_id WHERE h.import_key=? AND h.ro_number=? AND e.active=1')
      .bind(HISTORICAL_RO_IMPORT_KEY, ro).first<HistoricalRo>(),
    db.prepare('SELECT l.id,l.historical_repair_id,l.parts_cost,l.labor_cost,l.sublet_cost,l.total_cost,l.vmrs_description FROM historical_repair_lines l JOIN historical_repairs h ON h.id=l.historical_repair_id WHERE h.import_key=? AND h.ro_number=? ORDER BY l.id')
      .bind(HISTORICAL_RO_IMPORT_KEY, ro).all<HistoricalRoLine>(),
  ]);
  if (!record) throw new HistoricalRoCorrectionError('Historical RO not found.', 404);
  if (cents(record.total_cost) !== expected) {
    throw new HistoricalRoCorrectionError('This RO changed since it was opened. Reload the latest amounts.', 409);
  }
  if (expected === proposed) throw new HistoricalRoCorrectionError('Enter a different total.');
  const labor = cents(record.labor_cost), sublet = cents(record.sublet_cost), oldParts = cents(record.parts_cost);
  if (proposed < labor + sublet) {
    throw new HistoricalRoCorrectionError('Corrected total must cover existing labor and outside costs ($' + ((labor + sublet) / 100).toFixed(2) + ').');
  }
  const lines = detail.results;
  const sum = (field: 'parts_cost' | 'labor_cost' | 'sublet_cost' | 'total_cost') =>
    lines.reduce((total, line) => total + cents(line[field]), 0);
  if (!lines.length || lines.length !== Number(record.line_count) ||
      oldParts + labor + sublet !== expected || sum('parts_cost') !== oldParts ||
      sum('labor_cost') !== labor || sum('sublet_cost') !== sublet ||
      sum('total_cost') !== expected ||
      lines.some((line) => cents(line.parts_cost) + cents(line.labor_cost) + cents(line.sublet_cost) !== cents(line.total_cost))) {
    throw new HistoricalRoCorrectionError('RO costs or detail lines are inconsistent. No change was made.', 409);
  }
  const newParts = proposed - labor - sublet;
  const allocated = allocateHistoricalParts(lines.map((line) => line.parts_cost), newParts);
  const editor = (actor.displayName || actor.username || 'Manager').slice(0, 140);
  // The first D1 statement checks the LIVE old amounts. CHECK(guard_verified=1)
  // rejects stale edits, rolling the entire D1 batch back.
  const statements: D1PreparedStatement[] = [
    db.prepare('INSERT INTO historical_ro_cost_change_log (import_key,ro_number,equipment_id,changed_by_user_id,changed_by,previous_parts_cost,previous_labor_cost,previous_sublet_cost,previous_total_cost,new_parts_cost,new_total_cost,reason,guard_verified) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,(SELECT CASE WHEN COUNT(*)=1 THEN 1 ELSE 0 END FROM historical_repairs h WHERE h.id=? AND h.import_key=? AND h.ro_number=? AND h.equipment_id=? AND ABS(h.parts_cost-?)<0.005 AND ABS(h.labor_cost-?)<0.005 AND ABS(h.sublet_cost-?)<0.005 AND ABS(h.total_cost-?)<0.005 AND (SELECT COUNT(*) FROM historical_repair_lines l WHERE l.historical_repair_id=h.id)=? AND ABS((SELECT COALESCE(SUM(l.parts_cost),0) FROM historical_repair_lines l WHERE l.historical_repair_id=h.id)-h.parts_cost)<0.005 AND ABS((SELECT COALESCE(SUM(l.total_cost),0) FROM historical_repair_lines l WHERE l.historical_repair_id=h.id)-h.total_cost)<0.005))')
      .bind(HISTORICAL_RO_IMPORT_KEY, ro, record.equipment_id, actor.id, editor,
        money(record.parts_cost), money(record.labor_cost), money(record.sublet_cost), money(record.total_cost),
        newParts / 100, proposed / 100, reason,
        record.id, HISTORICAL_RO_IMPORT_KEY, ro, record.equipment_id,
        record.parts_cost, record.labor_cost, record.sublet_cost, record.total_cost, lines.length),
    db.prepare('INSERT INTO historical_ro_cost_corrections (import_key,ro_number,equipment_id,original_parts_cost,original_labor_cost,original_sublet_cost,original_total_cost,corrected_parts_cost,corrected_total_cost,reason) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(import_key,ro_number) DO UPDATE SET corrected_parts_cost=excluded.corrected_parts_cost,corrected_total_cost=excluded.corrected_total_cost,reason=excluded.reason,corrected_at=CURRENT_TIMESTAMP')
      .bind(HISTORICAL_RO_IMPORT_KEY, ro, record.equipment_id, money(record.parts_cost),
        money(record.labor_cost), money(record.sublet_cost), money(record.total_cost),
        newParts / 100, proposed / 100, reason),
    ...lines.map((line, index) => db.prepare('UPDATE historical_repair_lines SET parts_cost=?,total_cost=? WHERE id=? AND historical_repair_id=?')
      .bind(allocated[index] / 100, (allocated[index] + cents(line.labor_cost) + cents(line.sublet_cost)) / 100, line.id, record.id)),
    db.prepare('UPDATE historical_repairs SET parts_cost=?,total_cost=? WHERE id=? AND import_key=? AND ro_number=?')
      .bind(newParts / 100, proposed / 100, record.id, HISTORICAL_RO_IMPORT_KEY, ro),
  ];
  await db.batch(statements);
  return {
    ok: true, roNumber: ro, unit: record.unit, previousTotalCost: expected / 100,
    correctedTotalCost: proposed / 100, correctedPartsCost: newParts / 100,
    preservedLaborCost: labor / 100, preservedOutsideCost: sublet / 100,
  };
}
