import { buildReportXlsx, XLSX_MIME } from './report-xlsx.js';

const text = (value) => String(value ?? '');
const finite = (value) => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const equipmentLabel = (value) => ({ truck: 'Truck', trailer: 'Trailer' }[text(value).trim().toLowerCase()] || text(value) || 'Not recorded');
const escape = (value) => text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function localDate(value) {
  if (!value) return '';
  const raw = text(value), iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleString();
}
const money = (value) => finite(value) == null ? 'Not recorded' : Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const hours = (value) => finite(value) == null ? 'Not recorded' : `${(Number(value) / 60).toLocaleString('en-US', { maximumFractionDigits: 1 })} hr`;

// Build from the already-filtered, already-sorted data, never from a scroll viewport
// or draft form controls. This is a read-only export and sends no requests.
export function buildBreakdownDetailExport(records, options = {}) {
  const columns = [
    { key: 'id', header: 'Breakdown', width: 12 },
    { key: 'createdAt', header: 'Date (local)', width: 24 },
    { key: 'unit', header: 'Unit', width: 14 },
    { key: 'equipmentType', header: 'Equipment Type', width: 16 },
    ...(options.showTireDetails ? [{ key: 'tirePositions', header: 'Tire Positions / Sizes', width: 58 }] : []),
    { key: 'driverName', header: 'Driver', width: 26 },
    { key: 'category', header: 'Category', width: 22 },
    { key: 'serviceProvider', header: 'Provider', width: 28 },
    { key: 'location', header: 'Location', width: 24 },
    { key: 'status', header: 'Status', width: 18 },
    { key: 'arrivalMinutes', header: 'Arrival Minutes', width: 18, format: 'number' },
    { key: 'downtimeMinutes', header: 'Downtime Minutes', width: 20, format: 'number' },
    { key: 'partsCost', header: 'Parts', width: 16, format: 'money' },
    { key: 'laborCost', header: 'Labor', width: 16, format: 'money' },
    { key: 'outsideCost', header: 'Outside', width: 16, format: 'money' },
    { key: 'totalCost', header: 'Total', width: 16, format: 'money' },
    { key: 'repairNeeded', header: 'Repair Needed', width: 48 },
    { key: 'description', header: 'Description', width: 70 },
  ];
  const items = records.map((record) => {
    const result = { ...record, unit: text(record.unit), id: finite(record.id), createdAt: localDate(record.createdAt), equipmentType: equipmentLabel(record.equipmentType), tirePositions: text(record.tirePositions) || 'Not recorded' };
    for (const key of ['arrivalMinutes', 'downtimeMinutes', 'partsCost', 'laborCost', 'outsideCost', 'totalCost']) result[key] = finite(record[key]);
    return result;
  });
  const filters = options.filters || {}, range = options.range || {};
  const count = finite(options.totalCount) ?? records.length;
  const partial = Boolean(options.truncated) || count > records.length;
  const note = partial ? `PARTIAL REPORT: ${records.length} of ${count} matching breakdowns. Narrow the filters to include every row.` : `${records.length} breakdowns. All loaded detail rows are included, not just the visible scroll area.`;
  const metadata = [
    ['Report', 'Breakdown Detail'], ['Start date', text(range.startDate)], ['End date', text(range.endDate)],
    ['Equipment', filters.equipmentType ? equipmentLabel(filters.equipmentType) : 'All equipment'],
    ['Unit', filters.equipmentId ? text(options.units?.find((item) => Number(item.id) === Number(filters.equipmentId))?.unit || filters.equipmentId) : 'All units'],
    ['Tire position filter', text(filters.tirePosition) || 'All positions / no tire filter'],
    ...[['category', 'Category'], ['provider', 'Provider'], ['status', 'Status'], ['location', 'Location'], ['query', 'Search']].map(([key, label]) => [label, text(filters[key]) || 'All']),
    ['Sort order', `${text(options.sortKey) || 'createdAt'} ${options.sortDir === 'asc' ? 'ascending' : 'descending'}`],
    ['Tire detail column', options.showTireDetails ? 'Included' : 'Hidden'], ['Exported rows', records.length], ['Matching rows', count],
    ['Scope', note], ['Date timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'Browser local time'],
    ['Costs', 'Whole breakdown costs, not individual tire prices. Each breakdown is counted once.'],
    ['Source', text(options.source)],
  ];
  const safeDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) ? text(value) : 'report';
  return { columns, rows: items.map((row) => columns.map((col) => row[col.key] ?? '')), items, metadata, note, partial,
    filename: `breakdown-detail-${safeDate(range.startDate)}-to-${safeDate(range.endDate)}`, showTireDetails: Boolean(options.showTireDetails) };
}

export function breakdownDetailCsv(report) {
  function cell(value) {
    let output = text(value);
    // CSV opened in a spreadsheet must not interpret driver/provider text as a formula.
    if (typeof value !== 'number' && (/^[\s\uFEFF]*[=+@-]/.test(output) || /^[\t\r\n]/.test(output))) output = `'${output}`;
    return `"${output.replace(/"/g, '""')}"`;
  }
  return '\uFEFF' + [report.columns.map((col) => col.header), ...report.rows].map((row) => row.map(cell).join(',')).join('\r\n');
}
export function breakdownDetailXlsx(report) { return buildReportXlsx(report.columns, report.rows, report.metadata); }
export function breakdownDetailPrintHtml(report) {
  const fields = report.metadata.filter(([key]) => !['Report', 'Source', 'Costs', 'Scope'].includes(key));
  // A two-line record layout keeps the full detail readable on landscape letter.
  // Long descriptions and tire details wrap below the row instead of being clipped.
  const rows = report.items.map((row) => `<tbody class="record"><tr>
    <td><strong>#${escape(row.id)}</strong><br>${escape(row.createdAt)}</td>
    <td><strong>${escape(row.unit)}</strong><br>${escape(row.equipmentType)}</td>
    <td>${escape(row.driverName)}</td><td>${escape(row.category)}<br>${escape(row.status)}</td>
    <td>${escape(row.serviceProvider || 'Unassigned')}<br>${escape(row.location)}</td>
    <td>Arrival: ${escape(hours(row.arrivalMinutes))}<br>Downtime: ${escape(hours(row.downtimeMinutes))}</td>
    <td>Parts: ${escape(money(row.partsCost))}<br>Labor: ${escape(money(row.laborCost))}<br>Outside: ${escape(money(row.outsideCost))}<br><strong>Total: ${escape(money(row.totalCost))}</strong></td>
    </tr><tr><td colspan="7" class="description">${report.showTireDetails ? `<div><strong>Tire positions / sizes:</strong> ${escape(row.tirePositions)}</div>` : ''}
    <div><strong>Repair Needed:</strong> ${escape(row.repairNeeded || 'Not recorded')}</div>
    <div><strong>Description:</strong> ${escape(row.description || 'Not recorded')}</div></td></tr></tbody>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Breakdown Detail</title><style>
    @page { size: letter landscape; margin: .35in; }
    * { box-sizing: border-box; } body { font: 10px/1.45 Arial, sans-serif; color: #172033; margin: 0; }
    h1 { font-size: 21px; margin: 0 0 6px; } .filters { font-size: 9px; margin: 6px 0 10px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; } thead { display: table-header-group; }
    th { text-align: left; padding: 6px; background: #e8edf2; } td { vertical-align: top; padding: 6px; overflow-wrap: anywhere; }
    th:nth-child(1) { width: 13%; } th:nth-child(2) { width: 9%; } th:nth-child(3) { width: 13%; } th:nth-child(4) { width: 14%; } th:nth-child(5) { width: 20%; } th:nth-child(6) { width: 14%; } th:nth-child(7) { width: 17%; }
    tbody.record { break-inside: avoid; } .description { border-bottom: 1px solid #bcc6d0; padding-bottom: 10px; white-space: pre-wrap; }
    .note { font-weight: bold; } .toolbar { margin-bottom: 14px; } button { padding: 8px 12px; cursor: pointer; }
    @media print { .toolbar { display: none; } }
  </style></head><body><div class="toolbar"><button id="print-detail" type="button">Print / Save PDF</button></div>
    <h1>Breakdown Detail</h1><p class="note">${escape(report.note)}</p>
    <div class="filters">${fields.map(([key, value]) => `<strong>${escape(key)}:</strong> ${escape(value)}`).join(' &nbsp; | &nbsp; ')}</div>
    <p>Whole breakdown costs, not individual tire prices. Each breakdown is counted once.</p>
    <table><thead><tr><th>Breakdown / Date</th><th>Unit / Type</th><th>Driver</th><th>Category / Status</th><th>Provider / Location</th><th>Response / Downtime</th><th>Costs</th></tr></thead>${rows}</table></body></html>`;
}
export function saveBreakdownDetail(report, format, browser = window) {
  if (!['csv', 'xlsx'].includes(format)) throw new TypeError('Unknown export format.');
  const data = format === 'xlsx' ? breakdownDetailXlsx(report) : breakdownDetailCsv(report);
  const blob = new Blob([data], { type: format === 'xlsx' ? XLSX_MIME : 'text/csv;charset=utf-8' });
  const url = browser.URL.createObjectURL(blob), anchor = browser.document.createElement('a');
  anchor.href = url; anchor.download = `${report.filename}.${format}`; anchor.style.display = 'none';
  browser.document.body.appendChild(anchor);
  try { anchor.click(); } finally { anchor.remove(); browser.setTimeout(() => browser.URL.revokeObjectURL(url), 60000); }
}
export function printBreakdownDetail(report, browser = window) {
  const html = breakdownDetailPrintHtml(report);
  // Open synchronously in the click handler so normal browser popup permission applies.
  const target = browser.open('', '_blank', 'width=1400,height=900');
  if (!target) throw new Error('The browser blocked the print window. Allow pop-ups for this site, then try again.');
  try {
    target.opener = null;
    target.document.open(); target.document.write(html); target.document.close();
    target.document.getElementById('print-detail')?.addEventListener('click', () => target.print());
    browser.setTimeout(() => { if (!target.closed) { target.focus(); target.print(); } }, 250);
  } catch (error) { target.close(); throw error; }
}
