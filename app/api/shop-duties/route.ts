import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import {
  completeShopDuty,
  getCurrentShopDutiesForUser,
  pauseShopDuty,
  saveShopDutyItem,
  saveShopDutyNotes,
  startShopDuty,
} from '@/lib/shop-duties';

function canUse(role:string) {
  return role === 'mechanic' || role === 'manager' || role === 'admin';
}

export async function GET(request:Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) return Response.json({ error:'Authentication required.' }, { status:401 });
    if (!canUse(user.role)) return Response.json({ error:'Shop Duties are only available to working maintenance users.' }, { status:403 });
    const duties = await getCurrentShopDutiesForUser(env.DB, user);
    return Response.json({ ok:true, duties }, { headers:{ 'cache-control':'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event:'shop_duties_get_failed', error:String(error) }));
    return Response.json({ error:error instanceof Error ? error.message : 'Shop duties could not be loaded.' }, { status:400 });
  }
}

export async function POST(request:Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) return Response.json({ error:'Authentication required.' }, { status:401 });
    if (!canUse(user.role)) return Response.json({ error:'Shop Duties are only available to working maintenance users.' }, { status:403 });
    const body = await request.json() as Record<string,unknown>;
    const action = String(body.action ?? '');

    if (action === 'start' || action === 'resume') {
      return Response.json(await startShopDuty(env.DB, user, body.assignmentId));
    }
    if (action === 'pause') {
      return Response.json(await pauseShopDuty(env.DB, user, body.assignmentId));
    }
    if (action === 'saveItem') {
      return Response.json(await saveShopDutyItem(env.DB, user, {
        assignmentId:body.assignmentId,
        itemId:body.itemId,
        result:body.result,
        comment:body.comment,
      }));
    }
    if (action === 'saveNotes') {
      return Response.json(await saveShopDutyNotes(env.DB, user, {
        assignmentId:body.assignmentId,
        suppliesNeeded:body.suppliesNeeded,
        notes:body.notes,
      }));
    }
    if (action === 'complete') {
      return Response.json(await completeShopDuty(env.DB, user, body.assignmentId));
    }
    return Response.json({ error:'Unknown Shop Duty action.' }, { status:400 });
  } catch (error) {
    console.error(JSON.stringify({ event:'shop_duties_action_failed', error:String(error) }));
    return Response.json({ error:error instanceof Error ? error.message : 'Shop duty action failed.' }, { status:400 });
  }
}
