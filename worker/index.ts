/** Cloudflare Worker entry point for the Norlow repair and inventory application. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from 'vinext/server/image-optimization';
import handler from 'vinext/server/app-router-entry';
import { appUserCount, authenticateUser, createSession, getSessionUser, sessionCookie, type AppUser } from '../lib/auth';
import { syncBreakdownDriverDirectory } from '../lib/breakdown-driver-directory';
import { syncGeotabDvir } from '../lib/geotab';
import { syncGeotabFleetMaster } from '../lib/geotab-fleet';
import { syncGeotabGpsFeed, syncGeotabLocationMirror } from '../lib/geotab-gps-feed';
import { recoverStaleGeotabGps } from '../lib/geotab-gps-stale-recovery';

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  FILES: R2Bucket;
  GEOTAB_DATABASE?: string;
  GEOTAB_USERNAME?: string;
  GEOTAB_PASSWORD?: string;
  GEOTAB_CONFIG_PRIVATE_KEY?: string;
  AUTH_BOOTSTRAP_TOKEN?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const PUBLIC_PATHS = new Set([
  '/login',
  '/setup',
  '/report-breakdown',
  '/api/equipment/search',
  '/api/breakdowns',
  '/api/breakdown-categories',
  '/api/breakdowns/driver',
  '/api/breakdowns/driver-search',
  '/api/breakdowns/geotab-preview',
  '/api/webhook/twilio-sms',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/auth/setup',
  '/favicon.svg',
]);
const ASSIGNED_MAINTENANCE_WRITE_PATHS = new Set([
  '/api/maintenance-actions',
  '/api/maintenance-checklist',
  '/api/maintenance-findings',
  '/api/maintenance-signature',
  '/api/maintenance-subrepairs',
]);
const TECHNICIAN_SHOP_ACTIONS = new Set([
  'openRepair',
  'claimRepair',
  'startLabor',
  'stopLabor',
  'usePart',
  'useReservedPart',
  'removePlannedPart',
  'completeRepair',
  'startUnit',
  'switchRepair',
  'repairOutcome',
  'doneUnit',
]);
const TECHNICIAN_REPAIR_BOARD_ACTIONS = new Set([
  'assignToMe',
  'createRepairForMe',
  'setUnitOos',
]);
const TECHNICIAN_SHOP_WRITE_PATHS = new Set([
  '/api/shop/found-repair',
  '/api/shop/unmatched-part',
  '/api/shop/remove-applied-part',
  '/api/shop/repair-review',
]);
const DISPATCH_READ_PATHS = new Set([
  '/repair-board',
  '/breakdowns',
  '/api/repair-board',
  '/api/repair-board/eta',
  '/api/repair-board/order',
  '/api/yard-status',
  '/api/breakdown-service-providers',
]);

function isStaticAsset(pathname: string) {
  return pathname.startsWith('/_next/') || pathname.startsWith('/_vinext/') || pathname.startsWith('/assets/') || pathname.startsWith('/static/') || /\.(?:css|js|mjs|map|woff2?|ttf|otf|ico|svg|png|jpe?g|gif|webp|avif)$/i.test(pathname);
}
function isApi(pathname: string) {
  return pathname === '/api' || pathname.startsWith('/api/');
}
function loginRedirect(url: URL) {
  const target = new URL('/login', url);
  target.searchParams.set('returnTo', `${url.pathname}${url.search}`);
  return Response.redirect(target, 302);
}
function setupRedirect(url: URL) {
  return Response.redirect(new URL('/setup', url), 302);
}
function accessDenied(url: URL, message = 'Your clearance does not allow this action.') {
  return isApi(url.pathname)
    ? Response.json({ error: message }, { status: 403 })
    : new Response(message, { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
function publicUser(user: AppUser) {
  return user.dispatchAccess ? { ...user, role:'dispatch' as const } : user;
}

async function dispatchCanAccess(request: Request, url: URL) {
  const pathname = url.pathname;
  const method = request.method.toUpperCase();
  const read = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';

  if (read) {
    if (DISPATCH_READ_PATHS.has(pathname)) return true;
    if (pathname.startsWith('/api/breakdowns/')) return true;
    if (pathname.startsWith('/api/photos/')) return true;
    if (pathname === '/api/geotab-photo-ids' || pathname.startsWith('/api/geotab-media/')) return true;
    return false;
  }

  if (pathname === '/api/repair-board' && method === 'POST') {
    try {
      const body = await request.clone().json() as Record<string, unknown>;
      return String(body.action ?? '') === 'createRepair' && Number(body.technicianId ?? 0) <= 0;
    } catch {
      return false;
    }
  }

  if (pathname.startsWith('/api/breakdowns/')) return true;
  if (pathname === '/api/breakdown-service-providers') return true;
  return false;
}

async function mechanicCanWrite(request: Request, pathname: string) {
  if (ASSIGNED_MAINTENANCE_WRITE_PATHS.has(pathname) || TECHNICIAN_SHOP_WRITE_PATHS.has(pathname)) return true;
  if (pathname !== '/api/work-orders' && pathname !== '/api/repairs' && pathname !== '/api/shop' && pathname !== '/api/pm-followups' && pathname !== '/api/repair-board') return false;
  let action = '';
  try {
    const body = await request.clone().json() as Record<string, unknown>;
    action = String(body.action ?? '');
  } catch {
    return false;
  }
  if (pathname === '/api/shop') return TECHNICIAN_SHOP_ACTIONS.has(action);
  if (pathname === '/api/repair-board') return TECHNICIAN_REPAIR_BOARD_ACTIONS.has(action);
  if (pathname === '/api/pm-followups') return action === 'addNextPmRepair' || action === 'completeNextPmRepair' || action === 'deferNextPmRepair' || action === 'cancelNextPmRepair';
  if (pathname === '/api/repairs') return action === 'saveRepair' || action === 'completeRepair' || action === 'markRepaired';
  return action === 'completeRepair' || action === 'usePart' || action === 'addLabor';
}

async function userCanAccess(request: Request, user: AppUser, url: URL) {
  const pathname = url.pathname;
  if (user.dispatchAccess) return dispatchCanAccess(request, url);
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin') || pathname.startsWith('/api/internal')) return user.role === 'admin';
  if (pathname === '/pm-kits' || pathname.startsWith('/pm-kits/') || pathname === '/api/pm-kits' || pathname.startsWith('/api/pm-kits/')) return user.role === 'manager' || user.role === 'admin';
  if (pathname === '/next-pm-repairs' || pathname.startsWith('/next-pm-repairs/')) return user.role === 'mechanic' || user.role === 'manager' || user.role === 'admin';
  if (pathname === '/api/repairs' && url.searchParams.get('checkGeotab') === '1') return user.role === 'admin';
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  if (user.role === 'admin' || user.role === 'manager') return true;
  if (user.role === 'mechanic') return mechanicCanWrite(request, pathname);
  return false;
}

async function handleLogin(request: Request, env: Env, url: URL) {
  if (request.method.toUpperCase() !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } });
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return Response.json({ error: 'Cross-site sign-in request rejected.' }, { status: 403 });
  try {
    if (await appUserCount(env.DB) === 0) return Response.json({ error: 'Administrator setup is required.', setupRequired: true }, { status: 428, headers: { 'cache-control': 'no-store' } });
    const body = await request.json() as Record<string, unknown>;
    const result = await authenticateUser(env.DB, body.username ?? body.email, body.password, request.headers.get('cf-connecting-ip') || '');
    if (result.blocked) return Response.json({ error: 'Too many failed sign-in attempts. Try again in about 15 minutes.' }, { status: 429, headers: { 'retry-after': '900', 'cache-control': 'no-store' } });
    if (!result.user) return Response.json({ error: 'Username or password is incorrect.' }, { status: 401, headers: { 'cache-control': 'no-store' } });
    const token = await createSession(env.DB, result.user.id);
    return Response.json({ ok: true, user: publicUser(result.user) }, { headers: { 'set-cookie': sessionCookie(token, request.url), 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'worker_login_failed', error: String(error) }));
    return Response.json({ error: 'Sign in could not be completed.' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}

async function enforceDashboardAccess(request: Request, env: Env, url: URL): Promise<Response | null> {
  const method = request.method.toUpperCase();
  if (PUBLIC_PATHS.has(url.pathname) || isStaticAsset(url.pathname)) return null;
  const origin = request.headers.get('origin');
  if (!['GET','HEAD','OPTIONS'].includes(method) && origin && origin !== url.origin) return Response.json({ error: 'Cross-site write request rejected.' }, { status: 403 });
  const user = await getSessionUser(env.DB, request);
  if (!user) {
    const count = await appUserCount(env.DB);
    if (count === 0) return isApi(url.pathname) ? Response.json({ error: 'Dashboard administrator setup is required.', setupRequired: true }, { status: 503 }) : setupRedirect(url);
    return isApi(url.pathname) ? Response.json({ error: 'Authentication required.' }, { status: 401 }) : loginRedirect(url);
  }
  if (user.dispatchAccess && url.pathname === '/' && (method === 'GET' || method === 'HEAD')) {
    return Response.redirect(new URL('/repair-board', url), 302);
  }
  if (!(await userCanAccess(request, user, url))) return accessDenied(url);
  return null;
}

async function restrictDispatchRepairBoard(request: Request, env: Env, response: Response, url: URL) {
  if (url.pathname !== '/api/repair-board' || request.method.toUpperCase() !== 'GET' || !response.ok) return response;
  const user = await getSessionUser(env.DB, request);
  if (!user?.dispatchAccess) return response;
  try {
    const payload = await response.json() as Record<string, unknown>;
    payload.canManage = false;
    payload.technicians = [];
    const boardUser = payload.user && typeof payload.user === 'object' ? payload.user as Record<string, unknown> : null;
    if (boardUser) boardUser.role = 'dispatch';
    return Response.json(payload, { status:response.status, headers:{ 'cache-control':'no-store' } });
  } catch {
    return response;
  }
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/auth/login') return handleLogin(request, env, url);
    if (url.pathname === '/_vinext/image') {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
        allowedWidths,
      });
    }
    const denied = await enforceDashboardAccess(request, env, url);
    if (denied) return denied;
    const response = await handler.fetch(request, env, ctx);
    return restrictDispatchRepairBoard(request, env, response, url);
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    if (controller.cron === '15 6 * * *') {
      try {
        const driverDirectory = await syncBreakdownDriverDirectory(env);
        console.log(JSON.stringify({ event: 'breakdown_driver_directory_daily_sync', driverDirectory }));
      } catch (error) {
        console.error(JSON.stringify({ event: 'breakdown_driver_directory_sync_failed', error: String(error) }));
      }
      return;
    }

    if (controller.cron === '0 */2 * * *') {
      let feed: unknown = null;
      let recovery: unknown = null;
      let mirror: unknown = null;
      let fleet: unknown = null;
      let dvir: unknown = null;

      try {
        feed = await syncGeotabGpsFeed(env);
      } catch (error) {
        console.error(JSON.stringify({ event: 'geotab_gps_feed_schedule_failed', error: String(error) }));
      }

      try {
        const hour = new Date(controller.scheduledTime).getUTCHours();
        const trailerBucket = (Math.floor(hour / 2) % 2) as 0 | 1;
        recovery = await recoverStaleGeotabGps(env, { trailerBucket });
      } catch (error) {
        console.error(JSON.stringify({ event: 'geotab_targeted_gps_recovery_failed', error: String(error) }));
      }

      try {
        mirror = await syncGeotabLocationMirror(env.DB);
      } catch (error) {
        console.error(JSON.stringify({ event: 'geotab_location_mirror_failed', error: String(error) }));
      }

      try {
        fleet = await syncGeotabFleetMaster(env);
      } catch (error) {
        console.error(JSON.stringify({ event: 'geotab_fleet_sync_failed', error: String(error) }));
      }

      try {
        dvir = await syncGeotabDvir(env);
        await env.DB.prepare('DELETE FROM dvir_defects WHERE repaired = 1').run();
      } catch (error) {
        console.error(JSON.stringify({ event: 'geotab_dvir_sync_failed', error: String(error) }));
      }

      console.log(JSON.stringify({ event: 'geotab_two_hour_sync', feed, recovery, mirror, fleet, dvir }));
    }
  },
};
export default worker;