export const YARD_DEFINITIONS = [
  { key: 'clare', label: 'Clare', zoneName: 'Z', warehouseCode: 'CLARE' },
  { key: 'cadillac', label: 'Cadillac', zoneName: 'New cadillac yard', warehouseCode: 'CADILLAC' },
  { key: 'gr', label: 'GR', zoneName: 'G - Byron Center Yard', warehouseCode: 'GR' },
  { key: 'taylor', label: 'Taylor', zoneName: 'T', warehouseCode: 'TAYLOR' },
  { key: 'boyne', label: 'Boyne', zoneName: 'New Boyne Yard', warehouseCode: 'BOYNE' },
] as const;

export type YardKey = typeof YARD_DEFINITIONS[number]['key'];
export type YardSelection = '' | YardKey;

export const YARD_KEYS = YARD_DEFINITIONS.map((yard) => yard.key) as YardKey[];

export function isYardKey(value: unknown): value is YardKey {
  const normalized = String(value ?? '').trim().toLowerCase();
  return YARD_KEYS.some((yard) => yard === normalized);
}

export function normalizeYard(value: unknown): YardSelection {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return '';
  if (isYardKey(normalized)) return normalized;
  if (normalized === 't' || normalized.includes('taylor')) return 'taylor';
  if (normalized === 'g' || normalized.includes('grand rapids') || normalized.includes('byron center')) return 'gr';
  if (normalized.includes('boyne')) return 'boyne';
  if (normalized.includes('cadillac')) return 'cadillac';
  if (normalized.includes('clare')) return 'clare';
  return '';
}

export function yardLabel(value: unknown) {
  const yard = normalizeYard(value);
  return YARD_DEFINITIONS.find((definition) => definition.key === yard)?.label ?? '';
}

export function yardWarehouseCode(value: unknown) {
  const yard = normalizeYard(value);
  return YARD_DEFINITIONS.find((definition) => definition.key === yard)?.warehouseCode ?? '';
}
