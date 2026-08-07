import { env } from 'cloudflare:workers';
import { createPublicKey } from 'node:crypto';

export async function GET() {
  try {
    const privateKey = env.GEOTAB_CONFIG_PRIVATE_KEY;
    if (!privateKey) {
      return Response.json({ error: 'Protected import key is not configured.' }, { status: 503 });
    }

    const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
    return Response.json(
      { publicKey },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error(JSON.stringify({ event: 'import_public_key_failed', error: String(error) }));
    return Response.json({ error: 'Protected import public key could not be derived.' }, { status: 500 });
  }
}
