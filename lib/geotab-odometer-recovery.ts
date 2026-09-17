import {
  createGeotabClient,
  geotabArray,
  geotabGet,
  geotabObjectId,
  geotabRecord,
  type GeotabClientEnv,
  type GeotabJsonRecord,
} from './geotab-client';

const TARGET_BATCH_SIZE = 40;
const MAX_SECOND_PASS = 120;
const PRIMARY_ODOMETER_DIAGNOSTIC = 'DiagnosticOdometerId';
const FALLBACK_ODOMETER_DIAGNOSTIC = 'DiagnosticOdometerAdjustmentId';
const ODOMETER_DIAGNOSTICS = [
  { id: PRIMARY_ODOMETER_DIAGNOSTIC },
  { id: FALLBACK_ODOMETER_DIAGNOSTIC },
];

type OdometerResult = {
  milesByDevice: Map<string, number>;
  available: boolean;
  requested: number;
  firstPassReceived: number;
  retried: number;
  targetedRecovered: number;
  calculatedFallbackRecovered: number;
  broadFallbackRecovered: number;
  stillMissing: number;
};

function rowsFromMultiCallChild(value: unknown) {
  if (Array.isArray(value)) return geotabArray(value);
  const wrapped = geotabRecord(value);
  return geotabArray(geotabGet(wrapped, 'result', 'Result'));
}

function collectOdometers(rows: GeotabJsonRecord[], target: Map<string, number>) {
  for (const status of rows) {
    const deviceId = geotabObjectId(geotabGet(status, 'device', 'Device')) || geotabObjectId(status);
    if (!deviceId) continue;

    let primaryMiles: number | null = null;
    let fallbackMiles: number | null = null;

    for (const item of geotabArray(geotabGet(status, 'statusData', 'StatusData'))) {
      const diagnosticId = geotabObjectId(geotabGet(item, 'diagnostic', 'Diagnostic'));
      if (diagnosticId !== PRIMARY_ODOMETER_DIAGNOSTIC && diagnosticId !== FALLBACK_ODOMETER_DIAGNOSTIC) continue;

      const meters = Number(geotabGet(item, 'data', 'Data'));
      if (!Number.isFinite(meters) || meters < 0) continue;
      const miles = Math.round(meters / 1609.344);

      if (diagnosticId === PRIMARY_ODOMETER_DIAGNOSTIC) primaryMiles = miles;
      else fallbackMiles = miles;
    }

    const selectedMiles = primaryMiles ?? fallbackMiles;
    if (selectedMiles != null) target.set(deviceId, selectedMiles);
  }
}

function calculatedAdjustmentMiles(rows: GeotabJsonRecord[]) {
  let selected: { miles: number; timestamp: number; index: number } | null = null;

  rows.forEach((item, index) => {
    const diagnosticId = geotabObjectId(geotabGet(item, 'diagnostic', 'Diagnostic'));
    if (diagnosticId && diagnosticId !== FALLBACK_ODOMETER_DIAGNOSTIC) return;

    const meters = Number(geotabGet(item, 'data', 'Data'));
    if (!Number.isFinite(meters) || meters < 0) return;

    const dateValue = String(geotabGet(item, 'dateTime', 'DateTime') ?? '').trim();
    const parsed = dateValue ? Date.parse(dateValue) : Number.NaN;
    const timestamp = Number.isFinite(parsed) ? parsed : -1;
    const miles = Math.round(meters / 1609.344);

    if (!selected || timestamp > selected.timestamp || (timestamp === selected.timestamp && index > selected.index)) {
      selected = { miles, timestamp, index };
    }
  });

  return selected?.miles ?? null;
}

async function wait(ms: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function targetedStatusBatch(
  client: Awaited<ReturnType<typeof createGeotabClient>>,
  deviceIds: string[],
) {
  const calls = deviceIds.map((id) => ({
    method: 'Get',
    params: {
      typeName: 'DeviceStatusInfo',
      search: {
        deviceSearch: { id },
        diagnostics: ODOMETER_DIAGNOSTICS,
      },
    },
  }));
  const result = await client.call<unknown[]>('ExecuteMultiCall', { calls });
  const miles = new Map<string, number>();
  for (const child of Array.isArray(result) ? result : []) collectOdometers(rowsFromMultiCallChild(child), miles);
  return miles;
}

async function targetedCalculatedAdjustmentBatch(
  client: Awaited<ReturnType<typeof createGeotabClient>>,
  deviceIds: string[],
) {
  const calls = deviceIds.map((id) => ({
    method: 'Get',
    params: {
      typeName: 'StatusData',
      search: {
        deviceSearch: { id },
        diagnosticSearch: { id: FALLBACK_ODOMETER_DIAGNOSTIC },
      },
    },
  }));
  const result = await client.call<unknown[]>('ExecuteMultiCall', { calls });
  const miles = new Map<string, number>();
  const children = Array.isArray(result) ? result : [];

  for (let index = 0; index < deviceIds.length; index += 1) {
    const rows = rowsFromMultiCallChild(children[index]);
    const calculated = calculatedAdjustmentMiles(rows);
    if (calculated != null) miles.set(deviceIds[index], calculated);
  }
  return miles;
}

async function recoverCalculatedAdjustments(
  client: Awaited<ReturnType<typeof createGeotabClient>>,
  deviceIds: string[],
  target: Map<string, number>,
) {
  let recovered = 0;
  for (let index = 0; index < deviceIds.length; index += TARGET_BATCH_SIZE) {
    const batch = deviceIds.slice(index, index + TARGET_BATCH_SIZE).filter((id) => !target.has(id));
    if (!batch.length) continue;
    try {
      const result = await targetedCalculatedAdjustmentBatch(client, batch);
      for (const [id, miles] of result) {
        if (target.has(id)) continue;
        target.set(id, miles);
        recovered += 1;
      }
    } catch (error) {
      console.warn(JSON.stringify({
        event: 'geotab_calculated_odometer_batch_failed',
        batchSize: batch.length,
        error: String(error),
      }));
    }
  }
  return recovered;
}

async function broadFallback(client: Awaited<ReturnType<typeof createGeotabClient>>) {
  const rows = await client.call<GeotabJsonRecord[]>('Get', {
    typeName: 'DeviceStatusInfo',
    search: { diagnostics: ODOMETER_DIAGNOSTICS },
  });
  const miles = new Map<string, number>();
  collectOdometers(rows, miles);
  return miles;
}

export async function recoverAssignedOdometers(
  env: GeotabClientEnv,
  deviceIds: string[],
): Promise<OdometerResult> {
  const uniqueIds = [...new Set(deviceIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const milesByDevice = new Map<string, number>();
  if (!uniqueIds.length) {
    return {
      milesByDevice,
      available: true,
      requested: 0,
      firstPassReceived: 0,
      retried: 0,
      targetedRecovered: 0,
      calculatedFallbackRecovered: 0,
      broadFallbackRecovered: 0,
      stillMissing: 0,
    };
  }

  const client = await createGeotabClient(env);
  let successfulBatches = 0;

  for (let index = 0; index < uniqueIds.length; index += TARGET_BATCH_SIZE) {
    const batch = uniqueIds.slice(index, index + TARGET_BATCH_SIZE);
    try {
      const result = await targetedStatusBatch(client, batch);
      successfulBatches += 1;
      for (const [id, miles] of result) milesByDevice.set(id, miles);
    } catch (error) {
      console.warn(JSON.stringify({
        event: 'geotab_targeted_odometer_batch_failed',
        batchSize: batch.length,
        error: String(error),
      }));
    }
  }

  const firstPassReceived = milesByDevice.size;
  let missing = uniqueIds.filter((id) => !milesByDevice.has(id));

  // Geotab documents Get<StatusData> for DiagnosticOdometerAdjustmentId as the
  // calculated per-device fallback. It can extend the last known odometer using
  // GPS distance when a current ECM odometer is unavailable. DeviceStatusInfo
  // alone does not guarantee that calculated value will be returned.
  const calculatedFallbackRecovered = missing.length
    ? await recoverCalculatedAdjustments(client, missing, milesByDevice)
    : 0;

  missing = uniqueIds.filter((id) => !milesByDevice.has(id));
  const retryIds = missing.slice(0, MAX_SECOND_PASS);

  if (retryIds.length) {
    await wait(750 + Math.floor(Math.random() * 500));
    for (let index = 0; index < retryIds.length; index += TARGET_BATCH_SIZE) {
      const batch = retryIds.slice(index, index + TARGET_BATCH_SIZE);
      try {
        const result = await targetedStatusBatch(client, batch);
        successfulBatches += 1;
        for (const [id, miles] of result) milesByDevice.set(id, miles);
      } catch (error) {
        console.warn(JSON.stringify({
          event: 'geotab_targeted_odometer_retry_failed',
          batchSize: batch.length,
          error: String(error),
        }));
      }
    }

    const retryStillMissing = retryIds.filter((id) => !milesByDevice.has(id));
    if (retryStillMissing.length) {
      await recoverCalculatedAdjustments(client, retryStillMissing, milesByDevice);
    }
  }

  const targetedRecovered = milesByDevice.size;
  missing = uniqueIds.filter((id) => !milesByDevice.has(id));
  let broadFallbackRecovered = 0;
  let broadAvailable = false;

  if (missing.length) {
    try {
      const broad = await broadFallback(client);
      broadAvailable = true;
      for (const id of missing) {
        const miles = broad.get(id);
        if (miles == null) continue;
        milesByDevice.set(id, miles);
        broadFallbackRecovered += 1;
      }
    } catch (error) {
      console.warn(JSON.stringify({ event: 'geotab_odometer_broad_fallback_failed', error: String(error) }));
    }
  }

  const stillMissing = uniqueIds.filter((id) => !milesByDevice.has(id)).length;
  return {
    milesByDevice,
    available: successfulBatches > 0 || calculatedFallbackRecovered > 0 || broadAvailable,
    requested: uniqueIds.length,
    firstPassReceived,
    retried: retryIds.length,
    targetedRecovered,
    calculatedFallbackRecovered,
    broadFallbackRecovered,
    stillMissing,
  };
}
