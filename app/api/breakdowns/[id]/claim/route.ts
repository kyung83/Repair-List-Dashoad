import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { claimBreakdown } from '@/lib/roadside-breakdowns';

/**
 * Manual claim button in the admin dashboard. This is a fallback for
 * whoever happens to be looking at a screen -- the primary claim path is
 * still the Twilio SMS "reply with the ID" flow (see webhook/twilio-sms),
 * since dispatch is on-call and not always at the dashboard. Both paths
 * are first-reply-wins against the same claimed_by_user_id column, so
 * whichever happens first sticks.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) throw new Error('Authentication required.');
    const { id } = await params;
    const result = await claimBreakdown(Number(id), user.id, user.displayName);
    if (!result.claimed) return Response.json({ error: 'This breakdown was already claimed.' }, { status: 409 });
    return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return Response.json({ error: String((err as Error)?.message ?? err) }, { status: 400 });
  }
}
