import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { mergeEquipmentFork, previewEquipmentMerge } from '@/lib/equipment-merge';

async function requireAdmin(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return { user: null, response: Response.json({ error: 'Not signed in.' }, { status: 401 }) };
  if (user.role !== 'admin') {
    return { user: null, response: Response.json({ error: 'Administrator access is required.' }, { status: 403 }) };
  }
  return { user, response: null };
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response || !auth.user) return auth.response!;
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? 'preview');

    if (action === 'preview') {
      const preview = await previewEquipmentMerge(env.DB, body.sourceEquipmentId, body.targetEquipmentId);
      return Response.json({
        ok: true,
        source: preview.source,
        target: preview.target,
        sourceCounts: preview.sourceCounts,
        targetCounts: preview.targetCounts,
        referencesToMove: preview.referencesToMove,
        blockers: preview.blockers,
        warnings: preview.warnings,
        currentDeviceAssignment: preview.currentDeviceAssignment,
      }, { headers: { 'cache-control': 'no-store' } });
    }

    if (action === 'merge') {
      const result = await mergeEquipmentFork(
        env.DB,
        body.sourceEquipmentId,
        body.targetEquipmentId,
        auth.user.id,
        body.note,
      );
      return Response.json(result, { headers: { 'cache-control': 'no-store' } });
    }

    return Response.json({ error: 'Unknown equipment merge action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'equipment_merge_action_failed', error: String(error) }));
    return Response.json(
      { error: error instanceof Error ? error.message : 'Equipment merge action failed.' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }
}
