type BreakdownReportInput = {
  startDate?: unknown;
  endDate?: unknown;
  equipmentId?: unknown;
  category?: unknown;
  provider?: unknown;
  status?: unknown;
  location?: unknown;
  query?: unknown;
};

type BreakdownDataRow = {
  id: number;
  repair_id: number;
  equipment_id: number;
  unit: string;
  equipment_type: string;
  driver_name: string;
  repair_category: string;
  repair_needed: string | null;
  description: string;
  status: string;
  stage: number;
  service_provider: string | null;
  city: string;
  state: string;
  created_at: string;
  claimed_at: string | null;
  arrival_at: string | null;
  repair_finished_at: string | null;
  rolling_at: string | null;
  completed_at: string | null;
  parts_cost: number;
  labor_cost: number;
  outside_cost: number;
  total_cost: number;
  claim_minutes: number | null;
  arrival_minutes: number | null;
  repair_minutes: number | null;
  downtime_minutes: number | null;
};

type SummaryRow = {
  breakdown_count: number;
  completed_count: number;
  units_affected: number;
  total_cost: number;
  average_cost: number;
  average_claim_minutes: number | null;
  average_arrival_minutes: number | null;
  average_repair_minutes: number | null;
  average_downtime_minutes: number | null;
  total_downtime_hours: number;
};

type UnitSummaryRow = {
  equipment_id: number;
  unit: string;
  breakdown_count: number;
  total_cost: number;
  average_cost: number;
  downtime_hours: number;
};

type GroupSummaryRow = {
  label: string;
  breakdown_count: number;
  total_cost: number;
  average_cost: number;
  average_arrival_minutes: number | null;
  average_downtime_minutes: number | null;
};

type MonthSummaryRow = GroupSummaryRow & { month: string };

type EquipmentOption = { id: number; unit: string };

const MAX_ROWS = 5000;

function text(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dateValue(value: unknown, fallback: string) {
  const candidate = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return fallback;
  const parsed = Date.parse(`${candidate}T12:00:00Z`);
  return Number.isFinite(parsed) ? candidate : fallback;
}

function roundMoney(value: unknown) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function roundMinutes(value: unknown) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Math.round(Number(value));
}

function normalizeInput(raw: BreakdownReportInput) {
  const endFallback = today();
  let endDate = dateValue(raw.endDate, endFallback);
  let startDate = dateValue(raw.startDate, `${endDate.slice(0, 4)}-01-01`);
  if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
  return {
    startDate,
    endDate,
    equipmentId: integer(raw.equipmentId),
    category: text(raw.category, 100),
    provider: text(raw.provider, 160),
    status: text(raw.status, 100),
    location: text(raw.location, 180),
    query: text(raw.query, 200),
  };
}

function filterSql(input: ReturnType<typeof normalizeInput>) {
  const clauses = [`substr(b.created_at,1,10) BETWEEN ? AND ?`];
  const binds: unknown[] = [input.startDate, input.endDate];
  if (input.equipmentId) { clauses.push(`b.equipment_id=?`); binds.push(input.equipmentId); }
  if (input.category) { clauses.push(`lower(trim(COALESCE(b.repair_category,'')))=lower(trim(?))`); binds.push(input.category); }
  if (input.provider) { clauses.push(`lower(trim(COALESCE(b.service_provider,'')))=lower(trim(?))`); binds.push(input.provider); }
  if (input.status) { clauses.push(`lower(trim(COALESCE(b.status,'')))=lower(trim(?))`); binds.push(input.status); }
  if (input.location) { clauses.push(`lower(trim(COALESCE(b.city,'') || ', ' || COALESCE(b.state,'')))=lower(trim(?))`); binds.push(input.location); }
  if (input.query) {
    clauses.push(`lower(
      COALESCE(e.unit,'') || ' ' || COALESCE(b.driver_name,'') || ' ' || COALESCE(b.repair_category,'') || ' ' ||
      COALESCE(b.repair_needed,'') || ' ' || COALESCE(b.description,'') || ' ' || COALESCE(b.service_provider,'') || ' ' ||
      COALESCE(b.city,'') || ' ' || COALESCE(b.state,'') || ' ' || COALESCE(b.status,'')
    ) LIKE ?`);
    binds.push(`%${input.query.toLowerCase()}%`);
  }
  return { clauses, binds };
}

function dataCte(clauses: string[]) {
  return `
    WITH breakdown_data AS (
      SELECT
        b.id,b.repair_id,b.equipment_id,COALESCE(e.unit,'') AS unit,COALESCE(e.equipment_type,'') AS equipment_type,
        COALESCE(b.driver_name,'') AS driver_name,COALESCE(b.repair_category,'') AS repair_category,
        b.repair_needed,COALESCE(b.description,'') AS description,COALESCE(b.status,'') AS status,b.stage,
        b.service_provider,COALESCE(b.city,'') AS city,COALESCE(b.state,'') AS state,b.created_at,b.claimed_at,
        COALESCE(b.tech_arrived_at,b.on_location_at) AS arrival_at,b.repair_finished_at,b.rolling_at,r.completed_at,
        COALESCE((
          SELECT SUM(rp.quantity*COALESCE(rp.unit_cost,p.unit_cost,0))
          FROM repair_parts rp LEFT JOIN parts p ON p.id=rp.part_id WHERE rp.repair_id=r.id
        ),0) AS parts_cost,
        COALESCE(r.labor_hours,0)*COALESCE(r.labor_rate,0) AS labor_cost,
        COALESCE(r.outside_cost,0) AS outside_cost,
        COALESCE((
          SELECT SUM(rp.quantity*COALESCE(rp.unit_cost,p.unit_cost,0))
          FROM repair_parts rp LEFT JOIN parts p ON p.id=rp.part_id WHERE rp.repair_id=r.id
        ),0)+COALESCE(r.labor_hours,0)*COALESCE(r.labor_rate,0)+COALESCE(r.outside_cost,0) AS total_cost,
        CASE WHEN b.claimed_at IS NULL THEN NULL ELSE MAX(0,(julianday(b.claimed_at)-julianday(b.created_at))*1440.0) END AS claim_minutes,
        CASE WHEN COALESCE(b.tech_arrived_at,b.on_location_at) IS NULL THEN NULL ELSE MAX(0,(julianday(COALESCE(b.tech_arrived_at,b.on_location_at))-julianday(b.created_at))*1440.0) END AS arrival_minutes,
        CASE
          WHEN COALESCE(b.tech_arrived_at,b.on_location_at) IS NULL OR COALESCE(b.repair_finished_at,b.rolling_at,r.completed_at) IS NULL THEN NULL
          ELSE MAX(0,(julianday(COALESCE(b.repair_finished_at,b.rolling_at,r.completed_at))-julianday(COALESCE(b.tech_arrived_at,b.on_location_at)))*1440.0)
        END AS repair_minutes,
        CASE WHEN COALESCE(b.rolling_at,r.completed_at) IS NULL THEN NULL ELSE MAX(0,(julianday(COALESCE(b.rolling_at,r.completed_at))-julianday(b.created_at))*1440.0) END AS downtime_minutes
      FROM roadside_breakdowns b
      JOIN repairs r ON r.id=b.repair_id
      JOIN equipment e ON e.id=b.equipment_id
      WHERE ${clauses.join(' AND ')}
    )
  `;
}

async function distinctValues(db: D1Database, sql: string) {
  const result = await db.prepare(sql).all<{ value: string | null }>();
  return result.results.map((row) => String(row.value ?? '').trim()).filter(Boolean);
}

export async function getBreakdownReportData(db: D1Database, raw: BreakdownReportInput) {
  const input = normalizeInput(raw);
  const { clauses, binds } = filterSql(input);
  const cte = dataCte(clauses);

  const rowsPromise = db.prepare(`${cte}
    SELECT * FROM breakdown_data ORDER BY created_at DESC,id DESC LIMIT ${MAX_ROWS + 1}
  `).bind(...binds).all<BreakdownDataRow>();

  const summaryPromise = db.prepare(`${cte}
    SELECT
      COUNT(*) AS breakdown_count,
      COALESCE(SUM(CASE WHEN stage>=5 OR completed_at IS NOT NULL THEN 1 ELSE 0 END),0) AS completed_count,
      COUNT(DISTINCT equipment_id) AS units_affected,
      COALESCE(SUM(total_cost),0) AS total_cost,
      CASE WHEN COUNT(*)=0 THEN 0 ELSE COALESCE(SUM(total_cost),0)/COUNT(*) END AS average_cost,
      AVG(claim_minutes) AS average_claim_minutes,
      AVG(arrival_minutes) AS average_arrival_minutes,
      AVG(repair_minutes) AS average_repair_minutes,
      AVG(downtime_minutes) AS average_downtime_minutes,
      COALESCE(SUM(downtime_minutes),0)/60.0 AS total_downtime_hours
    FROM breakdown_data
  `).bind(...binds).first<SummaryRow>();

  const unitsPromise = db.prepare(`${cte}
    SELECT equipment_id,unit,COUNT(*) AS breakdown_count,COALESCE(SUM(total_cost),0) AS total_cost,
      CASE WHEN COUNT(*)=0 THEN 0 ELSE COALESCE(SUM(total_cost),0)/COUNT(*) END AS average_cost,
      COALESCE(SUM(downtime_minutes),0)/60.0 AS downtime_hours
    FROM breakdown_data GROUP BY equipment_id,unit
    ORDER BY total_cost DESC,breakdown_count DESC,unit COLLATE NOCASE LIMIT 500
  `).bind(...binds).all<UnitSummaryRow>();

  const categoryPromise = db.prepare(`${cte}
    SELECT COALESCE(NULLIF(trim(repair_category),''),'Uncategorized') AS label,COUNT(*) AS breakdown_count,
      COALESCE(SUM(total_cost),0) AS total_cost,CASE WHEN COUNT(*)=0 THEN 0 ELSE COALESCE(SUM(total_cost),0)/COUNT(*) END AS average_cost,
      AVG(arrival_minutes) AS average_arrival_minutes,AVG(downtime_minutes) AS average_downtime_minutes
    FROM breakdown_data GROUP BY COALESCE(NULLIF(trim(repair_category),''),'Uncategorized')
    ORDER BY breakdown_count DESC,total_cost DESC,label COLLATE NOCASE
  `).bind(...binds).all<GroupSummaryRow>();

  const providerPromise = db.prepare(`${cte}
    SELECT COALESCE(NULLIF(trim(service_provider),''),'Unassigned') AS label,COUNT(*) AS breakdown_count,
      COALESCE(SUM(total_cost),0) AS total_cost,CASE WHEN COUNT(*)=0 THEN 0 ELSE COALESCE(SUM(total_cost),0)/COUNT(*) END AS average_cost,
      AVG(arrival_minutes) AS average_arrival_minutes,AVG(downtime_minutes) AS average_downtime_minutes
    FROM breakdown_data GROUP BY COALESCE(NULLIF(trim(service_provider),''),'Unassigned')
    ORDER BY total_cost DESC,breakdown_count DESC,label COLLATE NOCASE
  `).bind(...binds).all<GroupSummaryRow>();

  const locationPromise = db.prepare(`${cte}
    SELECT COALESCE(NULLIF(trim(city || ', ' || state),', '),'Unknown') AS label,COUNT(*) AS breakdown_count,
      COALESCE(SUM(total_cost),0) AS total_cost,CASE WHEN COUNT(*)=0 THEN 0 ELSE COALESCE(SUM(total_cost),0)/COUNT(*) END AS average_cost,
      AVG(arrival_minutes) AS average_arrival_minutes,AVG(downtime_minutes) AS average_downtime_minutes
    FROM breakdown_data GROUP BY COALESCE(NULLIF(trim(city || ', ' || state),', '),'Unknown')
    ORDER BY breakdown_count DESC,total_cost DESC,label COLLATE NOCASE LIMIT 500
  `).bind(...binds).all<GroupSummaryRow>();

  const monthlyPromise = db.prepare(`${cte}
    SELECT substr(created_at,1,7) AS month,substr(created_at,1,7) AS label,COUNT(*) AS breakdown_count,
      COALESCE(SUM(total_cost),0) AS total_cost,CASE WHEN COUNT(*)=0 THEN 0 ELSE COALESCE(SUM(total_cost),0)/COUNT(*) END AS average_cost,
      AVG(arrival_minutes) AS average_arrival_minutes,AVG(downtime_minutes) AS average_downtime_minutes
    FROM breakdown_data GROUP BY substr(created_at,1,7) ORDER BY month
  `).bind(...binds).all<MonthSummaryRow>();

  const equipmentPromise = db.prepare(`
    SELECT DISTINCT e.id,e.unit
    FROM roadside_breakdowns b JOIN equipment e ON e.id=b.equipment_id
    ORDER BY e.unit COLLATE NOCASE
  `).all<EquipmentOption>();

  const optionPromise = Promise.all([
    distinctValues(db, `SELECT DISTINCT repair_category AS value FROM roadside_breakdowns WHERE trim(COALESCE(repair_category,''))<>'' ORDER BY value COLLATE NOCASE`),
    distinctValues(db, `SELECT DISTINCT service_provider AS value FROM roadside_breakdowns WHERE trim(COALESCE(service_provider,''))<>'' ORDER BY value COLLATE NOCASE`),
    distinctValues(db, `SELECT DISTINCT status AS value FROM roadside_breakdowns WHERE trim(COALESCE(status,''))<>'' ORDER BY value COLLATE NOCASE`),
    distinctValues(db, `SELECT DISTINCT trim(COALESCE(city,'') || ', ' || COALESCE(state,'')) AS value FROM roadside_breakdowns WHERE trim(COALESCE(city,'') || COALESCE(state,''))<>'' ORDER BY value COLLATE NOCASE`),
  ]);

  const [rowsResult, summaryRow, unitsResult, categoriesResult, providersResult, locationsResult, monthlyResult, equipmentResult, options] = await Promise.all([
    rowsPromise,summaryPromise,unitsPromise,categoryPromise,providerPromise,locationPromise,monthlyPromise,equipmentPromise,optionPromise,
  ]);

  const summary = summaryRow ?? {
    breakdown_count: 0,completed_count: 0,units_affected: 0,total_cost: 0,average_cost: 0,
    average_claim_minutes: null,average_arrival_minutes: null,average_repair_minutes: null,average_downtime_minutes: null,total_downtime_hours: 0,
  };

  const group = (row: GroupSummaryRow) => ({
    label: row.label,
    breakdownCount: Number(row.breakdown_count ?? 0),
    totalCost: roundMoney(row.total_cost),
    averageCost: roundMoney(row.average_cost),
    averageArrivalMinutes: roundMinutes(row.average_arrival_minutes),
    averageDowntimeMinutes: roundMinutes(row.average_downtime_minutes),
  });

  return {
    range: { startDate: input.startDate, endDate: input.endDate },
    filters: input,
    summary: {
      breakdownCount: Number(summary.breakdown_count ?? 0),
      completedCount: Number(summary.completed_count ?? 0),
      openCount: Math.max(0,Number(summary.breakdown_count ?? 0)-Number(summary.completed_count ?? 0)),
      unitsAffected: Number(summary.units_affected ?? 0),
      totalCost: roundMoney(summary.total_cost),
      averageCost: roundMoney(summary.average_cost),
      averageClaimMinutes: roundMinutes(summary.average_claim_minutes),
      averageArrivalMinutes: roundMinutes(summary.average_arrival_minutes),
      averageRepairMinutes: roundMinutes(summary.average_repair_minutes),
      averageDowntimeMinutes: roundMinutes(summary.average_downtime_minutes),
      totalDowntimeHours: Math.round((Number(summary.total_downtime_hours) || 0)*10)/10,
    },
    breakdowns: rowsResult.results.slice(0,MAX_ROWS).map((row) => ({
      id: row.id,
      repairId: row.repair_id,
      equipmentId: row.equipment_id,
      unit: row.unit,
      equipmentType: row.equipment_type,
      driverName: row.driver_name,
      category: row.repair_category,
      repairNeeded: row.repair_needed ?? '',
      description: row.description,
      status: row.status,
      stage: Number(row.stage ?? 0),
      serviceProvider: row.service_provider ?? '',
      location: [row.city,row.state].filter(Boolean).join(', '),
      createdAt: row.created_at,
      claimedAt: row.claimed_at,
      arrivalAt: row.arrival_at,
      repairFinishedAt: row.repair_finished_at,
      rollingAt: row.rolling_at,
      completedAt: row.completed_at,
      partsCost: roundMoney(row.parts_cost),
      laborCost: roundMoney(row.labor_cost),
      outsideCost: roundMoney(row.outside_cost),
      totalCost: roundMoney(row.total_cost),
      claimMinutes: roundMinutes(row.claim_minutes),
      arrivalMinutes: roundMinutes(row.arrival_minutes),
      repairMinutes: roundMinutes(row.repair_minutes),
      downtimeMinutes: roundMinutes(row.downtime_minutes),
    })),
    byUnit: unitsResult.results.map((row) => ({
      equipmentId: row.equipment_id,unit: row.unit,breakdownCount: Number(row.breakdown_count ?? 0),
      totalCost: roundMoney(row.total_cost),averageCost: roundMoney(row.average_cost),downtimeHours: Math.round((Number(row.downtime_hours)||0)*10)/10,
    })),
    byCategory: categoriesResult.results.map(group),
    byProvider: providersResult.results.map(group),
    byLocation: locationsResult.results.map(group),
    monthlyTrend: monthlyResult.results.map((row) => ({ month: row.month, ...group(row) })),
    filterOptions: {
      equipment: equipmentResult.results.map((row) => ({ id: row.id, unit: row.unit })),
      categories: options[0],
      providers: options[1],
      statuses: options[2],
      locations: options[3],
    },
    truncated: rowsResult.results.length > MAX_ROWS,
    updatedAt: new Date().toISOString(),
  };
}
