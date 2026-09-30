import { tireAxlesForEquipment } from './tire-position-rules.js';

export function normalizeEquipmentFilter(value) {
  const type = String(value ?? '').trim().toLowerCase();
  if (type && type !== 'truck' && type !== 'trailer') {
    throw new RangeError('Choose All equipment, Trucks, or Trailers.');
  }
  return type;
}

export function breakdownTirePositionOptions(equipmentType = '') {
  const selectedType = normalizeEquipmentFilter(equipmentType);
  return (selectedType ? [selectedType] : ['truck', 'trailer']).flatMap((type) =>
    tireAxlesForEquipment(type).flatMap((axle) => axle.positions.map((position) => ({
      value: `${type}:${position.code}`,
      equipmentType: type,
      positionCode: position.code,
      label: `${type === 'truck' ? 'Truck' : 'Trailer'} - ${axle.label} - ${position.label} (${position.code})`,
    }))),
  );
}

// A2RO, for example, means a different axle on a truck than on a trailer.
// Keep equipment type in every position filter, even when All equipment is selected.
export function normalizeTirePositionFilter(value, equipmentType = '') {
  const input = String(value ?? '').trim();
  if (!input) return null;
  const [rawType, rawCode, extra] = input.split(':');
  const canonical = `${String(rawType).toLowerCase()}:${String(rawCode ?? '').toUpperCase()}`;
  const option = !extra && breakdownTirePositionOptions(equipmentType).find((item) => item.value === canonical);
  if (!option) throw new RangeError('Choose a valid tire position for the selected equipment type.');
  return option;
}

export function changeBreakdownEquipmentFilter(filters, value, equipment) {
  const equipmentType = normalizeEquipmentFilter(value);
  const options = breakdownTirePositionOptions(equipmentType);
  const tirePosition = options.some((item) => item.value === filters.tirePosition) ? filters.tirePosition : '';
  const currentUnit = equipment.find((item) => String(item.id) === String(filters.unit));
  const unit = equipmentType && String(currentUnit?.equipmentType ?? '').trim().toLowerCase() !== equipmentType ? '' : filters.unit;
  return { ...filters, equipmentType, tirePosition, unit };
}

export function breakdownEquipmentLabel(value) {
  const type = String(value ?? '').trim().toLowerCase();
  if (type === 'truck') return 'Truck';
  if (type === 'trailer') return 'Trailer';
  return type || 'Not recorded';
}

export function parseBreakdownTireDetails(raw, equipmentType) {
  let rows;
  try { rows = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return []; }
  if (!Array.isArray(rows)) return [];
  const type = String(equipmentType ?? '').trim().toLowerCase();
  const options = type === 'truck' || type === 'trailer' ? breakdownTirePositionOptions(type) : [];
  return rows.filter((row) => row && typeof row === 'object' && String(row.positionCode ?? '').trim()).map((row) => {
    const positionCode = String(row.positionCode).trim().toUpperCase();
    const option = options.find((item) => item.positionCode === positionCode);
    return {
      positionCode,
      tireSize: String(row.tireSize ?? '').trim(),
      label: option?.label ?? `Recorded position ${positionCode}`,
    };
  }).sort((a, b) => a.positionCode.localeCompare(b.positionCode, undefined, { numeric: true }));
}

export function breakdownTireDetailsText(details) {
  return details.length ? details.map((item) => `${item.label}${item.tireSize ? ` - ${item.tireSize}` : ' - size not recorded'}`).join('; ') : 'Not recorded';
}
