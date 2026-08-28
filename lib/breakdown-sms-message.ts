import { renderBreakdownSmsTemplate } from '@/lib/twilio-runtime';

type BreakdownSmsRow = {
  id: number;
  driver_name: string;
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

export async function buildNewBreakdownSms(db: D1Database, breakdownId: number, fallback: string) {
  const breakdown = await db.prepare(`
    SELECT b.id,b.driver_name,b.city,b.state,b.repair_category,b.description,b.created_at,
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

  return renderBreakdownSmsTemplate(db, 'new_breakdown', {
    breakdown_id: breakdown.id,
    submitted_at: easternTimestamp(breakdown.created_at),
    driver_name: breakdown.driver_name,
    unit_label: breakdown.equipment_type === 'trailer' ? 'Trailer' : 'Truck',
    unit: breakdown.unit,
    city: breakdown.city,
    state: breakdown.state,
    category: breakdown.repair_category,
    tire_line: tireLine,
    description: breakdown.description,
  }, fallback);
}
