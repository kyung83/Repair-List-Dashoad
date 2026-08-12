import { env } from 'cloudflare:workers';
import { GET as originalGET, POST as originalPOST } from './original';

function numericRepairId(value: unknown) {
  const match = String(value ?? '').match(/^(?:repair-)?(\d+)$/);
  return match ? Number(match[1]) : 0;
}

async function isDeferredRepair(value: unknown) {
  const id = numericRepairId(value);
  if (!id) return false;
  const row = await env.DB.prepare(`SELECT COALESCE(status,'') AS status FROM repairs WHERE id = ?`).bind(id).first<{status:string}>();
  return Boolean(row && String(row.status).toLowerCase().startsWith('deferred to next'));
}

export async function GET(request: Request) {
  const response = await originalGET(request);
  if (!response.ok) return response;
  const payload = await response.json() as { repairs?: Array<{status?:string}>; [key:string]: unknown };
  if (Array.isArray(payload.repairs)) {
    payload.repairs = payload.repairs.filter((repair) => !String(repair.status ?? '').toLowerCase().startsWith('deferred to next'));
  }
  return Response.json(payload, { status: response.status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request) {
  const clone = request.clone();
  try {
    const body = await clone.json() as Record<string, unknown>;
    if (await isDeferredRepair(body.repairId ?? body.id)) {
      return Response.json({ error: 'This repair is saved for a future PM/Annual and is not active shop work yet.' }, { status: 400 });
    }
  } catch {
    // The original handler owns validation for malformed/non-JSON requests.
  }
  return originalPOST(request);
}
