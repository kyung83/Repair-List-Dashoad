import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import {
  GMAIL_BREAKDOWN_RECIPIENT,
  GMAIL_BREAKDOWN_SENDER,
  revokeGmailRuntimeAccess,
  sendGmailRuntimeEmail,
} from '@/lib/gmail-client';
import {
  clearGmailConnection,
  clearGmailOAuthClient,
  getGmailRuntimeCredentialMetadata,
  saveGmailOAuthClient,
} from '@/lib/gmail-runtime-credentials';

async function requireAdmin(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return { response: Response.json({ error: 'Authentication required.' }, { status: 401 }), user: null };
  if (user.role !== 'admin') return { response: Response.json({ error: 'Administrator access is required.' }, { status: 403 }), user: null };
  return { response: null, user };
}

function redirectUri(request: Request) {
  return new URL('/api/admin/gmail/callback', request.url).toString();
}

async function statusPayload(request: Request) {
  const credentials = await getGmailRuntimeCredentialMetadata(env.DB);
  return {
    ...credentials,
    sender: GMAIL_BREAKDOWN_SENDER,
    recipient: GMAIL_BREAKDOWN_RECIPIENT,
    redirectUri: redirectUri(request),
  };
}

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;
    return Response.json(await statusPayload(request), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'gmail_connection_status_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Gmail connection status could not be loaded.' }, { status: 500 });
  }
}

type ActionBody = {
  action?: string;
  clientId?: string;
  clientSecret?: string;
};

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response || !auth.user) return auth.response!;
    const body = await request.json().catch(() => ({})) as ActionBody;
    const action = String(body.action || '').trim();

    if (action === 'save-client') {
      const clientId = String(body.clientId || '').trim();
      const clientSecret = String(body.clientSecret || '').trim();
      if (!clientId || !clientSecret) return Response.json({ error: 'Google OAuth Client ID and Client Secret are required.' }, { status: 400 });
      if (clientId.length > 500 || clientSecret.length > 1000) return Response.json({ error: 'Google OAuth credential input is too long.' }, { status: 400 });
      await saveGmailOAuthClient(env.DB, env, clientId, clientSecret, auth.user.id);
      return Response.json({ ok: true, message: 'Google OAuth client saved. Connect Gmail next.', status: await statusPayload(request) });
    }

    if (action === 'disconnect') {
      await revokeGmailRuntimeAccess().catch(() => undefined);
      await clearGmailConnection(env.DB);
      return Response.json({ ok: true, message: 'Gmail connection removed.', status: await statusPayload(request) });
    }

    if (action === 'clear-client') {
      await revokeGmailRuntimeAccess().catch(() => undefined);
      await clearGmailOAuthClient(env.DB);
      return Response.json({ ok: true, message: 'Google OAuth client and Gmail connection removed.', status: await statusPayload(request) });
    }

    if (action === 'test') {
      const status = await getGmailRuntimeCredentialMetadata(env.DB);
      if (!status.connected) return Response.json({ error: 'Connect Gmail before sending a test.' }, { status: 400 });
      const sentAt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Detroit',
        dateStyle: 'medium',
        timeStyle: 'long',
      }).format(new Date());
      await sendGmailRuntimeEmail({
        to: GMAIL_BREAKDOWN_RECIPIENT,
        subject: 'Breakdown Email Test - Jerry Tomaski',
        text: `Norlow breakdown email is connected.\n\nFrom: ${GMAIL_BREAKDOWN_SENDER}\nTo: ${GMAIL_BREAKDOWN_RECIPIENT}\nSent: ${sentAt}`,
        html: `<p><strong>Norlow breakdown email is connected.</strong></p><p>From: ${GMAIL_BREAKDOWN_SENDER}<br>To: ${GMAIL_BREAKDOWN_RECIPIENT}<br>Sent: ${sentAt}</p>`,
      });
      return Response.json({ ok: true, message: `Test email sent to ${GMAIL_BREAKDOWN_RECIPIENT}.` });
    }

    return Response.json({ error: 'Unknown Gmail connection action.' }, { status: 400 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'gmail_connection_action_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Gmail connection action failed.' }, { status: 500 });
  }
}
