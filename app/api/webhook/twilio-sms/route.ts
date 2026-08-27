import { env } from 'cloudflare:workers';
import { claimBreakdown, findClaimableBreakdownFromSmsBody } from '@/lib/roadside-breakdowns';
import { logInboundSms } from '@/lib/notifications';

/**
 * NOT YET LIVE. This route exists so the claim-by-SMS-reply flow (same
 * behavior as the current Apps Script doPost webhook) is ready to point
 * Twilio at once phone numbers and Twilio are actually connected.
 *
 * Until then, this route is not registered anywhere in the Twilio console
 * -- nothing calls it in production. When ready:
 *   1. Set NOTIFICATIONS_LIVE=true and configure Twilio secrets
 *      (see lib/notifications.ts).
 *   2. In the Twilio console, set this deployed URL as the
 *      Messaging Service's inbound webhook.
 *   3. Consider adding a check that the replying phone number belongs to
 *      an active notification_group_contacts row, so a wrong-number reply
 *      can't claim a breakdown (flagged as an open question, not yet built).
 */
export async function POST(request: Request) {
  if (String((env as any).NOTIFICATIONS_LIVE ?? '').toLowerCase() !== 'true') {
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      status: 200,
      headers: { 'content-type': 'text/xml' },
    });
  }

  const form = await request.formData();
  const from = String(form.get('From') ?? '').trim();
  const body = String(form.get('Body') ?? '').trim();

  const breakdownId = await findClaimableBreakdownFromSmsBody(body);
  if (breakdownId) {
    await claimBreakdown(breakdownId, null, from);
    await logInboundSms(breakdownId, from, body);
  } else {
    await logInboundSms(null, from, body);
  }

  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { 'content-type': 'text/xml' },
  });
}
