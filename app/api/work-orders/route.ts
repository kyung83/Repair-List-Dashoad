import { env } from 'cloudflare:workers';
import { getWorkOrderData, handleWorkOrderAction } from '@/lib/work-orders';

export async function GET() {
  try {
    return Response.json(await getWorkOrderData(env.DB), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'work_orders_get_failed', error: String(error) }));
    return Response.json({ error: 'Work orders could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    return Response.json(await handleWorkOrderAction(env.DB, body));
  } catch (error) {
    console.error(JSON.stringify({ event: 'work_orders_post_failed', error: String(error) }));
    return Response.json({
      error: error instanceof Error ? error.message : 'Work-order action failed',
    }, { status: 400 });
  }
}
