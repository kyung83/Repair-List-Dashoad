import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import {
  ensureDefaultChecklistTemplate,
  listChecklistTemplateVersions,
  publishChecklistTemplate,
  type ChecklistEventType,
  type ChecklistTemplateItem,
} from '@/lib/maintenance-checklist-templates';

async function requireManager(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') {
    throw new Error('Manager or administrator access is required for checklist setup.');
  }
  return user;
}

function eventType(value: unknown): ChecklistEventType {
  if (value === 'pm' || value === 'annual') return value;
  throw new Error('Choose PM or Annual checklist.');
}

function cleanText(value: unknown, label: string, max: number) {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`${label} is required.`);
  if (result.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return result;
}

function optionalText(value: unknown, max: number) {
  const result = String(value ?? '').trim();
  if (result.length > max) throw new Error(`Checklist measurement text must be ${max} characters or fewer.`);
  return result;
}

function flag(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function checklistItems(value: unknown): ChecklistTemplateItem[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Add at least one checklist item before publishing.');
  if (value.length > 300) throw new Error('A checklist can contain at most 300 items.');
  const items = value.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`Checklist item ${index + 1} is invalid.`);
    const item = raw as Record<string, unknown>;
    const enabled = flag(item.enabled, true);
    const allowPass = flag(item.allowPass, true);
    const allowFail = flag(item.allowFail, true);
    const allowNa = flag(item.allowNa, true);
    const requireMeasurement = flag(item.requireMeasurement, false);
    const measurementLabel = optionalText(item.measurementLabel, 80);
    const measurementUnit = optionalText(item.measurementUnit, 30);
    if (enabled && !allowPass && !allowFail && !allowNa) {
      throw new Error(`Checklist item ${index + 1} must allow at least one result.`);
    }
    if (enabled && requireMeasurement && !measurementLabel) {
      throw new Error(`Checklist item ${index + 1} needs a measurement label.`);
    }
    return {
      position: index + 1,
      section: cleanText(item.section, `Section for item ${index + 1}`, 120),
      text: cleanText(item.text, `Question for item ${index + 1}`, 500),
      enabled,
      allowPass,
      allowFail,
      allowNa,
      requireNotes: flag(item.requireNotes, false),
      requirePhoto: flag(item.requirePhoto, false),
      requireMeasurement,
      measurementLabel,
      measurementUnit,
    };
  });
  if (!items.some((item) => item.enabled)) throw new Error('At least one checklist item must be enabled.');
  return items;
}

async function setupPayload() {
  const [pm, annual] = await Promise.all([
    ensureDefaultChecklistTemplate(env.DB, 'pm'),
    ensureDefaultChecklistTemplate(env.DB, 'annual'),
  ]);
  const [pmVersions, annualVersions] = await Promise.all([
    listChecklistTemplateVersions(env.DB, 'pm'),
    listChecklistTemplateVersions(env.DB, 'annual'),
  ]);
  return {
    pm: { active: pm, versions: pmVersions },
    annual: { active: annual, versions: annualVersions },
    updatedAt: new Date().toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    await requireManager(request);
    return Response.json(await setupPayload(), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'maintenance_checklist_templates_get_failed', error: String(error) }));
    const message = error instanceof Error ? error.message : 'Checklist templates could not be loaded.';
    const status = message === 'Authentication required.' ? 401 : message.startsWith('Manager or administrator') ? 403 : 500;
    return Response.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireManager(request);
    const body = await request.json() as Record<string, unknown>;
    if (String(body.action ?? '') !== 'publish') {
      return Response.json({ error: 'Unknown checklist template action.' }, { status: 400 });
    }
    const kind = eventType(body.eventType);
    const items = checklistItems(body.items);
    const defaultName = kind === 'annual' ? 'Annual Inspection Checklist' : 'Performance PM Checklist';
    const name = String(body.name ?? '').trim() || defaultName;
    if (name.length > 100) throw new Error('Checklist name must be 100 characters or fewer.');
    await publishChecklistTemplate(env.DB, kind, name, items, user.id);
    return Response.json({ ok: true, ...(await setupPayload()) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'maintenance_checklist_templates_post_failed', error: String(error) }));
    const message = error instanceof Error ? error.message : 'Checklist template could not be published.';
    const status = message === 'Authentication required.' ? 401 : message.startsWith('Manager or administrator') ? 403 : 400;
    return Response.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } });
  }
}
