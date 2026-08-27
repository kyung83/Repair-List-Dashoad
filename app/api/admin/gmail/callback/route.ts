import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { completeGmailAuthorization } from '@/lib/gmail-client';
import { consumeGmailOAuthState } from '@/lib/gmail-runtime-credentials';

function adminPage(request: Request, params: Record<string, string>) {
  const url = new URL('/admin/gmail', request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(env.DB, request);
    if (!user) return Response.redirect(new URL('/login?returnTo=/admin/gmail', request.url), 302);
    if (user.role !== 'admin') return Response.redirect(adminPage(request, { error: 'Administrator access is required.' }), 302);

    const url = new URL(request.url);
    const oauthError = String(url.searchParams.get('error') || '').trim();
    if (oauthError) return Response.redirect(adminPage(request, { error: `Google authorization was not completed: ${oauthError}` }), 302);

    const code = String(url.searchParams.get('code') || '').trim();
    const state = String(url.searchParams.get('state') || '').trim();
    if (!code || !state) return Response.redirect(adminPage(request, { error: 'Google authorization response was incomplete.' }), 302);

    const validState = await consumeGmailOAuthState(env.DB, state, user.id);
    if (!validState) return Response.redirect(adminPage(request, { error: 'Google authorization expired or could not be verified. Start Connect Gmail again.' }), 302);

    const redirectUri = new URL('/api/admin/gmail/callback', request.url).toString();
    const result = await completeGmailAuthorization(code, redirectUri, user.id);
    return Response.redirect(adminPage(request, { connected: result.email }), 302);
  } catch (error) {
    console.error(JSON.stringify({ event: 'gmail_authorize_callback_failed', error: String(error) }));
    const message = error instanceof Error ? error.message : 'Gmail authorization failed.';
    return Response.redirect(adminPage(request, { error: message.slice(0, 300) }), 302);
  }
}
