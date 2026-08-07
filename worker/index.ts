/** Cloudflare Worker entry point for the Norlow repair and inventory application. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from 'vinext/server/image-optimization';
import handler from 'vinext/server/app-router-entry';
import {
  appUserCount,
  authenticateUser,
  createSession,
  getSessionUser,
  sessionCookie,
  type AppUser,
} from '../lib/auth';
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

async function handleLogin(request: Request, env: Env, url: URL) {
  if (request.method.toUpperCase() !== 'POST') {
    return Response.json(
      { error: 'Method not allowed.' },
      { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } },
    );
  }

  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) {
    return Response.json({ error: 'Cross-site sign-in request rejected.' }, { status: 403 });
  }

  try {
    if (await appUserCount(env.DB) === 0) {
      return Response.json(
        { error: 'Administrator setup is required.', setupRequired: true },
        { status: 428, headers: { 'cache-control': 'no-store' } },
      );
    }

    const body = await request.json() as Record<string, unknown>;
    const ip = request.headers.get('cf-connecting-ip') || '';
    const result = await authenticateUser(env.DB, body.email, body.password, ip);

    if (result.blocked) {
      return Response.json(
        { error: 'Too many failed sign-in attempts. Try again in about 15 minutes.' },
        { status: 429, headers: { 'retry-after': '900', 'cache-control': 'no-store' } },
      );
    }

    if (!result.user) {
      return Response.json(
        { error: 'Email or password is incorrect.' },
        { status: 401, headers: { 'cache-control': 'no-store' } },
      );
    }

    const token = await createSession(env.DB, result.user.id);
    return Response.json(
      { ok: true, user: result.user },
      { headers: { 'set-cookie': sessionCookie(token, request.url), 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error(JSON.stringify({ event: 'worker_login_failed', error: String(error) }));
    return Response.json(
      { error: 'Sign in could not be completed.' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
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

    if (url.pathname === '/api/auth/login') return handleLogin(request, env, url);

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

    await env.DB.prepare('DELETE FROM dvir_defects WHERE repaired = 1').run();

    console.log(JSON.stringify({ event: 'geotab_scheduled_sync', dvir, fleet }));
  },
};

export default worker;
