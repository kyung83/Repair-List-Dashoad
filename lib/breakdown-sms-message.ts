import { renderBreakdownSmsTemplate } from '@/lib/twilio-runtime';

type BreakdownSmsRow = {
  id: number;
  driver_name: string;
  driver_phone: string | null;
  city: string;
  state: string;
  repair_category: string;
  description: string;
  created_at: string;
  unit: string;
  equipment_type: string;
};

function easternTimestamp(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Detroit',
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}

function ensureDriverPhone(message: string, driverName: string, driverPhone: string) {
  const text = String(message || '').trim();
  const phone = String(driverPhone || '').trim();
  if (!text || !phone) return text;

  const phoneDigits = phone.replace(/\D/g, '');
  if (phoneDigits && text.replace(/\D/g, '').includes(phoneDigits)) return text;

  const phoneLine = `Driver Phone: ${phone}`;
  const driverLine = new RegExp(`^Driver:\\s*${driverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi');
  if (driverLine.test(text)) return text.replace(driverLine, match => `${match}\n${phoneLine}`);

  const replyIndex = text.search(/^Reply\b/mi);
  if (replyIndex >= 0) return `${text.slice(0, replyIndex).trimEnd()}\n${phoneLine}\n\n${text.slice(replyIndex).trimStart()}`;
  return `${text}\n${phoneLine}`;
}

export async function buildNewBreakdownSms(db: D1Database, breakdownId: number, fallback: string) {
  const breakdown = await db.prepare(`
    SELECT b.id,b.driver_name,b.driver_phone,b.city,b.state,b.repair_category,b.description,b.created_at,
           e.unit,e.equipment_type
    FROM roadside_breakdowns b
    JOIN equipment e ON e.id=b.equipment_id
    WHERE b.id=?
  `).bind(breakdownId).first<BreakdownSmsRow>();
  if (!breakdown) return fallback;

  const tires = await db.prepare(`
    SELECT position_code,tire_size
    FROM roadside_breakdown_tires
    WHERE breakdown_id=?
    ORDER BY id
  `).bind(breakdownId).all<{ position_code: string; tire_size: string }>().catch(() => ({ results: [] as { position_code: string; tire_size: string }[] }));
  const tireLine = tires.results.length
    ? `Tires: ${tires.results.map(row => `${row.position_code} - ${row.tire_size}`).join(', ')}\n`
    : '';
  const driverPhone = String(breakdown.driver_phone || '').trim();

  const rendered = await renderBreakdownSmsTemplate(db, 'new_breakdown', {
    breakdown_id: breakdown.id,
    submitted_at: easternTimestamp(breakdown.created_at),
    driver_name: breakdown.driver_name,
    driver_phone: driverPhone,
    driver_phone_line: driverPhone ? `Driver Phone: ${driverPhone}\n` : '',
    unit_label: breakdown.equipment_type === 'trailer' ? 'Trailer' : 'Truck',
    unit: breakdown.unit,
    city: breakdown.city,
    state: breakdown.state,
    category: breakdown.repair_category,
    tire_line: tireLine,
    description: breakdown.description,
  }, fallback);

  return ensureDriverPhone(rendered, breakdown.driver_name, driverPhone);
}
