const MASTER_DATA_SPREADSHEET_ID = '1zFDdVqpb51u7BPAE9RA6v7e-ew8fR-E4fHcTMWDNg-g';
const RECRUITING_SHEET_GID = '1719156591';
const MIN_SAFE_ROWS = 10;
const MAX_SOURCE_BYTES = 2_000_000;
const SEARCH_LIMIT = 10;

type Env = { DB: D1Database };
type DirectoryRow = {
  id: number;
  first_name: string;
  last_name: string;
  full_name: string;
  phone_e164: string;
  phone_display: string;
  phone_last4: string;
};

type ParsedDriver = {
  sourceRow: number;
  firstName: string;
  lastName: string;
  fullName: string;
  firstNameNorm: string;
  lastNameNorm: string;
  fullNameNorm: string;
  phoneE164: string;
  phoneDisplay: string;
  phoneLast4: string;
};

function normalizeName(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizePhone(value: unknown) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return digits;
  return '';
}

function displayPhone(e164Digits: string) {
  const local = e164Digits.startsWith('1') ? e164Digits.slice(1) : e164Digits;
  if (local.length !== 10) return e164Digits;
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell.replace(/\r$/, ''));
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function parseRecruitingRows(csv: string) {
  const rows = parseCsv(csv);
  if (!rows.length) throw new Error('Recruiting sheet returned no rows.');
  const header = rows[0].map((value) => normalizeName(value));
  if (header[0] !== 'FIRST NAME' || header[1] !== 'LAST NAME' || header[2] !== 'PHONE NUMBER') {
    throw new Error('Recruiting sheet A-C headers do not match FIRST NAME / LAST NAME / PHONE NUMBER.');
  }

  const output: ParsedDriver[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const firstName = String(rows[index]?.[0] ?? '').trim().slice(0, 80);
    const lastName = String(rows[index]?.[1] ?? '').trim().slice(0, 80);
    const phoneE164 = normalizePhone(rows[index]?.[2]);
    if (!firstName || !lastName || !phoneE164) continue;
    const firstNameNorm = normalizeName(firstName);
    const lastNameNorm = normalizeName(lastName);
    if (!firstNameNorm || !lastNameNorm) continue;
    output.push({
      sourceRow: index + 1,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.replace(/\s+/g, ' ').trim().slice(0, 160),
      firstNameNorm,
      lastNameNorm,
      fullNameNorm: `${firstNameNorm} ${lastNameNorm}`,
      phoneE164,
      phoneDisplay: displayPhone(phoneE164),
      phoneLast4: phoneE164.slice(-4),
    });
  }
  if (output.length < MIN_SAFE_ROWS) {
    throw new Error(`Recruiting sheet produced only ${output.length} usable driver rows; keeping the previous cache.`);
  }
  return output;
}

async function fetchRecruitingCsv() {
  const urls = [
    `https://docs.google.com/spreadsheets/d/${MASTER_DATA_SPREADSHEET_ID}/export?format=csv&gid=${RECRUITING_SHEET_GID}&range=A:C`,
    `https://docs.google.com/spreadsheets/d/${MASTER_DATA_SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=Recruiting&range=A:C`,
  ];
  let lastError = '';
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: { accept: 'text/csv,text/plain;q=0.9,*/*;q=0.1' } });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const text = await response.text();
      if (!text || text.length > MAX_SOURCE_BYTES) {
        lastError = text ? 'response too large' : 'empty response';
        continue;
      }
      return text;
    } catch (error) {
      lastError = String(error);
    }
  }
  throw new Error(`Could not read Recruiting A-C from Master Data EI (${lastError || 'unknown error'}).`);
}

export async function syncBreakdownDriverDirectory(env: Env) {
  const attemptAt = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO breakdown_driver_directory_sync (id, last_attempt_at, updated_at)
    VALUES (1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at, updated_at=CURRENT_TIMESTAMP
  `).bind(attemptAt).run();

  try {
    const csv = await fetchRecruitingCsv();
    const drivers = parseRecruitingRows(csv);
    const generation = crypto.randomUUID();
    const statements = drivers.map((driver) => env.DB.prepare(`
      INSERT INTO breakdown_driver_directory (
        generation, source_row, first_name, last_name, full_name,
        first_name_norm, last_name_norm, full_name_norm,
        phone_e164, phone_display, phone_last4, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      generation,
      driver.sourceRow,
      driver.firstName,
      driver.lastName,
      driver.fullName,
      driver.firstNameNorm,
      driver.lastNameNorm,
      driver.fullNameNorm,
      driver.phoneE164,
      driver.phoneDisplay,
      driver.phoneLast4,
    ));

    for (let offset = 0; offset < statements.length; offset += 75) {
      await env.DB.batch(statements.slice(offset, offset + 75));
    }

    await env.DB.prepare(`
      UPDATE breakdown_driver_directory_sync
      SET active_generation=?, last_success_at=?, last_error=NULL, row_count=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=1
    `).bind(generation, attemptAt, drivers.length).run();

    await env.DB.prepare(`
      DELETE FROM breakdown_driver_directory
      WHERE generation <> ?
        AND generation NOT IN (
          SELECT generation FROM breakdown_driver_directory
          GROUP BY generation
          ORDER BY MAX(synced_at) DESC
          LIMIT 1
        )
    `).bind(generation).run();

    return { ok: true as const, rowCount: drivers.length, generation };
  } catch (error) {
    const message = String((error as Error)?.message ?? error).slice(0, 500);
    await env.DB.prepare(`
      UPDATE breakdown_driver_directory_sync
      SET last_error=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=1
    `).bind(message).run();
    throw error;
  }
}

async function activeGeneration(db: D1Database) {
  const row = await db.prepare(`
    SELECT active_generation
    FROM breakdown_driver_directory_sync
    WHERE id=1
  `).first<{ active_generation: string | null }>();
  return String(row?.active_generation || '').trim();
}

export async function searchBreakdownDrivers(db: D1Database, rawQuery: string) {
  const generation = await activeGeneration(db);
  if (!generation) return [];
  const query = normalizeName(rawQuery).slice(0, 80);
  if (query.length < 2) return [];
  const tokens = query.split(' ').filter(Boolean).slice(0, 3);
  const where = tokens.map(() => `(first_name_norm LIKE ? OR last_name_norm LIKE ? OR full_name_norm LIKE ?)`).join(' AND ');
  const params: unknown[] = [generation];
  for (const token of tokens) {
    const like = `${token}%`;
    params.push(like, like, `% ${like}`);
  }
  const result = await db.prepare(`
    SELECT id, first_name, last_name, full_name, phone_e164, phone_display, phone_last4
    FROM breakdown_driver_directory
    WHERE generation = ? AND ${where}
    ORDER BY
      CASE WHEN full_name_norm = ? THEN 0 WHEN first_name_norm = ? OR last_name_norm = ? THEN 1 ELSE 2 END,
      last_name_norm,
      first_name_norm
    LIMIT ${SEARCH_LIMIT}
  `).bind(...params, query, query, query).all<DirectoryRow>();
  return result.results.map((row) => ({
    id: row.id,
    name: row.full_name,
    phoneLast4: row.phone_last4,
  }));
}

export async function resolveBreakdownDriverDirectorySelection(db: D1Database, id: number) {
  if (!Number.isInteger(id) || id <= 0) return null;
  const generation = await activeGeneration(db);
  if (!generation) return null;
  const row = await db.prepare(`
    SELECT id, first_name, last_name, full_name, phone_e164, phone_display, phone_last4
    FROM breakdown_driver_directory
    WHERE id=? AND generation=?
  `).bind(id, generation).first<DirectoryRow>();
  if (!row) return null;
  return {
    id: row.id,
    name: row.full_name,
    phone: row.phone_display,
    phoneLast4: row.phone_last4,
  };
}
