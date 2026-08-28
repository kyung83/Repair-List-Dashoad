import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getBreakdown, updateBreakdown } from '@/lib/roadside-breakdowns';

async function requireManager(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  if (user.role !== 'manager' && user.role !== 'admin') throw new Error('Manager or administrator access is required.');
  return user;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireManager(request);
  const { id } = await params;
  const breakdown = await getBreakdown(Number(id));
  if (!breakdown) return Response.json({ error: 'Not found.' }, { status: 404 });
  return Response.json({ breakdown }, { headers: { 'cache-control': 'no-store' } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireManager(request);
    const { id } = await params;
    const body = await request.json<Record<string, unknown>>();
    await updateBreakdown(Number(id), {
      stage: body.stage as any,
      status: body.status as any,
      serviceProvider: body.serviceProvider as any,
      serviceProviderPhone: body.serviceProviderPhone as any,
      eta: body.eta as any,
      onLocation: body.onLocation as any,
      cost: body.cost as any,
      notBreakdown: body.notBreakdown === true,
    });
    return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return Response.json({ error: String((err as Error)?.message ?? err) }, { status: 400 });
  }
}
