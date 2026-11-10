#!/usr/bin/env node
/** Private CI administration only. Inventory values and credentials never go to stdout. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { inventoryImportHash, normalizeInventoryImport, planInventoryImport, buildInventoryImportSql, verifyInventoryImportPlan } from '../lib/inventory-import.js';

function argumentsFor(argv) {
  const [mode, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    if (!/^--[a-z-]+$/.test(rest[index]) || !rest[index + 1] || rest[index + 1].startsWith('--')) throw new Error('Invalid command arguments.');
    options[rest[index].slice(2)] = rest[index + 1];
  }
  return { mode, options };
}

async function privateJson(path, value) {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function cloudflareContext(options) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !/^[a-f0-9]{32}$/i.test(accountId || '')) throw new Error('Configured Cloudflare API token and account ID are required.');
  const configText = await readFile(options.config || 'wrangler.jsonc', 'utf8');
  const config = JSON.parse(configText.replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1'));
  const database = config.d1_databases?.find((entry) => entry.database_name === 'norlow-repair-production');
  if (!database || !/^[a-f0-9-]{36}$/i.test(database.database_id)) throw new Error('Production inventory D1 configuration was not found.');
  return { token, accountId, databaseId: database.database_id, databaseName: database.database_name, config: options.config || 'wrangler.jsonc' };
}

async function query(context, sql, params = []) {
  let response;
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${context.accountId}/d1/database/${context.databaseId}/query`, {
      method: 'POST', headers: { authorization: `Bearer ${context.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(60000),
    });
  } catch { throw new Error('Cloudflare D1 request failed; no response details were logged.'); }
  let payload;
  try { payload = await response.json(); } catch { throw new Error(`Cloudflare returned unreadable data (HTTP ${response.status}).`); }
  if (!response.ok || payload.success !== true || !Array.isArray(payload.result) || payload.result.some((result) => result.success === false)) {
    throw new Error(`Cloudflare D1 query was rejected (HTTP ${response.status}); private response details were withheld.`);
  }
  return payload.result.flatMap((result) => result.results || []);
}

async function readTable(context, table, limit) {
  // Identifiers are selected exclusively from this fixed internal allowlist.
  if (!new Set(['parts', 'part_warehouse_stock', 'warehouses', 'part_warehouse_locations']).has(table)) throw new Error('Unsupported inventory backup table.');
  const rows = [];
  let after = 0;
  while (true) {
    const page = await query(context, `SELECT * FROM ${table} WHERE id > ? ORDER BY id LIMIT 1000`, [after]);
    rows.push(...page);
    if (rows.length > limit) throw new Error(`Inventory backup exceeds the bounded ${table} limit. No partial backup was accepted.`);
    if (page.length < 1000) break;
    after = Number(page[page.length - 1].id);
  }
  return rows;
}

export async function exportInventory(context) {
  const schema = await query(context, "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('part_warehouse_locations','inventory_source_imports')");
  const binsTablePresent = schema.some((entry) => entry.name === 'part_warehouse_locations');
  const tables = {};
  for (const [name, limit] of [['parts', 30000], ['part_warehouse_stock', 90000], ['warehouses', 500]]) tables[name] = await readTable(context, name, limit);
  tables.part_warehouse_locations = binsTablePresent ? await readTable(context, 'part_warehouse_locations', 60000) : [];
  const inventoryOperationTail = await query(context, `
    SELECT l.warehouse_stock_id, l.operation_id, l.id AS line_id
    FROM inventory_operation_lines l JOIN inventory_operations o ON o.id=l.operation_id
    WHERE o.status='applied' AND l.warehouse_stock_id IS NOT NULL
      AND l.id=(SELECT MAX(l2.id) FROM inventory_operation_lines l2 JOIN inventory_operations o2 ON o2.id=l2.operation_id WHERE l2.warehouse_stock_id=l.warehouse_stock_id AND o2.status='applied')
    ORDER BY l.warehouse_stock_id LIMIT 90001`);
  const openRequests = await query(context, `SELECT id,repair_id,part_id,warehouse_id,requested_quantity,used_quantity,status,created_at,updated_at FROM repair_part_requests WHERE status='open' ORDER BY id LIMIT 30001`);
  const coreObligations = await query(context, `SELECT id,source_operation_id,repair_id,issued_part_id,core_part_id,quantity,status FROM part_core_obligations WHERE status='open' ORDER BY id LIMIT 30001`);
  if (inventoryOperationTail.length > 90000 || openRequests.length > 30000 || coreObligations.length > 30000) throw new Error('Inventory audit context exceeds its bounded export limit.');
  return { schemaVersion: 1, complete: true, exportedAt: new Date().toISOString(), databaseName: context.databaseName, databaseId: context.databaseId,
    binsTablePresent, auditTablePresent: schema.some((entry) => entry.name === 'inventory_source_imports'), tables,
    inventoryOperationTail, openRequests, coreObligations,
    counts: { ...Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])), inventoryOperationTail: inventoryOperationTail.length, openRequests: openRequests.length, coreObligations: coreObligations.length } };
}

async function main() {
  const { mode, options } = argumentsFor(process.argv.slice(2));
  if (mode === 'export') {
    if (!options.out) throw new Error('--out is required.');
    const snapshot = await exportInventory(await cloudflareContext(options));
    await privateJson(options.out, snapshot);
    console.log(JSON.stringify({ ok: true, mode, complete: true, counts: snapshot.counts, snapshotSha256: inventoryImportHash(snapshot) }));
    return;
  }
  if (mode === 'preview') {
    if (!options.source || !options.snapshot || !options.out) throw new Error('--source, --snapshot, and --out are required.');
    const [source, snapshot] = await Promise.all([readFile(options.source,'utf8').then(JSON.parse),readFile(options.snapshot,'utf8').then(JSON.parse)]);
    const plan = planInventoryImport(source,snapshot);
    await privateJson(options.out,plan);
    if (options.sql && plan.canApply) await writeFile(options.sql,buildInventoryImportSql(plan),{mode:0o600});
    console.log(JSON.stringify({ok:true,mode,canApply:plan.canApply,planHash:plan.planHash,planSha256:plan.planSha256,importKey:plan.importKey,summary:plan.summary}));
    return;
  }
  if (mode === 'apply') {
    const backupPath=options.backup||options.snapshot;
    const receiptPath=options.receipt||options.out;
    if (!options.plan || !backupPath || !options.source || !options['expected-plan-hash'] || !receiptPath) throw new Error('--plan, --source, --snapshot, --expected-plan-hash, and --out are required.');
    const [rawPlan,backup,source] = await Promise.all([readFile(options.plan,'utf8').then(JSON.parse),readFile(backupPath,'utf8').then(JSON.parse),readFile(options.source,'utf8').then(JSON.parse)]);
    const plan=verifyInventoryImportPlan(rawPlan);
    if(plan.planSha256!==options['expected-plan-hash'] || inventoryImportHash(backup)!==plan.snapshotSha256 || inventoryImportHash(normalizeInventoryImport(source))!==plan.payloadSha256) throw new Error('Approved source, plan, or complete private backup did not match.');
    const context=await cloudflareContext(options);
    if(plan.databaseId!==context.databaseId) throw new Error('Plan belongs to a different database.');
    const schema=await query(context,"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('part_warehouse_locations','inventory_source_imports','inventory_source_import_rows')");
    if(schema.length!==3) throw new Error('Required inventory location/import audit migrations have not been deployed.');
    const receiptSql='SELECT import_key,source_sha256,payload_sha256,plan_sha256,snapshot_sha256,status,source_row_count,part_count,quantity_before,quantity_after,applied_at FROM inventory_source_imports WHERE import_key=?';
    const existing=(await query(context,receiptSql,[plan.importKey]))[0];
    if(existing) {
      if(existing.status!=='applied'||existing.payload_sha256!==plan.payloadSha256||existing.source_sha256!==plan.source.sha256) throw new Error('An incompatible or incomplete import receipt already exists.');
      await privateJson(receiptPath,{ok:true,idempotent:true,...existing});
      console.log(JSON.stringify({ok:true,mode,idempotent:true,sourceRows:existing.source_row_count,parts:existing.part_count}));
      return;
    }
    const sqlPath=resolve(dirname(options.plan),'inventory-apply.sql');
    const logPath=resolve(dirname(options.plan),'inventory-apply-private.log');
    const actor=`Authorized GitHub Actions inventory import${process.env.GITHUB_RUN_ID?`; run ${process.env.GITHUB_RUN_ID}`:''}`;
    await writeFile(sqlPath,buildInventoryImportSql(plan,actor),{mode:0o600});
    // Wrangler's file-import endpoint restores the original database if ANY statement
    // fails. Do not replace this with separate REST query calls or split SQL chunks.
    // Source: installed Wrangler executeRemotely() / D1 import workflow.
    const child=spawn(resolve('node_modules/.bin/wrangler'),['d1','execute',context.databaseName,'--remote','--config',context.config,'--file',sqlPath,'--yes','--json'],{stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    const logs=[];
    child.stdout.on('data',(chunk)=>logs.push(chunk)); child.stderr.on('data',(chunk)=>logs.push(chunk));
    const exitCode=await new Promise((resolveExit,reject)=>{child.on('error',reject);child.on('close',resolveExit);});
    await writeFile(logPath,Buffer.concat(logs),{mode:0o600});
    if(exitCode!==0) throw new Error('Atomic D1 file import failed; inspect only the encrypted private log.');
    const receipt=(await query(context,receiptSql,[plan.importKey]))[0];
    if(!receipt||receipt.status!=='applied'||receipt.source_row_count!==plan.summary.sourceRows||receipt.plan_sha256!==plan.planSha256) throw new Error('Production import receipt verification did not match the approved plan.');
    const verification=await query(context,`SELECT COUNT(*) AS audited_rows,SUM(CASE WHEN ABS(s.quantity_on_hand-CAST(json_extract(r.source_json,'$.quantity') AS REAL))<0.000001 THEN 1 ELSE 0 END) AS matching_balances FROM inventory_source_import_rows r JOIN part_warehouse_stock s ON s.id=r.warehouse_stock_id WHERE r.import_key=?`,[plan.importKey]);
    const match=verification[0];
    if(Number(match?.audited_rows)!==plan.summary.sourceRows||Number(match?.matching_balances)!==plan.summary.sourceRows) throw new Error('Post-import stock changed or verification failed; inspect the retained import audit before retrying.');
    await privateJson(receiptPath,{ok:true,idempotent:false,...receipt,verification:match});
    console.log(JSON.stringify({ok:true,mode,idempotent:false,sourceRows:receipt.source_row_count,parts:receipt.part_count,matchingBalances:match.matching_balances}));
    return;
  }
  throw new Error('Choose export, preview, or apply.');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(() => { console.error('Inventory source administration failed. Private source data and response details were not logged.'); process.exitCode = 1; });
}
