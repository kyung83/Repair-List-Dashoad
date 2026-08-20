import { env } from 'cloudflare:workers';
import { getSessionUser } from '@/lib/auth';
import { createGeotabClient, testGeotabCredentials } from '@/lib/geotab-client';
import {
  clearGeotabRuntimeCredentials,
  getGeotabRuntimeCredentialMetadata,
  saveGeotabRuntimeCredentials,
} from '@/lib/geotab-runtime-credentials';

type ConnectionIssue = 'none' | 'archived_user' | 'invalid_credentials' | 'configuration' | 'unavailable';

type CredentialBody = {
  action?: string;
  database?: string;
  username?: string;
  password?: string;
};

function classifyConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'Geotab connection failed.');
  const lower = message.toLowerCase();
  let issue: ConnectionIssue = 'unavailable';
  if (lower.includes('user was archived') || lower.includes('active to date is now in the past')) issue = 'archived_user';
  else if (lower.includes('invalid user') || lower.includes('invalid password') || lower.includes('invalid credentials')) issue = 'invalid_credentials';
  else if (lower.includes('configuration is missing') || lower.includes('configuration private key') || lower.includes('protected configuration')) issue = 'configuration';
  const match = message.match(/@\s*'([^']+)'/i);
  return { issue, error: message.slice(0, 500), suggestedDatabase: match?.[1]?.trim() || '' };
}

async function requireAdmin(request: Request) {
  const user = await getSessionUser(env.DB, request);
  if (!user) return { response: Response.json({ error: 'Authentication required.' }, { status: 401 }), user: null };
  if (user.role !== 'admin') return { response: Response.json({ error: 'Administrator access is required.' }, { status: 403 }), user: null };
  return { response: null, user };
}

async function statusPayload() {
  const runtimeOverride = await getGeotabRuntimeCredentialMetadata(env.DB);
  try {
    await createGeotabClient(env);
    return {
      connected: true,
      issue: 'none' as ConnectionIssue,
      error: '',
      suggestedDatabase: runtimeOverride.database,
      credentialSource: runtimeOverride.active ? 'diagnostics_override' : 'deployment',
      runtimeOverride,
    };
  } catch (error) {
    const classified = classifyConnectionError(error);
    return {
      connected: false,
      ...classified,
      suggestedDatabase: runtimeOverride.database || classified.suggestedDatabase,
      credentialSource: runtimeOverride.active ? 'diagnostics_override' : 'deployment',
      runtimeOverride,
    };
  }
}

function credentials(body: CredentialBody) {
  return {
    database: String(body.database || '').trim(),
    username: String(body.username || '').trim(),
    password: String(body.password || ''),
  };
}

function validateCredentialInput(input: ReturnType<typeof credentials>) {
  if (!input.database || !input.username || !input.password) return 'Database, username, and password are required.';
  if (input.database.length > 120 || input.username.length > 254 || input.password.length > 500) return 'Geotab credential input is too long.';
  return '';
}

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response) return auth.response;
    return Response.json(await statusPayload(), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'geotab_connection_status_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Geotab connection status could not be loaded.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if (auth.response || !auth.user) return auth.response!;
    const body = await request.json().catch(() => ({})) as CredentialBody;
    const action = String(body.action || '').trim();

    if (action === 'clear') {
      await clearGeotabRuntimeCredentials(env.DB);
      return Response.json({ ok: true, message: 'Saved Geotab override cleared.', status: await statusPayload() });
    }

    if (action !== 'test' && action !== 'save') {
      return Response.json({ error: 'Unknown Geotab connection action.' }, { status: 400 });
    }

    const input = credentials(body);
    const inputError = validateCredentialInput(input);
    if (inputError) return Response.json({ error: inputError }, { status: 400 });

    try {
      await testGeotabCredentials(input);
    } catch (error) {
      const classified = classifyConnectionError(error);
      return Response.json({ ok: false, ...classified }, { status: 400 });
    }

    if (action === 'test') {
      return Response.json({ ok: true, message: 'Credentials authenticated successfully. Nothing was saved.' });
    }

    await saveGeotabRuntimeCredentials(env.DB, env, input, auth.user.id);
    const current = await statusPayload();
    if (!current.connected) {
      return Response.json({ ok: false, error: current.error || 'Credentials were saved but the active connection test failed.', status: current }, { status: 500 });
    }
    return Response.json({ ok: true, message: 'Replacement Geotab service account saved and is now active.', status: current });
  } catch (error) {
    console.error(JSON.stringify({ event: 'geotab_connection_action_failed', error: String(error) }));
    return Response.json({ error: error instanceof Error ? error.message : 'Geotab connection action failed.' }, { status: 500 });
  }
}
