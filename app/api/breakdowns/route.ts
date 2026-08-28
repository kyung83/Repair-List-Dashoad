import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { issueDriverAccessToken } from '@/lib/breakdown-driver-followup';
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
 * from Geotab privately. The driver can verify the preview or correct it before
 * submit; the Geotab snapshot remains the evidence source when available.
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
    const driverName = safeText(form.get('driverName'), 120);
    const state = safeText(form.get('state'), 2).toUpperCase();
    const city = safeText(form.get('city'), 120);
    const repairCategory = safeText(form.get('repairCategory'), 60);
    const description = safeText(form.get('description'), 2000);
    const rawSnapshotVerification = safeText(form.get('snapshotVerification'), 20).toLowerCase();
    const snapshotVerification = VALID_SNAPSHOT_VERIFICATION.has(rawSnapshotVerification)
      ? rawSnapshotVerification as BreakdownSnapshotVerification
      : undefined;

    if (unitType !== 'truck' && unitType !== 'trailer') throw new Error('Pick Truck or Trailer.');
    if (!unitNumber) throw new Error('Unit # is required.');
    if (!repairCategory) throw new Error('Repair type is required.');
    if (!description) throw new Error('Description is required.');

    const tireDetails: ReportedTireDetail[] = [];
    if (repairCategory.toUpperCase() === 'TIRES') {
      for (const entry of form.getAll('tirePosition')) {
        const positionCode = safeText(entry, 10).toUpperCase();
        if (!positionCode) continue;
        const tireSize = safeText(form.get(`tireSize_${positionCode}`), 40);
        tireDetails.push({ positionCode, tireSize });
      }
    }

    const { breakdownId, repairId, snapshotSource } = await createBreakdown({
      unitType: unitType as 'truck' | 'trailer',
      unitNumber,
      driverName,
      state,
      city,
      snapshotVerification,
      repairCategory,
      description,
      tireDetails,
    });
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
      const emailHtml = [
        '<strong>ROADSIDE BREAKDOWN</strong>',
        '',
        `<strong>Submitted:</strong> ${escapeHtml(submittedAt)}`,
        `<strong>Driver:</strong> ${escapeHtml(actual.driver_name)}`,
        `<strong>${unitLabel}:</strong> ${escapeHtml(actual.unit)}`,
        `<strong>Location:</strong> ${escapeHtml(`${actual.city}, ${actual.state}`)}`,
        `<strong>Category:</strong> ${escapeHtml(actual.repair_category)}${tireHtml}`,
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

/** ADMIN-ONLY: list breakdowns for the dashboard tab. */
export async function GET(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  if (user.role !== 'manager' && user.role !== 'admin') return Response.json({ error: 'Manager or administrator access is required.' }, { status: 403 });

  const url = new URL(request.url);
  const openOnly = url.searchParams.get('open') === '1';
  const breakdowns = await listBreakdowns({ openOnly });
  return Response.json({ breakdowns }, { headers: { 'cache-control': 'no-store' } });
}
