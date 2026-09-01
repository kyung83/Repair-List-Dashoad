export const TRUCK_BREAKDOWN_POSITION_AXLES = [
  { axle: 1, label: 'Axle 1 · Steer', positions: [{ code: 'A1L', label: 'Left' }, { code: 'A1R', label: 'Right' }] },
  { axle: 2, label: 'Axle 2 · Drive', positions: [{ code: 'A2L', label: 'Left' }, { code: 'A2R', label: 'Right' }] },
  { axle: 3, label: 'Axle 3 · Drive', positions: [{ code: 'A3L', label: 'Left' }, { code: 'A3R', label: 'Right' }] },
];

export const TRAILER_BREAKDOWN_POSITION_AXLES = [
  { axle: 1, label: 'Axle 1', positions: [{ code: 'A1L', label: 'Left' }, { code: 'A1R', label: 'Right' }] },
  { axle: 2, label: 'Axle 2', positions: [{ code: 'A2L', label: 'Left' }, { code: 'A2R', label: 'Right' }] },
];

export function breakdownPositionAxlesForEquipment(equipmentType) {
  const normalized = String(equipmentType ?? '').trim().toLowerCase();
  if (normalized === 'truck') return TRUCK_BREAKDOWN_POSITION_AXLES;
  if (normalized === 'trailer') return TRAILER_BREAKDOWN_POSITION_AXLES;
  return [];
}

export function allowedBreakdownPositionCodes(equipmentType) {
  return breakdownPositionAxlesForEquipment(equipmentType)
    .flatMap((axle) => axle.positions.map((position) => position.code));
}

export function normalizeBreakdownPositions(rawPositions, equipmentType) {
  const allowed = new Set(allowedBreakdownPositionCodes(equipmentType));
  const input = Array.isArray(rawPositions) ? rawPositions : [];
  const positions = [...new Set(input.map((value) => String(value ?? '').trim().toUpperCase()).filter(Boolean))];
  const invalid = positions.filter((position) => !allowed.has(position));
  return { positions, invalid, allowed: [...allowed] };
}
