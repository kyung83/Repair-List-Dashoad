import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import {
  correctHistoricalRoTotal, findHistoricalRoForCostEdit, HistoricalRoCorrectionError,
} from '@/lib/historical-ro-cost-corrections';

async function authorize(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return { user: null, response: Response.json({ error: 'Sign in to edit historical repair orders.' }, { status: 401 }) };
  if (user.role !== 'manager' && user.role !== 'admin') {
    return { user: null, response: Response.json({ error: 'Manager or administrator access required.' }, { status: 403 }) };
  }
  return { user, response: null };
}

function reportFailure(error: unknown) {
  if (error instanceof HistoricalRoCorrectionError) {
    return Response.json({ error: error.message }, { status: error.status, headers: { 'cache-control': 'no-store' } });
  }
  const detail = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ event: 'historical_ro_cost_correction_failed', detail }));
  if (/constraint failed|CHECK constraint|UNIQUE constraint/i.test(detail)) {
    return Response.json({ error: 'The RO changed while you were saving. Reload it before trying again. No change was saved.' }, { status: 409 });
  }
  return Response.json({ error: 'Could not update this historical RO. No change was saved.' }, { status: 500 });
}

export async function GET(request: Request) {
  const auth = await authorize(request);
  if (auth.response) return auth.response;
  try {
    const number = new URL(request.url).searchParams.get('ro');
    return Response.json(await findHistoricalRoForCostEdit(env.DB, number), { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return reportFailure(error); }
}

export async function PATCH(request: Request) {
  const auth = await authorize(request);
  if (auth.response || !auth.user) return auth.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const updated = await correctHistoricalRoTotal(env.DB, body, auth.user);
    console.log(JSON.stringify({
      event: 'historical_ro_cost_corrected', ro: updated.roNumber, unit: updated.unit,
      previousTotal: updated.previousTotalCost, correctedTotal: updated.correctedTotalCost,
      actorId: auth.user.id,
    }));
    return Response.json(updated, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return reportFailure(error); }
}
