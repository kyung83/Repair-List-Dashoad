import { env } from 'cloudflare:workers';
import { brotliDecompressSync } from 'node:zlib';
import { protectedInventoryImport } from '@/lib/inventory-import-protected';

type VendorTuple = [string, string, string, string, string, string, string, string, boolean, string];
type PartTuple = [string, string, number, number, number | null, string, string, string, string, string, string, number | null];
type StockTuple = [string, string, string, string, number, string, number | null, number | null, number, string, string, string, string, number];

type InventoryPayload = {
  v: number;
  d: string;
  V: VendorTuple[];
  P: PartTuple[];
  S: StockTuple[];
};

type ImportBody = {
  phase?: 'prepare' | 'vendors' | 'parts' | 'stocks' | 'status';
  offset?: number;
  limit?: number;
};

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodePrivateKey(value: string) {
  const base64 = value
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!base64) throw new Error('The protected import key is unavailable.');
  return decodeBase64(base64);
}

async function decryptPayload(privateKeyPem: string): Promise<InventoryPayload> {
  if (protectedInventoryImport.ciphertext.length !== protectedInventoryImport.expectedCiphertextLength) {
    throw new Error('The protected inventory payload is incomplete.');
  }

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    decodePrivateKey(privateKeyPem),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt'],
  );
  const rawAesKey = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    decodeBase64(protectedInventoryImport.wrappedKey),
  );
  const aesKey = await crypto.subtle.importKey('raw', rawAesKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const compressed = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64(protectedInventoryImport.iv) },
    aesKey,
    decodeBase64(protectedInventoryImport.ciphertext),
  );
  const plaintext = brotliDecompressSync(Buffer.from(compressed));
  const payload = JSON.parse(plaintext.toString('utf8')) as Partial<InventoryPayload>;

  if (payload.v !== 1 || !payload.d || !Array.isArray(payload.V) || !Array.isArray(payload.P) || !Array.isArray(payload.S)) {
    throw new Error('The protected inventory import is invalid.');
  }
  if (
    payload.V.length !== protectedInventoryImport.expected.vendors ||
    payload.P.length !== protectedInventoryImport.expected.parts ||
    payload.S.length !== protectedInventoryImport.expected.stockRows
  ) {
    throw new Error('The protected inventory import counts do not match the source manifest.');
  }
  return payload as InventoryPayload;
}

function pageBounds(offsetValue: unknown, limitValue: unknown, total: number) {
  const offset = Math.max(0, Math.min(total, Math.trunc(Number(offsetValue) || 0)));
  const limit = Math.max(1, Math.min(75, Math.trunc(Number(limitValue) || 75)));
  return { offset, end: Math.min(total, offset + limit) };
}

async function importVendors(payload: InventoryPayload, offsetValue: unknown, limitValue: unknown) {
  const { offset, end } = pageBounds(offsetValue, limitValue, payload.V.length);
  const statements = payload.V.slice(offset, end).map((vendor) => {
    const [vendorCode, name, address, phone, fax, email, paymentTerms, supplierType, taxExempt, taxInfo] = vendor;
    return env.DB.prepare(`
      INSERT INTO vendors (
        name, phone, email, vendor_code, address, fax, payment_terms,
        supplier_type, tax_exempt, tax_info, active, source_updated_at
      ) VALUES (?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''),
                NULLIF(?, ''), ?, NULLIF(?, ''), 1, ?)
      ON CONFLICT(name) DO UPDATE SET
        phone = COALESCE(NULLIF(excluded.phone, ''), vendors.phone),
        email = COALESCE(NULLIF(excluded.email, ''), vendors.email),
        vendor_code = COALESCE(NULLIF(excluded.vendor_code, ''), vendors.vendor_code),
        address = COALESCE(NULLIF(excluded.address, ''), vendors.address),
        fax = COALESCE(NULLIF(excluded.fax, ''), vendors.fax),
        payment_terms = COALESCE(NULLIF(excluded.payment_terms, ''), vendors.payment_terms),
        supplier_type = COALESCE(NULLIF(excluded.supplier_type, ''), vendors.supplier_type),
        tax_exempt = excluded.tax_exempt,
        tax_info = COALESCE(NULLIF(excluded.tax_info, ''), vendors.tax_info),
        active = 1,
        source_updated_at = excluded.source_updated_at
    `).bind(name, phone, email, vendorCode, address, fax, paymentTerms, supplierType, taxExempt ? 1 : 0, taxInfo, payload.d);
  });
  if (statements.length) await env.DB.batch(statements);
  return { phase: 'vendors', imported: statements.length, nextOffset: end, total: payload.V.length, done: end >= payload.V.length };
}

async function importParts(payload: InventoryPayload, offsetValue: unknown, limitValue: unknown) {
  const { offset, end } = pageBounds(offsetValue, limitValue, payload.P.length);
  const statements = payload.P.slice(offset, end).map((part) => {
    const [partNumber, description, quantityOnHand, reorderLevel, unitCost, location, vendorCode,
      sourceActiveFlag, sourceStockFlag, productGroup, markupGroup, chargePrice] = part;
    return env.DB.prepare(`
      INSERT INTO parts (
        part_number, description, quantity_on_hand, reorder_level, preferred_vendor_id,
        unit_cost, location, active, source_active_flag, source_stock_flag,
        product_group, markup_group, charge_price, source_updated_at, updated_at
      ) VALUES (?, ?, ?, ?, (SELECT id FROM vendors WHERE vendor_code = ? LIMIT 1), ?, NULLIF(?, ''), 1,
                NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(part_number) DO UPDATE SET
        description = excluded.description,
        quantity_on_hand = excluded.quantity_on_hand,
        reorder_level = excluded.reorder_level,
        preferred_vendor_id = COALESCE(excluded.preferred_vendor_id, parts.preferred_vendor_id),
        unit_cost = excluded.unit_cost,
        location = excluded.location,
        active = 1,
        source_active_flag = excluded.source_active_flag,
        source_stock_flag = excluded.source_stock_flag,
        product_group = excluded.product_group,
        markup_group = excluded.markup_group,
        charge_price = excluded.charge_price,
        source_updated_at = excluded.source_updated_at,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      partNumber, description, quantityOnHand, reorderLevel, vendorCode, unitCost, location,
      sourceActiveFlag, sourceStockFlag, productGroup, markupGroup, chargePrice, payload.d,
    );
  });
  if (statements.length) await env.DB.batch(statements);
  return { phase: 'parts', imported: statements.length, nextOffset: end, total: payload.P.length, done: end >= payload.P.length };
}

async function importStocks(payload: InventoryPayload, offsetValue: unknown, limitValue: unknown) {
  const { offset, end } = pageBounds(offsetValue, limitValue, payload.S.length);
  const statements = payload.S.slice(offset, end).map((stock) => {
    const [partNumber, warehouseCode, variantKey, coreType, quantityOnHand, unitOfMeasure, unitCost,
      chargePrice, onOrder, cm, inventoryLine, lastPurchaseReceived, lastIssue, sourcePage] = stock;
    return env.DB.prepare(`
      INSERT INTO part_warehouse_stock (
        part_id, warehouse_id, variant_key, core_type, quantity_on_hand, unit_of_measure,
        unit_cost, charge_price, on_order, cm, inventory_line, last_purchase_received,
        last_issue, source_page, source_updated_at, updated_at
      ) VALUES (
        (SELECT id FROM parts WHERE part_number = ? LIMIT 1),
        (SELECT id FROM warehouses WHERE code = ? LIMIT 1),
        ?, NULLIF(?, ''), ?, NULLIF(?, ''), ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''),
        NULLIF(?, ''), NULLIF(?, ''), ?, ?, CURRENT_TIMESTAMP
      )
      ON CONFLICT(part_id, warehouse_id, variant_key) DO UPDATE SET
        core_type = excluded.core_type,
        quantity_on_hand = excluded.quantity_on_hand,
        unit_of_measure = excluded.unit_of_measure,
        unit_cost = excluded.unit_cost,
        charge_price = excluded.charge_price,
        on_order = excluded.on_order,
        cm = excluded.cm,
        inventory_line = excluded.inventory_line,
        last_purchase_received = excluded.last_purchase_received,
        last_issue = excluded.last_issue,
        source_page = excluded.source_page,
        source_updated_at = excluded.source_updated_at,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      partNumber, warehouseCode, variantKey, coreType, quantityOnHand, unitOfMeasure, unitCost,
      chargePrice, onOrder, cm, inventoryLine, lastPurchaseReceived, lastIssue, sourcePage, payload.d,
    );
  });
  if (statements.length) await env.DB.batch(statements);
  return { phase: 'stocks', imported: statements.length, nextOffset: end, total: payload.S.length, done: end >= payload.S.length };
}

async function status(payload: InventoryPayload) {
  const [vendorRow, partRow, stockRow, warehouseResult] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS count FROM vendors WHERE source_updated_at = ?').bind(payload.d).first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM parts WHERE source_updated_at = ?').bind(payload.d).first<{ count: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM part_warehouse_stock WHERE source_updated_at = ?').bind(payload.d).first<{ count: number }>(),
    env.DB.prepare(`
      SELECT w.code, COUNT(*) AS row_count, COALESCE(SUM(s.quantity_on_hand), 0) AS units
      FROM part_warehouse_stock s
      JOIN warehouses w ON w.id = s.warehouse_id
      WHERE s.source_updated_at = ?
      GROUP BY w.code
      ORDER BY w.code
    `).bind(payload.d).all<{ code: string; row_count: number; units: number }>(),
  ]);
  return {
    phase: 'status',
    sourceDate: payload.d,
    expected: protectedInventoryImport.expected,
    actual: {
      vendors: Number(vendorRow?.count ?? 0),
      parts: Number(partRow?.count ?? 0),
      stockRows: Number(stockRow?.count ?? 0),
      warehouses: warehouseResult.results.map((row) => ({ code: row.code, rows: Number(row.row_count), units: Number(row.units) })),
    },
  };
}

export async function POST(request: Request) {
  try {
    const privateKey = env.GEOTAB_CONFIG_PRIVATE_KEY;
    if (!privateKey) return Response.json({ error: 'The protected import key is not configured.' }, { status: 503 });

    const body = await request.json().catch(() => ({})) as ImportBody;
    const phase = body.phase ?? 'status';
    const payload = await decryptPayload(privateKey);

    let result: unknown;
    if (phase === 'prepare') {
      await env.DB.prepare('DELETE FROM part_warehouse_stock WHERE source_page IS NOT NULL').run();
      result = { phase: 'prepare', ok: true };
    } else if (phase === 'vendors') {
      result = await importVendors(payload, body.offset, body.limit);
    } else if (phase === 'parts') {
      result = await importParts(payload, body.offset, body.limit);
    } else if (phase === 'stocks') {
      result = await importStocks(payload, body.offset, body.limit);
    } else {
      result = await status(payload);
    }

    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'inventory_bootstrap_failed', error: String(error) }));
    return Response.json({ error: 'The protected inventory import failed.' }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { allow: 'POST' } });
}
