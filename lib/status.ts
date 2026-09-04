export const REPAIR_STATUS = {
  NEW: 'New',
  ASSIGNED: 'Assigned',
  WAITING_FOR_PARTS: 'Waiting for Parts',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
} as const;

export type RepairStatus = typeof REPAIR_STATUS[keyof typeof REPAIR_STATUS];

export const BREAKDOWN_STAGE = {
  REPORTED: 1,
  DIAGNOSTICS: 2,
  EN_ROUTE: 3,
  ON_LOCATION: 4,
  COMPLETE: 5,
} as const;

export const BREAKDOWN_STATUS = {
  REPORTED: 'reported',
  DIAGNOSTICS: 'diagnostics',
  EN_ROUTE: 'en_route',
  ON_LOCATION: 'on_location',
  READY_FOR_REVIEW: 'ready_for_review',
  COMPLETE: 'complete',
  NOT_BREAKDOWN: 'not_breakdown',
} as const;

function normalized(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isRepairCompleted(value: unknown) {
  const status = normalized(value);
  return /(^|[\s_-])completed?($|[\s_-])/.test(status);
}

export function isRepairDeferred(value: unknown) {
  return normalized(value).startsWith('deferred to next');
}

export function isRepairWaitingForParts(value: unknown) {
  const status = normalized(value);
  return status.includes('waiting for part') || status.includes('waiting on part');
}

export function isRepairInProgress(value: unknown) {
  return normalized(value).includes('in progress');
}

export function isRepairAssigned(value: unknown) {
  return normalized(value) === 'assigned';
}

export function canonicalRepairStatus(value: unknown): string {
  const status = normalized(value);
  if (!status) return REPAIR_STATUS.NEW;
  if (status === 'complete' || status === 'completed') return REPAIR_STATUS.COMPLETED;
  if (status === 'new' || status === 'open') return REPAIR_STATUS.NEW;
  if (status === 'assigned' || status === 'accepted') return REPAIR_STATUS.ASSIGNED;
  if (status === 'in progress' || status === 'in_progress') return REPAIR_STATUS.IN_PROGRESS;
  if (status === 'waiting for parts' || status === 'waiting on part' || status === 'waiting on parts') return REPAIR_STATUS.WAITING_FOR_PARTS;
  return String(value ?? '').trim();
}

export function isBreakdownComplete(stage: unknown, status: unknown) {
  return Number(stage) >= BREAKDOWN_STAGE.COMPLETE || normalized(status) === BREAKDOWN_STATUS.COMPLETE;
}
