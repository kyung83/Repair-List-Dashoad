import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';

export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return new Response('Authentication required.', { status: 401 });

  const { key } = await context.params;
  const objectKey = (key ?? []).map(decodeURIComponent).join('/');
  if (!objectKey.startsWith('maintenance-checklists/')) {
    return new Response('Not found.', { status: 404 });
  }

  const object = await env.FILES.get(objectKey);
  if (!object) return new Response('Not found.', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('cache-control', 'private, max-age=31536000, immutable');
  return new Response(object.body, { headers });
}
