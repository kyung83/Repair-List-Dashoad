import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { VendorError, listBreakdownVendors, addBreakdownVendor, changeBreakdownVendor } from '@/lib/breakdown-vendors';

async function handle(request: Request, method: 'GET' | 'POST' | 'PATCH' | 'DELETE') {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) throw new VendorError('Authentication required.', 401);
    if (user.dispatchAccess || (user.role !== 'manager' && user.role !== 'admin')) throw new VendorError('Manager or administrator access is required.', 403);
    if (method === 'GET') return json(await listBreakdownVendors(env.DB, new URL(request.url).searchParams));
    const origin = request.headers.get('origin');
    if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== new URL(request.url).origin)) throw new VendorError('Cross-site vendor changes are not allowed.', 403);
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new VendorError('Send vendor changes as JSON.', 415);
    if (Number(request.headers.get('content-length')) > 16384) throw new VendorError('Vendor request is too large.', 413);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 16384) throw new VendorError('Vendor request is too large.', 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { throw new VendorError('Vendor request contains invalid JSON.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new VendorError('Vendor request must be an object.');
    if (method === 'POST') return json({ ok: true, vendor: await addBreakdownVendor(env.DB, body) }, 201);
    return json({ ok: true, ...await changeBreakdownVendor(env.DB, user.id, body, method === 'DELETE') });
  } catch (error) {
    if (error instanceof VendorError) return json({ error: error.message }, error.status);
    const requestId = crypto.randomUUID();
    console.error(JSON.stringify({ event: 'breakdown_vendor_management_failed', requestId, error: String(error) }));
    return json({ error: 'The vendor directory could not be updated or loaded. Refresh and try again.', requestId }, 500);
  }
}
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { 'cache-control': 'no-store' } }); }
export const GET = (request: Request) => handle(request, 'GET');
export const POST = (request: Request) => handle(request, 'POST');
export const PATCH = (request: Request) => handle(request, 'PATCH');
export const DELETE = (request: Request) => handle(request, 'DELETE');
