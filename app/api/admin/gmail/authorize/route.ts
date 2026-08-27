import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { buildGmailAuthorizationUrl } from '@/lib/gmail-client';
import { createGmailOAuthState, getGmailRuntimeCredentialMetadata } from '@/lib/gmail-runtime-credentials';

async function requireAdmin(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return { response: Response.json({ error: 'Authentication required.' }, { status: 401 }), user: null };
  if (user.role !== 'admin') return { response: Response.json({ error: 'Administrator access is required.' }, { status: 403 }), user: null };
  return { response: null, user };
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response || !auth.user) return auth.response!;
    const status = await getGmailRuntimeCredentialMetadata(env.DB);
    if (!status.configured) return Response.json({ error: 'Save the Google OAuth Client ID and Client Secret first.' }, { status: 400 });
    const state = await createGmailOAuthState(env.DB, auth.user.id);
    const redirectUri = new URL('/api/admin/gmail/callback', request.url).toString();
    const authorizationUrl = await buildGmailAuthorizationUrl(state, redirectUri);
    return Response.json({ ok: true, authorizationUrl }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'gmail_authorize_start_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Gmail authorization could not be started.' }, { status: 500 });
  }
}
