import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getBreakdownReceiptReview } from '@/lib/breakdown-driver-followup';

async function requireManager(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)throw new Error('Authentication required.');
  if(user.role!=='manager'&&user.role!=='admin')throw new Error('Manager or administrator access is required.');
  return user;
}

function breakdownId(value:unknown){
  const id=Number(value);
  if(!Number.isInteger(id)||id<=0)throw new Error('Breakdown was not found.');
  return id;
}
function text(value:unknown,max:number){return String(value??'').trim().slice(0,max);}
function finalCost(value:unknown){
  const raw=String(value??'').trim();
  if(!raw)throw new Error('Enter the final total cost. Enter 0.00 if there was no outside cost.');
  const number=Number(raw);
  if(!Number.isFinite(number)||number<0||number>1_000_000)throw new Error('Final total cost must be a valid positive dollar amount.');
  return {number,text:number.toFixed(2)};
}

export async function GET(request:Request){
  try{
    await requireManager(request);
    const url=new URL(request.url);
    const id=breakdownId(url.searchParams.get('breakdownId'));
    const review=await getBreakdownReceiptReview(id);
    if(!review)return Response.json({error:'Breakdown was not found.'},{status:404,headers:{'cache-control':'no-store'}});
    return Response.json({ok:true,review},{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    const status=/Authentication required/i.test(message)?401:/Manager or administrator/i.test(message)?403:400;
    return Response.json({error:message},{status,headers:{'cache-control':'no-store'}});
  }
}

export async function PATCH(request:Request){
  try{
    const user=await requireManager(request);
    const body=await request.json<Record<string,unknown>>();
    const id=breakdownId(body.breakdownId);
    const breakdown=await env.DB.prepare(`
      SELECT id,repair_id,stage,status
      FROM roadside_breakdowns
      WHERE id=?
    `).bind(id).first<{id:number;repair_id:number;stage:number;status:string}>();
    if(!breakdown)throw new Error('Breakdown was not found.');
    if(breakdown.status==='not_breakdown')throw new Error('This report was cleared as not a breakdown.');
    if(breakdown.stage>=5)return Response.json({ok:true,closed:true,alreadyClosed:true},{headers:{'cache-control':'no-store'}});

    const cost=finalCost(body.totalAmount);
    const vendor=text(body.vendor,180);
    const invoiceNumber=text(body.invoiceNumber,100);
    const invoiceDate=text(body.invoiceDate,20);
    const serviceSummary=text(body.serviceSummary,4000);
    const receipt=await env.DB.prepare('SELECT id FROM roadside_breakdown_receipts WHERE breakdown_id=?').bind(id).first<{id:number}>();

    const statements=[];
    if(receipt){
      statements.push(env.DB.prepare(`
        UPDATE roadside_breakdown_receipts
        SET review_status='confirmed',reviewed_vendor=?,reviewed_invoice_number=?,reviewed_invoice_date=?,
            reviewed_total_amount=?,reviewed_service_summary=?,reviewed_by_user_id=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).bind(vendor,invoiceNumber,invoiceDate,cost.text,serviceSummary,user.id,receipt.id));
    }
    statements.push(env.DB.prepare(`
      UPDATE roadside_breakdowns
      SET stage=5,status='complete',ready_for_review_at=COALESCE(ready_for_review_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(id));
    statements.push(env.DB.prepare(`
      UPDATE repairs
      SET status='Completed',outside_cost=?,completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(cost.number,breakdown.repair_id));
    await env.DB.batch(statements);

    return Response.json({ok:true,closed:true,finalCost:cost.number},{headers:{'cache-control':'no-store'}});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    const status=/Authentication required/i.test(message)?401:/Manager or administrator/i.test(message)?403:400;
    return Response.json({error:message},{status,headers:{'cache-control':'no-store'}});
  }
}
