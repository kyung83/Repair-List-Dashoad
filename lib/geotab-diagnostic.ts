import { createGeotabClient, type GeotabClientEnv } from './geotab-client';

type CheckResult = { ok: boolean; count?: number; error?: string };

export type GeotabDiagnosticResult = {
  ok: boolean;
  authenticated: boolean;
  stage: 'configuration' | 'authentication' | 'permissions' | 'ready';
  endpointHost?: string;
  checks: Record<string, CheckResult>;
  error?: string;
};

function safeError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value);
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[service-account]')
    .replace(/password\s*[:=]\s*\S+/gi, 'password=[redacted]')
    .replace(/sessionId\s*[:=]\s*\S+/gi, 'sessionId=[redacted]')
    .slice(0, 500);
}

export async function diagnoseGeotabConnection(env: GeotabClientEnv): Promise<GeotabDiagnosticResult> {
  let client: Awaited<ReturnType<typeof createGeotabClient>>;
  try {
    client = await createGeotabClient(env);
  } catch (error) {
    const message = safeError(error);
    const configuration = /dedicated service account|not permitted|encryption is unavailable|credential encryption/i.test(message);
    return { ok: false, authenticated: false, stage: configuration ? 'configuration' : 'authentication',
      checks: {}, error: message };
  }

  async function runGet(params: Record<string, unknown>): Promise<CheckResult> {
    try {
      const rows = await client.call<unknown[]>('Get', params);
      return { ok: true, count: Array.isArray(rows) ? rows.length : 0 };
    } catch (error) {
      return { ok: false, error: safeError(error) };
    }
  }

  // DVIR and the office diagnostics now verify exactly the same service
  // account, shared session and requested entity types.
  const now = new Date();
  const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const checks: Record<string, CheckResult> = {
    devices: await runGet({ typeName: 'Device' }),
    trailers: await runGet({ typeName: 'Trailer' }),
    users: await runGet({ typeName: 'User' }),
    defects: await runGet({ typeName: 'Defect', search: { includeAllTrees: true } }),
    dvirLogs: await runGet({ typeName: 'DVIRLog',
      search: { fromDate: past.toISOString(), toDate: now.toISOString() } }),
  };
  const ok = Object.values(checks).every(check => check.ok);
  return {
    ok,
    authenticated: true,
    stage: ok ? 'ready' : 'permissions',
    endpointHost: client.endpointHost,
    checks,
    ...(ok ? {} : { error: 'The saved Geotab service account authenticated, but one or more required API permissions failed.' }),
  };
}
