import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(env.DB,request);
    if (!user) throw new Error('Authentication required.');
    const url = new URL(request.url);
    const partId = Number(url.searchParams.get('partId') ?? 0);
    const warehouseCode = String(url.searchParams.get('warehouseCode') ?? '').trim().toUpperCase();
    if (!Number.isInteger(partId) || partId <= 0 || !warehouseCode) throw new Error('Part and warehouse are required.');
    const row = await env.DB.prepare(`
      SELECT s.id,s.quantity_on_hand,s.updated_at,w.code AS warehouse_code,w.name AS warehouse_name,p.part_number,p.description
      FROM part_warehouse_stock s
      JOIN warehouses w ON w.id=s.warehouse_id
      JOIN parts p ON p.id=s.part_id
      WHERE s.part_id=? AND w.code=? AND w.active=1
      ORDER BY CASE WHEN s.variant_key='' THEN 0 ELSE 1 END,s.quantity_on_hand DESC,s.id
      LIMIT 1
    `).bind(partId,warehouseCode).first<{
      id:number;quantity_on_hand:number;updated_at:string;warehouse_code:string;warehouse_name:string;part_number:string;description:string;
    }>();
    if (!row) throw new Error('That part is not stocked in the selected warehouse.');
    return Response.json({ok:true,partId,partNumber:row.part_number,description:row.description,warehouseCode:row.warehouse_code,warehouseName:row.warehouse_name,expectedQuantity:Number(row.quantity_on_hand),stockVersion:row.updated_at},{headers:{'cache-control':'no-store'}});
  } catch (error) {
    return Response.json({error:error instanceof Error?error.message:'Physical count could not be started.'},{status:400,headers:{'cache-control':'no-store'}});
  }
}
