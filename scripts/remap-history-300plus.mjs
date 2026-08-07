import fs from 'node:fs';
import path from 'node:path';

const IMPORT_KEY = 'ro-history-9309499-v1';
const EXPECTED_ROS = 15929;
const TERMINAL = new Set(['CLOSED', 'INVOICED', 'COMPLETTED']);

const [payloadPath, equipmentPath, outputDir] = process.argv.slice(2);
if (!payloadPath || !equipmentPath || !outputDir) throw new Error('Usage: node remap-history-300plus.mjs payload.json equipment.json output-dir');

const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const norm = (value) => clean(value, 100).toUpperCase().replace(/\s+/g, ' ');
const num = (value) => { const n = Number(value ?? 0); return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : 0; };
const sqlText = (value) => `'${String(value ?? '').replaceAll("'", "''")}'`;
const sqlNum = (value) => String(num(value));

function majorCategory(systemValue) {
  const system = clean(systemValue, 20).toUpperCase();
  if (system === 'PM') return 'Preventive Maintenance & Inspections';
  const groups = [
    [['013'], 'Brakes'], [['017', '018'], 'Tires, Wheels & Bearings'], [['070', '071', '072', '077', '176'], 'Trailer & Body'],
    [['034'], 'Lighting'], [['030'], 'Electrical Wiring'], [['031', '032'], 'Starting, Charging & Batteries'],
    [['033', '037'], 'Diagnostics & Electronic Modules'], [['040', '041', '042', '043', '044', '045'], 'Engine, Cooling, Exhaust & Fuel'],
    [['001'], 'HVAC'], [['002', '010', '014'], 'Cab, Body & Frame'], [['016', '113'], 'Suspension & Alignment'],
    [['011', '012', '020', '021', '022'], 'Axles, Hubs & Seals'], [['023', '024', '026', '027', '028'], 'Drivetrain & Transmission'],
    [['015'], 'Steering'], [['059'], 'Coupling & Fifth Wheel'], [['036', '051'], 'Telematics, Cameras & GPS'],
    [['003'], 'Instruments, Switches & Gauges'], [['050', '052', '053', '054'], 'Accessories & Safety Equipment'],
    [['019'], 'Lubrication Systems'], [['047'], 'Filters / Multi-System'], [['049', '065', '112'], 'Hydraulics'],
    [['055'], 'Liftgate & Material Handling'], [['006'], 'Aerodynamics'], [['094'], 'Bulk Product Transfer'],
    [['100'], 'Outside Service / Road Calls'], [['103'], 'Indirect Shop Labor'], [['104'], 'Shop Supplies'],
    [['105'], 'Transfer / Internal Movement'], [['151', '153'], 'APU & Generator'], [['152', '174'], 'Specialty Body Systems'],
  ];
  for (const [systems, name] of groups) if (systems.includes(system)) return name;
  return system ? `Other / System ${system}` : 'Other / Unclassified';
}

function unwrapWranglerResults(value) {
  if (Array.isArray(value)) return value.flatMap((entry) => Array.isArray(entry?.results) ? entry.results : []);
  return Array.isArray(value?.results) ? value.results : [];
}

const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const equipmentRaw = JSON.parse(fs.readFileSync(equipmentPath, 'utf8'));
const equipment = unwrapWranglerResults(equipmentRaw);
if (payload?.v !== 1 || !Array.isArray(payload.rows) || !Array.isArray(payload.cats)) throw new Error('Invalid remap payload.');

const byNumber = new Map();
for (const row of equipment) {
  const match = norm(row.unit).match(/^(\d+)\s*\(\s*(DC|BT|SC)\s*\)$/);
  if (!match) continue;
  const key = String(Number(match[1]));
  const entry = byNumber.get(key) ?? [];
  entry.push({ id: Number(row.id), unit: String(row.unit), type: match[2] });
  byNumber.set(key, entry);
}

const roMap = new Map();
for (const row of payload.rows) {
  const [unit, roNumber, roDate, locationIndex, statusIndex, categoryIndex, laborHours, laborCost, partsCost, subletCost, totalCost] = row;
  let ro = roMap.get(roNumber);
  if (!ro) {
    ro = { unit: clean(unit, 100), roNumber: clean(roNumber, 80), roDate: clean(roDate, 10), location: clean(payload.locs?.[locationIndex] ?? '', 160), status: norm(payload.sts?.[statusIndex] ?? ''), lines: [] };
    roMap.set(roNumber, ro);
  }
  const category = payload.cats[categoryIndex] ?? ['', '', ''];
  ro.lines.push({ systemCode: clean(category[0], 20).toUpperCase(), assemblyCode: clean(category[1], 30).toUpperCase(), description: clean(category[2], 500) || 'Unspecified repair', laborHours: num(laborHours), laborCost: num(laborCost), partsCost: num(partsCost), subletCost: num(subletCost), totalCost: num(totalCost) });
}

const remaps = [];
const conflicts = [];
for (const ro of roMap.values()) {
  if (!TERMINAL.has(ro.status)) continue;
  if (!/^\d+$/.test(ro.unit) || Number(ro.unit) < 300) continue;
  const matches = byNumber.get(String(Number(ro.unit))) ?? [];
  if (matches.length === 1) remaps.push({ ro, equipment: matches[0] });
  else conflicts.push({ unit: ro.unit, roNumber: ro.roNumber, matchCount: matches.length });
}
if (conflicts.length) throw new Error(`Safety stop: ${conflicts.length} remap ROs no longer have exactly one DC/BT/SC target.`);
if (remaps.length !== EXPECTED_ROS) throw new Error(`Safety stop: expected ${EXPECTED_ROS} remap ROs but found ${remaps.length}.`);

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

function roSql(item) {
  const { ro, equipment } = item;
  const laborHours = ro.lines.reduce((s, x) => s + x.laborHours, 0), laborCost = ro.lines.reduce((s, x) => s + x.laborCost, 0), partsCost = ro.lines.reduce((s, x) => s + x.partsCost, 0), subletCost = ro.lines.reduce((s, x) => s + x.subletCost, 0), totalCost = ro.lines.reduce((s, x) => s + x.totalCost, 0);
  const statements = [`INSERT OR IGNORE INTO historical_repairs (import_key,equipment_id,ro_number,ro_date,location,source_status,labor_hours,labor_cost,parts_cost,sublet_cost,total_cost,line_count) VALUES (${sqlText(IMPORT_KEY)},${equipment.id},${sqlText(ro.roNumber)},${sqlText(ro.roDate)},${sqlText(ro.location)},${sqlText(ro.status)},${sqlNum(laborHours)},${sqlNum(laborCost)},${sqlNum(partsCost)},${sqlNum(subletCost)},${sqlNum(totalCost)},${ro.lines.length});`];
  for (const line of ro.lines) statements.push(`INSERT OR IGNORE INTO historical_repair_lines (import_key,historical_repair_id,equipment_id,ro_number,ro_date,major_category,system_code,assembly_code,vmrs_description,labor_hours,labor_cost,parts_cost,sublet_cost,total_cost) VALUES (${sqlText(IMPORT_KEY)},(SELECT id FROM historical_repairs WHERE import_key=${sqlText(IMPORT_KEY)} AND ro_number=${sqlText(ro.roNumber)}),${equipment.id},${sqlText(ro.roNumber)},${sqlText(ro.roDate)},${sqlText(majorCategory(line.systemCode))},${sqlText(line.systemCode)},${sqlText(line.assemblyCode)},${sqlText(line.description)},${sqlNum(line.laborHours)},${sqlNum(line.laborCost)},${sqlNum(line.partsCost)},${sqlNum(line.subletCost)},${sqlNum(line.totalCost)});`);
  return statements.join('\n');
}

const chunkSize = 500;
for (let index = 0; index < remaps.length; index += chunkSize) {
  const name = `import-${String(index / chunkSize).padStart(3, '0')}.sql`;
  fs.writeFileSync(path.join(outputDir, name), remaps.slice(index, index + chunkSize).map(roSql).join('\n') + '\n');
}

const cleanup = [];
for (let index = 0; index < remaps.length; index += 500) cleanup.push(`DELETE FROM data_import_unmatched_ros WHERE import_key=${sqlText(IMPORT_KEY)} AND ro_number IN (${remaps.slice(index, index + 500).map((item) => sqlText(item.ro.roNumber)).join(',')});`);
cleanup.push(`DELETE FROM data_import_unmatched_units WHERE import_key=${sqlText(IMPORT_KEY)};`);
cleanup.push(`INSERT INTO data_import_unmatched_units (import_key,unit,ro_count,line_count,total_cost) SELECT import_key,unit,COUNT(*),COALESCE(SUM(line_count),0),COALESCE(SUM(total_cost),0) FROM data_import_unmatched_ros WHERE import_key=${sqlText(IMPORT_KEY)} GROUP BY import_key,unit;`);
cleanup.push(`UPDATE data_imports SET status='completed', imported_line_count=(SELECT COUNT(*) FROM historical_repair_lines WHERE import_key=${sqlText(IMPORT_KEY)}), imported_ro_count=(SELECT COUNT(*) FROM historical_repairs WHERE import_key=${sqlText(IMPORT_KEY)}), matched_unit_count=(SELECT COUNT(DISTINCT equipment_id) FROM historical_repairs WHERE import_key=${sqlText(IMPORT_KEY)}), unmatched_line_count=(SELECT COALESCE(SUM(line_count),0) FROM data_import_unmatched_ros WHERE import_key=${sqlText(IMPORT_KEY)}), unmatched_ro_count=(SELECT COUNT(*) FROM data_import_unmatched_ros WHERE import_key=${sqlText(IMPORT_KEY)}), unmatched_unit_count=(SELECT COUNT(DISTINCT unit) FROM data_import_unmatched_ros WHERE import_key=${sqlText(IMPORT_KEY)}), skipped_nonfinal_ro_count=(SELECT COUNT(*) FROM data_import_skipped_ros WHERE import_key=${sqlText(IMPORT_KEY)}), completed_at=CURRENT_TIMESTAMP, notes='Historical RO export attached to existing active equipment. Numeric source units 300+ were additionally mapped to a unique same-number DC/BT/SC active unit; no ambiguous matches were assigned.' WHERE import_key=${sqlText(IMPORT_KEY)};`);
fs.writeFileSync(path.join(outputDir, 'cleanup.sql'), cleanup.join('\n') + '\n');

const targetUnits = new Set(remaps.map((item) => item.equipment.id));
const lines = remaps.reduce((sum, item) => sum + item.ro.lines.length, 0);
const totalCost = remaps.reduce((sum, item) => sum + item.ro.lines.reduce((s, line) => s + line.totalCost, 0), 0);
const summary = { remapRos: remaps.length, remapLines: lines, remapCost: Math.round(totalCost * 100) / 100, targetUnits: targetUnits.size, sqlFiles: Math.ceil(remaps.length / chunkSize) };
fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
