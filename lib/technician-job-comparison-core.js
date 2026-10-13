/**
 * Like-for-like time comparison is only a descriptive labor-time benchmark:
 * completed, single-tech, classified jobs with timer-confirmed hours and
 * opened/completed dates inside the report period. It is NOT a time standard
 * or an appraisal of quality/skill. Shared jobs are reported separately.
 */
const numeric = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const hours = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const pct = value => Math.round((Number(value) + Number.EPSILON) * 10) / 10;
const normalized = value => String(value ?? '').trim();

export function classifyTechnicianJob(row) {
  const source = normalized(row.source).toLowerCase();
  const event = normalized(row.maintenance_event_type).toLowerCase();
  const typeId = Math.max(0, Math.trunc(numeric(row.repair_type_id)));
  const typeName = normalized(row.repair_type_name);
  const templateId = Math.max(0, Math.trunc(numeric(row.maintenance_template_id)));
  const version = Math.max(0, Math.trunc(numeric(row.maintenance_template_version)));
  const templateName = normalized(row.maintenance_template_name);
  if (source === 'scheduled-pm' || event === 'pm') {
    return templateId > 0
      ? { key: 'pm:' + templateId, name: 'PM – ' + (templateName || 'Checklist') + (version ? ' (v' + version + ')' : ''), scope: 'PM', comparable: true }
      : { key: 'pm:unspecified', name: 'PM – checklist not specified', scope: 'PM', comparable: false };
  }
  if (source === 'scheduled-annual' || event === 'annual') {
    return templateId > 0
      ? { key: 'annual:' + templateId, name: 'Annual – ' + (templateName || 'Checklist') + (version ? ' (v' + version + ')' : ''), scope: 'Annual', comparable: true }
      : { key: 'annual:unspecified', name: 'Annual – checklist not specified', scope: 'Annual', comparable: false };
  }
  if (typeId > 0 && typeName && typeName.toUpperCase() !== 'INDIRECT LABOR-OTHER') {
    return { key: 'repair-type:' + typeId, name: typeName, scope: 'Repair type', comparable: true };
  }
  return { key: 'uncategorized', name: 'Unclassified repair', scope: 'Unclassified', comparable: false };
}

function excludeReason(job, start, end, shared) {
  if (!job.category.comparable) return job.category.scope === 'Unclassified'
    ? 'No repair type selected' : 'No versioned PM/Annual checklist';
  if (shared) return 'Multiple technicians worked this WO; shown under Shared Work Orders';
  if (numeric(job.untimedHours) > 0.005) return 'Manual/legacy labor without timer timestamps';
  const status = normalized(job.status).toLowerCase();
  if (status !== 'completed' && !status.startsWith('completed ')) {
    return 'WO is not completed';
  }
  const opened = normalized(job.openedAt).slice(0, 10);
  const completed = normalized(job.completedAt).slice(0, 10);
  if (!opened || !completed || opened < start || opened > end || completed < start || completed > end) {
    return 'WO opened or completed outside selected dates / missing dates';
  }
  return '';
}

export function buildTechnicianJobComparisons(rows, range) {
  if (!Array.isArray(rows) || !range || !range.startDate || !range.endDate) {
    throw new RangeError('Valid work order data and a date range are required.');
  }
  if (rows.length >= 10001) {
    throw new RangeError('More than 10,000 technician/work-order combinations match. Choose a shorter date range for accurate comparisons.');
  }
  const mapped = rows.map(row => {
    const category = classifyTechnicianJob(row);
    return {
      technicianId: Number(row.technician_id),
      technician: String(row.technician_name || 'Unknown technician'),
      repairId: Number(row.repair_id),
      title: normalized(row.title) || 'Untitled repair',
      unit: normalized(row.unit) || 'SHOP / NO UNIT',
      source: normalized(row.source),
      status: normalized(row.status),
      openedAt: normalized(row.opened_at),
      completedAt: normalized(row.completed_at),
      firstDate: normalized(row.first_labor_date),
      lastDate: normalized(row.last_labor_date),
      laborEntries: Number(row.entries || 0),
      hours: hours(numeric(row.hours)),
      untimedHours: hours(numeric(row.untimed_hours)),
      category,
    };
  });

  // Each job may contain several technician entries. Do NOT compare portions
  // of multi-technician repairs to a full single-tech repair as equivalent jobs.
  const byRepair = new Map();
  for (const job of mapped) {
    const members = byRepair.get(job.repairId) || [];
    members.push(job);
    byRepair.set(job.repairId, members);
  }
  const sharedRepairs = [...byRepair.values()]
    .filter(members => new Set(members.map(job => job.technicianId)).size > 1)
    .map(members => {
      const totalHours = members.reduce((sum, job) => sum + job.hours, 0);
      const first = members[0];
      return {
        repairId: first.repairId, title: first.title, unit: first.unit,
        status: first.status, category: first.category.name,
        totalHours: hours(totalHours),
        members: members.map(job => ({
          technicianId: job.technicianId,
          technician: job.technician,
          hours: job.hours,
          sharePercent: totalHours > 0 ? pct(job.hours * 100 / totalHours) : null,
          untimedHours: job.untimedHours,
        })).sort((a,b) => b.hours - a.hours || a.technician.localeCompare(b.technician)),
      };
    }).sort((a,b) => b.totalHours - a.totalHours || b.repairId - a.repairId);

  const eligible = [];
  let unclassifiedCount = 0, incompleteCount = 0, manualCount = 0;
  const workOrders = mapped.map(job => {
    const shared = (byRepair.get(job.repairId)?.length || 0) > 1;
    const excludedReason = excludeReason(job, range.startDate, range.endDate, shared);
    if (!job.category.comparable) unclassifiedCount += 1;
    if (!excludedReason) eligible.push(job);
    else if (excludedReason === 'WO is not completed') incompleteCount += 1;
    else if (excludedReason.startsWith('Manual/legacy')) manualCount += 1;
    return { ...job, comparable: !excludedReason, excludedReason };
  });

  const categories = new Map();
  for (const job of workOrders) {
    const previous = categories.get(job.category.key) || {
      key: job.category.key, name: job.category.name, scope: job.category.scope,
      comparable: job.category.comparable, totalHours: 0, workOrderIds: new Set(),
      technicianIds: new Set(), eligibleJobs: 0, eligibleHours: 0,
    };
    previous.totalHours += job.hours;
    previous.workOrderIds.add(job.repairId);
    previous.technicianIds.add(job.technicianId);
    if (job.comparable) { previous.eligibleJobs += 1; previous.eligibleHours += job.hours; }
    categories.set(job.category.key, previous);
  }
  const jobTypes = [...categories.values()].map(c => ({
    key: c.key, name: c.name, scope: c.scope, comparable: c.comparable,
    totalHours: hours(c.totalHours), jobs: c.workOrderIds.size,
    technicians: c.technicianIds.size, eligibleJobs: c.eligibleJobs,
    eligibleHours: hours(c.eligibleHours),
    averageEligibleHours: c.eligibleJobs ? hours(c.eligibleHours / c.eligibleJobs) : null,
  })).sort((a,b) => b.jobs - a.jobs || a.name.localeCompare(b.name));

  // Exclude the technician's own jobs from their peer comparison.
  // Each eligible work order is exclusively attributed to a single tech.
  const peers = new Map();
  for (const job of eligible) {
    const techs = peers.get(job.category.key) || new Map();
    const own = techs.get(job.technicianId) || {
      technicianId: job.technicianId, technician: job.technician, category: job.category,
      jobCount: 0, totalHours: 0, jobs: [],
    };
    own.jobCount += 1;
    own.totalHours += job.hours;
    own.jobs.push(job.repairId);
    techs.set(job.technicianId, own);
    peers.set(job.category.key, techs);
  }
  const comparisons = [];
  for (const [,techs] of peers) {
    if (techs.size < 2) continue;
    const totals = [...techs.values()];
    const sumHours = totals.reduce((n,v) => n + v.totalHours, 0);
    const sumJobs = totals.reduce((n,v) => n + v.jobCount, 0);
    for (const person of totals) {
      const peerHours = sumHours - person.totalHours;
      const peerJobs = sumJobs - person.jobCount;
      const peerTechnicians = totals.length - 1;
      const ownAvg = person.totalHours / person.jobCount;
      const peerAvg = peerJobs ? peerHours / peerJobs : null;
      comparisons.push({
        categoryKey: person.category.key,
        jobType: person.category.name,
        scope: person.category.scope,
        technicianId: person.technicianId,
        technician: person.technician,
        jobCount: person.jobCount,
        totalHours: hours(person.totalHours),
        averageHours: hours(ownAvg),
        peerJobs,
        peerTechnicians,
        peerAverageHours: peerAvg === null ? null : hours(peerAvg),
        // +30% = took 30% more logged labor hours than the other technicians'
        // average for the same classified job; -20% = 20% fewer hours.
        timeVsPeersPercent: peerAvg !== null && peerAvg > 0 ? pct((ownAvg / peerAvg - 1) * 100) : null,
        sample: person.jobCount >= 3 && peerJobs >= 3 && peerTechnicians >= 2 ? 'More observations' : 'Small comparison sample',
      });
    }
  }
  comparisons.sort((a,b) => a.jobType.localeCompare(b.jobType) || a.technician.localeCompare(b.technician));

  return {
    summary: {
      technicianJobRows: mapped.length, uniqueWorkOrders: byRepair.size,
      recordedDirectHours: hours(mapped.reduce((n,j) => n + j.hours, 0)),
      comparableJobs: eligible.length, comparableHours: hours(eligible.reduce((n,j) => n + j.hours, 0)),
      sharedWorkOrders: sharedRepairs.length, comparisonRows: comparisons.length,
      unclassifiedOrUnversionedRows: unclassifiedCount,
      openWorkOrderRows: incompleteCount,
      untimedExcludedRows: manualCount,
    },
    jobTypes, comparisons, sharedRepairs, workOrders,
  };
}
