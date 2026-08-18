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

function movableReferenceCount(counts: Record<string, number>) {
  return Object.entries(counts).reduce((sum, [key, value]) => key === 'priorMergeEvents' ? sum : sum + Number(value || 0), 0);
}

async function thirdPartyCurrentOwnerBlock(sourceId: number, targetId: number, geotabDeviceId: string | null) {
  const deviceId = String(geotabDeviceId ?? '').trim();
  if (!deviceId) return null;
  const owner = await env.DB.prepare(`
    SELECT d.equipment_id, e.unit
    FROM equipment_geotab_devices d
    JOIN equipment e ON e.id = d.equipment_id
    WHERE d.current = 1
      AND d.geotab_device_id = ?
      AND d.equipment_id NOT IN (?, ?)
    ORDER BY d.id DESC
    LIMIT 1
  `).bind(deviceId, sourceId, targetId).first<{ equipment_id: number; unit: string }>();
  if (!owner) return null;
  return `This Geotab device is currently assigned to ${owner.unit} (#${owner.equipment_id}). Use that current owner as the canonical row before merging this fork.`;
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response || !auth.user) return auth.response!;
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? 'preview');

    if (action === 'preview') {
      const preview = await previewEquipmentMerge(env.DB, body.sourceEquipmentId, body.targetEquipmentId);
      const ownerBlock = await thirdPartyCurrentOwnerBlock(preview.source.id, preview.target.id, preview.source.geotab_device_id);
      const blockers = ownerBlock ? [...preview.blockers, ownerBlock] : preview.blockers;
      return Response.json({
        ok: true,
        source: preview.source,
        target: preview.target,
        sourceCounts: preview.sourceCounts,
        targetCounts: preview.targetCounts,
        referencesToMove: movableReferenceCount(preview.sourceCounts),
        blockers,
        warnings: preview.warnings,
        currentDeviceAssignment: preview.currentDeviceAssignment,
      }, { headers: { 'cache-control': 'no-store' } });
    }

    if (action === 'merge') {
      // Re-run all preview guards at mutation time. The UI preview is informative;
      // it is never treated as authorization for a later database change.
      const preview = await previewEquipmentMerge(env.DB, body.sourceEquipmentId, body.targetEquipmentId);
      if (preview.blockers.length) throw new Error(preview.blockers.join(' '));
      const ownerBlock = await thirdPartyCurrentOwnerBlock(preview.source.id, preview.target.id, preview.source.geotab_device_id);
      if (ownerBlock) throw new Error(ownerBlock);
      const referencesMoved = movableReferenceCount(preview.sourceCounts);

      const result = await mergeEquipmentFork(
        env.DB,
        preview.source.id,
        preview.target.id,
        auth.user.id,
        body.note,
      );
      return Response.json({ ...result, referencesMoved }, { headers: { 'cache-control': 'no-store' } });
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
