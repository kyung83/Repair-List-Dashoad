import { env } from 'cloudflare:workers';

/**
 * Notification sending is OFF by default. Every call still validates its
 * inputs and writes a row to notification_log (status='stubbed'), so the
 * whole breakdown flow -- group membership, message content, who would have
 * been texted -- can be tested end to end before Twilio/email are live.
 *
 * To go live later:
 *   1. Set the Worker secret/var NOTIFICATIONS_LIVE = "true"
 *   2. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID
 *      as Worker secrets (wrangler secret put ...) -- never commit these.
 *   3. Set an email provider key (e.g. RESEND_API_KEY) as a Worker secret.
 *   4. Implement sendSmsLive() / sendEmailLive() below -- both are stubbed
 *      with a clear TODO and throw if called while NOTIFICATIONS_LIVE=true
 *      but the provider isn't actually wired up yet, so this can't silently
 *      no-op once you flip the flag.
 */

function notificationsLive() {
  return String((env as any).NOTIFICATIONS_LIVE ?? '').toLowerCase() === 'true';
}

async function logNotification(row: {
  breakdownId: number | null;
  channel: 'sms' | 'email';
  direction: 'outbound' | 'inbound';
  recipient: string | null;
  body: string;
  status: 'sent' | 'stubbed' | 'error';
  error?: string;
}) {
  await env.DB.prepare(`
    INSERT INTO notification_log (breakdown_id, channel, direction, recipient, body, status, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(row.breakdownId, row.channel, row.direction, row.recipient, row.body, row.status, row.error ?? null).run();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function sendSmsLive(toPhone: string, message: string): Promise<void> {
  // TODO when ready to go live:
  //   const sid = env.TWILIO_ACCOUNT_SID; const token = env.TWILIO_AUTH_TOKEN;
  //   const messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
  //   await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
  //     method: 'POST',
  //     headers: {
  //       'Content-Type': 'application/x-www-form-urlencoded',
  //       Authorization: 'Basic ' + btoa(`${sid}:${token}`),
  //     },
  //     body: new URLSearchParams({ To: `+${toPhone}`, Body: message, MessagingServiceSid: messagingServiceSid }),
  //   });
  throw new Error('sendSmsLive is not implemented yet -- Twilio is not connected. Set NOTIFICATIONS_LIVE=false until this is built.');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function sendEmailLive(toEmail: string, subject: string, html: string): Promise<void> {
  // TODO when ready to go live: call your email provider's API here
  // (Resend/Postmark/SendGrid), with the API key as a Worker secret.
  throw new Error('sendEmailLive is not implemented yet -- email sending is not connected. Set NOTIFICATIONS_LIVE=false until this is built.');
}

export async function sendBreakdownSms(breakdownId: number, toPhone: string, message: string) {
  try {
    if (notificationsLive()) {
      await sendSmsLive(toPhone, message);
      await logNotification({ breakdownId, channel: 'sms', direction: 'outbound', recipient: toPhone, body: message, status: 'sent' });
    } else {
      await logNotification({ breakdownId, channel: 'sms', direction: 'outbound', recipient: toPhone, body: message, status: 'stubbed' });
    }
  } catch (err) {
    await logNotification({ breakdownId, channel: 'sms', direction: 'outbound', recipient: toPhone, body: message, status: 'error', error: String((err as Error)?.message ?? err) });
  }
}

export async function sendBreakdownEmail(breakdownId: number, toEmail: string, subject: string, html: string) {
  try {
    if (notificationsLive()) {
      await sendEmailLive(toEmail, subject, html);
      await logNotification({ breakdownId, channel: 'email', direction: 'outbound', recipient: toEmail, body: html, status: 'sent' });
    } else {
      await logNotification({ breakdownId, channel: 'email', direction: 'outbound', recipient: toEmail, body: html, status: 'stubbed' });
    }
  } catch (err) {
    await logNotification({ breakdownId, channel: 'email', direction: 'outbound', recipient: toEmail, body: html, status: 'error', error: String((err as Error)?.message ?? err) });
  }
}

export async function logInboundSms(breakdownId: number | null, fromPhone: string, body: string) {
  await logNotification({ breakdownId, channel: 'sms', direction: 'inbound', recipient: fromPhone, body, status: 'sent' });
}

/** Sends (or, while stubbed, logs) the stage-1 "new breakdown reported" blast to an active notification group. */
export async function notifyBreakdownGroup(breakdownId: number, groupName: string, message: string, emailSubject: string, emailHtml: string) {
  const group = await env.DB.prepare(`SELECT id FROM notification_groups WHERE name = ? AND active = 1`).bind(groupName).first<{ id: number }>();
  if (!group) return { contacted: 0 };

  const contacts = await env.DB.prepare(`
    SELECT phone, email FROM notification_group_contacts WHERE group_id = ? AND active = 1
  `).bind(group.id).all<{ phone: string | null; email: string | null }>();

  let contacted = 0;
  for (const contact of contacts.results) {
    if (contact.phone) { await sendBreakdownSms(breakdownId, contact.phone, message); contacted++; }
    if (contact.email) { await sendBreakdownEmail(breakdownId, contact.email, emailSubject, emailHtml); contacted++; }
  }
  return { contacted };
}
