import {
  BREAKDOWN_SMS_GROUP,
  getBreakdownSmsContactSchedules,
  type BreakdownSmsContactSchedule,
} from '@/lib/breakdown-sms-schedule';
import {
  isBreakdownSmsAwayPeriodActive,
} from './breakdown-sms-away-core.js';

export type BreakdownSmsAwayPeriod = {
  id: number;
  contactId: number;
  startDate: string;
  endDate: string;
  backupContactId: number | null;
  backupLabel: string;
  label: string;
  awayNow: boolean;
  updatedAt: string;
};

export type BreakdownSmsContactCoverage = BreakdownSmsContactSchedule & {
  normalAllowedNow: boolean;
  awayPeriods: BreakdownSmsAwayPeriod[];
  awayNow: boolean;
  activeAwayPeriod: BreakdownSmsAwayPeriod | null;
  coveringFor: { contactId: number; label: string }[];
};

type AwayPeriodRow = {
  id: number;
  contact_id: number;
  start_date: string;
  end_date: string;
  backup_contact_id: number | null;
  backup_label: string | null;
  label: string;
  active: number;
  updated_at: string;
};

function cleanDate(value: unknown) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose valid vacation start and end dates.');
  return date;
}

function awayResponse(row: AwayPeriodRow, date: Date): BreakdownSmsAwayPeriod {
  return {
    id: Number(row.id),
    contactId: Number(row.contact_id),
    startDate: String(row.start_date || ''),
    endDate: String(row.end_date || ''),
    backupContactId: row.backup_contact_id == null ? null : Number(row.backup_contact_id),
    backupLabel: String(row.backup_label || ''),
    label: String(row.label || '').trim() || 'Vacation / Away',
    awayNow: isBreakdownSmsAwayPeriodActive(row, date),
    updatedAt: String(row.updated_at || ''),
  };
}

async function activeAwayRows(db: D1Database) {
  const result = await db.prepare(`
    SELECT a.id,a.contact_id,a.start_date,a.end_date,a.backup_contact_id,
           COALESCE(b.label,'') AS backup_label,a.label,a.active,a.updated_at
    FROM breakdown_sms_contact_away_periods a
    JOIN notification_group_contacts c ON c.id=a.contact_id
    JOIN notification_groups g ON g.id=c.group_id AND g.name=?
    LEFT JOIN notification_group_contacts b ON b.id=a.backup_contact_id
    WHERE a.active=1
    ORDER BY a.start_date,a.end_date,a.id
  `).bind(BREAKDOWN_SMS_GROUP).all<AwayPeriodRow>();
  return result.results;
}

export async function getBreakdownSmsContactCoverage(
  db: D1Database,
  date = new Date(),
): Promise<BreakdownSmsContactCoverage[]> {
  const [baseSchedules, rows] = await Promise.all([
    getBreakdownSmsContactSchedules(db),
    activeAwayRows(db),
  ]);

  const baseById = new Map(baseSchedules.map(contact => [contact.contactId, contact]));
  const periodsByContact = new Map<number, BreakdownSmsAwayPeriod[]>();
  for (const row of rows) {
    const period = awayResponse(row, date);
    const existing = periodsByContact.get(period.contactId) || [];
    existing.push(period);
    periodsByContact.set(period.contactId, existing);
  }

  const awayNowById = new Map<number, boolean>();
  for (const contact of baseSchedules) {
    const periods = periodsByContact.get(contact.contactId) || [];
    awayNowById.set(contact.contactId, periods.some(period => period.awayNow));
  }

  const coveringForById = new Map<number, { contactId: number; label: string }[]>();
  for (const row of rows) {
    if (row.backup_contact_id == null || !isBreakdownSmsAwayPeriodActive(row, date)) continue;
    const primary = baseById.get(Number(row.contact_id));
    const backup = baseById.get(Number(row.backup_contact_id));
    if (!primary?.active || !backup?.active) continue;
    if (!primary.allowedNow) continue;
    if (awayNowById.get(backup.contactId)) continue;

    const existing = coveringForById.get(backup.contactId) || [];
    if (!existing.some(item => item.contactId === primary.contactId)) {
      existing.push({ contactId: primary.contactId, label: primary.label });
      coveringForById.set(backup.contactId, existing);
    }
  }

  return baseSchedules.map(contact => {
    const awayPeriods = periodsByContact.get(contact.contactId) || [];
    const activeAwayPeriod = awayPeriods.find(period => period.awayNow) || null;
    const coveringFor = coveringForById.get(contact.contactId) || [];
    const awayNow = Boolean(activeAwayPeriod);
    const normalAllowedNow = Boolean(contact.allowedNow);
    return {
      ...contact,
      normalAllowedNow,
      awayPeriods,
      awayNow,
      activeAwayPeriod,
      coveringFor,
      allowedNow: Boolean(contact.active) && !awayNow && (normalAllowedNow || coveringFor.length > 0),
    };
  });
}

export async function breakdownSmsContactAllows(db: D1Database, contactId?: number) {
  if (!contactId) return true;
  const contacts = await getBreakdownSmsContactCoverage(db);
  return Boolean(contacts.find(contact => contact.contactId === Number(contactId))?.allowedNow);
}

async function requireBreakdownContact(db: D1Database, contactId: number, requireActive = false) {
  const row = await db.prepare(`
    SELECT c.id,c.label,c.active
    FROM notification_group_contacts c
    JOIN notification_groups g ON g.id=c.group_id AND g.name=?
    WHERE c.id=? AND c.phone IS NOT NULL AND trim(c.phone)<>''
  `).bind(BREAKDOWN_SMS_GROUP, contactId).first<{ id: number; label: string; active: number }>();
  if (!row) throw new Error('Breakdown text user was not found.');
  if (requireActive && !row.active) throw new Error('Choose an active breakdown person as the vacation backup.');
  return row;
}

export async function saveBreakdownSmsAwayPeriod(
  db: D1Database,
  input: {
    awayId?: number | null;
    contactId: number;
    startDate: string;
    endDate: string;
    backupContactId?: number | null;
    label?: string;
  },
  updatedByUserId: number,
) {
  const contactId = Number(input.contactId);
  if (!Number.isInteger(contactId) || contactId <= 0) throw new Error('Choose a valid breakdown text user.');
  await requireBreakdownContact(db, contactId);

  const startDate = cleanDate(input.startDate);
  const endDate = cleanDate(input.endDate);
  if (startDate > endDate) throw new Error('Vacation end date must be on or after the start date.');

  const backupContactId = input.backupContactId == null || Number(input.backupContactId) <= 0
    ? null
    : Number(input.backupContactId);
  if (backupContactId != null) {
    if (!Number.isInteger(backupContactId) || backupContactId === contactId) {
      throw new Error('Choose a different breakdown person as the vacation backup.');
    }
    await requireBreakdownContact(db, backupContactId, true);
  }

  const awayId = Number(input.awayId || 0);
  const overlap = await db.prepare(`
    SELECT id
    FROM breakdown_sms_contact_away_periods
    WHERE contact_id=? AND active=1
      AND id<>?
      AND start_date<=? AND end_date>=?
    LIMIT 1
  `).bind(contactId, Number.isInteger(awayId) ? awayId : 0, endDate, startDate).first<{ id: number }>();
  if (overlap) throw new Error('This person already has a vacation/away period that overlaps those dates.');

  const label = String(input.label || '').trim().slice(0, 80) || 'Vacation / Away';
  if (Number.isInteger(awayId) && awayId > 0) {
    await db.prepare(`
      UPDATE breakdown_sms_contact_away_periods
      SET start_date=?,end_date=?,backup_contact_id=?,label=?,active=1,
          updated_at=CURRENT_TIMESTAMP,updated_by_user_id=?
      WHERE id=? AND contact_id=?
    `).bind(startDate, endDate, backupContactId, label, updatedByUserId, awayId, contactId).run();
  } else {
    await db.prepare(`
      INSERT INTO breakdown_sms_contact_away_periods(
        contact_id,start_date,end_date,backup_contact_id,label,active,created_at,updated_at,updated_by_user_id
      ) VALUES(?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?)
    `).bind(contactId, startDate, endDate, backupContactId, label, updatedByUserId).run();
  }
}

export async function removeBreakdownSmsAwayPeriod(
  db: D1Database,
  contactIdValue: number,
  awayIdValue: number,
  updatedByUserId: number,
) {
  const contactId = Number(contactIdValue);
  const awayId = Number(awayIdValue);
  if (!Number.isInteger(contactId) || contactId <= 0 || !Number.isInteger(awayId) || awayId <= 0) {
    throw new Error('Choose a valid vacation/away period.');
  }
  await requireBreakdownContact(db, contactId);
  await db.prepare(`
    UPDATE breakdown_sms_contact_away_periods
    SET active=0,updated_at=CURRENT_TIMESTAMP,updated_by_user_id=?
    WHERE id=? AND contact_id=?
  `).bind(updatedByUserId, awayId, contactId).run();
}
