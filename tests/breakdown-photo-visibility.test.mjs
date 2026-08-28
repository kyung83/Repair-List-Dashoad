import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const breakdownRoute = readFileSync(new URL('../app/api/breakdowns/route.ts', import.meta.url), 'utf8');
const photoListRoute = readFileSync(new URL('../app/api/breakdowns/photos/route.ts', import.meta.url), 'utf8');
const photoReader = readFileSync(new URL('../app/api/photos/[...key]/route.ts', import.meta.url), 'utf8');
const breakdownPage = readFileSync(new URL('../app/breakdowns/page.tsx', import.meta.url), 'utf8');
const publicBreakdownPage = readFileSync(new URL('../app/report-breakdown/page.tsx', import.meta.url), 'utf8');
const rootLayout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
const photoPrep = readFileSync(new URL('../public/breakdown-photo-prep.js', import.meta.url), 'utf8');
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

test('uploaded roadside photos are attached to the one original Gmail breakdown email', () => {
  const createIndex = breakdownRoute.indexOf('await createBreakdown');
  const uploadIndex = breakdownRoute.indexOf('await env.FILES.put');
  const attachmentIndex = breakdownRoute.indexOf('emailAttachments.push');
  const emailIndex = breakdownRoute.indexOf('await notifyBreakdownInitialEmailGroup');
  assert.ok(createIndex >= 0 && uploadIndex > createIndex && attachmentIndex > uploadIndex && emailIndex > attachmentIndex);
  assert.doesNotMatch(breakdownRoute, /await notifyBreakdownEmailGroup/);

  const groupStart = notifications.indexOf('export async function notifyBreakdownGroup');
  const initialEmailStart = notifications.indexOf('export async function notifyBreakdownInitialEmailGroup');
  const groupBody = notifications.slice(groupStart, initialEmailStart);
  assert.ok(groupStart >= 0 && initialEmailStart > groupStart);
  assert.doesNotMatch(groupBody, /sendBreakdownEmail/);

  const initialEmailEnd = notifications.indexOf('/** Email-only follow-up', initialEmailStart);
  const initialEmailBody = notifications.slice(initialEmailStart, initialEmailEnd);
  assert.match(initialEmailBody, /rememberThread:\s*true/);
  assert.match(initialEmailBody, /attachments/);
  assert.match(gmailClient, /multipart\/mixed/);
  assert.match(gmailClient, /Content-Disposition: attachment/);
  assert.match(gmailClient, /arrayBufferBase64/);
});

test('public breakdown photo upload avoids the forced iPhone camera capture path', () => {
  assert.match(publicBreakdownPage, /<input type="file" name="photos" accept="image\/\*" multiple/);
  assert.doesNotMatch(publicBreakdownPage, /capture="environment"/);
  assert.match(publicBreakdownPage, /const responseText = await response\.text\(\)/);
  assert.match(publicBreakdownPage, /string did not match the expected pattern/i);
});

test('public breakdown page automatically compresses large phone photos before submit', () => {
  assert.match(rootLayout, /<script src="\/breakdown-photo-prep\.js" defer/);
  assert.match(photoPrep, /window\.location\.pathname !== '\/report-breakdown'/);
  assert.match(photoPrep, /input\.name !== 'photos'/);
  assert.match(photoPrep, /var MAX_EDGE = 1600/);
  assert.match(photoPrep, /var TARGET_BYTES = 700000/);
  assert.match(photoPrep, /canvas\.toBlob/);
  assert.match(photoPrep, /'image\/jpeg'/);
  assert.match(photoPrep, /new DataTransfer\(\)/);
  assert.match(photoPrep, /input\.files = transfer\.files/);
  assert.match(photoPrep, /setSubmitBusy\(input, true\)/);
  assert.match(photoPrep, /setSubmitBusy\(input, false\)/);
});
