import { env } from 'cloudflare:workers';
import { usePartOnRepair } from '@/lib/inventory-db';
import { getWorkOrderData, handleWorkOrderAction } from '@/lib/work-orders';

async function refreshRepairPartsText(repairId: number) {
  const rows = await env.DB.prepare(`
    SELECT p.part_number, SUM(rp.quantity) AS quantity
    FROM repair_parts rp
    JOIN parts p ON p.id = rp.part_id
    WHERE rp.repair_id = ?
    GROUP BY p.id, p.part_number
    ORDER BY p.part_number
  `).bind(repairId).all<{ part_number: string; quantity: number }>();
  const text = rows.results.map((row) => `${row.part_number} x${Number(row.quantity)}`).join(', ');
  await env.DB.prepare('UPDATE repairs SET parts_text = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(text, repairId).run();
}

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
    if (String(body.action ?? '') === 'usePart') {
      const result = await usePartOnRepair(env.DB, body);
      const match = String(body.repairId ?? '').match(/^repair-(\d+)$/);
      if (match) await refreshRepairPartsText(Number(match[1]));
      return Response.json(result);
    }
    return Response.json(await handleWorkOrderAction(env.DB, body));
  } catch (error) {
    console.error(JSON.stringify({ event: 'work_orders_post_failed', error: String(error) }));
    return Response.json({
      error: error instanceof Error ? error.message : 'Work-order action failed',
    }, { status: 400 });
  }
}
