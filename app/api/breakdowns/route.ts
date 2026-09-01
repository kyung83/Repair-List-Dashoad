import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { issueDriverAccessToken } from '@/lib/breakdown-driver-followup';
import { resolveBreakdownDriverDirectorySelection } from '@/lib/breakdown-driver-directory';
import { listBreakdownCategoryConfigs, validateBreakdownCategorySelection } from '@/lib/breakdown-categories';
import { normalizeBreakdownPositions } from '@/lib/breakdown-position-rules.js';
import {
  createBreakdown,
  getBreakdown,
  listBreakdowns,
  ManualBreakdownSnapshotRequiredError,
  type BreakdownSnapshotVerification,
  type ReportedTireDetail,
} from '@/lib/roadside-breakdowns';
import { notifyBreakdownInitialEmailGroup, type BreakdownEmailAttachment } from '@/lib/notifications';

const SAFE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const VALID_SNAPSHOT_VERIFICATION = new Set(['verified', 'corrected', 'unavailable']);
const BREAKDOWN_ALERT_GROUP = 'Breakdown Alerts';

function safeText(value: FormDataEntryValue | null, max: number) {
  return String(value ?? '').trim().slice(0, max);
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parsedTimestamp(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return new Date();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(' ', 'T')}Z`
    : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function easternTimestamp(value: unknown) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Detroit',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(parsedTimestamp(value));
}

/**
 * PUBLIC endpoint -- no session required. The server resolves driver/location
 * from Geotab privately. If Geotab cannot provide the driver, the public form
 * submits only a cached-directory record id; the server resolves the full phone.
 */
export async function POST(request: Request) {
  try {
    const fetchSite = String(request.headers.get('sec-fetch-site') ?? '').trim().toLowerCase();
    if (fetchSite === 'cross-site') {
      return Response.json({ error: 'Cross-site breakdown submission rejected.' }, { status: 403, headers: { 'cache-control': 'no-store' } });
    }

    const form = await request.formData();
    const unitType = safeText(form.get('unitType'), 10);
    const unitNumber = safeText(form.get('unitNumber'), 20);
    const typedDriverName = safeText(form.get('driverName'), 120);
    const state = safeText(form.get('state'), 2).toUpperCase();
    const city = safeText(form.get('city'), 120);
    const submittedCategory = safeText(form.get('repairCategory'), 120);
    const submittedSubcategory = safeText(form.get('repairSubcategory'), 120);
    const description = safeText(form.get('description'), 2000);
    const rawSnapshotVerification = safeText(form.get('snapshotVerification'), 20).toLowerCase();
    const snapshotVerification = VALID_SNAPSHOT_VERIFICATION.has(rawSnapshotVerification)
      ? rawSnapshotVerification as BreakdownSnapshotVerification
      : undefined;
    const driverDirectoryId = Number(safeText(form.get('driverDirectoryId'), 20));
    const driverNotListed = safeText(form.get('driverNotListed'), 4) === '1';

    if (unitType !== 'truck' && unitType !== 'trailer') throw new Error('Pick Truck or Trailer.');
    if (!unitNumber) throw new Error('Unit # is required.');
    if (!submittedCategory) throw new Error('Repair type is required.');
    if (!description) throw new Error('Description is required.');

    const categoryConfig = await validateBreakdownCategorySelection(env.DB, submittedCategory, submittedSubcategory);
    const repairCategory = categoryConfig.name;
    const repairSubcategory = categoryConfig.subcategory;

    const needsFallbackDriver = snapshotVerification === 'unavailable' || snapshotVerification === 'corrected';
    const directoryDriver = Number.isInteger(driverDirectoryId) && driverDirectoryId > 0
      ? await resolveBreakdownDriverDirectorySelection(env.DB, driverDirectoryId)
      : null;
    if (driverDirectoryId > 0 && !directoryDriver) {
      throw new Error('That driver directory selection is no longer current. Search for the driver again.');
    }
    if (needsFallbackDriver && !directoryDriver && !driverNotListed) {
      throw new Error('Search for and select the driver from Recruiting, or use Driver not listed.');
    }
    if (driverNotListed && !typedDriverName) {
      throw new Error('Enter the driver name for Driver not listed.');
    }

    const driverName = directoryDriver?.name || typedDriverName;
    const driverPhone = directoryDriver?.phone || '';
    const driverSource = directoryDriver ? 'directory' as const : 'manual' as const;

    const tireDetails: ReportedTireDetail[] = [];
    if (categoryConfig.requiresTireSize) {
      for (const entry of form.getAll('tirePosition')) {
        const positionCode = safeText(entry, 10).toUpperCase();
        if (!positionCode) continue;
        const tireSize = safeText(form.get(`tireSize_${positionCode}`), 40);
        tireDetails.push({ positionCode, tireSize });
      }
      if (!tireDetails.length) throw new Error('Choose at least one tire position.');
      if (tireDetails.some((item) => !item.tireSize)) throw new Error('Enter the tire size for every selected tire.');
    }

    let positionCodes: string[] = [];
    if (categoryConfig.requiresPosition && !categoryConfig.requiresTireSize) {
      const normalized = normalizeBreakdownPositions(
        form.getAll('positionCode').map((entry) => safeText(entry, 10)),
        unitType,
      );
      if (normalized.invalid.length) throw new Error(`Invalid position: ${normalized.invalid.join(', ')}.`);
      if (!normalized.positions.length) throw new Error(`Choose at least one ${repairCategory} position.`);
      positionCodes = normalized.positions;
    }

    const { breakdownId, repairId, snapshotSource } = await createBreakdown({
      unitType: unitType as 'truck' | 'trailer',
      unitNumber,
      driverName,
      driverPhone,
      driverSource,
      state,
      city,
      snapshotVerification,
      repairCategory,
      description,
      tireDetails,
    });

    await env.DB.prepare(`
      UPDATE roadside_breakdowns
      SET repair_subcategory=?, position_codes=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(repairSubcategory || null, positionCodes.length ? JSON.stringify(positionCodes) : null, breakdownId).run();

    const driverToken = await issueDriverAccessToken(breakdownId);

    const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
    const emailAttachments: BreakdownEmailAttachment[] = [];
    for (const file of files.slice(0, 6)) {
      if (!SAFE_IMAGE_TYPES.has(file.type)) continue;
      try {
        const bytes = await file.arrayBuffer();
        const key = `roadside-breakdowns/${new Date().toISOString().slice(0, 4)}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-140)}`;
        await env.FILES.put(key, bytes, { httpMetadata: { contentType: file.type } });
        await env.DB.prepare(`
          INSERT INTO attachments (repair_id, object_key, file_name, content_type)
          VALUES (?, ?, ?, ?)
        `).bind(repairId, key, file.name.slice(0, 255), file.type).run();
        emailAttachments.push({ filename: file.name.slice(0, 180) || 'breakdown-photo', contentType: file.type, data: bytes });
      } catch (error) {
        console.warn(JSON.stringify({ event: 'breakdown_photo_upload_failed', breakdownId, error: String(error) }));
      }
    }

    try {
      const actual = await getBreakdown(breakdownId);
      if (!actual) throw new Error('Breakdown could not be reloaded for its email alert.');
      const submittedAt = easternTimestamp(actual.created_at);
      const unitLabel = actual.equipment_type === 'trailer' ? 'Trailer' : 'Truck';
      const tireHtml = tireDetails.length
        ? `<br><strong>Tires:</strong> ${escapeHtml(tireDetails.map((item) => `${item.positionCode} - ${item.tireSize}`).join(', '))}`
        : '';
      const subcategoryHtml = repairSubcategory
        ? `<br><strong>Issue:</strong> ${escapeHtml(repairSubcategory)}`
        : '';
      const positionHtml = positionCodes.length
        ? `<br><strong>Position:</strong> ${escapeHtml(positionCodes.join(', '))}`
        : '';
      const emailHtml = [
        '<strong>ROADSIDE BREAKDOWN</strong>',
        '',
        `<strong>Submitted:</strong> ${escapeHtml(submittedAt)}`,
        `<strong>Driver:</strong> ${escapeHtml(actual.driver_name)}`,
        ...(actual.driver_phone ? [`<strong>Driver Phone:</strong> ${escapeHtml(actual.driver_phone)}`] : []),
        `<strong>${unitLabel}:</strong> ${escapeHtml(actual.unit)}`,
        `<strong>Location:</strong> ${escapeHtml(`${actual.city}, ${actual.state}`)}`,
        `<strong>Category:</strong> ${escapeHtml(repairCategory)}${subcategoryHtml}${positionHtml}${tireHtml}`,
        `<strong>Description:</strong> ${escapeHtml(actual.description)}`,
        `<strong>Breakdown #:</strong> ${breakdownId}`,
      ].join('<br>');

      await notifyBreakdownInitialEmailGroup(
        breakdownId,
        BREAKDOWN_ALERT_GROUP,
        `Breakdown - ${actual.driver_name}`,
        emailHtml,
        emailAttachments,
      );
    } catch (error) {
      console.warn(JSON.stringify({ event: 'breakdown_initial_email_failed', breakdownId, error: String(error) }));
    }

    return Response.json({ ok: true, breakdownId, driverToken, snapshotSource }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof ManualBreakdownSnapshotRequiredError) {
      return Response.json(
        { error: err.message, manualFallbackRequired: true },
        { status: 422, headers: { 'cache-control': 'no-store' } },
      );
    }
    return Response.json({ error: String((err as Error)?.message ?? err) }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
}

/** PUBLIC categories query or manager-only breakdown list. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get('categories') === '1') {
    const categories = await listBreakdownCategoryConfigs(env.DB, false);
    return Response.json({ categories }, { headers: { 'cache-control': 'no-store' } });
  }

  const user = await getSessionUser(env.DB, request);
  if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  if (user.role !== 'manager' && user.role !== 'admin') return Response.json({ error: 'Manager or administrator access is required.' }, { status: 403 });

  const openOnly = url.searchParams.get('open') === '1';
  const breakdowns = await listBreakdowns({ openOnly });
  if (!breakdowns.length) return Response.json({ breakdowns }, { headers: { 'cache-control': 'no-store' } });

  const ids = breakdowns.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const detailRows = await env.DB.prepare(`
    SELECT id,repair_subcategory,position_codes
    FROM roadside_breakdowns
    WHERE id IN (${placeholders})
  `).bind(...ids).all<{ id:number; repair_subcategory:string|null; position_codes:string|null }>();
  const details = new Map(detailRows.results.map((row) => [row.id, row]));
  const enriched = breakdowns.map((row) => {
    const detail = details.get(row.id);
    let positions: string[] = [];
    try { positions = detail?.position_codes ? JSON.parse(detail.position_codes) : []; } catch { positions = []; }
    return { ...row, repair_subcategory: detail?.repair_subcategory || null, position_codes: positions };
  });
  return Response.json({ breakdowns: enriched }, { headers: { 'cache-control': 'no-store' } });
}
