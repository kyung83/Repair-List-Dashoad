import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const client = readFileSync(new URL('../lib/gmail-client.ts', import.meta.url), 'utf8');
const credentials = readFileSync(new URL('../lib/gmail-runtime-credentials.ts', import.meta.url), 'utf8');
const notifications = readFileSync(new URL('../lib/notifications.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../app/api/admin/gmail/route.ts', import.meta.url), 'utf8');
const authorize = readFileSync(new URL('../app/api/admin/gmail/authorize/route.ts', import.meta.url), 'utf8');
const callback = readFileSync(new URL('../app/api/admin/gmail/callback/route.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/admin/gmail/page.tsx', import.meta.url), 'utf8');
const navigation = readFileSync(new URL('../app/navigation-config.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0103_gmail_breakdown_sender.sql', import.meta.url), 'utf8');
const recipient = readFileSync(new URL('../lib/breakdown-email-recipient.ts', import.meta.url), 'utf8');

test('Gmail breakdown sender uses Jerry account with send-only Gmail permission and default recipient', () => {
  assert.match(client, /GMAIL_BREAKDOWN_SENDER = 'Jtomaski@norloworld\.com'/);
  assert.match(client, /GMAIL_BREAKDOWN_RECIPIENT = 'breakdown@norloworld\.com'/);
  assert.match(recipient, /DEFAULT_BREAKDOWN_EMAIL_RECIPIENT = 'breakdown@norloworld\.com'/);
  assert.match(client, /https:\/\/www\.googleapis\.com\/auth\/gmail\.send/);
  assert.match(client, /access_type', 'offline'/);
  assert.match(client, /prompt', 'consent'/);
  assert.match(client, /login_hint', GMAIL_BREAKDOWN_SENDER/);
  assert.match(client, /gmail\/v1\/users\/me\/messages\/send/);
  assert.doesNotMatch(client, /gmail\.readonly|gmail\.modify|mail\.google\.com/);
});

test('Gmail OAuth secrets and refresh token are encrypted before D1 storage', () => {
  assert.match(credentials, /encryptGeotabRuntimeSecret\(secret, env\)/);
  assert.match(credentials, /encryptGeotabRuntimeSecret\(token, env\)/);
  assert.match(credentials, /client_secret_ciphertext/);
  assert.match(credentials, /refresh_token_ciphertext/);
  assert.doesNotMatch(page, /GMAIL_CLIENT_SECRET|refresh_token/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS gmail_runtime_credentials/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS gmail_oauth_states/);
});

test('Gmail OAuth flow is admin-only, state-checked, and verifies Jerry mailbox', () => {
  for (const source of [api, authorize]) assert.match(source, /user\.role !== 'admin'/);
  assert.match(authorize, /createGmailOAuthState/);
  assert.match(callback, /consumeGmailOAuthState/);
  assert.match(client, /email !== EXPECTED_EMAIL/);
  assert.match(client, /openid email/);
});

test('breakdown alerts prefer connected Gmail and preserve real Gmail threading', () => {
  assert.match(notifications, /getGmailRuntimeCredentialMetadata/);
  assert.match(notifications, /sendGmailRuntimeEmail/);
  assert.match(notifications, /gmail_thread_id/);
  assert.match(notifications, /gmailThreadId: thread\?\.gmail_thread_id/);
  assert.match(client, /In-Reply-To/);
  assert.match(client, /References/);
  assert.match(client, /threadId: input\.gmailThreadId/);
  assert.match(migration, /ADD COLUMN gmail_thread_id TEXT/);
});

test('Diagnostics exposes a one-time Connect Jtomaski Gmail workflow and test email button', () => {
  assert.match(navigation, /href: "\/admin\/gmail", label: "Breakdown Email"/);
  assert.match(page, /Connect Jtomaski Gmail/);
  assert.match(page, /Send test email/);
  assert.match(page, /Authorized redirect URI/);
  assert.match(page, /Google OAuth Client Secret/);
  assert.match(api, /Breakdown Email Test - Jerry Tomaski/);
});

test('admin can change the real breakdown email recipient for testing without changing Gmail credentials', () => {
  assert.match(api, /action === 'save-recipient'/);
  assert.match(api, /saveBreakdownEmailRecipient/);
  assert.match(api, /getBreakdownEmailRecipient/);
  assert.match(api, /to: recipient/);
  assert.match(recipient, /Roadside Breakdown Mailbox/);
  assert.match(recipient, /UPDATE notification_group_contacts/);
  assert.match(page, /Save Email Recipient/);
  assert.match(page, /TEST RECIPIENT ACTIVE/);
  assert.match(page, /Restore \{defaultRecipient\}/);
  assert.match(page, /Twilio texting and the Text Schedule are separate/);
});
