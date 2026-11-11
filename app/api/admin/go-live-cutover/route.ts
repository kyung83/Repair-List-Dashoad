import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { executeGoLiveCutover, getGoLiveCutoverPreview } from '@/lib/go-live-cutover';

export async function GET(request:Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) return Response.json({ error:'Authentication required.' }, { status:401, headers:{ 'cache-control':'no-store' } });
    if (user.role !== 'admin') return Response.json({ error:'Administrator access is required.' }, { status:403, headers:{ 'cache-control':'no-store' } });
    return Response.json(await getGoLiveCutoverPreview(env.DB), { headers:{ 'cache-control':'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event:'go_live_cutover_preview_failed', error:String(error) }));
    return Response.json({ error:error instanceof Error ? error.message : 'Cutover preview could not be loaded.' }, { status:400, headers:{ 'cache-control':'no-store' } });
  }
}


export async function POST(request:Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) return Response.json({ error:'Authentication required.' }, { status:401, headers:{ 'cache-control':'no-store' } });
    if (user.role !== 'admin') return Response.json({ error:'Administrator access is required.' }, { status:403, headers:{ 'cache-control':'no-store' } });
    const body=await request.json() as Record<string,unknown>;
    const result=await executeGoLiveCutover(env.DB,{
      userId:user.id,
      userName:user.displayName,
      confirmation:String(body.confirmation??''),
    });
    return Response.json(result,{headers:{'cache-control':'no-store'}});
  } catch (error) {
    console.error(JSON.stringify({ event:'go_live_cutover_execute_failed', error:String(error) }));
    return Response.json({ error:error instanceof Error ? error.message : 'Cutover could not be completed.' }, { status:400, headers:{ 'cache-control':'no-store' } });
  }
}
