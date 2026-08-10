type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function get(source: JsonRecord, ...names: string[]) {
  for (const name of names) if (name in source) return source[name];
  return undefined;
}

function refId(value: unknown) {
  if (typeof value === 'string') return value.trim();
  const source = record(value);
  return text(get(source, 'id', 'Id')).trim();
}

function refs(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function hasTrailerLabel(value: unknown) {
  const normalized = text(value).trim().toLowerCase();
  return /(^|[^a-z0-9])trailers?([^a-z0-9]|$)/.test(normalized);
}

export function buildTrailerGroupIds(groupValues: unknown[]) {
  const groups = groupValues.map(record);
  const childrenById = new Map<string, Set<string>>();
  const trailerGroupIds = new Set<string>();

  function addChild(parentId: string, childId: string) {
    if (!parentId || !childId) return;
    const children = childrenById.get(parentId) ?? new Set<string>();
    children.add(childId);
    childrenById.set(parentId, children);
  }

  for (const group of groups) {
    const id = refId(group);
    if (!id) continue;

    const name = get(group, 'name', 'Name');
    const reference = get(group, 'reference', 'Reference');
    if (hasTrailerLabel(name) || hasTrailerLabel(reference)) trailerGroupIds.add(id);

    for (const child of refs(get(group, 'children', 'Children'))) {
      addChild(id, refId(child));
    }

    const parentId = refId(get(group, 'parent', 'Parent'));
    if (parentId) addChild(parentId, id);
  }

  const queue = [...trailerGroupIds];
  while (queue.length) {
    const parentId = queue.shift()!;
    for (const childId of childrenById.get(parentId) ?? []) {
      if (trailerGroupIds.has(childId)) continue;
      trailerGroupIds.add(childId);
      queue.push(childId);
    }
  }

  return trailerGroupIds;
}

export function entityBelongsToTrailerGroup(value: unknown, trailerGroupIds: Set<string>) {
  if (!trailerGroupIds.size) return false;
  const source = record(value);
  const memberships = [
    ...refs(get(source, 'groups', 'Groups')),
    ...refs(get(source, 'autoGroups', 'AutoGroups')),
  ];
  return memberships.some((membership) => trailerGroupIds.has(refId(membership)));
}
