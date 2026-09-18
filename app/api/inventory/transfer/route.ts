import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { recentInventoryTransfers, transferInventory } from '@/lib/inventory-transfers';

async function requireManager(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  if(user.role!=='manager'&&user.role!=='admin')throw new Error('Manager or administrator access is required.');
  return user;
}

export async function GET(request:Request){
  try{
    await requireManager(request);
    return Response.json({transfers:await recentInventoryTransfers(env.DB,60)},{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:'Transfers could not be loaded.';
    return Response.json({error:message},{status:/Authentication required/i.test(message)?401:403});
  }
}

export async function POST(request:Request){
  try{
    const user=await requireManager(request);
    const body=await request.json() as Record<string,unknown>;
    const operationKey=String(body.operationKey??request.headers.get('idempotency-key')??`inventory-transfer:${crypto.randomUUID()}`);
    return Response.json(await transferInventory(env.DB,{
      operationKey,
      partId:body.partId,
      sourceWarehouseCode:body.sourceWarehouseCode,
      transferKind:body.transferKind,
      destinationWarehouseCode:body.destinationWarehouseCode,
      destinationLabel:body.destinationLabel,
      quantity:body.quantity,
      notes:body.notes,
      userId:user.id,
    }),{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:'Inventory transfer failed.';
    const status=/Authentication required/i.test(message)?401:/Manager or administrator/i.test(message)?403:400;
    return Response.json({error:message},{status,headers:{'cache-control':'no-store'}});
  }
}
