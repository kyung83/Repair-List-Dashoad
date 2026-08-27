import { env } from 'cloudflare:workers';
import {
  loadGmailOAuthClient,
  loadGmailRuntimeCredentials,
  saveGmailConnection,
} from '@/lib/gmail-runtime-credentials';

export const GMAIL_BREAKDOWN_SENDER = 'Jtomaski@norloworld.com';
export const GMAIL_BREAKDOWN_RECIPIENT = 'breakdown@norloworld.com';
const EXPECTED_EMAIL = GMAIL_BREAKDOWN_SENDER.toLowerCase();
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export type GmailRuntimeAttachment = {
  filename: string;
  contentType: string;
  data: ArrayBuffer;
};

function utf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(binary);
}

function arrayBufferBase64(value: ArrayBuffer) {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(binary);
}

function wrapBase64(value: string) {
  return value.match(/.{1,76}/g)?.join('\r\n') || value;
}

function base64Url(value: string) {
  return utf8Base64(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function mimeHeader(value: string) {
  const clean = value.replace(/[\r\n]+/g, ' ').trim();
  return /^[\x20-\x7E]*$/.test(clean) ? clean : `=?UTF-8?B?${utf8Base64(clean)}?=`;
}

function safeAddress(value: string) {
  const clean = value.replace(/[\r\n]+/g, '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('Email address is invalid.');
  return clean;
}

function safeFilename(value: string) {
  const clean = String(value || 'photo').replace(/[\r\n"]/g, '').trim().slice(0, 180);
  return clean || 'photo';
}

function safeContentType(value: string) {
  const clean = String(value || '').trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(clean) ? clean : 'application/octet-stream';
}

function randomToken(bytesCount = 18) {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesCount));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function normalizedMessageId(value: string) {
  const id = String(value || '').trim().replace(/[\r\n]+/g, '');
  if (!id) return '';
  return id.startsWith('<') && id.endsWith('>') ? id : `<${id}>`;
}

function alternativeBody(boundary: string, text: string, html: string) {
  return [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(utf8Base64(text)),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(utf8Base64(html)),
    `--${boundary}--`,
  ];
}

function buildMime(input: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  messageId: string;
  replyToMessageId?: string;
  attachments?: GmailRuntimeAttachment[];
}) {
  const alternativeBoundary = `norlow_alt_${randomToken(10)}`;
  const mixedBoundary = `norlow_mixed_${randomToken(10)}`;
  const from = safeAddress(input.from);
  const to = safeAddress(input.to);
  const messageId = normalizedMessageId(input.messageId);
  const replyTo = normalizedMessageId(input.replyToMessageId || '');
  const attachments = Array.isArray(input.attachments) ? input.attachments.filter((item) => item?.data instanceof ArrayBuffer) : [];
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${mimeHeader(input.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    ...(replyTo ? [`In-Reply-To: ${replyTo}`, `References: ${replyTo}`] : []),
    'MIME-Version: 1.0',
    `Content-Type: ${attachments.length ? 'multipart/mixed' : 'multipart/alternative'}; boundary="${attachments.length ? mixedBoundary : alternativeBoundary}"`,
  ];

  if (!attachments.length) {
    return [
      ...headers,
      '',
      ...alternativeBody(alternativeBoundary, input.text, input.html),
      '',
    ].join('\r\n');
  }

  const parts = [
    ...headers,
    '',
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
    '',
    ...alternativeBody(alternativeBoundary, input.text, input.html),
  ];

  for (const attachment of attachments) {
    const filename = safeFilename(attachment.filename);
    const contentType = safeContentType(attachment.contentType);
    parts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${contentType}; name="${filename}"`,
      `Content-Disposition: attachment; filename="${filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(arrayBufferBase64(attachment.data)),
    );
  }
  parts.push(`--${mixedBoundary}--`, '');
  return parts.join('\r\n');
}

async function postForm(url: string, fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* keep empty */ }
  if (!response.ok) {
    const detail = String(data.error_description || data.error || text || `HTTP ${response.status}`).slice(0, 500);
    throw new Error(`Google OAuth request failed: ${detail}`);
  }
  return data;
}

export async function buildGmailAuthorizationUrl(state: string, redirectUri: string) {
  const client = await loadGmailOAuthClient(env.DB, env);
  if (!client) throw new Error('Google OAuth Client ID and Client Secret have not been configured.');
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', `openid email ${GMAIL_SEND_SCOPE}`);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  url.searchParams.set('login_hint', GMAIL_BREAKDOWN_SENDER);
  return url.toString();
}

export async function completeGmailAuthorization(
  code: string,
  redirectUri: string,
  updatedByUserId: number,
) {
  const client = await loadGmailOAuthClient(env.DB, env);
  if (!client) throw new Error('Google OAuth client configuration is missing.');
  const token = await postForm(GOOGLE_TOKEN_URL, {
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const accessToken = String(token.access_token || '');
  const refreshToken = String(token.refresh_token || '');
  if (!accessToken || !refreshToken) {
    throw new Error('Google did not return offline Gmail access. Reconnect and approve access when prompted.');
  }
  const profileResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const profile = await profileResponse.json().catch(() => ({})) as { email?: string; email_verified?: boolean };
  if (!profileResponse.ok) throw new Error('Google account identity could not be verified.');
  const email = String(profile.email || '').trim().toLowerCase();
  if (email !== EXPECTED_EMAIL) {
    throw new Error(`Connect ${GMAIL_BREAKDOWN_SENDER}, not ${email || 'another Google account'}.`);
  }
  await saveGmailConnection(env.DB, env, refreshToken, email, updatedByUserId);
  return { email };
}

async function refreshAccessToken() {
  const credentials = await loadGmailRuntimeCredentials(env.DB, env);
  if (!credentials) throw new Error('Gmail is not connected.');
  if (credentials.connectedEmail.toLowerCase() !== EXPECTED_EMAIL) {
    throw new Error(`Connected Gmail account must be ${GMAIL_BREAKDOWN_SENDER}.`);
  }
  const token = await postForm(GOOGLE_TOKEN_URL, {
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: 'refresh_token',
  });
  const accessToken = String(token.access_token || '');
  if (!accessToken) throw new Error('Google did not return a Gmail access token.');
  return accessToken;
}

export async function sendGmailRuntimeEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyToMessageId?: string;
  gmailThreadId?: string;
  attachments?: GmailRuntimeAttachment[];
}) {
  const accessToken = await refreshAccessToken();
  const messageId = `<norlow-breakdown-${Date.now()}-${randomToken(10)}@norloworld.com>`;
  const raw = buildMime({
    from: GMAIL_BREAKDOWN_SENDER,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    messageId,
    replyToMessageId: input.replyToMessageId,
    attachments: input.attachments,
  });
  const response = await fetch(GMAIL_SEND_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      raw: base64Url(raw),
      ...(input.gmailThreadId ? { threadId: input.gmailThreadId } : {}),
    }),
  });
  const text = await response.text();
  let result: { id?: string; threadId?: string; error?: { message?: string } } = {};
  try { result = text ? JSON.parse(text) as typeof result : {}; } catch { /* keep empty */ }
  if (!response.ok) {
    throw new Error(`Gmail send failed: ${String(result.error?.message || text || `HTTP ${response.status}`).slice(0, 500)}`);
  }
  return {
    messageId,
    gmailMessageId: String(result.id || ''),
    gmailThreadId: String(result.threadId || ''),
  };
}

export async function revokeGmailRuntimeAccess() {
  const credentials = await loadGmailRuntimeCredentials(env.DB, env);
  if (!credentials?.refreshToken) return;
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(credentials.refreshToken)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }).catch(() => undefined);
}
