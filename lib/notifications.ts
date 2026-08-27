import { env } from 'cloudflare:workers';

const BREAKDOWN_EMAIL_FROM = 'norlow-breakdowns@norloworld.com';

type BreakdownEmailBinding = {
  send(message: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<unknown>;
};

/**
 * SMS remains opt-in until Twilio is deliberately connected. Breakdown email
 * is independent: when the Cloudflare Email Service binding exists, email is
 * live without enabling SMS.
 */
function smsNotificationsLive() {
  return String((env as any).NOTIFICATIONS_LIVE ?? '').toLowerCase() === 'true';
}

function breakdownEmailBinding(): BreakdownEmailBinding | null {
  const binding = (env as any).BREAKDOWN_EMAIL as BreakdownEmailBinding | undefined;
  return binding && typeof binding.send === 'function' ? binding : null;
}

function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
  // TODO when SMS is approved to go live: connect Twilio with Worker secrets.
  throw new Error('sendSmsLive is not implemented yet -- Twilio is not connected.');
}

async function sendEmailLive(toEmail: string, subject: string, html: string): Promise<void> {
  const binding = breakdownEmailBinding();
  if (!binding) throw new Error('Cloudflare Breakdown Email binding is not configured.');
  await binding.send({
    from: BREAKDOWN_EMAIL_FROM,
    to: toEmail,
    subject,
    html,
    text: htmlToText(html),
  });
}

export async function sendBreakdownSms(breakdownId: number, toPhone: string, message: string) {
  try {
    if (smsNotificationsLive()) {
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
    if (breakdownEmailBinding()) {
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

async function activeGroupContacts(groupName: string) {
  const group = await env.DB.prepare(`SELECT id FROM notification_groups WHERE name = ? AND active = 1`).bind(groupName).first<{ id: number }>();
  if (!group) return [] as { phone: string | null; email: string | null }[];
  const contacts = await env.DB.prepare(`
    SELECT phone, email FROM notification_group_contacts WHERE group_id = ? AND active = 1
  `).bind(group.id).all<{ phone: string | null; email: string | null }>();
  return contacts.results;
}

/** Sends the new-breakdown alert to all active contacts in the configured group. */
export async function notifyBreakdownGroup(breakdownId: number, groupName: string, message: string, emailSubject: string, emailHtml: string) {
  const contacts = await activeGroupContacts(groupName);
  let contacted = 0;
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();

  for (const contact of contacts) {
    const phone = String(contact.phone || '').trim();
    const email = String(contact.email || '').trim().toLowerCase();
    if (phone && !seenPhones.has(phone)) {
      seenPhones.add(phone);
      await sendBreakdownSms(breakdownId, phone, message);
      contacted++;
    }
    if (email && !seenEmails.has(email)) {
      seenEmails.add(email);
      await sendBreakdownEmail(breakdownId, email, emailSubject, emailHtml);
      contacted++;
    }
  }
  return { contacted };
}

/** Email-only follow-up used for dispatch/provider and ETA changes. */
export async function notifyBreakdownEmailGroup(breakdownId: number, groupName: string, emailSubject: string, emailHtml: string) {
  const contacts = await activeGroupContacts(groupName);
  const seenEmails = new Set<string>();
  let contacted = 0;
  for (const contact of contacts) {
    const email = String(contact.email || '').trim().toLowerCase();
    if (!email || seenEmails.has(email)) continue;
    seenEmails.add(email);
    await sendBreakdownEmail(breakdownId, email, emailSubject, emailHtml);
    contacted++;
  }
  return { contacted };
}
