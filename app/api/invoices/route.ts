import { env } from 'cloudflare:workers';
import { createInvoice, getBillingData, getInvoice, saveCustomer, saveShopLaborRate, updateInvoiceStatus } from '@/lib/billing';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    return Response.json(id ? await getInvoice(env.DB, id) : await getBillingData(env.DB), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invoice data could not be loaded.' }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'createInvoice') return Response.json(await createInvoice(env.DB, body));
    if (action === 'saveCustomer') return Response.json(await saveCustomer(env.DB, body));
    if (action === 'saveLaborRate') return Response.json(await saveShopLaborRate(env.DB, body.laborRate));
    if (action === 'updateStatus') return Response.json(await updateInvoiceStatus(env.DB, body));
    throw new Error('Unknown invoice action.');
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invoice action failed.' }, { status: 400 });
  }
}
