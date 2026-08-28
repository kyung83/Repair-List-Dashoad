import { env } from 'cloudflare:workers';
import { sendGmailRuntimeEmail, type GmailRuntimeAttachment } from '@/lib/gmail-client';
import { getGmailRuntimeCredentialMetadata } from '@/lib/gmail-runtime-credentials';
import { sendTwilioRuntimeSms, twilioRuntimeReady } from '@/lib/twilio-runtime';
import { buildNewBreakdownSms } from '@/lib/breakdown-sms-message';
import { breakdownSmsScheduleAllows } from '@/lib/breakdown-sms-schedule';

const BREAKDOWN_EMAIL_FROM = 'norlow-breakdowns@norloworld.com';

export type BreakdownEmailAttachment = GmailRuntimeAttachment;

type BreakdownEmailBinding = {
  send(message: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    headers?: Record<string, string>;
  }): Promise<{ messageId?: string }>;
};

type BreakdownEmailThread = {
  root_message_id: string;
  subject: string;
  gmail_thread_id: string | null;
};

type EmailSendResult = {
  messageId: string;
  gmailThreadId: string;
  provider: 'gmail' | 'cloudflare';
};

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

function normalizedMessageId(value: string) {
  const messageId = String(value || '').trim();
  if (!messageId) return '';
  return messageId.startsWith('<') && messageId.endsWith('>') ? messageId : `<${messageId}>`;
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

async function rememberEmailThread(
  breakdownId: number,
  recipient: string,
  subject: string,
  messageId: string,
  gmailThreadId = '',
) {
  const rootMessageId = normalizedMessageId(messageId);
  if (!rootMessageId) return;
  await env.DB.prepare(`
    INSERT INTO roadside_breakdown_email_threads (
      breakdown_id, recipient, root_message_id, subject, gmail_thread_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(breakdown_id, recipient) DO UPDATE SET
      root_message_id = excluded.root_message_id,
      subject = excluded.subject,
      gmail_thread_id = excluded.gmail_thread_id,
      updated_at = CURRENT_TIMESTAMP
  `).bind(breakdownId, recipient.toLowerCase(), rootMessageId, subject, gmailThreadId || null).run();
}

async function getEmailThread(breakdownId: number, recipient: string) {
  return env.DB.prepare(`
    SELECT root_message_id, subject, gmail_thread_id
    FROM roadside_breakdown_email_threads
    WHERE breakdown_id = ? AND lower(recipient) = lower(?)
  `).bind(breakdownId, recipient).first<BreakdownEmailThread>();
}

async function sendSmsLive(toPhone: string, message: string): Promise<void> {
  await sendTwilioRuntimeSms(env.DB, env, toPhone, message);
}

async function gmailConnected() {
  try {
    return (await getGmailRuntimeCredentialMetadata(env.DB)).connected;
  } catch {
    return false;
  }
}

async function sendEmailLive(
  toEmail: string,
  subject: string,
  html: string,
  replyToMessageId = '',
  gmailThreadId = '',
  attachments: BreakdownEmailAttachment[] = [],
): Promise<EmailSendResult> {
  if (await gmailConnected()) {
    const result = await sendGmailRuntimeEmail({
      to: toEmail,
      subject,
      html,
      text: htmlToText(html),
      replyToMessageId,
      gmailThreadId,
      attachments,
    });
    return {
      messageId: normalizedMessageId(result.messageId),
      gmailThreadId: result.gmailThreadId,
      provider: 'gmail',
    };
  }

  const binding = breakdownEmailBinding();
  if (!binding) throw new Error('No live breakdown email provider is configured.');
  const rootMessageId = normalizedMessageId(replyToMessageId);
  const fallbackHtml = attachments.length
    ? `${html}<br><br><em>${attachments.length} breakdown photo${attachments.length === 1 ? '' : 's'} are available in the Norlow Breakdown dashboard.</em>`
    : html;
  const result = await binding.send({
    from: BREAKDOWN_EMAIL_FROM,
    to: toEmail,
    subject,
    html: fallbackHtml,
    text: htmlToText(fallbackHtml),
    ...(rootMessageId ? {
      headers: {
        'In-Reply-To': rootMessageId,
        References: rootMessageId,
      },
    } : {}),
  });
  return {
    messageId: normalizedMessageId(String(result?.messageId || '')),
    gmailThreadId: '',
    provider: 'cloudflare',
  };
}

export async function sendBreakdownSms(breakdownId: number, toPhone: string, message: string) {
  try {
    const twilioReady = await twilioRuntimeReady(env.DB);
    const scheduleAllowed = await breakdownSmsScheduleAllows(env.DB);
    if (twilioReady && scheduleAllowed) {
      await sendSmsLive(toPhone, message);
      await logNotification({ breakdownId, channel: 'sms', direction: 'outbound', recipient: toPhone, body: message, status: 'sent' });
    } else {
      await logNotification({
        breakdownId,
        channel: 'sms',
        direction: 'outbound',
        recipient: toPhone,
        body: message,
        status: 'stubbed',
        error: twilioReady ? 'Outside configured breakdown SMS schedule.' : 'Twilio breakdown texting is not enabled.',
      });
    }
  } catch (err) {
    await logNotification({ breakdownId, channel: 'sms', direction: 'outbound', recipient: toPhone, body: message, status: 'error', error: String((err as Error)?.message ?? err) });
  }
}

export async function sendBreakdownEmail(
  breakdownId: number,
  toEmail: string,
  subject: string,
  html: string,
  options: {
    rememberThread?: boolean;
    replyToMessageId?: string;
    gmailThreadId?: string;
    attachments?: BreakdownEmailAttachment[];
  } = {},
) {
  try {
    const hasProvider = (await gmailConnected()) || Boolean(breakdownEmailBinding());
    if (!hasProvider) {
      await logNotification({ breakdownId, channel: 'email', direction: 'outbound', recipient: toEmail, body: html, status: 'stubbed' });
      return { sent: false, messageId: '', gmailThreadId: '', provider: '' } as const;
    }
    const result = await sendEmailLive(
      toEmail,
      subject,
      html,
      options.replyToMessageId,
      options.gmailThreadId,
      options.attachments,
    );
    if (options.rememberThread && result.messageId) {
      await rememberEmailThread(breakdownId, toEmail, subject, result.messageId, result.gmailThreadId);
    }
    await logNotification({ breakdownId, channel: 'email', direction: 'outbound', recipient: toEmail, body: html, status: 'sent' });
    return { sent: true, ...result } as const;
  } catch (err) {
    await logNotification({ breakdownId, channel: 'email', direction: 'outbound', recipient: toEmail, body: html, status: 'error', error: String((err as Error)?.message ?? err) });
    return { sent: false, messageId: '', gmailThreadId: '', provider: '' } as const;
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

/**
 * Sends only the SMS side of a new-breakdown alert. The initial email is deliberately
 * sent by the POST route after any driver photos have finished uploading, so the first
 * email can contain those photos instead of creating a second email.
 */
export async function notifyBreakdownGroup(
  breakdownId: number,
  groupName: string,
  message: string,
  _emailSubject: string,
  _emailHtml: string,
) {
  const contacts = await activeGroupContacts(groupName);
  let contacted = 0;
  const seenPhones = new Set<string>();
  const outboundMessage = await buildNewBreakdownSms(env.DB, breakdownId, message);

  if (!outboundMessage.trim()) return { contacted };
  for (const contact of contacts) {
    const phone = String(contact.phone || '').trim();
    if (phone && !seenPhones.has(phone)) {
      seenPhones.add(phone);
      await sendBreakdownSms(breakdownId, phone, outboundMessage);
      contacted++;
    }
  }
  return { contacted };
}

/** Sends the one original breakdown email after uploads, and remembers its Gmail thread. */
export async function notifyBreakdownInitialEmailGroup(
  breakdownId: number,
  groupName: string,
  emailSubject: string,
  emailHtml: string,
  attachments: BreakdownEmailAttachment[] = [],
) {
  const contacts = await activeGroupContacts(groupName);
  let contacted = 0;
  const seenEmails = new Set<string>();

  for (const contact of contacts) {
    const email = String(contact.email || '').trim().toLowerCase();
    if (!email || seenEmails.has(email)) continue;
    seenEmails.add(email);
    await sendBreakdownEmail(breakdownId, email, emailSubject, emailHtml, {
      rememberThread: true,
      attachments,
    });
    contacted++;
  }
  return { contacted };
}

/** Email-only follow-up that stays in the original Gmail/email conversation. */
export async function notifyBreakdownEmailGroup(
  breakdownId: number,
  groupName: string,
  baseSubject: string,
  emailHtml: string,
  attachments: BreakdownEmailAttachment[] = [],
) {
  const contacts = await activeGroupContacts(groupName);
  const seenEmails = new Set<string>();
  let contacted = 0;
  for (const contact of contacts) {
    const email = String(contact.email || '').trim().toLowerCase();
    if (!email || seenEmails.has(email)) continue;
    seenEmails.add(email);
    const thread = await getEmailThread(breakdownId, email);
    const subject = thread?.subject || baseSubject.replace(/^Re:\s*/i, '');
    await sendBreakdownEmail(breakdownId, email, subject, emailHtml, {
      replyToMessageId: thread?.root_message_id || '',
      gmailThreadId: thread?.gmail_thread_id || '',
      attachments,
    });
    contacted++;
  }
  return { contacted };
}
