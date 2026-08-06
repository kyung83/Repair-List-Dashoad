import { env } from 'cloudflare:workers';
import { protectedVendorImport } from '@/lib/vendor-import-protected';

type VendorRecord = {
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  source?: string;
};

type VendorPayload = {
  version: number;
  vendors: VendorRecord[];
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

async function decryptPayload(privateKeyPem: string): Promise<VendorPayload> {
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
    decodeBase64(protectedVendorImport.wrappedKey),
  );
  const aesKey = await crypto.subtle.importKey(
    'raw',
    rawAesKey,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64(protectedVendorImport.iv) },
    aesKey,
    decodeBase64(protectedVendorImport.ciphertext),
  );
  const payload = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<VendorPayload>;
  if (payload.version !== 1 || !Array.isArray(payload.vendors)) {
    throw new Error('The protected vendor import is invalid.');
  }
  return payload as VendorPayload;
}

export async function POST() {
  try {
    const privateKey = env.GEOTAB_CONFIG_PRIVATE_KEY;
    if (!privateKey) {
      return Response.json({ error: 'The protected import key is not configured.' }, { status: 503 });
    }

    const payload = await decryptPayload(privateKey);
    const vendors = payload.vendors
      .map((vendor) => ({
        name: String(vendor.name ?? '').trim(),
        phone: String(vendor.phone ?? '').trim(),
        email: String(vendor.email ?? '').trim(),
        notes: [String(vendor.notes ?? '').trim(), vendor.source ? `Source: ${vendor.source}` : '']
          .filter(Boolean)
          .join('; '),
      }))
      .filter((vendor) => vendor.name.length > 0);

    if (!vendors.length) throw new Error('The protected vendor import is empty.');

    const statements = vendors.map((vendor) => env.DB.prepare(`
      INSERT INTO vendors (name, phone, email, notes)
      VALUES (?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''))
      ON CONFLICT(name) DO UPDATE SET
        phone = COALESCE(NULLIF(excluded.phone, ''), vendors.phone),
        email = COALESCE(NULLIF(excluded.email, ''), vendors.email),
        notes = COALESCE(NULLIF(excluded.notes, ''), vendors.notes)
    `).bind(vendor.name, vendor.phone, vendor.email, vendor.notes));

    await env.DB.batch(statements);
    return Response.json(
      { ok: true, imported: vendors.length },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error(JSON.stringify({ event: 'vendor_bootstrap_failed', error: String(error) }));
    return Response.json({ error: 'The protected vendor import failed.' }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { allow: 'POST' } });
}
