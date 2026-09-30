// The roadside directory is separate from Inventory and Outside Work vendors.
// Historical breakdowns store name/phone snapshots, not provider IDs. Never rewrite them.
export class VendorError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type Draft = { name: string; phone: string; city: string; state: string; zip: string };
type ProviderRow = Draft & {
  id: number; active: number; source: string; phone_digits: string; updated_at: string;
  version: string; has_history: number;
};
const table = 'roadside_service_providers';
const versionSql = (alias: string) => `json_array(${alias}.name,${alias}.phone,${alias}.phone_digits,${alias}.city,${alias}.state,${alias}.zip,${alias}.active,${alias}.updated_at)`;
const snapshotSql = (alias: string) => `json_object('name',${alias}.name,'phone',${alias}.phone,'city',${alias}.city,'state',${alias}.state,'zip',${alias}.zip,'active',${alias}.active,'source',${alias}.source,'updatedAt',${alias}.updated_at)`;

function phoneSql(column: string) {
  let sql = `lower(COALESCE(${column},''))`;
  for (const char of [' ', '-', '(', ')', '+', '.', '/', 'ext', 'x']) sql = `replace(${sql},'${char}','')`;
  // Ignore an optional leading country code; shared numbers conservatively protect all matches.
  return `substr(${sql},-10)`;
}
const phoneKey = (value: string) => value.replace(/\D/g, '').slice(-10);
function historySql(alias: string) {
  const matches = (other: string) => `(
    (trim(${other}.name)<>'' AND lower(trim(b.service_provider))=lower(trim(${other}.name)))
    OR (length(${phoneSql(`${other}.phone`)})>=7 AND ${phoneSql('b.service_provider_phone')}=${phoneSql(`${other}.phone`)})
  )`;
  return `(EXISTS (SELECT 1 FROM roadside_breakdowns b WHERE ${matches(alias)})
    OR EXISTS (SELECT 1 FROM roadside_vendor_change_log old
      JOIN roadside_breakdowns b ON ${matches('old')} WHERE old.provider_id=${alias}.id))`;
}
function selectSql() {
  return `SELECT p.*,${versionSql('p')} AS version,${historySql('p')} AS has_history FROM ${table} p`;
}
function payload(row: ProviderRow) {
  const active = Number(row.active) === 1, hasHistory = Boolean(row.has_history);
  return { id: Number(row.id), name: row.name, phone: row.phone, city: row.city, state: row.state,
    zip: row.zip, active, updatedAt: row.updated_at, version: row.version, hasHistory,
    canDelete: !active && !hasHistory };
}
function field(value: unknown, label: string, max: number, required = false) {
  if (value != null && typeof value !== 'string') throw new VendorError(`${label} must be text.`);
  const output = String(value ?? '').trim();
  if (required && !output) throw new VendorError(`${label} is required.`);
  if (output.length > max || /[\x00-\x1f\x7f]/.test(output)) throw new VendorError(`${label} must be a single line of at most ${max} characters.`);
  return output;
}
export function normalizeVendorDraft(body: Record<string, unknown>): Draft {
  const result = { name: field(body.name, 'Company name', 160, true), phone: field(body.phone, 'Phone', 40),
    city: field(body.city, 'City', 120, true), state: field(body.state, 'State / province', 2, true).toUpperCase(),
    zip: field(body.zip, 'ZIP / postal code', 20) };
  if (!/^[A-Z]{2}$/.test(result.state)) throw new VendorError('Enter a 2-letter state or province abbreviation.');
  if (result.phone && result.phone.replace(/\D/g, '').length < 7) throw new VendorError('Enter a valid phone number, or leave it blank.');
  return result;
}
function positive(value: unknown, label: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new VendorError(`${label} must be a positive integer.`);
  return result;
}
function duplicateSql() {
  return `EXISTS (SELECT 1 FROM ${table} d WHERE d.id<>?
    AND lower(trim(d.name))=lower(trim(?)) AND lower(trim(d.city))=lower(trim(?))
    AND upper(trim(d.state))=? AND ${phoneSql('d.phone')}=? AND lower(trim(d.zip))=lower(trim(?)))`;
}
const duplicateBinds = (draft: Draft, id = 0) => [id, draft.name, draft.city, draft.state, phoneKey(draft.phone), draft.zip];
const duplicateMessage = 'This vendor/location already exists. Find it in All vendors and use Edit or Restore instead.';

export async function listBreakdownVendors(db: D1Database, params: URLSearchParams) {
  const q = field(params.get('q'), 'Search', 160);
  const state = field(params.get('state'), 'State filter', 3).toUpperCase();
  const status = params.get('status') || 'all';
  if (!['all', 'active', 'archived'].includes(status)) throw new VendorError('Choose All, Active, or Archived vendors.');
  const page = positive(params.get('page') || 1, 'Page');
  const pageSize = Math.min(200, positive(params.get('pageSize') || 100, 'Page size'));
  const where: string[] = ['1=1']; const binds: (string | number)[] = [];
  if (state) { where.push('upper(trim(p.state))=?'); binds.push(state); }
  if (status !== 'all') { where.push('p.active=?'); binds.push(status === 'active' ? 1 : 0); }
  if (q) {
    // instr makes user wildcard characters literal, while all inputs stay bound.
    const digits = q.replace(/\D/g, '');
    where.push(`(instr(lower(p.name || ' ' || p.phone || ' ' || p.city || ' ' || p.state || ' ' || p.zip),lower(?))>0${digits ? ' OR instr(p.phone_digits,?)>0' : ''})`);
    binds.push(q); if (digits) binds.push(digits);
  }
  const count = await db.prepare(`SELECT COUNT(*) AS total FROM ${table} p WHERE ${where.join(' AND ')}`).bind(...binds).first<{ total: number }>();
  const total = Number(count?.total || 0), pages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pages);
  const [rows, counts, states] = await Promise.all([
    db.prepare(`${selectSql()} WHERE ${where.join(' AND ')} ORDER BY p.name COLLATE NOCASE,p.state,p.city COLLATE NOCASE,p.id LIMIT ? OFFSET ?`)
      .bind(...binds, pageSize, (currentPage - 1) * pageSize).all<ProviderRow>(),
    db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(active),0) AS active FROM ${table}`).first<{ total: number; active: number }>(),
    db.prepare(`SELECT DISTINCT upper(trim(state)) AS state FROM ${table} WHERE trim(state)<>'' ORDER BY state`).all<{ state: string }>(),
  ]);
  return { vendors: rows.results.map(payload), total, page: currentPage, pageSize, pages,
    counts: { total: Number(counts?.total || 0), active: Number(counts?.active || 0), archived: Number(counts?.total || 0) - Number(counts?.active || 0) },
    states: states.results.map((row) => row.state) };
}

async function readVendor(db: D1Database, id: number) {
  const row = await db.prepare(`${selectSql()} WHERE p.id=?`).bind(id).first<ProviderRow>();
  if (!row) throw new VendorError('Vendor no longer exists. Refresh the directory.', 404);
  return row;
}
export async function addBreakdownVendor(db: D1Database, body: Record<string, unknown>) {
  const draft = normalizeVendorDraft(body);
  // The duplicate check is inside the INSERT, not a race-prone read then write.
  const row = await db.prepare(`INSERT INTO ${table} (name,phone,phone_digits,city,state,zip,active,source)
    SELECT ?,?,?,?,?,?,1,'manual' WHERE NOT ${duplicateSql()} RETURNING id`)
    .bind(draft.name, draft.phone, draft.phone.replace(/\D/g, ''), draft.city, draft.state, draft.zip, ...duplicateBinds(draft)).first<{ id: number }>();
  if (!row) throw new VendorError(duplicateMessage, 409);
  return payload(await readVendor(db, row.id));
}

export async function changeBreakdownVendor(db: D1Database, actorId: number, body: Record<string, unknown>, deleting = false) {
  const id = positive(body.id, 'Vendor ID');
  const action = deleting ? 'delete' : String(body.action || 'edit');
  if (!['edit', 'archive', 'restore', 'delete'].includes(action) || (!deleting && action === 'delete')) throw new VendorError('Invalid vendor action.');
  if (deleting && body.confirmDelete !== true) throw new VendorError('Confirm permanent vendor deletion first.');
  const expected = field(body.expectedVersion, 'Version', 2000, true);
  const old = await readVendor(db, id);
  if (old.version !== expected) throw new VendorError('This vendor changed in another session. Refresh and reopen it before saving.', 409);
  if (deleting && (Number(old.active) === 1 || old.has_history)) throw new VendorError('Only archived vendors with no matching breakdown history can be deleted. Archive this vendor to remove it from future searches.', 409);
  const draft = action === 'edit' ? normalizeVendorDraft(body) : null;
  const guards = ['p.id=?', `${versionSql('p')}=?`];
  const binds: (string | number)[] = [id, expected];
  if (draft) { guards.push(`NOT ${duplicateSql()}`); binds.push(...duplicateBinds(draft, id)); }
  if (deleting) { guards.push('p.active=0', `NOT ${historySql('p')}`); }
  const guard = guards.join(' AND ');
  const after = draft ? { ...draft, active: Number(old.active) === 1 } : action === 'delete' ? null : { active: action === 'restore' };
  const audit = db.prepare(`INSERT INTO roadside_vendor_change_log (provider_id,actor_user_id,action,name,phone,before_json,after_json)
    SELECT p.id,?,?,p.name,p.phone,${snapshotSql('p')},? FROM ${table} p WHERE ${guard}`)
    .bind(actorId, action, after == null ? null : JSON.stringify(after), ...binds);
  let mutation: D1PreparedStatement;
  if (deleting) {
    mutation = db.prepare(`DELETE FROM ${table} AS p WHERE ${guard}`).bind(...binds);
  } else if (draft) {
    mutation = db.prepare(`UPDATE ${table} AS p SET name=?,phone=?,phone_digits=?,city=?,state=?,zip=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ${guard}`)
      .bind(draft.name, draft.phone, draft.phone.replace(/\D/g, ''), draft.city, draft.state, draft.zip, ...binds);
  } else {
    mutation = db.prepare(`UPDATE ${table} AS p SET active=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ${guard}`)
      .bind(action === 'restore' ? 1 : 0, ...binds);
  }
  // D1 batch is transactional. The identical predicates make audit and mutation conditional
  // on the same old version. History is checked again inside DELETE, including saved aliases.
  const result = await db.batch([audit, mutation]);
  if (Number(result[1].meta.changes) !== 1) throw new VendorError(draft ? `${duplicateMessage} Otherwise refresh because this vendor changed.` : 'Vendor changed or has matching history. Refresh the directory and try again.', 409);
  return deleting ? { deleted: true, id } : { vendor: payload(await readVendor(db, id)) };
}
