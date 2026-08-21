export const TRUCK_TIRE_AXLES = [
  {
    axle: 1,
    label: 'Axle 1 · Steer',
    positions: [
      { code: 'A1L', label: 'Left' },
      { code: 'A1R', label: 'Right' },
    ],
  },
  {
    axle: 2,
    label: 'Axle 2 · Drive',
    positions: [
      { code: 'A2LO', label: 'Left Outer' },
      { code: 'A2LI', label: 'Left Inner' },
      { code: 'A2RI', label: 'Right Inner' },
      { code: 'A2RO', label: 'Right Outer' },
    ],
  },
  {
    axle: 3,
    label: 'Axle 3 · Drive',
    positions: [
      { code: 'A3LO', label: 'Left Outer' },
      { code: 'A3LI', label: 'Left Inner' },
      { code: 'A3RI', label: 'Right Inner' },
      { code: 'A3RO', label: 'Right Outer' },
    ],
  },
];

export const TRAILER_TIRE_AXLES = [
  {
    axle: 1,
    label: 'Axle 1',
    positions: [
      { code: 'A1LO', label: 'Left Outer' },
      { code: 'A1LI', label: 'Left Inner' },
      { code: 'A1RI', label: 'Right Inner' },
      { code: 'A1RO', label: 'Right Outer' },
    ],
  },
  {
    axle: 2,
    label: 'Axle 2',
    positions: [
      { code: 'A2LO', label: 'Left Outer' },
      { code: 'A2LI', label: 'Left Inner' },
      { code: 'A2RI', label: 'Right Inner' },
      { code: 'A2RO', label: 'Right Outer' },
    ],
  },
];

const TIRE_WORD = /\b(tire|tires|tyre|tyres|flat|blowout|blown|sidewall|tread|recap)\b/i;

export function tireAxlesForEquipment(equipmentType) {
  const normalized = String(equipmentType ?? '').trim().toLowerCase();
  if (normalized === 'truck') return TRUCK_TIRE_AXLES;
  if (normalized === 'trailer') return TRAILER_TIRE_AXLES;
  return [];
}

export function tireRepairRequired({ title = '', description = '', equipmentType = '' } = {}) {
  return tireAxlesForEquipment(equipmentType).length > 0
    && TIRE_WORD.test(`${String(title)} ${String(description)}`);
}

export function allowedTirePositionCodes(equipmentType) {
  return tireAxlesForEquipment(equipmentType).flatMap((axle) => axle.positions.map((position) => position.code));
}

export function normalizeTirePositions(rawPositions, equipmentType) {
  const allowed = new Set(allowedTirePositionCodes(equipmentType));
  const input = Array.isArray(rawPositions) ? rawPositions : [];
  const positions = [...new Set(input.map((value) => String(value ?? '').trim().toUpperCase()).filter(Boolean))];
  const invalid = positions.filter((position) => !allowed.has(position));
  return { positions, invalid, allowed: [...allowed] };
}
