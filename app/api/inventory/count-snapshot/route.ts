import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getWarehousePhysicalCountSnapshot } from '@/lib/inventory-operations';

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(env.DB,request);
    if (!user) throw new Error('Authentication required.');
    const url = new URL(request.url);
    const partId = Number(url.searchParams.get('partId') ?? 0);
    const warehouseCode = String(url.searchParams.get('warehouseCode') ?? '').trim().toUpperCase();
    if (!Number.isInteger(partId) || partId <= 0 || !warehouseCode) throw new Error('Part and warehouse are required.');
    const row=await getWarehousePhysicalCountSnapshot(env.DB,partId,warehouseCode);
    if(!row)throw new Error('That part is not stocked in the selected warehouse.');
    return Response.json({
      ok:true,
      partId,
      partNumber:row.partNumber,
      description:row.description,
      warehouseCode:row.warehouseCode,
      warehouseName:row.warehouseName,
      expectedQuantity:row.expectedQuantity,
      stockVersion:row.stockVersion,
    },{headers:{'cache-control':'no-store'}});
  } catch (error) {
    return Response.json({error:error instanceof Error?error.message:'Physical count could not be started.'},{status:400,headers:{'cache-control':'no-store'}});
  }
}
