import { env } from 'cloudflare:workers';
import { logInboundSms } from '@/lib/notifications';
import { claimBreakdownFromSms } from '@/lib/breakdown-sms-claims';
import {
  findActiveBreakdownSmsContactByPhone,
  loadTwilioRuntimeCredentials,
  renderBreakdownSmsTemplate,
  validateTwilioWebhook,
} from '@/lib/twilio-runtime';

function xmlEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function twiml(message = '', status = 200) {
  const body = message.trim() ? `<Message>${xmlEscape(message.trim())}</Message>` : '';
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status,
    headers: { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function POST(request: Request) {
  const credentials = await loadTwilioRuntimeCredentials(env.DB, env).catch(() => null);
  if (!credentials || !credentials.enabled) return twiml();

  const form = await request.formData();
  if (!(await validateTwilioWebhook(request, form, credentials.authToken))) {
    return twiml('', 403);
  }

  const from = String(form.get('From') ?? '').trim();
  const body = String(form.get('Body') ?? '').trim();
  const contact = await findActiveBreakdownSmsContactByPhone(env.DB, from);

  if (!contact) {
    await logInboundSms(null, from, body);
    return twiml();
  }

  const claim = await claimBreakdownFromSms(env.DB, body, contact);
  await logInboundSms(claim.breakdownId, from, body);

  if (claim.status === 'claimed') {
    const reply = await renderBreakdownSmsTemplate(env.DB, 'claim_confirmed', {
      breakdown_id: claim.breakdownId,
      contact_label: contact.label,
    }, `Breakdown #${claim.breakdownId} is assigned to ${contact.label}.`);
    return twiml(reply);
  }

  if (claim.status === 'already_claimed') {
    const reply = await renderBreakdownSmsTemplate(env.DB, 'claim_already', {
      breakdown_id: claim.breakdownId,
      contact_label: contact.label,
    }, `Breakdown #${claim.breakdownId} was already claimed by someone else.`);
    return twiml(reply);
  }

  const reply = await renderBreakdownSmsTemplate(env.DB, 'claim_invalid', {
    breakdown_id: claim.breakdownId ?? '',
    contact_label: contact.label,
  }, 'Reply with only the breakdown number shown in the alert.');
  return twiml(reply);
}
