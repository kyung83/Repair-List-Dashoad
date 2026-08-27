import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const breakdownRoute = readFileSync(new URL('../app/api/breakdowns/route.ts', import.meta.url), 'utf8');
const photoListRoute = readFileSync(new URL('../app/api/breakdowns/photos/route.ts', import.meta.url), 'utf8');
const photoReader = readFileSync(new URL('../app/api/photos/[...key]/route.ts', import.meta.url), 'utf8');
const breakdownPage = readFileSync(new URL('../app/breakdowns/page.tsx', import.meta.url), 'utf8');
const gmailClient = readFileSync(new URL('../lib/gmail-client.ts', import.meta.url), 'utf8');
const notifications = readFileSync(new URL('../lib/notifications.ts', import.meta.url), 'utf8');

test('roadside photos remain private but are readable by breakdown managers', () => {
  assert.match(photoReader, /roadside-breakdowns\//);
  assert.match(photoReader, /user\.role !== 'manager' && user\.role !== 'admin'/);
  assert.match(photoListRoute, /JOIN attachments a ON a\.repair_id = b\.repair_id/);
  assert.match(photoListRoute, /a\.object_key LIKE 'roadside-breakdowns\/%'/);
});

test('breakdown dashboard loads and renders driver photos', () => {
  assert.match(breakdownPage, /\/api\/breakdowns\/photos\?open=1/);
  assert.match(breakdownPage, /DRIVER PHOTOS/);
  assert.match(breakdownPage, /src=\{photo\.url\}/);
  assert.match(breakdownPage, /href=\{photo\.url\}/);
});

test('uploaded roadside photos are attached to a reply in the original Gmail thread', () => {
  const uploadIndex = breakdownRoute.indexOf('await env.FILES.put');
  const attachmentIndex = breakdownRoute.indexOf('emailAttachments.push');
  const emailIndex = breakdownRoute.indexOf('await notifyBreakdownEmailGroup');
  assert.ok(uploadIndex >= 0 && attachmentIndex > uploadIndex && emailIndex > attachmentIndex);
  assert.match(notifications, /attachments:\s*BreakdownEmailAttachment\[\]/);
  assert.match(notifications, /gmailThreadId:\s*thread\?\.gmail_thread_id/);
  assert.match(notifications, /replyToMessageId:\s*thread\?\.root_message_id/);
  assert.match(gmailClient, /multipart\/mixed/);
  assert.match(gmailClient, /Content-Disposition: attachment/);
  assert.match(gmailClient, /arrayBufferBase64/);
});
