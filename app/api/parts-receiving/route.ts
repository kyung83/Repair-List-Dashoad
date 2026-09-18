import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { addPartCrossReference } from '@/lib/part-cross-references';
import { receiveInventoryPart, recentPartsReceipts } from '@/lib/parts-receiving';

async function requireManager(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  if(user.role!=='manager'&&user.role!=='admin')throw new Error('Manager or administrator access is required for Parts Receiving.');
  return user;
}

export async function GET(request:Request){
  try{
    await requireManager(request);
    return Response.json({receipts:await recentPartsReceipts(env.DB,75)},{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:'Parts receipts could not be loaded.';
    return Response.json({error:message},{status:/Authentication required/i.test(message)?401:403});
  }
}

export async function POST(request:Request){
  try{
    const user=await requireManager(request);
    const body=await request.json() as Record<string,unknown>;
    const receiptGroupKey=String(body.receiptGroupKey??'').trim().slice(0,160);
    const warehouseCode=String(body.warehouseCode??'').trim().toUpperCase();
    const lines=Array.isArray(body.lines)?body.lines as Array<Record<string,unknown>>:[];
    if(!receiptGroupKey)throw new Error('Receipt group key is required.');
    if(!warehouseCode)throw new Error('Choose the receiving warehouse.');
    if(!lines.length)throw new Error('Choose at least one invoice line to receive.');
    if(lines.length>100)throw new Error('Receive no more than 100 invoice lines at one time.');

    for(const line of lines){
      const partId=Number(line.partId??0),quantity=Number(line.quantity??0);
      if(!Number.isInteger(partId)||partId<=0)throw new Error('Every selected invoice line needs an inventory part.');
      if(!Number.isFinite(quantity)||quantity<=0)throw new Error('Every selected invoice line needs a positive quantity.');
    }

    const received=[];
    for(let index=0;index<lines.length;index++){
      const line=lines[index];
      const partId=Number(line.partId);
      const result=await receiveInventoryPart(env.DB,{
        operationKey:`parts-receipt:${receiptGroupKey}:${index}`,
        receiptGroupKey,
        partId,
        warehouseCode,
        quantity:line.quantity,
        unitCost:line.unitCost,
        vendorName:body.vendorName,
        invoiceNumber:body.invoiceNumber,
        invoiceDate:body.invoiceDate,
        sourcePartNumber:line.sourcePartNumber,
        sourceDescription:line.sourceDescription,
        userId:user.id,
      });
      if(line.rememberCrossReference===true&&String(line.sourcePartNumber??'').trim()){
        await addPartCrossReference(env.DB,partId,line.sourcePartNumber);
      }
      received.push(result);
    }
    return Response.json({ok:true,received},{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:'Parts could not be received.';
    const status=/Authentication required/i.test(message)?401:/Manager or administrator/i.test(message)?403:400;
    return Response.json({error:message},{status,headers:{'cache-control':'no-store'}});
  }
}
