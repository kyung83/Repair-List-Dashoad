import { env } from 'cloudflare:workers';
import { getSessionUser, type AppUser } from '@/lib/auth';
import { createInvoice, getBillingData, getInvoice, saveCustomer, saveShopLaborRate, updateInvoiceStatus } from '@/lib/billing';
import { ensureReviewedWorkOrderCanBeInvoiced } from '@/lib/invoice-eligibility';

async function requireUser(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) throw new Error('Authentication required.');
  return user;
}

function requireManager(user: AppUser) {
  if (user.role !== 'manager' && user.role !== 'admin') {
    throw new Error('Manager or administrator access is required for invoice changes.');
  }
}

async function invoiceIdFromNumber(invoiceNumber: string) {
  const row = await env.DB.prepare('SELECT id FROM invoices WHERE invoice_number = ?').bind(invoiceNumber).first<{id:number}>();
  if (!row) throw new Error('Invoice was not found.');
  return row.id;
}

async function deleteVoidedInvoice(user: AppUser, body: Record<string, unknown>) {
  const invoiceNumber = String(body.invoiceNumber ?? '').trim();
  const requestedId = Number(body.id ?? 0);
  const invoice = invoiceNumber
    ? await env.DB.prepare(`
        SELECT i.*, COALESCE(e.unit,'') AS unit
        FROM invoices i
        LEFT JOIN equipment e ON e.id = i.equipment_id
        WHERE i.invoice_number = ?
      `).bind(invoiceNumber).first<any>()
    : Number.isInteger(requestedId) && requestedId > 0
      ? await env.DB.prepare(`
          SELECT i.*, COALESCE(e.unit,'') AS unit
          FROM invoices i
          LEFT JOIN equipment e ON e.id = i.equipment_id
          WHERE i.id = ?
        `).bind(requestedId).first<any>()
      : null;

  if (!invoice) throw new Error('Invoice was not found.');
  if (String(invoice.status) !== 'Void') throw new Error('Only an invoice that is already Void can be deleted.');

  const [lines, repairs] = await Promise.all([
    env.DB.prepare(`
      SELECT id,line_type,description,quantity,unit_price,amount,sort_order,created_at
      FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order,id
    `).bind(invoice.id).all<any>(),
    env.DB.prepare(`
      SELECT irl.repair_id,irl.sort_order,COALESCE(r.title,'') AS title
      FROM invoice_repair_links irl
      LEFT JOIN repairs r ON r.id = irl.repair_id
      WHERE irl.invoice_id = ? ORDER BY irl.sort_order,irl.repair_id
    `).bind(invoice.id).all<any>(),
  ]);

  const snapshot = JSON.stringify({ invoice, repairLinks: repairs.results, lines: lines.results });
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO invoice_void_deletions (
        invoice_id,invoice_number,bill_to_name,unit,total,
        deleted_by_user_id,deleted_by_name,snapshot_json
      ) VALUES (?,?,?,?,?,?,?,?)
    `).bind(
      Number(invoice.id), String(invoice.invoice_number ?? ''), String(invoice.bill_to_name ?? ''),
      String(invoice.unit ?? ''), Number(invoice.total ?? 0), user.id, user.displayName, snapshot,
    ),
    env.DB.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').bind(invoice.id),
    env.DB.prepare('DELETE FROM invoice_repair_links WHERE invoice_id = ?').bind(invoice.id),
    env.DB.prepare("DELETE FROM invoices WHERE id = ? AND status = 'Void'").bind(invoice.id),
  ]);

  return { ok:true, deleted:true, invoiceNumber:String(invoice.invoice_number ?? ''), id:Number(invoice.id) };
}

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const invoiceNumber = String(url.searchParams.get('number') ?? '').trim();
    const resolvedId = id || (invoiceNumber ? String(await invoiceIdFromNumber(invoiceNumber)) : '');
    return Response.json(resolvedId ? await getInvoice(env.DB, resolvedId) : await getBillingData(env.DB), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invoice data could not be loaded.';
    const status = message === 'Authentication required.' ? 401 : 400;
    return Response.json({ error: message }, { status, headers:{'cache-control':'no-store'} });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    requireManager(user);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'createInvoice') {
      await ensureReviewedWorkOrderCanBeInvoiced(env.DB, body);
      return Response.json(await createInvoice(env.DB, body));
    }
    if (action === 'saveCustomer') return Response.json(await saveCustomer(env.DB, body));
    if (action === 'saveLaborRate') return Response.json(await saveShopLaborRate(env.DB, body.laborRate));
    if (action === 'updateStatus') return Response.json(await updateInvoiceStatus(env.DB, body));
    if (action === 'deleteVoidedInvoice') return Response.json(await deleteVoidedInvoice(user, body));
    throw new Error('Unknown invoice action.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invoice action failed.';
    const status = message === 'Authentication required.' ? 401 : /Manager or administrator/.test(message) ? 403 : 400;
    return Response.json({ error: message }, { status, headers:{'cache-control':'no-store'} });
  }
}
