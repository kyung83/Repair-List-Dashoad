import { env } from 'cloudflare:workers';
import { notifyBreakdownEmailGroup } from '@/lib/notifications';
import { getBreakdown } from '@/lib/roadside-breakdowns';

const BREAKDOWN_ALERT_GROUP = 'Breakdown Alerts';

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function clearBreakdownAsNotBreakdown(breakdownId: number) {
  const before = await getBreakdown(breakdownId);
  if (!before) throw new Error('Breakdown not found.');
  if (before.status === 'not_breakdown') return { cleared: true, alreadyCleared: true };
  if (before.stage >= 5) throw new Error('This breakdown is already closed.');

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE roadside_breakdowns
      SET stage = 5, status = 'not_breakdown', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND stage < 5
    `).bind(breakdownId),
    env.DB.prepare(`
      UPDATE repairs
      SET status = 'Cancelled', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(before.repair_id),
  ]);

  const after = await getBreakdown(breakdownId);
  if (!after || after.status !== 'not_breakdown') throw new Error('Breakdown could not be cleared.');

  const unitLabel = String(after.equipment_type || '').toLowerCase() === 'trailer' ? 'Trailer' : 'Truck';
  const updateHtml = [
    '<strong>ROADSIDE BREAKDOWN CLEARED</strong>',
    '',
    `<strong>Driver:</strong> ${escapeHtml(after.driver_name)}`,
    `<strong>${unitLabel}:</strong> ${escapeHtml(after.unit)}`,
    `<strong>Location:</strong> ${escapeHtml(`${after.city}, ${after.state}`)}`,
    '<strong>Outcome:</strong> Not a breakdown / no roadside response required',
    `<strong>Breakdown #:</strong> ${after.id}`,
  ].join('<br>');

  await notifyBreakdownEmailGroup(
    breakdownId,
    BREAKDOWN_ALERT_GROUP,
    `Breakdown - ${after.driver_name}`,
    updateHtml,
  );

  return { cleared: true, alreadyCleared: false };
}
