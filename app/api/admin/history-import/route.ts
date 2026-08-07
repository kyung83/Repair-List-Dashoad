import { env } from 'cloudflare:workers';
import {
  finishHistoryImport,
  getHistoryImportStatus,
  importHistoryBatch,
  resetHistoryImport,
  startHistoryImport,
} from '@/lib/history-import';

export async function GET() {
  try {
    return Response.json(await getHistoryImportStatus(env.DB), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'history_import_status_failed', error: String(error) }));
    return Response.json({ error: 'Repair-history import status could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'start') return Response.json(await startHistoryImport(env.DB, body));
    if (action === 'batch') return Response.json(await importHistoryBatch(env.DB, body));
    if (action === 'finish') return Response.json(await finishHistoryImport(env.DB, body));
    if (action === 'reset') return Response.json(await resetHistoryImport(env.DB, body));
    throw new Error('Unknown repair-history import action.');
  } catch (error) {
    console.error(JSON.stringify({ event: 'history_import_action_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Repair-history import failed.' }, { status: 400 });
  }
}
