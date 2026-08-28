import type { BreakdownSmsContact } from '@/lib/twilio-runtime';

export type SmsClaimResult =
  | { status: 'claimed'; breakdownId: number }
  | { status: 'already_claimed'; breakdownId: number }
  | { status: 'invalid'; breakdownId: number | null };

export async function claimBreakdownFromSms(
  db: D1Database,
  body: string,
  contact: BreakdownSmsContact,
): Promise<SmsClaimResult> {
  const breakdownId = Number(String(body || '').trim());
  if (!Number.isInteger(breakdownId) || breakdownId <= 0) return { status: 'invalid', breakdownId: null };

  const existing = await db.prepare(`
    SELECT id,stage,status,claimed_by_user_id,claimed_by_notification_contact_id
    FROM roadside_breakdowns
    WHERE id=?
  `).bind(breakdownId).first<{
    id: number;
    stage: number;
    status: string;
    claimed_by_user_id: number | null;
    claimed_by_notification_contact_id: number | null;
  }>();

  if (!existing || Number(existing.stage) >= 5 || String(existing.status) === 'not_breakdown') {
    return { status: 'invalid', breakdownId };
  }
  if (existing.claimed_by_user_id || existing.claimed_by_notification_contact_id) {
    return { status: 'already_claimed', breakdownId };
  }

  const update = await db.prepare(`
    UPDATE roadside_breakdowns
    SET claimed_by_notification_contact_id=?,
        claimed_by_label=?,
        claimed_at=CURRENT_TIMESTAMP,
        status='assigned',
        stage=CASE WHEN stage < 2 THEN 2 ELSE stage END,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
      AND claimed_by_user_id IS NULL
      AND claimed_by_notification_contact_id IS NULL
      AND stage < 5
      AND status <> 'not_breakdown'
  `).bind(contact.id, contact.label, breakdownId).run();

  if (!Number(update.meta.changes || 0)) return { status: 'already_claimed', breakdownId };

  await db.prepare(`
    UPDATE repairs
    SET status='in_progress',updated_at=CURRENT_TIMESTAMP
    WHERE id=(SELECT repair_id FROM roadside_breakdowns WHERE id=?)
  `).bind(breakdownId).run();

  return { status: 'claimed', breakdownId };
}
