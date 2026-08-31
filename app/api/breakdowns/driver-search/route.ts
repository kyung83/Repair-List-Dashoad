import { env } from 'cloudflare:workers';
import { searchBreakdownDrivers } from '@/lib/breakdown-driver-directory';

/**
 * PUBLIC and intentionally narrow. Searches the cached Recruiting directory and
 * exposes only a display name plus the last four phone digits. Full phone data
 * never leaves the server.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = String(url.searchParams.get('q') ?? '').trim().slice(0, 80);
    if (query.length < 2) {
      return Response.json({ drivers: [] }, { headers: { 'cache-control': 'no-store, max-age=0' } });
    }
    const drivers = await searchBreakdownDrivers(env.DB, query);
    return Response.json({ drivers }, { headers: { 'cache-control': 'no-store, max-age=0' } });
  } catch (error) {
    console.warn(JSON.stringify({ event: 'breakdown_driver_directory_search_failed', error: String(error) }));
    return Response.json({ drivers: [] }, { headers: { 'cache-control': 'no-store, max-age=0' } });
  }
}
