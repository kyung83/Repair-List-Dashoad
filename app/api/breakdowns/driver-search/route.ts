import { env } from 'cloudflare:workers';
import { searchBreakdownDrivers, syncBreakdownDriverDirectory } from '@/lib/breakdown-driver-directory';

type DirectorySyncRow = {
  active_generation: string | null;
  last_success_at: string | null;
  last_error: string | null;
  row_count: number;
};

async function directoryStatus() {
  const row = await env.DB.prepare(`
    SELECT active_generation, last_success_at, last_error, row_count
    FROM breakdown_driver_directory_sync
    WHERE id=1
  `).first<DirectorySyncRow>();
  return {
    ready: Boolean(String(row?.active_generation || '').trim()) && Number(row?.row_count || 0) >= 10,
    rowCount: Number(row?.row_count || 0),
    lastSuccessAt: row?.last_success_at || null,
    lastError: row?.last_error || null,
  };
}

/**
 * PUBLIC and intentionally narrow. Searches the cached Recruiting directory and
 * exposes only a display name plus the last four phone digits. Full phone data
 * never leaves the server. If production has just deployed and the five-minute
 * cron has not populated D1 yet, the first real search seeds the cache once.
 */
export async function GET(request: Request) {
  const headers = { 'cache-control': 'no-store, max-age=0' };
  try {
    const url = new URL(request.url);
    const query = String(url.searchParams.get('q') ?? '').trim().slice(0, 80);
    if (query.length < 2) {
      return Response.json({ drivers: [], directoryReady: false }, { headers });
    }

    let status = await directoryStatus();
    if (!status.ready) {
      try {
        await syncBreakdownDriverDirectory({ DB: env.DB });
      } catch (error) {
        console.error(JSON.stringify({ event: 'breakdown_driver_directory_bootstrap_failed', error: String(error) }));
        status = await directoryStatus();
        return Response.json({
          drivers: [],
          directoryReady: false,
          unavailable: true,
          rowCount: status.rowCount,
        }, { status: 503, headers });
      }
      status = await directoryStatus();
    }

    if (!status.ready) {
      return Response.json({
        drivers: [],
        directoryReady: false,
        unavailable: true,
        rowCount: status.rowCount,
      }, { status: 503, headers });
    }

    const drivers = await searchBreakdownDrivers(env.DB, query);
    return Response.json({
      drivers,
      directoryReady: true,
      rowCount: status.rowCount,
    }, { headers });
  } catch (error) {
    console.warn(JSON.stringify({ event: 'breakdown_driver_directory_search_failed', error: String(error) }));
    return Response.json({
      drivers: [],
      directoryReady: false,
      unavailable: true,
    }, { status: 503, headers });
  }
}
