#!/usr/bin/env node
// One-time operator workflow. Only encrypted data leaves the authorized CI runner.
import { generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sealInventory, openInventory } from './inventory-private-envelope.mjs';

const keyName = 'inventory-emdecs-20261110-rsa-v1';
const configPath = 'wrangler.jsonc';
const outputDir = resolve(process.env.RUNNER_TEMP || '/tmp', 'protected-inventory-output');
const privateDir = resolve(process.env.RUNNER_TEMP || '/tmp', 'private-inventory-work');
let context;

async function query(sql, params = []) {
  let response;
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${context.accountId}/d1/database/${context.databaseId}/query`, {
      method: 'POST', headers: { authorization: `Bearer ${context.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(60000),
    });
  } catch { throw new Error('The private D1 request failed.'); }
  const body = await response.json();
  if (!response.ok || body.success !== true || body.result?.some(item => item.success === false)) throw new Error('The private D1 request was rejected.');
  return body.result.flatMap(item => item.results || []);
}

function runPrivate(args) {
  const result = spawnSync(process.execPath, ['scripts/inventory-source-import.mjs', ...args], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Inventory administration did not complete; private command output was withheld.');
}

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function writePrivate(path, value) { await writeFile(path, JSON.stringify(value), { mode: 0o600 }); }
async function protect(name, value, recipient) { await writePrivate(resolve(outputDir, name), sealInventory(value, recipient)); }

async function importBundle(create) {
  const rows = await query('SELECT version_token FROM sync_state WHERE feed_name = ? LIMIT 1', [keyName]);
  if (rows.length) {
    const bundle = JSON.parse(rows[0].version_token);
    if (!bundle.publicKey || !bundle.privateKey || bundle.purpose !== keyName) throw new Error('Import key record is invalid.');
    return bundle;
  }
  if (!create) throw new Error('The prepared import key is missing.');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const bundle = { publicKey, privateKey, purpose: keyName, createdAt: new Date().toISOString() };
  await query('INSERT INTO sync_state(feed_name,version_token,last_success_at,last_error) VALUES(?,?,CURRENT_TIMESTAMP,NULL)', [keyName, JSON.stringify(bundle)]);
  return bundle;
}

async function main() {
  const request = await readJson('ops/inventory-source-request.json');
  if (!['bootstrap', 'preview', 'apply', 'cleanup'].includes(request.operation)) throw new Error('Unsupported inventory operation.');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const database = config.d1_databases.find(item => item.database_name === 'norlow-repair-production');
  context = { token: process.env.CLOUDFLARE_API_TOKEN, accountId: process.env.CLOUDFLARE_ACCOUNT_ID, databaseId: database?.database_id };
  if (!context.token || !/^[a-f0-9]{32}$/i.test(context.accountId || '') || !/^[a-f0-9-]{36}$/i.test(context.databaseId || '')) throw new Error('Authorized production configuration is missing.');
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  const recipient = await readFile('ops/inventory-recipient-public.pem', 'utf8');

  if (request.operation === 'cleanup') {
    await query('DELETE FROM sync_state WHERE feed_name = ?', [keyName]);
    await protect('cleanup-receipt.json.enc', { ok: true, keyRemoved: true, completedAt: new Date().toISOString() }, recipient);
    console.log('Temporary inventory encryption key removed.');
    return;
  }
  const bundle = await importBundle(request.operation === 'bootstrap');
  const beforePath = resolve(privateDir, 'inventory-before.json');
  runPrivate(['export', '--out', beforePath, '--config', configPath]);
  const before = await readJson(beforePath);
  await protect('inventory-before.json.enc', before, recipient);
  if (request.operation === 'bootstrap') {
    console.log('INVENTORY_IMPORT_PUBLIC_KEY=' + Buffer.from(bundle.publicKey).toString('base64'));
    console.log('Private inventory baseline exported and encrypted.');
    return;
  }
  const payload = openInventory(await readJson('ops/inventory-source-payload.json.enc'), bundle.privateKey);
  const sourcePath = resolve(privateDir, 'inventory-source.json');
  await writePrivate(sourcePath, payload);
  // Preview/apply arguments are intentionally explicit and constrained to this source.
  const planPath = resolve(privateDir, 'inventory-plan.json');
  runPrivate(['preview', '--source', sourcePath, '--snapshot', beforePath, '--out', planPath]);
  const plan = await readJson(planPath);
  await protect('inventory-plan.json.enc', plan, recipient);
  if (request.operation === 'preview') {
    console.log('Private inventory preview completed and encrypted.');
    return;
  }
  if (!request.expectedPlanHash || plan.planHash !== request.expectedPlanHash) throw new Error('The current preview does not match the reviewed inventory plan.');
  const receiptPath = resolve(privateDir, 'inventory-receipt.json');
  runPrivate(['apply', '--source', sourcePath, '--snapshot', beforePath, '--plan', planPath, '--out', receiptPath, '--config', configPath, '--expected-plan-hash', request.expectedPlanHash]);
  await protect('inventory-receipt.json.enc', await readJson(receiptPath), recipient);
  const afterPath = resolve(privateDir, 'inventory-after.json');
  runPrivate(['export', '--out', afterPath, '--config', configPath]);
  await protect('inventory-after.json.enc', await readJson(afterPath), recipient);
  console.log('Reviewed inventory import applied; verification artifacts are encrypted.');
}

main().catch(() => { console.error('Protected inventory workflow stopped. No private data or credentials were logged.'); process.exitCode = 1; });
