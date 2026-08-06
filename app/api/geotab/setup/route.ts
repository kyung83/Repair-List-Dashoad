import { env } from 'cloudflare:workers';
import {
  configureGeotabService,
  hasGeotabCredential,
  syncGeotabDvir,
} from '@/lib/geotab-direct';

const TOKEN_HASH = 'e2a86aadd7be50b73802674a67e41a3bf64479d31cecd72b10e6ac0b142e27d8';
const PASSWORD_IV = '2QgAqFEucfUFdgjf';
const PASSWORD_CIPHERTEXT = '4TOHFAoevGOu93PZgPpqdxK2niK57UVg';
const EXPIRES_AT = Date.parse('2026-08-06T18:00:00.000Z');
const SETUP_AAD = new TextEncoder().encode('geotab-service-setup-v1');

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function hex(value: ArrayBuffer) {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function decryptSetupPassword(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64(PASSWORD_IV), additionalData: SETUP_AAD },
    key,
    decodeBase64(PASSWORD_CIPHERTEXT),
  );
  return new TextDecoder().decode(plaintext);
}

export async function GET(request: Request) {
  try {
    if (Date.now() > EXPIRES_AT) {
      return Response.json({ error: 'Setup link expired' }, { status: 410 });
    }

    const token = new URL(request.url).searchParams.get('token') ?? '';
    const suppliedHash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
    if (!constantTimeEqual(suppliedHash, TOKEN_HASH)) {
      return Response.json({ error: 'Invalid setup link' }, { status: 403 });
    }

    if (await hasGeotabCredential(env)) {
      return Response.json({ ok: true, alreadyConfigured: true });
    }

    const password = await decryptSetupPassword(token);
    const configured = await configureGeotabService(
      env,
      'norloworld',
      'repair-dashboard-api@norloworld.com',
      password,
    );
    const sync = await syncGeotabDvir(env);
    return Response.json({ ok: true, configured, sync }, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'geotab_one_time_setup_failed', error: String(error) }));
    return Response.json({
      error: error instanceof Error ? error.message : 'Geotab setup failed',
    }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
}
