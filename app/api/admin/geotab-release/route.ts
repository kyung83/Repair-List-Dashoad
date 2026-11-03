import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { GeotabReleaseError, requireReleaseAdmin, releaseGeotabDevice, searchGeotabReleaseLinks } from '@/lib/geotab-device-release.js';

const headers = { 'cache-control': 'no-store' };
function failure(error: unknown) {
  if (error instanceof GeotabReleaseError) {
    return Response.json({ error: error.message }, { status: error.status, headers });
  }
  console.error(JSON.stringify({ event: 'geotab_device_release_failed', error: String(error) }));
  return Response.json({ error: 'GPS release could not be completed. Refresh and check the assignment before retrying.' }, { status: 500, headers });
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    const links = await searchGeotabReleaseLinks(env.DB, user, new URL(request.url).searchParams.get('q'));
    return Response.json({ links }, { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    requireReleaseAdmin(user);
    // Only a same-origin JSON request from the signed-in Admin screen may write.
    if (request.headers.get('origin') !== new URL(request.url).origin) {
      return Response.json({ error: 'Same-origin request required.' }, { status: 403, headers });
    }
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return Response.json({ error: 'JSON request required.' }, { status: 415, headers });
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.action !== 'release') {
      return Response.json({ error: 'Invalid GPS release request.' }, { status: 400, headers });
    }
    return Response.json(await releaseGeotabDevice(env.DB, user, body), { headers });
  } catch (error) { return failure(error); }
}
