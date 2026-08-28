import {
  decryptGeotabRuntimeSecret,
  encryptGeotabRuntimeSecret,
  type GeotabRuntimeSecretEnv,
} from '@/lib/geotab-runtime-credentials';

export const BREAKDOWN_SMS_GROUP = 'Breakdown Alerts';

export type TwilioRuntimeMetadata = {
  configured: boolean;
  enabled: boolean;
  accountSid: string;
  sender: string;
  updatedAt: string;
  updatedByUserId: number | null;
};

export type TwilioRuntimeCredentials = {
  accountSid: string;
  authToken: string;
  sender: string;
  enabled: boolean;
};

export type BreakdownSmsTemplate = {
  key: string;
  label: string;
  body: string;
  active: boolean;
  updatedAt: string;
};

export type BreakdownSmsContact = {
  id: number;
  label: string;
  phone: string;
  active: boolean;
};

type CredentialRow = {
  account_sid: string;
  auth_token_ciphertext: string;
  auth_token_iv: string;
  sender: string;
  enabled: number;
  updated_at: string;
  updated_by_user_id: number | null;
};

type TemplateRow = {
  template_key: string;
  label: string;
  body: string;
  active: number;
  updated_at: string;
};

type ContactRow = {
  id: number;
  label: string;
  phone: string | null;
  active: number;
};

const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(binary);
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let different = 0;
  for (let index = 0; index < a.length; index += 1) different |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return different === 0;
}

export function normalizeSmsPhone(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return '';
}

function normalizedSender(value: string) {
  const raw = String(value || '').trim();
  if (/^MG[0-9a-fA-F]{32}$/.test(raw)) return raw;
  return normalizeSmsPhone(raw);
}

async function credentialRow(db: D1Database) {
  return db.prepare(`
    SELECT account_sid,auth_token_ciphertext,auth_token_iv,sender,enabled,updated_at,updated_by_user_id
    FROM twilio_runtime_credentials WHERE id=1
  `).first<CredentialRow>();
}

export async function getTwilioRuntimeMetadata(db: D1Database): Promise<TwilioRuntimeMetadata> {
  const row = await credentialRow(db);
  if (!row) return { configured: false, enabled: false, accountSid: '', sender: '', updatedAt: '', updatedByUserId: null };
  return {
    configured: Boolean(row.account_sid && row.auth_token_ciphertext && row.auth_token_iv && row.sender),
    enabled: Boolean(row.enabled),
    accountSid: String(row.account_sid || ''),
    sender: String(row.sender || ''),
    updatedAt: String(row.updated_at || ''),
    updatedByUserId: row.updated_by_user_id == null ? null : Number(row.updated_by_user_id),
  };
}

export async function saveTwilioRuntimeCredentials(
  db: D1Database,
  env: GeotabRuntimeSecretEnv,
  input: { accountSid: string; authToken: string; sender: string; enabled: boolean },
  updatedByUserId: number,
) {
  const accountSid = String(input.accountSid || '').trim();
  const authToken = String(input.authToken || '').trim();
  const sender = normalizedSender(input.sender);
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) throw new Error('Enter a valid Twilio Account SID (starts with AC).');
  if (authToken.length < 20 || authToken.length > 500) throw new Error('Enter the Twilio Auth Token from the same Twilio account.');
  if (!sender) throw new Error('Enter the Twilio sending phone number or Messaging Service SID.');

  const encrypted = await encryptGeotabRuntimeSecret(authToken, env);
  await db.prepare(`
    INSERT INTO twilio_runtime_credentials(
      id,account_sid,auth_token_ciphertext,auth_token_iv,sender,enabled,updated_at,updated_by_user_id
    ) VALUES(1,?,?,?,?,?,CURRENT_TIMESTAMP,?)
    ON CONFLICT(id) DO UPDATE SET
      account_sid=excluded.account_sid,
      auth_token_ciphertext=excluded.auth_token_ciphertext,
      auth_token_iv=excluded.auth_token_iv,
      sender=excluded.sender,
      enabled=excluded.enabled,
      updated_at=CURRENT_TIMESTAMP,
      updated_by_user_id=excluded.updated_by_user_id
  `).bind(accountSid, encrypted.ciphertext, encrypted.iv, sender, input.enabled ? 1 : 0, updatedByUserId).run();
}

export async function setTwilioRuntimeEnabled(db: D1Database, enabled: boolean, updatedByUserId: number) {
  const result = await db.prepare(`
    UPDATE twilio_runtime_credentials
    SET enabled=?,updated_at=CURRENT_TIMESTAMP,updated_by_user_id=? WHERE id=1
  `).bind(enabled ? 1 : 0, updatedByUserId).run();
  if (!Number(result.meta.changes || 0)) throw new Error('Save the Twilio connection before enabling live breakdown texts.');
}

export async function clearTwilioRuntimeCredentials(db: D1Database) {
  await db.prepare('DELETE FROM twilio_runtime_credentials WHERE id=1').run();
}

export async function loadTwilioRuntimeCredentials(
  db: D1Database,
  env: GeotabRuntimeSecretEnv,
): Promise<TwilioRuntimeCredentials | null> {
  const row = await credentialRow(db);
  if (!row) return null;
  const authToken = await decryptGeotabRuntimeSecret(row.auth_token_ciphertext, row.auth_token_iv, env);
  if (!row.account_sid || !authToken || !row.sender) throw new Error('Saved Twilio configuration is incomplete.');
  return {
    accountSid: String(row.account_sid),
    authToken,
    sender: String(row.sender),
    enabled: Boolean(row.enabled),
  };
}

export async function twilioRuntimeReady(db: D1Database) {
  const metadata = await getTwilioRuntimeMetadata(db);
  return metadata.configured && metadata.enabled;
}

export async function sendTwilioRuntimeSms(
  db: D1Database,
  env: GeotabRuntimeSecretEnv,
  toPhone: string,
  body: string,
) {
  const credentials = await loadTwilioRuntimeCredentials(db, env);
  if (!credentials || !credentials.enabled) throw new Error('Twilio breakdown texting is not enabled.');
  const to = normalizeSmsPhone(toPhone);
  const message = String(body || '').trim();
  if (!to) throw new Error('The SMS recipient phone number is invalid.');
  if (!message) throw new Error('The SMS message is empty.');

  const form = new URLSearchParams({ To: to, Body: message });
  if (credentials.sender.startsWith('MG')) form.set('MessagingServiceSid', credentials.sender);
  else form.set('From', credentials.sender);

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}/Messages.json`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${credentials.accountSid}:${credentials.authToken}`)}`,
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: form.toString(),
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try { payload = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { payload = {}; }
  if (!response.ok) {
    const detail = String(payload.message || payload.error_message || '').trim();
    throw new Error(detail ? `Twilio: ${detail}` : `Twilio SMS failed with HTTP ${response.status}.`);
  }
  return { sid: String(payload.sid || ''), status: String(payload.status || '') };
}

export async function validateTwilioWebhook(
  request: Request,
  form: FormData,
  authToken: string,
) {
  const signature = String(request.headers.get('x-twilio-signature') || '').trim();
  if (!signature || !authToken) return false;
  const entries: Array<[string, string]> = [];
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') entries.push([key, value]);
  }
  entries.sort((a, b) => a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]));
  let signed = request.url;
  for (const [key, value] of entries) signed += `${key}${value}`;
  const key = await crypto.subtle.importKey('raw', encoder.encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(signed));
  return constantTimeEqual(bytesToBase64(new Uint8Array(digest)), signature);
}

export async function listBreakdownSmsTemplates(db: D1Database): Promise<BreakdownSmsTemplate[]> {
  const result = await db.prepare(`
    SELECT template_key,label,body,active,updated_at
    FROM breakdown_sms_templates
    ORDER BY CASE template_key
      WHEN 'new_breakdown' THEN 1
      WHEN 'claim_confirmed' THEN 2
      WHEN 'claim_already' THEN 3
      WHEN 'claim_invalid' THEN 4
      ELSE 99 END,label
  `).all<TemplateRow>();
  return result.results.map(row => ({
    key: row.template_key,
    label: row.label,
    body: row.body,
    active: Boolean(row.active),
    updatedAt: row.updated_at,
  }));
}

export async function saveBreakdownSmsTemplate(
  db: D1Database,
  templateKey: string,
  body: string,
  active: boolean,
  updatedByUserId: number,
) {
  const key = String(templateKey || '').trim();
  const text = String(body || '').trim();
  if (!key || !text) throw new Error('Text template cannot be blank.');
  if (text.length > 4000) throw new Error('Text template is too long.');
  const result = await db.prepare(`
    UPDATE breakdown_sms_templates
    SET body=?,active=?,updated_at=CURRENT_TIMESTAMP,updated_by_user_id=?
    WHERE template_key=?
  `).bind(text, active ? 1 : 0, updatedByUserId, key).run();
  if (!Number(result.meta.changes || 0)) throw new Error('Unknown breakdown text template.');
}

export async function renderBreakdownSmsTemplate(
  db: D1Database,
  templateKey: string,
  values: Record<string, string | number | null | undefined>,
  fallback = '',
) {
  const row = await db.prepare(`SELECT body,active FROM breakdown_sms_templates WHERE template_key=?`).bind(templateKey).first<{ body: string; active: number }>();
  if (row && !row.active) return '';
  const source = String(row?.body || fallback || '');
  const rendered = source.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_match, key: string) => String(values[key] ?? ''));
  return rendered
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function breakdownGroupId(db: D1Database) {
  const group = await db.prepare(`SELECT id FROM notification_groups WHERE name=? AND active=1`).bind(BREAKDOWN_SMS_GROUP).first<{ id: number }>();
  if (!group) throw new Error('Breakdown Alerts notification group is missing.');
  return Number(group.id);
}

export async function listBreakdownSmsContacts(db: D1Database): Promise<BreakdownSmsContact[]> {
  const groupId = await breakdownGroupId(db);
  const result = await db.prepare(`
    SELECT id,label,phone,active
    FROM notification_group_contacts
    WHERE group_id=? AND phone IS NOT NULL AND trim(phone)<>''
    ORDER BY active DESC,label COLLATE NOCASE,id
  `).bind(groupId).all<ContactRow>();
  return result.results.map(row => ({
    id: Number(row.id),
    label: String(row.label || ''),
    phone: normalizeSmsPhone(String(row.phone || '')) || String(row.phone || ''),
    active: Boolean(row.active),
  }));
}

export async function findActiveBreakdownSmsContactByPhone(db: D1Database, phone: string) {
  const wanted = normalizeSmsPhone(phone);
  if (!wanted) return null;
  const contacts = await listBreakdownSmsContacts(db);
  return contacts.find(contact => contact.active && normalizeSmsPhone(contact.phone) === wanted) || null;
}

export async function addBreakdownSmsContact(db: D1Database, label: string, phone: string, active = true) {
  const groupId = await breakdownGroupId(db);
  const name = String(label || '').trim().slice(0, 120);
  const normalized = normalizeSmsPhone(phone);
  if (!name) throw new Error('Enter a name for the breakdown text user.');
  if (!normalized) throw new Error('Enter a valid mobile phone number.');
  const existing = await listBreakdownSmsContacts(db);
  if (existing.some(contact => normalizeSmsPhone(contact.phone) === normalized)) throw new Error('That phone number is already on the breakdown text list.');
  await db.prepare(`
    INSERT INTO notification_group_contacts(group_id,label,phone,email,active)
    VALUES(?,?,?,NULL,?)
  `).bind(groupId, name, normalized, active ? 1 : 0).run();
}

export async function updateBreakdownSmsContact(db: D1Database, id: number, label: string, phone: string, active: boolean) {
  const groupId = await breakdownGroupId(db);
  const name = String(label || '').trim().slice(0, 120);
  const normalized = normalizeSmsPhone(phone);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Breakdown text user is invalid.');
  if (!name) throw new Error('Enter a name for the breakdown text user.');
  if (!normalized) throw new Error('Enter a valid mobile phone number.');
  const result = await db.prepare(`
    UPDATE notification_group_contacts SET label=?,phone=?,active=?
    WHERE id=? AND group_id=?
  `).bind(name, normalized, active ? 1 : 0, id, groupId).run();
  if (!Number(result.meta.changes || 0)) throw new Error('Breakdown text user was not found.');
}

export async function removeBreakdownSmsContact(db: D1Database, id: number) {
  const groupId = await breakdownGroupId(db);
  const row = await db.prepare(`SELECT email FROM notification_group_contacts WHERE id=? AND group_id=?`).bind(id, groupId).first<{ email: string | null }>();
  if (!row) throw new Error('Breakdown text user was not found.');
  if (String(row.email || '').trim()) {
    await db.prepare(`UPDATE notification_group_contacts SET phone=NULL WHERE id=? AND group_id=?`).bind(id, groupId).run();
  } else {
    await db.prepare(`DELETE FROM notification_group_contacts WHERE id=? AND group_id=?`).bind(id, groupId).run();
  }
}
