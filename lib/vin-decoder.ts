type VinRow = { id: number; vin: string };
type VinResult = Record<string, unknown>;

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/i;
const VPIC_BATCH_SIZE = 50;
const MAX_VINS_PER_SYNC = 200;

function text(value: unknown) {
  if (typeof value !== 'string') return value == null ? '' : String(value);
  const result = value.trim();
  if (!result || /^(not applicable|n\/a|null)$/i.test(result)) return '';
  return result;
}

function engineDescription(result: VinResult) {
  const engineModel = text(result.EngineModel);
  if (engineModel) return engineModel;

  const details = [
    text(result.DisplacementL) ? `${text(result.DisplacementL)}L` : '',
    text(result.EngineCylinders) ? `${text(result.EngineCylinders)} cyl` : '',
    text(result.EngineConfiguration),
    text(result.FuelTypePrimary),
  ].filter(Boolean);
  return details.join(' ');
}

async function decodeBatch(rows: VinRow[]) {
  const body = new URLSearchParams({
    format: 'json',
    data: rows.map((row) => row.vin).join(';'),
  });
  const response = await fetch('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      accept: 'application/json',
      'user-agent': 'NorlowRepairDashboard/1.0',
    },
    body,
  });
  if (!response.ok) throw new Error(`VIN decoder returned HTTP ${response.status}`);
  const payload = await response.json() as { Results?: VinResult[] };
  return Array.isArray(payload.Results) ? payload.Results : [];
}

export async function refreshMissingVinMetadata(db: D1Database) {
  const query = await db.prepare(`
    SELECT id, vin
    FROM equipment
    WHERE active = 1
      AND vin IS NOT NULL
      AND length(vin) = 17
      AND (vin_decoded_at IS NULL OR model_year IS NULL OR make IS NULL OR model IS NULL)
    ORDER BY CASE WHEN vin_decoded_at IS NULL THEN 0 ELSE 1 END, id
    LIMIT ?
  `).bind(MAX_VINS_PER_SYNC).all<VinRow>();

  const rows = query.results.filter((row) => VIN_PATTERN.test(row.vin));
  let updated = 0;

  for (let offset = 0; offset < rows.length; offset += VPIC_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + VPIC_BATCH_SIZE);
    const byVin = new Map(batch.map((row) => [row.vin.toUpperCase(), row]));
    const results = await decodeBatch(batch);
    const statements: D1PreparedStatement[] = [];

    for (const result of results) {
      const vin = text(result.VIN).toUpperCase();
      const target = byVin.get(vin);
      if (!target) continue;
      const yearValue = Number(text(result.ModelYear));
      const modelYear = Number.isInteger(yearValue) && yearValue >= 1900 && yearValue <= 2200 ? yearValue : null;
      const make = text(result.Make) || null;
      const model = text(result.Model) || null;
      const engine = engineDescription(result) || null;

      statements.push(db.prepare(`
        UPDATE equipment
        SET model_year = COALESCE(?, model_year),
            make = COALESCE(?, make),
            model = COALESCE(?, model),
            engine = COALESCE(?, engine),
            vin_decoded_at = CURRENT_TIMESTAMP,
            vin_decode_source = 'NHTSA vPIC',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND upper(vin) = ?
      `).bind(modelYear, make, model, engine, target.id, vin));
    }

    if (statements.length) {
      await db.batch(statements);
      updated += statements.length;
    }
  }

  return { requested: rows.length, updated };
}
