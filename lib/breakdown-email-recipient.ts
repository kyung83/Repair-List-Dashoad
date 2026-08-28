export const DEFAULT_BREAKDOWN_EMAIL_RECIPIENT = 'breakdown@norloworld.com';
const BREAKDOWN_GROUP = 'Breakdown Alerts';
const BREAKDOWN_EMAIL_LABEL = 'Roadside Breakdown Mailbox';

type RecipientRow = {
  id: number;
  email: string | null;
};

function normalizeEmail(value: string) {
  return String(value || '').trim().toLowerCase();
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function groupId(db: D1Database) {
  const group = await db.prepare(`SELECT id FROM notification_groups WHERE name=?`).bind(BREAKDOWN_GROUP).first<{ id: number }>();
  if (!group) throw new Error('Breakdown Alerts notification group is missing.');
  return Number(group.id);
}

async function recipientRow(db: D1Database) {
  const id = await groupId(db);
  return db.prepare(`
    SELECT id,email
    FROM notification_group_contacts
    WHERE group_id=?
      AND (
        label=?
        OR lower(trim(COALESCE(email,'')))=lower(?)
      )
    ORDER BY CASE WHEN label=? THEN 0 ELSE 1 END,id
    LIMIT 1
  `).bind(id, BREAKDOWN_EMAIL_LABEL, DEFAULT_BREAKDOWN_EMAIL_RECIPIENT, BREAKDOWN_EMAIL_LABEL).first<RecipientRow>();
}

export async function getBreakdownEmailRecipient(db: D1Database) {
  const row = await recipientRow(db);
  const email = normalizeEmail(row?.email || '');
  return email || DEFAULT_BREAKDOWN_EMAIL_RECIPIENT;
}

export async function saveBreakdownEmailRecipient(db: D1Database, value: string) {
  const email = normalizeEmail(value);
  if (!email || email.length > 320 || !validEmail(email)) throw new Error('Enter a valid breakdown email address.');

  const id = await groupId(db);
  const existing = await recipientRow(db);
  if (existing) {
    await db.prepare(`
      UPDATE notification_group_contacts
      SET label=?,email=?,active=1
      WHERE id=? AND group_id=?
    `).bind(BREAKDOWN_EMAIL_LABEL, email, existing.id, id).run();
  } else {
    await db.prepare(`
      INSERT INTO notification_group_contacts(group_id,label,phone,email,active)
      VALUES(?,?,NULL,?,1)
    `).bind(id, BREAKDOWN_EMAIL_LABEL, email).run();
  }
  return email;
}
