type SearchInput = {
  startDate?: unknown;
  endDate?: unknown;
  equipmentId?: unknown;
  category?: unknown;
  equipmentType?: unknown;
  make?: unknown;
  model?: unknown;
  repairStatus?: unknown;
  technician?: unknown;
  repairSource?: unknown;
  repairLocation?: unknown;
  maintenanceType?: unknown;
  pmType?: unknown;
  maintenanceSource?: unknown;
  expenseCategory?: unknown;
  expenseSource?: unknown;
  query?: unknown;
};

type EquipmentRow = {
  id: number;
  unit: string;
  category: string | null;
  equipment_type: string | null;
  model_year: number | null;
  make: string | null;
  model: string | null;
};

type RepairRow = {
  id: number;
  equipment_id: number | null;
  unit: string;
  category: string;
  equipment_type: string;
  model_year: number | null;
  make: string;
  model: string;
  title: string;
  status: string;
  source: string;
  opened_at: string;
  completed_at: string | null;
  technician: string;
  location: string;
  labor_hours: number;
  labor_rate: number;
  outside_cost: number;
  parts_cost: number;
  filtered_count: number;
  filtered_parts: number;
  filtered_labor: number;
  filtered_outside: number;
  filtered_total: number;
};

type HistoricalRepairRow = {
  id: number;
  equipment_id: number;
  unit: string;
  category: string;
  equipment_type: string;
  model_year: number | null;
  make: string;
  model: string;
  ro_number: string;
  ro_date: string;
  location: string;
  source_status: string;
  labor_hours: number;
  labor_cost: number;
  parts_cost: number;
  sublet_cost: number;
  total_cost: number;
  filtered_count: number;
  filtered_parts: number;
  filtered_labor: number;
  filtered_outside: number;
  filtered_total: number;
};

type MaintenanceRow = {
  id: number;
  equipment_id: number;
  unit: string;
  event_type: string;
  pm_type: string | null;
  event_date: string;
  mileage: number | null;
  notes: string | null;
  source: string;
  filtered_count: number;
};

type ExpenseRow = {
  id: number;
  equipment_id: number;
  unit: string;
  expense_date: string;
  category: string;
  amount: number;
  vendor: string | null;
  description: string | null;
  source: string;
  filtered_count: number;
  filtered_total: number;
};

type PartRow = {
  part_number: string;
  description: string;
  quantity: number;
  repair_count: number;
  unit_count: number;
  cost: number;
};

const MAX_ROWS = 5000;

function text(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function dateValue(value: unknown, fallback: string) {
  const candidate = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return fallback;
  const parsed = Date.parse(`${candidate}T12:00:00Z`);
  return Number.isFinite(parsed) ? candidate : fallback;
}

function localTodayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function defaultStart(endDate: string) {
  return `${endDate.slice(0, 4)}-01-01`;
}

function roundMoney(value: unknown) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function categoryName(category: string | null | undefined, equipmentType: string | null | undefined) {
  if (String(equipmentType ?? '').toLowerCase() === 'trailer') return 'Trailers';
  const value = String(category ?? '').trim();
  return value && value.toLowerCase() !== 'fleet' ? value : 'Uncategorized';
}

function addEquipmentFilters(alias: string, input: ReturnType<typeof normalizeInput>, clauses: string[], binds: unknown[]) {
  if (input.equipmentId) { clauses.push(`${alias}.id = ?`); binds.push(input.equipmentId); }
  if (input.category) { clauses.push(`lower(trim(CASE WHEN lower(COALESCE(${alias}.equipment_type,''))='trailer' THEN 'Trailers' WHEN lower(trim(COALESCE(${alias}.category,'')))='fleet' OR trim(COALESCE(${alias}.category,''))='' THEN 'Uncategorized' ELSE ${alias}.category END)) = lower(trim(?))`); binds.push(input.category); }
  if (input.equipmentType) { clauses.push(`lower(trim(COALESCE(${alias}.equipment_type,''))) = lower(trim(?))`); binds.push(input.equipmentType); }
  if (input.make) { clauses.push(`lower(trim(COALESCE(${alias}.make,''))) = lower(trim(?))`); binds.push(input.make); }
  if (input.model) { clauses.push(`lower(trim(COALESCE(${alias}.model,''))) = lower(trim(?))`); binds.push(input.model); }
}

function normalizeInput(raw: SearchInput) {
  const today = localTodayUtc();
  let endDate = dateValue(raw.endDate, today);
  let startDate = dateValue(raw.startDate, defaultStart(endDate));
  if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
  return {
    startDate,
    endDate,
    equipmentId: integer(raw.equipmentId),
    category: text(raw.category, 100),
    equipmentType: text(raw.equipmentType, 80),
    make: text(raw.make, 100),
    model: text(raw.model, 100),
    repairStatus: text(raw.repairStatus, 100),
    technician: text(raw.technician, 160),
    repairSource: text(raw.repairSource, 120),
    repairLocation: text(raw.repairLocation, 160),
    maintenanceType: text(raw.maintenanceType, 80),
    pmType: text(raw.pmType, 80),
    maintenanceSource: text(raw.maintenanceSource, 120),
    expenseCategory: text(raw.expenseCategory, 100),
    expenseSource: text(raw.expenseSource, 120),
    query: text(raw.query, 200),
  };
}

function filterEquipmentRows(rows: EquipmentRow[], input: ReturnType<typeof normalizeInput>) {
  const same = (left: unknown, right: string) => String(left ?? '').trim().toLowerCase() === right.trim().toLowerCase();
  return rows.filter((row) => {
    if (input.equipmentId && row.id !== input.equipmentId) return false;
    if (input.category && !same(categoryName(row.category, row.equipment_type), input.category)) return false;
    if (input.equipmentType && !same(row.equipment_type, input.equipmentType)) return false;
    if (input.make && !same(row.make, input.make)) return false;
    if (input.model && !same(row.model, input.model)) return false;
    return true;
  });
}

async function distinctValues(db: D1Database, sql: string) {
  const result = await db.prepare(sql).all<{ value: string | null }>();
  return result.results.map((row) => String(row.value ?? '').trim()).filter(Boolean);
}

export async function getReportSearchData(db: D1Database, raw: SearchInput) {
  const input = normalizeInput(raw);

  const equipmentPromise = db.prepare(`
    SELECT id, unit, category, equipment_type, model_year, make, model
    FROM equipment
    WHERE active = 1
    ORDER BY unit COLLATE NOCASE
  `).all<EquipmentRow>();

  const repairClauses = [`substr(r.opened_at,1,10) BETWEEN ? AND ?`];
  const repairBinds: unknown[] = [input.startDate, input.endDate];
  addEquipmentFilters('e', input, repairClauses, repairBinds);
  if (input.repairStatus) { repairClauses.push(`lower(trim(COALESCE(r.status,''))) = lower(trim(?))`); repairBinds.push(input.repairStatus); }
  if (input.technician) { repairClauses.push(`lower(trim(COALESCE(t.name,r.driver,''))) = lower(trim(?))`); repairBinds.push(input.technician); }
  if (input.repairSource) { repairClauses.push(`lower(trim(COALESCE(r.source,''))) = lower(trim(?))`); repairBinds.push(input.repairSource); }
  if (input.repairLocation) { repairClauses.push(`lower(trim(COALESCE(r.location,''))) = lower(trim(?))`); repairBinds.push(input.repairLocation); }
  if (input.query) {
    repairClauses.push(`lower(COALESCE(e.unit,'') || ' ' || COALESCE(r.title,'') || ' ' || COALESCE(r.status,'') || ' ' || COALESCE(r.source,'') || ' ' || COALESCE(t.name,r.driver,'') || ' ' || COALESCE(r.location,'')) LIKE ?`);
    repairBinds.push(`%${input.query.toLowerCase()}%`);
  }

  const repairSql = `
    WITH repair_data AS (
      SELECT r.id,r.equipment_id,COALESCE(e.unit,'') AS unit,COALESCE(e.category,'') AS category,COALESCE(e.equipment_type,'') AS equipment_type,
             e.model_year,COALESCE(e.make,'') AS make,COALESCE(e.model,'') AS model,r.title,COALESCE(r.status,'') AS status,
             COALESCE(r.source,'') AS source,r.opened_at,r.completed_at,COALESCE(t.name,r.driver,'') AS technician,
             COALESCE(r.location,'') AS location,COALESCE(r.labor_hours,0) AS labor_hours,COALESCE(r.labor_rate,0) AS labor_rate,
             COALESCE(r.outside_cost,0) AS outside_cost,
             COALESCE((SELECT SUM(rp.quantity*COALESCE(rp.unit_cost,p.unit_cost,0)) FROM repair_parts rp LEFT JOIN parts p ON p.id=rp.part_id WHERE rp.repair_id=r.id),0) AS parts_cost
      FROM repairs r
      LEFT JOIN equipment e ON e.id=r.equipment_id
      LEFT JOIN technicians t ON t.id=r.technician_id
      WHERE ${repairClauses.join(' AND ')}
    )
    SELECT *,COUNT(*) OVER() AS filtered_count,
           COALESCE(SUM(parts_cost) OVER(),0) AS filtered_parts,
           COALESCE(SUM(labor_hours*labor_rate) OVER(),0) AS filtered_labor,
           COALESCE(SUM(outside_cost) OVER(),0) AS filtered_outside,
           COALESCE(SUM(parts_cost+labor_hours*labor_rate+outside_cost) OVER(),0) AS filtered_total
    FROM repair_data ORDER BY opened_at DESC,id DESC LIMIT ${MAX_ROWS + 1}
  `;
  const repairPromise = db.prepare(repairSql).bind(...repairBinds).all<RepairRow>();

  const historyClauses = [`substr(h.ro_date,1,10) BETWEEN ? AND ?`, `e.active=1`];
  const historyBinds: unknown[] = [input.startDate, input.endDate];
  addEquipmentFilters('e', input, historyClauses, historyBinds);
  if (input.repairStatus) { historyClauses.push(`lower(trim(COALESCE(h.source_status,''))) = lower(trim(?))`); historyBinds.push(input.repairStatus); }
  if (input.repairSource && input.repairSource.toLowerCase() !== 'historical ro import') historyClauses.push('1=0');
  if (input.technician && input.technician.toLowerCase() !== 'historical import') historyClauses.push('1=0');
  if (input.repairLocation) { historyClauses.push(`lower(trim(COALESCE(h.location,''))) = lower(trim(?))`); historyBinds.push(input.repairLocation); }
  if (input.query) {
    historyClauses.push(`lower(COALESCE(e.unit,'') || ' ' || COALESCE(h.ro_number,'') || ' ' || COALESCE(h.location,'') || ' ' || COALESCE(h.source_status,'')) LIKE ?`);
    historyBinds.push(`%${input.query.toLowerCase()}%`);
  }
  const historySql = `
    WITH history_data AS (
      SELECT h.id,h.equipment_id,e.unit,COALESCE(e.category,'') AS category,COALESCE(e.equipment_type,'') AS equipment_type,e.model_year,
             COALESCE(e.make,'') AS make,COALESCE(e.model,'') AS model,h.ro_number,h.ro_date,COALESCE(h.location,'') AS location,
             COALESCE(h.source_status,'COMPLETED') AS source_status,COALESCE(h.labor_hours,0) AS labor_hours,COALESCE(h.labor_cost,0) AS labor_cost,
             COALESCE(h.parts_cost,0) AS parts_cost,COALESCE(h.sublet_cost,0) AS sublet_cost,COALESCE(h.total_cost,0) AS total_cost
      FROM historical_repairs h JOIN equipment e ON e.id=h.equipment_id
      WHERE ${historyClauses.join(' AND ')}
    )
    SELECT *,COUNT(*) OVER() AS filtered_count,
           COALESCE(SUM(parts_cost) OVER(),0) AS filtered_parts,
           COALESCE(SUM(labor_cost) OVER(),0) AS filtered_labor,
           COALESCE(SUM(sublet_cost) OVER(),0) AS filtered_outside,
           COALESCE(SUM(total_cost) OVER(),0) AS filtered_total
    FROM history_data ORDER BY ro_date DESC,ro_number DESC LIMIT ${MAX_ROWS + 1}
  `;
  const historyPromise = db.prepare(historySql).bind(...historyBinds).all<HistoricalRepairRow>();

  const maintenanceClauses = [`substr(m.event_date,1,10) BETWEEN ? AND ?`];
  const maintenanceBinds: unknown[] = [input.startDate, input.endDate];
  addEquipmentFilters('e', input, maintenanceClauses, maintenanceBinds);
  if (input.maintenanceType) { maintenanceClauses.push(`lower(trim(COALESCE(m.event_type,''))) = lower(trim(?))`); maintenanceBinds.push(input.maintenanceType); }
  if (input.pmType) { maintenanceClauses.push(`lower(trim(COALESCE(m.pm_type,''))) = lower(trim(?))`); maintenanceBinds.push(input.pmType); }
  if (input.maintenanceSource) { maintenanceClauses.push(`lower(trim(COALESCE(m.source,''))) = lower(trim(?))`); maintenanceBinds.push(input.maintenanceSource); }
  if (input.query) {
    maintenanceClauses.push(`lower(COALESCE(e.unit,'') || ' ' || COALESCE(m.event_type,'') || ' ' || COALESCE(m.pm_type,'') || ' ' || COALESCE(m.notes,'') || ' ' || COALESCE(m.source,'')) LIKE ?`);
    maintenanceBinds.push(`%${input.query.toLowerCase()}%`);
  }
  const maintenancePromise = db.prepare(`
    SELECT m.id,m.equipment_id,e.unit,m.event_type,m.pm_type,m.event_date,m.mileage,m.notes,m.source,
           COUNT(*) OVER() AS filtered_count
    FROM maintenance_events m JOIN equipment e ON e.id=m.equipment_id
    WHERE ${maintenanceClauses.join(' AND ')}
    ORDER BY m.event_date DESC,m.id DESC LIMIT ${MAX_ROWS + 1}
  `).bind(...maintenanceBinds).all<MaintenanceRow>();

  const expenseClauses = [`substr(x.expense_date,1,10) BETWEEN ? AND ?`];
  const expenseBinds: unknown[] = [input.startDate, input.endDate];
  addEquipmentFilters('e', input, expenseClauses, expenseBinds);
  if (input.expenseCategory) { expenseClauses.push(`lower(trim(COALESCE(x.category,''))) = lower(trim(?))`); expenseBinds.push(input.expenseCategory); }
  if (input.expenseSource) { expenseClauses.push(`lower(trim(COALESCE(x.source,''))) = lower(trim(?))`); expenseBinds.push(input.expenseSource); }
  if (input.query) {
    expenseClauses.push(`lower(COALESCE(e.unit,'') || ' ' || COALESCE(x.category,'') || ' ' || COALESCE(x.vendor,'') || ' ' || COALESCE(x.description,'') || ' ' || COALESCE(x.source,'')) LIKE ?`);
    expenseBinds.push(`%${input.query.toLowerCase()}%`);
  }
  const expensePromise = db.prepare(`
    SELECT x.id,x.equipment_id,e.unit,x.expense_date,x.category,x.amount,x.vendor,x.description,x.source,
           COUNT(*) OVER() AS filtered_count,COALESCE(SUM(x.amount) OVER(),0) AS filtered_total
    FROM unit_expenses x JOIN equipment e ON e.id=x.equipment_id
    WHERE ${expenseClauses.join(' AND ')}
    ORDER BY x.expense_date DESC,x.id DESC LIMIT ${MAX_ROWS + 1}
  `).bind(...expenseBinds).all<ExpenseRow>();

  const partClauses = [...repairClauses];
  const partBinds = [...repairBinds];
  const partPromise = db.prepare(`
    SELECT p.part_number,p.description,COALESCE(SUM(rp.quantity),0) AS quantity,COUNT(DISTINCT r.id) AS repair_count,
           COUNT(DISTINCT r.equipment_id) AS unit_count,
           COALESCE(SUM(rp.quantity*COALESCE(rp.unit_cost,p.unit_cost,0)),0) AS cost
    FROM repair_parts rp JOIN repairs r ON r.id=rp.repair_id LEFT JOIN equipment e ON e.id=r.equipment_id
    LEFT JOIN technicians t ON t.id=r.technician_id JOIN parts p ON p.id=rp.part_id
    WHERE ${partClauses.join(' AND ')}
    GROUP BY p.id,p.part_number,p.description
    ORDER BY cost DESC,quantity DESC,p.part_number COLLATE NOCASE LIMIT 1000
  `).bind(...partBinds).all<PartRow>();

  const optionPromises = Promise.all([
    distinctValues(db, `SELECT DISTINCT COALESCE(status,'') AS value FROM repairs UNION SELECT DISTINCT COALESCE(source_status,'') FROM historical_repairs ORDER BY value COLLATE NOCASE`),
    distinctValues(db, `SELECT DISTINCT COALESCE(t.name,r.driver,'') AS value FROM repairs r LEFT JOIN technicians t ON t.id=r.technician_id UNION SELECT 'Historical import' ORDER BY value COLLATE NOCASE`),
    distinctValues(db, `SELECT DISTINCT COALESCE(source,'') AS value FROM repairs UNION SELECT 'Historical RO import' ORDER BY value COLLATE NOCASE`),
    distinctValues(db, `SELECT DISTINCT COALESCE(location,'') AS value FROM repairs UNION SELECT DISTINCT COALESCE(location,'') FROM historical_repairs ORDER BY value COLLATE NOCASE`),
    distinctValues(db, `SELECT DISTINCT COALESCE(event_type,'') AS value FROM maintenance_events ORDER BY value COLLATE NOCASE`),
    distinctValues(db, `SELECT DISTINCT COALESCE(pm_type,'') AS value FROM maintenance_events ORDER BY value COLLATE NOCASE`),
    distinctValues(db, `SELECT DISTINCT COALESCE(source,'') AS value FROM maintenance_events ORDER BY value COLLATE NOCASE`),
    distinctValues(db, `SELECT DISTINCT COALESCE(category,'') AS value FROM unit_expenses ORDER BY value COLLATE NOCASE`),
    distinctValues(db, `SELECT DISTINCT COALESCE(source,'') AS value FROM unit_expenses ORDER BY value COLLATE NOCASE`),
  ]);

  const [equipmentResult, repairResult, historyResult, maintenanceResult, expenseResult, partResult, options] = await Promise.all([
    equipmentPromise, repairPromise, historyPromise, maintenancePromise, expensePromise, partPromise, optionPromises,
  ]);

  const currentRows = repairResult.results.slice(0, MAX_ROWS);
  const historicalRows = historyResult.results.slice(0, MAX_ROWS);
  const currentTotals = repairResult.results[0];
  const historicalTotals = historyResult.results[0];
  const maintenanceTotal = Number(maintenanceResult.results[0]?.filtered_count ?? 0);
  const expenseCount = Number(expenseResult.results[0]?.filtered_count ?? 0);
  const expenseTotal = Number(expenseResult.results[0]?.filtered_total ?? 0);

  const repairs = [
    ...currentRows.map((row) => {
      const laborCost = Number(row.labor_hours ?? 0) * Number(row.labor_rate ?? 0);
      return {
        id: row.id,
        kind: 'Current repair',
        equipmentId: row.equipment_id,
        unit: row.unit,
        category: categoryName(row.category, row.equipment_type),
        equipmentType: row.equipment_type,
        modelYear: row.model_year,
        make: row.make,
        model: row.model,
        date: row.opened_at.slice(0, 10),
        repair: row.title,
        status: row.status,
        technician: row.technician || 'Unassigned',
        source: row.source,
        location: row.location,
        partsCost: roundMoney(row.parts_cost),
        laborHours: Number(row.labor_hours ?? 0),
        laborCost: roundMoney(laborCost),
        outsideCost: roundMoney(row.outside_cost),
        totalCost: roundMoney(Number(row.parts_cost ?? 0) + laborCost + Number(row.outside_cost ?? 0)),
      };
    }),
    ...historicalRows.map((row) => ({
      id: -Number(row.id),
      kind: 'Historical RO',
      equipmentId: row.equipment_id,
      unit: row.unit,
      category: categoryName(row.category, row.equipment_type),
      equipmentType: row.equipment_type,
      modelYear: row.model_year,
      make: row.make,
      model: row.model,
      date: row.ro_date.slice(0, 10),
      repair: `RO ${row.ro_number}`,
      status: row.source_status,
      technician: 'Historical import',
      source: 'Historical RO import',
      location: row.location,
      partsCost: roundMoney(row.parts_cost),
      laborHours: Number(row.labor_hours ?? 0),
      laborCost: roundMoney(row.labor_cost),
      outsideCost: roundMoney(row.sublet_cost),
      totalCost: roundMoney(row.total_cost),
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  const equipment = equipmentResult.results.map((row) => ({
    id: row.id,
    unit: row.unit,
    category: categoryName(row.category, row.equipment_type),
    equipmentType: row.equipment_type ?? '',
    modelYear: row.model_year == null ? null : Number(row.model_year),
    make: row.make ?? '',
    model: row.model ?? '',
  }));
  const matchingEquipment = filterEquipmentRows(equipmentResult.results, input);

  const currentCount = Number(currentTotals?.filtered_count ?? 0);
  const historicalCount = Number(historicalTotals?.filtered_count ?? 0);
  const repairParts = Number(currentTotals?.filtered_parts ?? 0) + Number(historicalTotals?.filtered_parts ?? 0);
  const repairLabor = Number(currentTotals?.filtered_labor ?? 0) + Number(historicalTotals?.filtered_labor ?? 0);
  const repairOutside = Number(currentTotals?.filtered_outside ?? 0) + Number(historicalTotals?.filtered_outside ?? 0);
  const repairTotal = Number(currentTotals?.filtered_total ?? 0) + Number(historicalTotals?.filtered_total ?? 0);

  const [statuses, technicians, repairSources, repairLocations, maintenanceTypes, pmTypes, maintenanceSources, expenseCategories, expenseSources] = options;

  return {
    range: { startDate: input.startDate, endDate: input.endDate },
    filters: input,
    summary: {
      unitsInScope: matchingEquipment.length,
      repairCount: currentCount + historicalCount,
      currentRepairCount: currentCount,
      historicalRepairCount: historicalCount,
      partsCost: roundMoney(repairParts),
      laborCost: roundMoney(repairLabor),
      outsideCost: roundMoney(repairOutside),
      repairCost: roundMoney(repairTotal),
      maintenanceEvents: maintenanceTotal,
      expenseCount,
      expenseCost: roundMoney(expenseTotal),
      operatingCost: roundMoney(repairTotal + expenseTotal),
    },
    equipment,
    repairs: repairs.slice(0, MAX_ROWS),
    maintenance: maintenanceResult.results.slice(0, MAX_ROWS).map((row) => ({
      id: row.id, equipmentId: row.equipment_id, unit: row.unit, date: row.event_date.slice(0, 10), type: row.event_type,
      pmType: row.pm_type ?? '', mileage: row.mileage == null ? null : Number(row.mileage), source: row.source, notes: row.notes ?? '',
    })),
    expenses: expenseResult.results.slice(0, MAX_ROWS).map((row) => ({
      id: row.id, equipmentId: row.equipment_id, unit: row.unit, date: row.expense_date.slice(0, 10), category: row.category,
      amount: roundMoney(row.amount), vendor: row.vendor ?? '', description: row.description ?? '', source: row.source,
    })),
    parts: partResult.results.map((row) => ({
      partNumber: row.part_number, description: row.description, quantity: Math.round(Number(row.quantity ?? 0) * 100) / 100,
      repairCount: Number(row.repair_count ?? 0), unitCount: Number(row.unit_count ?? 0), cost: roundMoney(row.cost),
    })),
    truncated: {
      repairs: currentCount + historicalCount > MAX_ROWS,
      maintenance: maintenanceTotal > MAX_ROWS,
      expenses: expenseCount > MAX_ROWS,
    },
    filterOptions: {
      categories: [...new Set(equipment.map((row) => row.category))].sort((a, b) => a.localeCompare(b)),
      equipmentTypes: [...new Set(equipment.map((row) => row.equipmentType).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
      makes: [...new Set(equipment.map((row) => row.make).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
      models: [...new Set(equipment.map((row) => row.model).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
      repairStatuses: statuses,
      technicians,
      repairSources,
      repairLocations,
      maintenanceTypes,
      pmTypes,
      maintenanceSources,
      expenseCategories,
      expenseSources,
    },
    updatedAt: new Date().toISOString(),
  };
}
