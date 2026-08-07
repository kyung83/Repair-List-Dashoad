type EquipmentRow = {
  id: number;
  unit: string;
  category: string;
  equipment_type: string;
  current_mileage: number | null;
  model_year: number | null;
  make: string | null;
  model: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  in_service_date: string | null;
  acquisition_mileage: number | null;
  expected_residual_value: number | null;
  retired_date: string | null;
};

type RepairCostRow = {
  id: number;
  equipment_id: number | null;
  unit: string;
  category: string;
  equipment_type: string | null;
  title: string;
  status: string;
  source: string;
  opened_at: string;
  completed_at: string | null;
  technician_name: string;
  location: string;
  labor_hours: number;
  labor_rate: number;
  outside_cost: number;
  parts_cost: number;
  part_lines: number;
  snapshot_part_lines: number;
  priced_part_lines: number;
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
};

type MaintenanceEventRow = {
  id: number;
  equipment_id: number;
  unit: string;
  event_type: string;
  pm_type: string | null;
  event_date: string;
  mileage: number | null;
  notes: string | null;
  source: string;
};

type PartUsageRow = {
  repair_id: number;
  equipment_id: number | null;
  unit: string;
  opened_at: string;
  part_number: string;
  description: string;
  quantity: number;
  snapshot_unit_cost: number | null;
  current_unit_cost: number | null;
};

function dateYear(value: string | null | undefined) {
  const match = String(value ?? '').match(/^(\d{4})-/);
  return match ? Number(match[1]) : null;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function displayCategory(row: { category: string; equipment_type?: string | null }) {
  if (row.equipment_type === 'trailer') return 'Trailers';
  const value = String(row.category ?? '').trim();
  return value && value.toLowerCase() !== 'fleet' ? value : 'Uncategorized';
}

function isComplete(status: string) {
  return status.toLowerCase().includes('complete');
}

function cycleHours(openedAt: string, completedAt: string | null) {
  if (!completedAt) return null;
  const opened = Date.parse(openedAt);
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(opened) || !Number.isFinite(completed) || completed < opened) return null;
  return (completed - opened) / 3_600_000;
}

function selectedYearValue(value: unknown) {
  const current = new Date().getUTCFullYear();
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : current;
}

export async function getReportingData(db: D1Database, requestedYear?: unknown) {
  const selectedYear = selectedYearValue(requestedYear);
  const [equipmentResult, repairsResult, expensesResult, maintenanceResult, partUsageResult] = await Promise.all([
    db.prepare(`
      SELECT id, unit, category, equipment_type, current_mileage, model_year, make, model,
             purchase_date, purchase_price, in_service_date, acquisition_mileage,
             expected_residual_value, retired_date
      FROM equipment
      WHERE active = 1
      ORDER BY unit
    `).all<EquipmentRow>(),
    db.prepare(`
      SELECT r.id, r.equipment_id, COALESCE(e.unit, '') AS unit,
             COALESCE(e.category, '') AS category, e.equipment_type,
             r.title, r.status, r.source, r.opened_at, r.completed_at,
             COALESCE(t.name, r.driver, '') AS technician_name,
             COALESCE(r.location, '') AS location,
             COALESCE(r.labor_hours, 0) AS labor_hours,
             COALESCE(r.labor_rate, 0) AS labor_rate,
             COALESCE(r.outside_cost, 0) AS outside_cost,
             COALESCE(SUM(rp.quantity * COALESCE(rp.unit_cost, p.unit_cost, 0)), 0) AS parts_cost,
             COUNT(rp.id) AS part_lines,
             COALESCE(SUM(CASE WHEN rp.id IS NOT NULL AND rp.unit_cost IS NOT NULL THEN 1 ELSE 0 END), 0) AS snapshot_part_lines,
             COALESCE(SUM(CASE WHEN rp.id IS NOT NULL AND (rp.unit_cost IS NOT NULL OR p.unit_cost IS NOT NULL) THEN 1 ELSE 0 END), 0) AS priced_part_lines
      FROM repairs r
      LEFT JOIN equipment e ON e.id = r.equipment_id
      LEFT JOIN technicians t ON t.id = r.technician_id
      LEFT JOIN repair_parts rp ON rp.repair_id = r.id
      LEFT JOIN parts p ON p.id = rp.part_id
      GROUP BY r.id, r.equipment_id, e.unit, e.category, e.equipment_type,
               r.title, r.status, r.source, r.opened_at, r.completed_at,
               t.name, r.driver, r.location, r.labor_hours, r.labor_rate, r.outside_cost
      ORDER BY r.opened_at DESC, r.id DESC
    `).all<RepairCostRow>(),
    db.prepare(`
      SELECT x.id, x.equipment_id, e.unit, x.expense_date, x.category, x.amount,
             x.vendor, x.description, x.source
      FROM unit_expenses x
      JOIN equipment e ON e.id = x.equipment_id
      ORDER BY x.expense_date DESC, x.id DESC
    `).all<ExpenseRow>(),
    db.prepare(`
      SELECT m.id, m.equipment_id, e.unit, m.event_type, m.pm_type, m.event_date,
             m.mileage, m.notes, m.source
      FROM maintenance_events m
      JOIN equipment e ON e.id = m.equipment_id
      ORDER BY m.event_date DESC, m.id DESC
    `).all<MaintenanceEventRow>(),
    db.prepare(`
      SELECT rp.repair_id, r.equipment_id, COALESCE(e.unit, '') AS unit, r.opened_at,
             p.part_number, p.description, rp.quantity,
             rp.unit_cost AS snapshot_unit_cost, p.unit_cost AS current_unit_cost
      FROM repair_parts rp
      JOIN repairs r ON r.id = rp.repair_id
      LEFT JOIN equipment e ON e.id = r.equipment_id
      JOIN parts p ON p.id = rp.part_id
      ORDER BY r.opened_at DESC, rp.id DESC
    `).all<PartUsageRow>(),
  ]);

  const repairs = repairsResult.results.map((row) => {
    const partsCost = Number(row.parts_cost ?? 0);
    const laborHours = Number(row.labor_hours ?? 0);
    const laborRate = Number(row.labor_rate ?? 0);
    const laborCost = laborHours * laborRate;
    const outsideCost = Number(row.outside_cost ?? 0);
    return {
      id: row.id,
      equipmentId: row.equipment_id,
      unit: row.unit,
      category: displayCategory(row),
      equipmentType: row.equipment_type ?? 'other',
      title: row.title,
      status: row.status,
      source: row.source,
      openedAt: row.opened_at,
      completedAt: row.completed_at ?? '',
      year: dateYear(row.opened_at),
      technician: row.technician_name || 'Unassigned',
      location: row.location,
      partsCost: roundMoney(partsCost),
      laborHours,
      laborRate: roundMoney(laborRate),
      laborCost: roundMoney(laborCost),
      outsideCost: roundMoney(outsideCost),
      totalCost: roundMoney(partsCost + laborCost + outsideCost),
      repairCycleHours: cycleHours(row.opened_at, row.completed_at),
      partLines: Number(row.part_lines ?? 0),
      snapshotPartLines: Number(row.snapshot_part_lines ?? 0),
      pricedPartLines: Number(row.priced_part_lines ?? 0),
    };
  });

  const expenses = expensesResult.results.map((row) => ({
    id: row.id,
    equipmentId: row.equipment_id,
    unit: row.unit,
    expenseDate: row.expense_date,
    year: dateYear(row.expense_date),
    category: row.category,
    amount: roundMoney(Number(row.amount ?? 0)),
    vendor: row.vendor ?? '',
    description: row.description ?? '',
    source: row.source,
  }));

  const maintenanceHistory = maintenanceResult.results.map((row) => ({
    id: row.id,
    equipmentId: row.equipment_id,
    unit: row.unit,
    eventType: row.event_type,
    pmType: row.pm_type ?? '',
    eventDate: row.event_date,
    year: dateYear(row.event_date),
    mileage: row.mileage == null ? null : Number(row.mileage),
    notes: row.notes ?? '',
    source: row.source,
  }));

  const cycleStats = new Map<number, { total: number; count: number }>();
  const pmCounts = new Map<number, number>();
  const annualCounts = new Map<number, number>();

  for (const event of maintenanceHistory) {
    if (event.eventType === 'pm') pmCounts.set(event.equipmentId, (pmCounts.get(event.equipmentId) ?? 0) + 1);
    if (event.eventType === 'annual') annualCounts.set(event.equipmentId, (annualCounts.get(event.equipmentId) ?? 0) + 1);
  }

  const unitCosts = equipmentResult.results.map((row) => {
    const rowRepairs = repairs.filter((repair) => repair.equipmentId === row.id);
    const yearRepairs = rowRepairs.filter((repair) => repair.year === selectedYear);
    const rowExpenses = expenses.filter((expense) => expense.equipmentId === row.id);
    const yearExpenses = rowExpenses.filter((expense) => expense.year === selectedYear);
    const completedCycles = rowRepairs.map((repair) => repair.repairCycleHours).filter((value): value is number => value != null);
    if (completedCycles.length) {
      cycleStats.set(row.id, { total: completedCycles.reduce((sum, value) => sum + value, 0), count: completedCycles.length });
    }

    const yearPartsCost = yearRepairs.reduce((sum, repair) => sum + repair.partsCost, 0);
    const yearLaborCost = yearRepairs.reduce((sum, repair) => sum + repair.laborCost, 0);
    const yearOutsideCost = yearRepairs.reduce((sum, repair) => sum + repair.outsideCost, 0);
    const yearRepairCost = yearRepairs.reduce((sum, repair) => sum + repair.totalCost, 0);
    const yearExpenseCost = yearExpenses.reduce((sum, expense) => sum + expense.amount, 0);
    const lifetimeRepairCost = rowRepairs.reduce((sum, repair) => sum + repair.totalCost, 0);
    const lifetimeExpenseCost = rowExpenses.reduce((sum, expense) => sum + expense.amount, 0);
    const purchasePrice = row.purchase_price == null ? null : Number(row.purchase_price);
    const residualValue = row.expected_residual_value == null ? null : Number(row.expected_residual_value);
    const purchaseCostYear = dateYear(row.purchase_date) === selectedYear ? (purchasePrice ?? 0) : 0;
    const lifetimeOperatingCost = lifetimeRepairCost + lifetimeExpenseCost;
    const lifetimeOwnershipCost = (purchasePrice ?? 0) + lifetimeOperatingCost;
    const netLifecycleCost = Math.max(0, lifetimeOwnershipCost - (residualValue ?? 0));
    const acquisitionMileage = row.acquisition_mileage == null ? null : Number(row.acquisition_mileage);
    const currentMileage = row.current_mileage == null ? null : Number(row.current_mileage);
    const milesOwned = currentMileage != null && acquisitionMileage != null && currentMileage > acquisitionMileage
      ? currentMileage - acquisitionMileage
      : null;
    const costBasisForMile = purchasePrice == null ? lifetimeOperatingCost : netLifecycleCost;

    return {
      equipmentId: row.id,
      unit: row.unit,
      category: displayCategory(row),
      equipmentType: row.equipment_type,
      modelYear: row.model_year,
      make: row.make ?? '',
      model: row.model ?? '',
      currentMileage,
      purchaseDate: row.purchase_date ?? '',
      purchasePrice: purchasePrice == null ? null : roundMoney(purchasePrice),
      inServiceDate: row.in_service_date ?? '',
      acquisitionMileage,
      expectedResidualValue: residualValue == null ? null : roundMoney(residualValue),
      retiredDate: row.retired_date ?? '',
      repairCountYear: yearRepairs.length,
      lifetimeRepairCount: rowRepairs.length,
      openRepairs: rowRepairs.filter((repair) => !isComplete(repair.status)).length,
      yearPartsCost: roundMoney(yearPartsCost),
      yearLaborCost: roundMoney(yearLaborCost),
      yearOutsideCost: roundMoney(yearOutsideCost),
      yearRepairCost: roundMoney(yearRepairCost),
      yearExpenseCost: roundMoney(yearExpenseCost),
      purchaseCostYear: roundMoney(purchaseCostYear),
      yearOperatingCost: roundMoney(yearRepairCost + yearExpenseCost),
      yearTotalCost: roundMoney(yearRepairCost + yearExpenseCost + purchaseCostYear),
      lifetimeRepairCost: roundMoney(lifetimeRepairCost),
      lifetimeExpenseCost: roundMoney(lifetimeExpenseCost),
      lifetimeOperatingCost: roundMoney(lifetimeOperatingCost),
      lifetimeOwnershipCost: roundMoney(lifetimeOwnershipCost),
      netLifecycleCost: roundMoney(netLifecycleCost),
      milesOwned,
      recordedCostPerMile: milesOwned ? roundMoney(costBasisForMile / milesOwned) : null,
      averageRepairCycleHours: completedCycles.length
        ? Math.round((completedCycles.reduce((sum, value) => sum + value, 0) / completedCycles.length) * 10) / 10
        : null,
      pmEvents: pmCounts.get(row.id) ?? 0,
      annualEvents: annualCounts.get(row.id) ?? 0,
      ownershipDataComplete: purchasePrice != null,
    };
  });

  unitCosts.sort((left, right) => right.yearOperatingCost - left.yearOperatingCost || left.unit.localeCompare(right.unit, undefined, { numeric: true }));

  const categoryMap = new Map<string, { category: string; units: number; repairCost: number; expenseCost: number; purchaseCost: number }>();
  for (const unit of unitCosts) {
    const entry = categoryMap.get(unit.category) ?? { category: unit.category, units: 0, repairCost: 0, expenseCost: 0, purchaseCost: 0 };
    entry.units += 1;
    entry.repairCost += unit.yearRepairCost;
    entry.expenseCost += unit.yearExpenseCost;
    entry.purchaseCost += unit.purchaseCostYear;
    categoryMap.set(unit.category, entry);
  }
  const categoryCosts = [...categoryMap.values()].map((entry) => ({
    ...entry,
    repairCost: roundMoney(entry.repairCost),
    expenseCost: roundMoney(entry.expenseCost),
    purchaseCost: roundMoney(entry.purchaseCost),
    operatingCost: roundMoney(entry.repairCost + entry.expenseCost),
    totalCost: roundMoney(entry.repairCost + entry.expenseCost + entry.purchaseCost),
  })).sort((left, right) => right.totalCost - left.totalCost);

  const years = new Set<number>([new Date().getUTCFullYear(), selectedYear]);
  repairs.forEach((repair) => { if (repair.year) years.add(repair.year); });
  expenses.forEach((expense) => { if (expense.year) years.add(expense.year); });
  equipmentResult.results.forEach((row) => { const year = dateYear(row.purchase_date); if (year) years.add(year); });
  maintenanceHistory.forEach((event) => { if (event.year) years.add(event.year); });
  const yearList = [...years].sort((a, b) => a - b);
  const trendMap = new Map(yearList.map((year) => [year, { year, repairCost: 0, expenseCost: 0, purchaseCost: 0, repairCount: 0 }]));
  for (const repair of repairs) {
    if (!repair.year) continue;
    const entry = trendMap.get(repair.year);
    if (!entry) continue;
    entry.repairCost += repair.totalCost;
    entry.repairCount += 1;
  }
  for (const expense of expenses) {
    if (!expense.year) continue;
    const entry = trendMap.get(expense.year);
    if (entry) entry.expenseCost += expense.amount;
  }
  for (const row of equipmentResult.results) {
    const year = dateYear(row.purchase_date);
    if (!year || row.purchase_price == null) continue;
    const entry = trendMap.get(year);
    if (entry) entry.purchaseCost += Number(row.purchase_price);
  }
  const yearlyTrend = [...trendMap.values()].map((entry) => ({
    year: entry.year,
    repairCount: entry.repairCount,
    repairCost: roundMoney(entry.repairCost),
    expenseCost: roundMoney(entry.expenseCost),
    purchaseCost: roundMoney(entry.purchaseCost),
    operatingCost: roundMoney(entry.repairCost + entry.expenseCost),
    totalCost: roundMoney(entry.repairCost + entry.expenseCost + entry.purchaseCost),
  }));

  const partMap = new Map<string, { partNumber: string; description: string; quantity: number; cost: number; repairs: Set<number>; units: Set<string> }>();
  for (const row of partUsageResult.results) {
    if (dateYear(row.opened_at) !== selectedYear) continue;
    const key = row.part_number.toLowerCase();
    const entry = partMap.get(key) ?? {
      partNumber: row.part_number,
      description: row.description,
      quantity: 0,
      cost: 0,
      repairs: new Set<number>(),
      units: new Set<string>(),
    };
    const unitCost = row.snapshot_unit_cost == null ? Number(row.current_unit_cost ?? 0) : Number(row.snapshot_unit_cost);
    entry.quantity += Number(row.quantity ?? 0);
    entry.cost += Number(row.quantity ?? 0) * unitCost;
    entry.repairs.add(row.repair_id);
    if (row.unit) entry.units.add(row.unit);
    partMap.set(key, entry);
  }
  const partsUsage = [...partMap.values()].map((entry) => ({
    partNumber: entry.partNumber,
    description: entry.description,
    quantity: Math.round(entry.quantity * 100) / 100,
    repairCount: entry.repairs.size,
    unitCount: entry.units.size,
    units: [...entry.units].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    cost: roundMoney(entry.cost),
  })).sort((left, right) => right.cost - left.cost || right.quantity - left.quantity);

  const issueMap = new Map<string, { issue: string; repairs: number; cost: number; units: Set<string> }>();
  for (const repair of repairs.filter((item) => item.year === selectedYear)) {
    const key = repair.title.trim().toLowerCase();
    const entry = issueMap.get(key) ?? { issue: repair.title.trim() || 'Unspecified repair', repairs: 0, cost: 0, units: new Set<string>() };
    entry.repairs += 1;
    entry.cost += repair.totalCost;
    if (repair.unit) entry.units.add(repair.unit);
    issueMap.set(key, entry);
  }
  const issueAnalysis = [...issueMap.values()].map((entry) => ({
    issue: entry.issue,
    repairCount: entry.repairs,
    unitCount: entry.units.size,
    totalCost: roundMoney(entry.cost),
    averageCost: entry.repairs ? roundMoney(entry.cost / entry.repairs) : 0,
  })).sort((left, right) => right.totalCost - left.totalCost || right.repairCount - left.repairCount);

  const technicianMap = new Map<string, { technician: string; repairs: number; completed: number; cost: number; cycleTotal: number; cycleCount: number }>();
  for (const repair of repairs.filter((item) => item.year === selectedYear)) {
    const name = repair.technician || 'Unassigned';
    const entry = technicianMap.get(name) ?? { technician: name, repairs: 0, completed: 0, cost: 0, cycleTotal: 0, cycleCount: 0 };
    entry.repairs += 1;
    if (isComplete(repair.status)) entry.completed += 1;
    entry.cost += repair.totalCost;
    if (repair.repairCycleHours != null) {
      entry.cycleTotal += repair.repairCycleHours;
      entry.cycleCount += 1;
    }
    technicianMap.set(name, entry);
  }
  const technicianAnalysis = [...technicianMap.values()].map((entry) => ({
    technician: entry.technician,
    repairCount: entry.repairs,
    completedCount: entry.completed,
    totalCost: roundMoney(entry.cost),
    averageRepairCycleHours: entry.cycleCount ? Math.round((entry.cycleTotal / entry.cycleCount) * 10) / 10 : null,
  })).sort((left, right) => right.repairCount - left.repairCount || right.totalCost - left.totalCost);

  const yearRepairs = repairs.filter((repair) => repair.year === selectedYear);
  const yearExpenses = expenses.filter((expense) => expense.year === selectedYear);
  const completedCycles = yearRepairs.map((repair) => repair.repairCycleHours).filter((value): value is number => value != null);
  const repairSpend = yearRepairs.reduce((sum, repair) => sum + repair.totalCost, 0);
  const expenseSpend = yearExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const purchaseSpend = unitCosts.reduce((sum, unit) => sum + unit.purchaseCostYear, 0);
  const totalPartLines = repairs.reduce((sum, repair) => sum + repair.partLines, 0);
  const snapshotPartLines = repairs.reduce((sum, repair) => sum + repair.snapshotPartLines, 0);
  const pricedPartLines = repairs.reduce((sum, repair) => sum + repair.pricedPartLines, 0);
  const laborEntered = repairs.filter((repair) => repair.laborHours > 0 || repair.laborRate > 0).length;
  const purchaseEntered = unitCosts.filter((unit) => unit.purchasePrice != null).length;

  return {
    years: [...years].sort((a, b) => b - a),
    selectedYear,
    summary: {
      activeUnits: unitCosts.length,
      repairsInYear: yearRepairs.length,
      completedRepairsInYear: yearRepairs.filter((repair) => isComplete(repair.status)).length,
      openRepairs: repairs.filter((repair) => !isComplete(repair.status)).length,
      partsSpend: roundMoney(yearRepairs.reduce((sum, repair) => sum + repair.partsCost, 0)),
      laborSpend: roundMoney(yearRepairs.reduce((sum, repair) => sum + repair.laborCost, 0)),
      outsideRepairSpend: roundMoney(yearRepairs.reduce((sum, repair) => sum + repair.outsideCost, 0)),
      repairSpend: roundMoney(repairSpend),
      ownershipExpenseSpend: roundMoney(expenseSpend),
      purchaseSpend: roundMoney(purchaseSpend),
      operatingCost: roundMoney(repairSpend + expenseSpend),
      totalCost: roundMoney(repairSpend + expenseSpend + purchaseSpend),
      averageRepairCost: yearRepairs.length ? roundMoney(repairSpend / yearRepairs.length) : 0,
      averageRepairCycleHours: completedCycles.length
        ? Math.round((completedCycles.reduce((sum, value) => sum + value, 0) / completedCycles.length) * 10) / 10
        : null,
      fleetLifetimeOperatingCost: roundMoney(unitCosts.reduce((sum, unit) => sum + unit.lifetimeOperatingCost, 0)),
      fleetLifetimeOwnershipCost: roundMoney(unitCosts.reduce((sum, unit) => sum + unit.lifetimeOwnershipCost, 0)),
    },
    unitCosts,
    categoryCosts,
    yearlyTrend,
    repairHistory: repairs,
    partsUsage,
    issueAnalysis,
    technicianAnalysis,
    maintenanceHistory,
    expenses,
    expenseCategories: ['Fuel', 'Insurance', 'Registration', 'Lease', 'Tires', 'Towing', 'Road service', 'Licensing', 'Taxes', 'Warranty', 'Body work', 'Outside maintenance', 'Other'],
    dataQuality: {
      totalUnits: unitCosts.length,
      unitsWithPurchasePrice: purchaseEntered,
      totalRepairs: repairs.length,
      repairsWithLaborEntry: laborEntered,
      totalPartLines,
      pricedPartLines,
      snapshotPartLines,
      ownershipExpenseEntries: expenses.length,
    },
    updatedAt: new Date().toISOString(),
  };
}

function positiveId(value: unknown, label: string) {
  const raw = String(value ?? '').replace(/^repair-/, '');
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} is invalid.`);
  return id;
}

function optionalMoney(value: unknown, label: string) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be zero or greater.`);
  return roundMoney(number);
}

function optionalMileage(value: unknown, label: string) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} must be zero or a positive whole number.`);
  return number;
}

function dateOnly(value: unknown, label: string, required = false) {
  const text = String(value ?? '').trim();
  if (!text && !required) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error(`${label} must be a valid date.`);
  }
  return text;
}

export async function handleReportingAction(db: D1Database, body: Record<string, unknown>) {
  const action = String(body.action ?? '');

  if (action === 'saveUnitFinancials') {
    const equipmentId = positiveId(body.equipmentId, 'Unit');
    const purchaseDate = dateOnly(body.purchaseDate, 'Purchase date');
    const purchasePrice = optionalMoney(body.purchasePrice, 'Purchase price');
    const inServiceDate = dateOnly(body.inServiceDate, 'In-service date');
    const acquisitionMileage = optionalMileage(body.acquisitionMileage, 'Acquisition mileage');
    const expectedResidualValue = optionalMoney(body.expectedResidualValue, 'Expected residual value');
    const retiredDate = dateOnly(body.retiredDate, 'Retired date');

    const result = await db.prepare(`
      UPDATE equipment
      SET purchase_date = ?, purchase_price = ?, in_service_date = ?, acquisition_mileage = ?,
          expected_residual_value = ?, retired_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND active = 1
    `).bind(
      purchaseDate,
      purchasePrice,
      inServiceDate,
      acquisitionMileage,
      expectedResidualValue,
      retiredDate,
      equipmentId,
    ).run();
    if (!result.meta.changes) throw new Error('Unit was not found.');
    return { ok: true, equipmentId };
  }

  if (action === 'addExpense') {
    const equipmentId = positiveId(body.equipmentId, 'Unit');
    const expenseDate = dateOnly(body.expenseDate, 'Expense date', true)!;
    const category = String(body.category ?? '').trim();
    if (!category) throw new Error('Expense category is required.');
    const amount = optionalMoney(body.amount, 'Expense amount');
    if (amount == null || amount <= 0) throw new Error('Expense amount must be greater than zero.');
    const vendor = String(body.vendor ?? '').trim().slice(0, 200);
    const description = String(body.description ?? '').trim().slice(0, 500);
    const equipment = await db.prepare('SELECT id FROM equipment WHERE id = ? AND active = 1').bind(equipmentId).first<{ id: number }>();
    if (!equipment) throw new Error('Unit was not found.');
    const result = await db.prepare(`
      INSERT INTO unit_expenses (equipment_id, expense_date, category, amount, vendor, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(equipmentId, expenseDate, category, amount, vendor, description).run();
    return { ok: true, id: result.meta.last_row_id };
  }

  if (action === 'deleteExpense') {
    const id = positiveId(body.id, 'Expense');
    await db.prepare('DELETE FROM unit_expenses WHERE id = ?').bind(id).run();
    return { ok: true, id };
  }

  if (action === 'saveRepairCost') {
    const repairId = positiveId(body.repairId, 'Repair');
    const laborHours = optionalMoney(body.laborHours, 'Labor hours') ?? 0;
    const laborRate = optionalMoney(body.laborRate, 'Labor rate');
    const outsideCost = optionalMoney(body.outsideCost, 'Outside repair cost') ?? 0;
    const result = await db.prepare(`
      UPDATE repairs
      SET labor_hours = ?, labor_rate = ?, outside_cost = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(laborHours, laborRate, outsideCost, repairId).run();
    if (!result.meta.changes) throw new Error('Repair was not found.');
    return { ok: true, repairId };
  }

  throw new Error('Unknown reporting action.');
}
