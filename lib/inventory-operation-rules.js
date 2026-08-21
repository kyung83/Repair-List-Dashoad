export const INVENTORY_EPSILON = 0.000001;

export function cleanVendorDisplayName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeVendorName(value) {
  return cleanVendorDisplayName(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\blimited liability company\b/g, ' llc ')
    .replace(/\bincorporated\b/g, ' inc ')
    .replace(/\bcorporation\b/g, ' corp ')
    .replace(/\bcompany\b/g, ' co ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeWarehouseCode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

export function finitePositive(value, maximum = Number.POSITIVE_INFINITY) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > maximum) return null;
  return number;
}

export function finiteNonNegative(value, maximum = Number.POSITIVE_INFINITY) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > maximum) return null;
  return number;
}

export function derivedReservationQueue(physicalQuantity, requests) {
  let remaining = Math.max(0, Number(physicalQuantity) || 0);
  return [...requests]
    .map((request) => ({
      ...request,
      requestedQuantity: Math.max(0, Number(request.requestedQuantity ?? request.requested_quantity) || 0),
      usedQuantity: Math.max(0, Number(request.usedQuantity ?? request.used_quantity) || 0),
      id: Number(request.id) || 0,
      createdAt: String(request.createdAt ?? request.created_at ?? ''),
    }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id - right.id)
    .map((request) => {
      const need = Math.max(0, request.requestedQuantity - request.usedQuantity);
      const reservedQuantity = Math.min(need, remaining);
      remaining = Math.max(0, remaining - reservedQuantity);
      return { ...request, need, reservedQuantity, shortageQuantity: Math.max(0, need - reservedQuantity) };
    });
}

export function derivedReservationForRequest(physicalQuantity, requests, requestId) {
  return derivedReservationQueue(physicalQuantity, requests).find((request) => Number(request.id) === Number(requestId)) ?? null;
}

export function physicalCountDecision({ expectedVersion, currentVersion, systemQuantity, countedQuantity }) {
  const expected = Number(expectedVersion);
  const current = Number(currentVersion);
  const system = Number(systemQuantity);
  const counted = Number(countedQuantity);
  if (!Number.isInteger(expected) || !Number.isInteger(current) || expected < 0 || current < 0) {
    return { ok: false, stale: true, discrepancy: false, difference: 0 };
  }
  if (!Number.isFinite(system) || !Number.isFinite(counted) || counted < 0) {
    return { ok: false, stale: false, discrepancy: false, difference: 0 };
  }
  if (expected !== current) return { ok: false, stale: true, discrepancy: false, difference: counted - system };
  const difference = Math.round((counted - system) * 1000000) / 1000000;
  return {
    ok: true,
    stale: false,
    discrepancy: Math.abs(difference) > INVENTORY_EPSILON,
    difference,
  };
}

export function canUndoInventoryOperation({ status, activeDependentCount }) {
  if (String(status) !== 'applied') return { ok: false, reason: 'Operation is not currently applied.' };
  if (Number(activeDependentCount) > 0) return { ok: false, reason: 'Undo newer dependent inventory operations first.' };
  return { ok: true, reason: '' };
}

export function requiredObligations({ coreRequired, usedTireRecoveryRequired, quantity }) {
  const qty = finitePositive(quantity, 1000000);
  if (!qty) return [];
  const obligations = [];
  if (Boolean(coreRequired)) obligations.push({ type: 'core_return', quantity: qty });
  if (Boolean(usedTireRecoveryRequired)) obligations.push({ type: 'used_tire_recovery', quantity: qty });
  return obligations;
}

export function canonicalizeOperationPayload(value) {
  if (Array.isArray(value)) return value.map(canonicalizeOperationPayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeOperationPayload(entry)]),
    );
  }
  if (typeof value === 'number' && Object.is(value, -0)) return 0;
  return value;
}

export function operationPayloadText(value) {
  return JSON.stringify(canonicalizeOperationPayload(value));
}

export function normalizeIdempotencyKey(value) {
  const key = String(value ?? '').trim();
  if (!key) return '';
  if (key.length > 180) return key.slice(0, 180);
  return key;
}

export function isInventoryOperationType(value) {
  return [
    'apply_part', 'repair_part_correction', 'repair_part_remove', 'receive_stock',
    'return_stock', 'transfer_stock', 'count_adjustment', 'obligation_recovery', 'undo',
  ].includes(String(value));
}
