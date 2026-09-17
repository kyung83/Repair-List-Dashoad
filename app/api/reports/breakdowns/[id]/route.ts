import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

type BreakdownDeleteRow = {
  id: number;
  repair_id: number;
  unit: string;
  source: string;
};

type BreakdownEditRow = {
  id: number;
  repair_id: number;
  unit: string;
  stage: number;
  breakdown_status: string;
  repair_status: string;
  source: string;
  service_provider: string | null;
  outside_cost: number | null;
  closeout_invoice_number: string | null;
  closeout_invoice_date: string | null;
  closeout_notes: string | null;
  receipt_id: number | null;
  reviewed_vendor: string | null;
  reviewed_invoice_number: string | null;
  reviewed_invoice_date: string | null;
  reviewed_total_amount: string | null;
  reviewed_service_summary: string | null;
};

function breakdownIdFromRequest(request: Request) {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  const raw = parts[parts.length - 1] ?? '';
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function requireManager(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return { user: null, response: Response.json({ error: 'Authentication required.' }, { status: 401 }) };
  if (user.role !== 'manager' && user.role !== 'admin') {
    return { user: null, response: Response.json({ error: 'Manager or administrator access is required.' }, { status: 403 }) };
  }
  return { user, response: null };
}

function text(value: unknown, max: number) {
  return String(value ?? '').trim().slice(0, max);
}

function finalCost(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('Enter the final total cost.');
  const number = Number(raw);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000) throw new Error('Final total cost must be a valid positive dollar amount.');
  return { number, formatted: number.toFixed(2) };
}

function invoiceDate(value: unknown) {
  const raw = text(value, 20);
  if (!raw) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isFinite(Date.parse(`${raw}T12:00:00Z`))) throw new Error('Invoice date is invalid.');
  return raw;
}

async function editableBreakdown(id: number) {
  return env.DB.prepare(`
    SELECT
      b.id,b.repair_id,COALESCE(e.unit,'') AS unit,b.stage,
      COALESCE(b.status,'') AS breakdown_status,COALESCE(r.status,'') AS repair_status,
      COALESCE(r.source,'') AS source,b.service_provider,r.outside_cost,
      COALESCE(b.closeout_invoice_number,'') AS closeout_invoice_number,
      COALESCE(b.closeout_invoice_date,'') AS closeout_invoice_date,
      COALESCE(b.closeout_notes,'') AS closeout_notes,
      rr.id AS receipt_id,rr.reviewed_vendor,rr.reviewed_invoice_number,
      rr.reviewed_invoice_date,rr.reviewed_total_amount,rr.reviewed_service_summary
    FROM roadside_breakdowns b
    JOIN repairs r ON r.id=b.repair_id
    JOIN equipment e ON e.id=b.equipment_id
    LEFT JOIN roadside_breakdown_receipts rr ON rr.breakdown_id=b.id
    WHERE b.id=?
  `).bind(id).first<BreakdownEditRow>();
}

function isCompleted(row: BreakdownEditRow) {
  return Number(row.stage) >= 5 || row.repair_status.trim().toLowerCase() === 'completed';
}

export async function GET(request: Request) {
  try {
    const auth = await requireManager(request);
    if (auth.response) return auth.response;
    const breakdownId = breakdownIdFromRequest(request);
    if (!breakdownId) return Response.json({ error: 'A valid breakdown ID is required.' }, { status: 400 });

    const row = await editableBreakdown(breakdownId);
    if (!row) return Response.json({ error: 'Breakdown record was not found.' }, { status: 404 });
    if (row.source !== 'roadside-breakdown') return Response.json({ error: 'This linked repair is not a roadside breakdown.' }, { status: 409 });
    if (!isCompleted(row)) return Response.json({ error: 'Open breakdowns should be edited from the active Breakdown screen.' }, { status: 409 });

    const receiptCost = Number(row.reviewed_total_amount);
    const finalTotalCost = Number.isFinite(receiptCost) && String(row.reviewed_total_amount ?? '').trim() !== ''
      ? receiptCost
      : Number(row.outside_cost ?? 0);

    return Response.json({
      record: {
        breakdownId: row.id,
        unit: row.unit,
        finalTotalCost,
        serviceProvider: row.reviewed_vendor?.trim() || row.service_provider || '',
        invoiceNumber: row.reviewed_invoice_number?.trim() || row.closeout_invoice_number || '',
        invoiceDate: row.reviewed_invoice_date?.trim() || row.closeout_invoice_date || '',
        closeoutNotes: row.reviewed_service_summary?.trim() || row.closeout_notes || '',
      },
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'breakdown_report_record_edit_load_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Breakdown record could not be loaded.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireManager(request);
    if (auth.response || !auth.user) return auth.response!;
    const breakdownId = breakdownIdFromRequest(request);
    if (!breakdownId) return Response.json({ error: 'A valid breakdown ID is required.' }, { status: 400 });

    const row = await editableBreakdown(breakdownId);
    if (!row) return Response.json({ error: 'Breakdown record was not found.' }, { status: 404 });
    if (row.source !== 'roadside-breakdown') return Response.json({ error: 'This linked repair is not a roadside breakdown.' }, { status: 409 });
    if (!isCompleted(row)) return Response.json({ error: 'Open breakdowns should be edited from the active Breakdown screen.' }, { status: 409 });

    const body = await request.json<Record<string, unknown>>();
    const cost = finalCost(body.totalAmount);
    const provider = text(body.serviceProvider, 180);
    const invoiceNumber = text(body.invoiceNumber, 100);
    const invoiceDateValue = invoiceDate(body.invoiceDate);
    const closeoutNotes = text(body.closeoutNotes, 4000);

    const oldCost = Number(row.outside_cost ?? 0);
    const oldProvider = row.service_provider ?? '';
    const oldInvoice = row.reviewed_invoice_number?.trim() || row.closeout_invoice_number || '';
    const oldInvoiceDate = row.reviewed_invoice_date?.trim() || row.closeout_invoice_date || '';
    const oldNotes = row.reviewed_service_summary?.trim() || row.closeout_notes || '';

    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`
        UPDATE roadside_breakdowns
        SET service_provider=?,closeout_invoice_number=?,closeout_invoice_date=?,closeout_notes=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).bind(provider || null, invoiceNumber, invoiceDateValue, closeoutNotes, row.id),
      env.DB.prepare(`
        UPDATE repairs
        SET outside_cost=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND source='roadside-breakdown'
      `).bind(cost.number, row.repair_id),
    ];

    if (row.receipt_id != null) {
      statements.push(env.DB.prepare(`
        UPDATE roadside_breakdown_receipts
        SET review_status='confirmed',reviewed_vendor=?,reviewed_invoice_number=?,reviewed_invoice_date=?,
            reviewed_total_amount=?,reviewed_service_summary=?,reviewed_by_user_id=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).bind(provider, invoiceNumber, invoiceDateValue, cost.formatted, closeoutNotes, auth.user.id, row.receipt_id));
    }

    const changes: string[] = [];
    if (oldCost !== cost.number) changes.push(`cost $${oldCost.toFixed(2)} -> $${cost.formatted}`);
    if (oldProvider !== provider) changes.push(`provider "${oldProvider}" -> "${provider}"`);
    if (oldInvoice !== invoiceNumber) changes.push(`invoice "${oldInvoice}" -> "${invoiceNumber}"`);
    if (oldInvoiceDate !== invoiceDateValue) changes.push(`invoice date "${oldInvoiceDate}" -> "${invoiceDateValue}"`);
    if (oldNotes !== closeoutNotes) changes.push('closeout notes updated');
    const detail = `Breakdown #${row.id} closeout correction${changes.length ? `: ${changes.join('; ')}` : ': saved with no value changes'}`.slice(0, 500);
    statements.push(env.DB.prepare(`
      INSERT INTO repair_job_events (repair_id,user_id,technician_id,action,detail)
      VALUES (?,?,NULL,'breakdown_closeout_corrected',?)
    `).bind(row.repair_id, auth.user.id, detail));

    await env.DB.batch(statements);

    console.info(JSON.stringify({
      event: 'breakdown_closeout_corrected',
      breakdownId: row.id,
      repairId: row.repair_id,
      correctedByUserId: auth.user.id,
      previousCost: oldCost,
      correctedCost: cost.number,
    }));

    return Response.json({
      ok: true,
      breakdownId: row.id,
      finalTotalCost: cost.number,
      serviceProvider: provider,
      invoiceNumber,
      invoiceDate: invoiceDateValue,
      closeoutNotes,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'breakdown_report_record_edit_failed', error: String(error) }));
    const message = error instanceof Error ? error.message : 'Breakdown correction could not be saved.';
    return Response.json({ error: message }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireManager(request);
    if (auth.response || !auth.user) return auth.response!;

    const breakdownId = breakdownIdFromRequest(request);
    if (!breakdownId) return Response.json({ error: 'A valid breakdown ID is required.' }, { status: 400 });

    const breakdown = await env.DB.prepare(`
      SELECT b.id,b.repair_id,COALESCE(e.unit,'') AS unit,COALESCE(r.source,'') AS source
      FROM roadside_breakdowns b
      JOIN repairs r ON r.id=b.repair_id
      JOIN equipment e ON e.id=b.equipment_id
      WHERE b.id=?
    `).bind(breakdownId).first<BreakdownDeleteRow>();

    if (!breakdown) return Response.json({ error: 'Breakdown record was not found.' }, { status: 404 });
    if (breakdown.source !== 'roadside-breakdown') {
      return Response.json({ error: 'This linked repair is not a roadside breakdown and cannot be purged here.' }, { status: 409 });
    }

    const inventory = await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM inventory_operations
      WHERE repair_id=? AND status='applied'
    `).bind(breakdown.repair_id).first<{ count: number }>();

    if (Number(inventory?.count ?? 0) > 0) {
      return Response.json({
        error: 'This breakdown has applied inventory activity. Undo the parts/inventory operation before deleting the test record so physical stock stays correct.',
      }, { status: 409 });
    }

    await env.DB.batch([
      env.DB.prepare('DELETE FROM roadside_breakdowns WHERE id=? AND repair_id=?').bind(breakdown.id, breakdown.repair_id),
      env.DB.prepare("DELETE FROM repairs WHERE id=? AND source='roadside-breakdown'").bind(breakdown.repair_id),
    ]);

    const remaining = await env.DB.prepare('SELECT id FROM roadside_breakdowns WHERE id=?').bind(breakdown.id).first<{ id: number }>();
    const repairRemaining = await env.DB.prepare('SELECT id FROM repairs WHERE id=?').bind(breakdown.repair_id).first<{ id: number }>();
    if (remaining || repairRemaining) throw new Error('The breakdown test record could not be fully deleted.');

    console.info(JSON.stringify({
      event: 'breakdown_report_record_deleted',
      breakdownId: breakdown.id,
      repairId: breakdown.repair_id,
      unit: breakdown.unit,
      deletedByUserId: auth.user.id,
      deletedByRole: auth.user.role,
    }));

    return Response.json({ deleted: true, breakdownId: breakdown.id, repairId: breakdown.repair_id, unit: breakdown.unit });
  } catch (error) {
    console.error(JSON.stringify({ event: 'breakdown_report_delete_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Breakdown record could not be deleted.' }, { status: 500 });
  }
}
