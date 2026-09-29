import { env } from 'cloudflare:workers';
import {
  createGeotabClient,
  geotabGet,
  geotabObjectId,
  geotabText,
  type GeotabJsonRecord,
} from '@/lib/geotab-client';

type AssignmentRow = {
  geotab_device_id: string;
  equipment_id: number;
  unit: string;
};

type LookupStage = 'connection' | 'devices' | 'assignments';

// Return only safe diagnostics. Never send account details or session IDs to the browser.
const failures: Record<LookupStage, { code: string; error: string }> = {
  connection: {
    code: 'GEOTAB_CONNECTION_FAILED',
    error: 'The Geotab connection could not be opened. Check the saved Geotab connection in Diagnostics, then refresh this list.',
  },
  devices: {
    code: 'GEOTAB_DEVICE_LOOKUP_FAILED',
    error: 'Geotab did not return a usable device list. Check the connected account and its asset access, then refresh this list.',
  },
  assignments: {
    code: 'GEOTAB_ASSIGNMENTS_LOAD_FAILED',
    error: 'Geotab responded, but the software could not read its equipment-device assignments. This needs an application/database check.',
  },
};

function dateValue(value: unknown) {
  const raw = geotabText(value).trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function activeDevice(device: GeotabJsonRecord, now: number) {
  const id = geotabObjectId(device);
  if (!id || id.toLowerCase() === 'nodeviceid') return false;
  const from = dateValue(geotabGet(device, 'activeFrom', 'ActiveFrom'));
  const to = dateValue(geotabGet(device, 'activeTo', 'ActiveTo'));
  return (from == null || from <= now) && (to == null || to > now);
}

export async function GET() {
  let stage: LookupStage = 'connection';
  const requestId = crypto.randomUUID();
  try {
    // Use the same saved-credential/session client as the fleet sync.
    // The legacy isGeotabConfigured(env) gate cannot see credentials saved in D1.
    const client = await createGeotabClient(env);
    stage = 'devices';
    const devices = await client.call<GeotabJsonRecord[]>('Get', { typeName: 'Device' });
    if (!Array.isArray(devices) || devices.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error('Invalid device response.');
    }

    stage = 'assignments';
    const result = await env.DB.prepare(`
      SELECT a.geotab_device_id, a.equipment_id, e.unit
      FROM equipment_geotab_devices a
      JOIN equipment e ON e.id = a.equipment_id
      WHERE a.current = 1
    `).all<AssignmentRow>();
    const assignments = new Map(result.results.map((row) => [row.geotab_device_id, row]));
    const now = Date.now();
    const options = devices
      .filter((device) => activeDevice(device, now))
      .map((device) => {
        const id = geotabObjectId(device);
        const assigned = assignments.get(id);
        return {
          id,
          name: geotabText(geotabGet(device, 'name', 'Name')).trim() || id,
          serialNumber: geotabText(geotabGet(device, 'serialNumber', 'SerialNumber')).trim(),
          vin: geotabText(geotabGet(device, 'vehicleIdentificationNumber', 'VehicleIdentificationNumber')).trim().toUpperCase(),
          assignedEquipmentId: assigned?.equipment_id ?? null,
          assignedUnit: assigned?.unit ?? '',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    return Response.json({ configured: true, devices: options }, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    const failure = failures[stage];
    console.error(JSON.stringify({ event: 'geotab_device_options_failed', stage, code: failure.code, requestId }));
    return Response.json({ ...failure, requestId }, {
      status: 500,
      headers: { 'cache-control': 'no-store' },
    });
  }
}
