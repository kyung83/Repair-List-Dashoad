type PartsUsageFilters = {
  startDate?: unknown;
  endDate?: unknown;
  partId?: unknown;
  equipmentId?: unknown;
  query?: unknown;
};

type DetailRow = {
  usage_id:number;
  part_id:number;
  part_number:string;
  description:string;
  quantity:number;
  unit_cost:number;
  line_cost:number;
  used_at:string;
  repair_id:number;
  repair_title:string;
  repair_status:string;
  repair_source:string;
  equipment_id:number|null;
  unit:string;
  technician:string;
};

type SummaryRow = {
  line_count:number;
  total_quantity:number;
  total_cost:number;
  repair_count:number;
  unit_count:number;
};

type PartSummaryRow = {
  part_id:number;
  part_number:string;
  description:string;
  quantity:number;
  repair_count:number;
  unit_count:number;
  cost:number;
};

const MAX_DETAIL_ROWS = 5000;

function clean(value: unknown, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function validDate(value: unknown, fallback: string) {
  const candidate = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return fallback;
  return Number.isNaN(Date.parse(`${candidate}T12:00:00Z`)) ? fallback : candidate;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeFilters(raw: PartsUsageFilters) {
  const today = todayUtc();
  let endDate = validDate(raw.endDate, today);
  let startDate = validDate(raw.startDate, `${endDate.slice(0, 4)}-01-01`);
  if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
  return {
    startDate,
    endDate,
    partId: positiveInteger(raw.partId),
    equipmentId: positiveInteger(raw.equipmentId),
    query: clean(raw.query).toLowerCase(),
  };
}

function roundMoney(value: unknown) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function where(filters: ReturnType<typeof normalizeFilters>) {
  const clauses = ["substr(COALESCE(rp.created_at,r.opened_at),1,10) BETWEEN ? AND ?"];
  const binds: unknown[] = [filters.startDate, filters.endDate];

  if (filters.partId) {
    clauses.push('rp.part_id=?');
    binds.push(filters.partId);
  }
  if (filters.equipmentId) {
    clauses.push('r.equipment_id=?');
    binds.push(filters.equipmentId);
  }
  if (filters.query) {
    const needle = `%${filters.query}%`;
    clauses.push(`lower(
      COALESCE(p.part_number,'') || ' ' || COALESCE(p.description,'') || ' ' ||
      COALESCE(e.unit,'') || ' ' || COALESCE(r.title,'') || ' ' ||
      COALESCE(t.name,r.driver,'') || ' ' || COALESCE(r.source,'')
    ) LIKE ?`);
    binds.push(needle);
  }

  return { sql: clauses.join(' AND '), binds };
}

export async function getPartsUsageReport(db: D1Database, raw: PartsUsageFilters = {}) {
  const filters = normalizeFilters(raw);
  const w = where(filters);

  const [summaryResult, partSummaryResult, detailResult, partOptionsResult, unitOptionsResult] = await Promise.all([
    db.prepare(`
      SELECT COUNT(rp.id) AS line_count,
             COALESCE(SUM(rp.quantity),0) AS total_quantity,
             COALESCE(SUM(rp.quantity*COALESCE(rp.unit_cost,p.unit_cost,0)),0) AS total_cost,
             COUNT(DISTINCT rp.repair_id) AS repair_count,
             COUNT(DISTINCT r.equipment_id) AS unit_count
      FROM repair_parts rp
      JOIN parts p ON p.id=rp.part_id
      JOIN repairs r ON r.id=rp.repair_id
      LEFT JOIN equipment e ON e.id=r.equipment_id
      LEFT JOIN technicians t ON t.id=r.technician_id
      WHERE ${w.sql}
    `).bind(...w.binds).first<SummaryRow>(),

    db.prepare(`
      SELECT p.id AS part_id,p.part_number,p.description,
             COALESCE(SUM(rp.quantity),0) AS quantity,
             COUNT(DISTINCT rp.repair_id) AS repair_count,
             COUNT(DISTINCT r.equipment_id) AS unit_count,
             COALESCE(SUM(rp.quantity*COALESCE(rp.unit_cost,p.unit_cost,0)),0) AS cost
      FROM repair_parts rp
      JOIN parts p ON p.id=rp.part_id
      JOIN repairs r ON r.id=rp.repair_id
      LEFT JOIN equipment e ON e.id=r.equipment_id
      LEFT JOIN technicians t ON t.id=r.technician_id
      WHERE ${w.sql}
      GROUP BY p.id,p.part_number,p.description
      ORDER BY cost DESC,quantity DESC,p.part_number COLLATE NOCASE
    `).bind(...w.binds).all<PartSummaryRow>(),

    db.prepare(`
      SELECT rp.id AS usage_id,rp.part_id,p.part_number,p.description,rp.quantity,
             COALESCE(rp.unit_cost,p.unit_cost,0) AS unit_cost,
             rp.quantity*COALESCE(rp.unit_cost,p.unit_cost,0) AS line_cost,
             COALESCE(rp.created_at,r.opened_at) AS used_at,
             r.id AS repair_id,r.title AS repair_title,COALESCE(r.status,'') AS repair_status,
             COALESCE(r.source,'') AS repair_source,r.equipment_id,
             COALESCE(e.unit,'') AS unit,
             COALESCE(t.name,r.driver,'Unassigned') AS technician
      FROM repair_parts rp
      JOIN parts p ON p.id=rp.part_id
      JOIN repairs r ON r.id=rp.repair_id
      LEFT JOIN equipment e ON e.id=r.equipment_id
      LEFT JOIN technicians t ON t.id=r.technician_id
      WHERE ${w.sql}
      ORDER BY COALESCE(rp.created_at,r.opened_at) DESC,rp.id DESC
      LIMIT ${MAX_DETAIL_ROWS + 1}
    `).bind(...w.binds).all<DetailRow>(),

    db.prepare(`
      SELECT DISTINCT p.id,p.part_number,p.description
      FROM repair_parts rp
      JOIN parts p ON p.id=rp.part_id
      ORDER BY p.part_number COLLATE NOCASE,p.description COLLATE NOCASE
    `).all<{id:number;part_number:string;description:string}>(),

    db.prepare(`
      SELECT DISTINCT e.id,e.unit
      FROM repair_parts rp
      JOIN repairs r ON r.id=rp.repair_id
      JOIN equipment e ON e.id=r.equipment_id
      ORDER BY e.unit COLLATE NOCASE
    `).all<{id:number;unit:string}>(),
  ]);

  const detailRows = detailResult.results;
  const truncated = detailRows.length > MAX_DETAIL_ROWS;
  const details = detailRows.slice(0, MAX_DETAIL_ROWS).map((row) => ({
    usageId: Number(row.usage_id),
    partId: Number(row.part_id),
    partNumber: row.part_number,
    description: row.description,
    quantity: Number(row.quantity ?? 0),
    unitCost: roundMoney(row.unit_cost),
    lineCost: roundMoney(row.line_cost),
    usedAt: row.used_at,
    repairId: Number(row.repair_id),
    repair: row.repair_title,
    repairStatus: row.repair_status,
    repairSource: row.repair_source,
    equipmentId: row.equipment_id == null ? null : Number(row.equipment_id),
    unit: row.unit,
    technician: row.technician || 'Unassigned',
  }));

  return {
    range: { startDate: filters.startDate, endDate: filters.endDate },
    filters: { partId: filters.partId, equipmentId: filters.equipmentId, query: filters.query },
    summary: {
      lineCount: Number(summaryResult?.line_count ?? 0),
      totalQuantity: Number(summaryResult?.total_quantity ?? 0),
      totalCost: roundMoney(summaryResult?.total_cost),
      repairCount: Number(summaryResult?.repair_count ?? 0),
      unitCount: Number(summaryResult?.unit_count ?? 0),
    },
    parts: partSummaryResult.results.map((row) => ({
      partId: Number(row.part_id),
      partNumber: row.part_number,
      description: row.description,
      quantity: Number(row.quantity ?? 0),
      repairCount: Number(row.repair_count ?? 0),
      unitCount: Number(row.unit_count ?? 0),
      cost: roundMoney(row.cost),
    })),
    details,
    truncated,
    options: {
      parts: partOptionsResult.results.map((row) => ({ id: Number(row.id), partNumber: row.part_number, description: row.description })),
      units: unitOptionsResult.results.map((row) => ({ id: Number(row.id), unit: row.unit })),
    },
    updatedAt: new Date().toISOString(),
  };
}
