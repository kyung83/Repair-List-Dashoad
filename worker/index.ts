/** Cloudflare Worker entry point for the Norlow repair and inventory application. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from 'vinext/server/image-optimization';
import handler from 'vinext/server/app-router-entry';
import { appUserCount, getSessionUser, type AppUser } from '../lib/auth';
import { syncGeotabDvir } from '../lib/geotab';
import { syncGeotabFleetMaster } from '../lib/geotab-fleet';

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
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/auth/setup',
  '/favicon.svg',
]);

function isStaticAsset(pathname: string) {
  return pathname.startsWith('/_next/') ||
    pathname.startsWith('/_vinext/') ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/static/') ||
    /\.(?:css|js|mjs|map|woff2?|ttf|otf|ico|svg|png|jpe?g|gif|webp|avif)$/i.test(pathname);
}

function isApi(pathname: string) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function loginRedirect(url: URL) {
  const returnTo = `${url.pathname}${url.search}`;
  const target = new URL('/login', url);
  target.searchParams.set('returnTo', returnTo);
  return Response.redirect(target, 302);
}

function setupRedirect(url: URL) {
  return Response.redirect(new URL('/setup', url), 302);
}

function accessDenied(url: URL, message = 'Your clearance does not allow this action.') {
  if (isApi(url.pathname)) return Response.json({ error: message }, { status: 403 });
  return new Response(message, { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

async function mechanicCanWrite(request: Request, pathname: string) {
  if (pathname !== '/api/work-orders' && pathname !== '/api/repairs') return false;
  let action = '';
  try {
    const body = await request.clone().json() as Record<string, unknown>;
    action = String(body.action ?? '');
  } catch {
    return false;
  }

  if (pathname === '/api/repairs') {
    return action === 'saveRepair' || action === 'completeRepair' || action === 'markRepaired';
  }
  return action === 'saveRepair' || action === 'completeRepair' || action === 'assignTechnician' || action === 'usePart';
}

async function userCanAccess(request: Request, user: AppUser, url: URL) {
  const pathname = url.pathname;
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin') || pathname.startsWith('/api/internal')) {
    return user.role === 'admin';
  }
  if (pathname === '/api/repairs' && url.searchParams.get('checkGeotab') === '1') {
    return user.role === 'admin';
  }

  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  if (user.role === 'admin' || user.role === 'manager') return true;
  if (user.role === 'mechanic') return mechanicCanWrite(request, pathname);
  return false;
}

async function enforceDashboardAccess(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (PUBLIC_PATHS.has(url.pathname) || isStaticAsset(url.pathname)) return null;

  const origin = request.headers.get('origin');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase()) && origin && origin !== url.origin) {
    return Response.json({ error: 'Cross-site write request rejected.' }, { status: 403 });
  }

  const user = await getSessionUser(env.DB, request);
  if (!user) {
    const count = await appUserCount(env.DB);
    if (count === 0) {
      return isApi(url.pathname)
        ? Response.json({ error: 'Dashboard administrator setup is required.', setupRequired: true }, { status: 503 })
        : setupRedirect(url);
    }
    return isApi(url.pathname)
      ? Response.json({ error: 'Authentication required.' }, { status: 401 })
      : loginRedirect(url);
  }

  if (!(await userCanAccess(request, user, url))) return accessDenied(url);
  return null;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/_vinext/image') {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const denied = await enforceDashboardAccess(request, env, url);
    if (denied) return denied;
    return handler.fetch(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const dvir = await syncGeotabDvir(env);
    const fleet = await syncGeotabFleetMaster(env);

    // The active DVIR table is an open-work queue. Match the Apps Script by
    // removing defects that Geotab already reports as repaired after each sync.
    await env.DB.prepare('DELETE FROM dvir_defects WHERE repaired = 1').run();

    console.log(JSON.stringify({ event: 'geotab_scheduled_sync', dvir, fleet }));
  },
};

export default worker;
