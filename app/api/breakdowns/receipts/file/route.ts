import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { getBreakdownReceiptPage } from '@/lib/breakdown-driver-followup';

export async function GET(request:Request){
  const user=await getSessionUser(env.DB,request);
  if(!user)return new Response('Authentication required.',{status:401});
  if(user.role!=='manager'&&user.role!=='admin')return new Response('Manager or administrator access is required.',{status:403});

  const url=new URL(request.url);
  const receiptId=Number(url.searchParams.get('receiptId'));
  const page=Number(url.searchParams.get('page'));
  if(!Number.isInteger(receiptId)||receiptId<=0||!Number.isInteger(page)||page<=0)return new Response('Not found.',{status:404});

  const metadata=await getBreakdownReceiptPage(receiptId,page);
  if(!metadata)return new Response('Not found.',{status:404});
  const object=await env.FILES.get(metadata.object_key);
  if(!object)return new Response('Not found.',{status:404});

  const headers=new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type',metadata.content_type||headers.get('content-type')||'application/octet-stream');
  headers.set('content-disposition',`inline; filename="${metadata.file_name.replace(/["\r\n]/g,'')}"`);
  headers.set('cache-control','private, max-age=300');
  return new Response(object.body,{headers});
}
