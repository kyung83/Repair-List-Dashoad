import { readFile, writeFile } from 'node:fs/promises';

const path = 'app/api/maintenance-checklist/route.ts';
let source = await readFile(path, 'utf8');

function replaceOnce(from, to, label) {
  const index = source.indexOf(from);
  if (index < 0) throw new Error(`Checklist template route patch failed: ${label} was not found.`);
  if (source.indexOf(from, index + from.length) >= 0) throw new Error(`Checklist template route patch failed: ${label} matched more than once.`);
  source = source.slice(0, index) + to + source.slice(index + from.length);
}

replaceOnce(
  "import { checklistFor } from '@/lib/maintenance-checklists';\nimport { getActiveChecklistTemplate } from '@/lib/maintenance-checklist-templates';",
  "import { getAssignedChecklistTemplate } from '@/lib/maintenance-checklist-templates';",
  'template import',
);

replaceOnce(
  "  unit: string;\n  current_mileage: number | null;",
  "  unit: string;\n  equipment_type: string | null;\n  current_mileage: number | null;",
  'equipment type field',
);

replaceOnce(
  "           COALESCE(r.status,'') AS status, COALESCE(e.unit,'') AS unit,\n           e.current_mileage, e.mileage_updated_at, e.geotab_device_id,",
  "           COALESCE(r.status,'') AS status, COALESCE(e.unit,'') AS unit, e.equipment_type,\n           e.current_mileage, e.mileage_updated_at, e.geotab_device_id,",
  'equipment query',
);

replaceOnce(
  "  const template = await getActiveChecklistTemplate(env.DB, kind);",
  "  const appliesTo = String(repair.equipment_type ?? '').toLowerCase() === 'trailer' ? 'trailer' : 'truck';\n  const template = await getAssignedChecklistTemplate(env.DB, kind, appliesTo);",
  'run template selection',
);

replaceOnce(
  "  if (!run) {\n    return {",
  "  if (!run) {\n    const appliesTo = String(repair.equipment_type ?? '').toLowerCase() === 'trailer' ? 'trailer' : 'truck';\n    const template = await getAssignedChecklistTemplate(env.DB, kind, appliesTo);\n    return {",
  'preview template selection',
);

replaceOnce(
  "      items: checklistFor(kind).map((item) => ({ ...item, id: null, result: 'pending', notes: '', photos: [], correctiveRepair: null })),",
  "      items: template.items.filter((item) => item.enabled).map((item) => ({ number: item.position, section: item.section, text: item.text, id: null, result: 'pending', notes: '', photos: [], correctiveRepair: null })),",
  'preview items',
);

await writeFile(path, source);
