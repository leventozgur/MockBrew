import type { Conflict, ProjectModel } from './model.js';

export function normalizePath(path: string): string {
  let p = path.trim().replace(/\/{2,}/g, '/');
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function segments(path: string): string[] {
  return normalizePath(path).split('/').slice(1);
}

const isParam = (segment: string): boolean => segment.startsWith(':');

/** Path with parameter names erased, so /users/:id and /users/:userId are the same route. */
export function pathShape(path: string): string {
  return `/${segments(path).map((s) => (isParam(s) ? ':' : s)).join('/')}`;
}

/** True when every request matched by `later` is already matched by `earlier`. */
function shadows(earlier: string[], later: string[]): boolean {
  if (earlier.length !== later.length) return false;
  return earlier.every((segment, i) => isParam(segment) || segment === later[i]);
}

interface Entry {
  id: string;
  collection: string;
  method: string;
  path: string;
  shape: string;
}

/**
 * Looks for routes that cannot all be reached among the active collections.
 * The engine serves the first matching route, in collection and endpoint order.
 */
export function detectConflicts(model: ProjectModel): Conflict[] {
  const entries: Entry[] = [];
  for (const collection of model.collections) {
    if (!collection.active) continue;
    for (const endpoint of collection.endpoints) {
      if (endpoint.readOnly) continue;
      entries.push({
        id: endpoint.id,
        collection: collection.name,
        method: endpoint.method,
        path: endpoint.path,
        shape: pathShape(endpoint.path),
      });
    }
  }

  const conflicts: Conflict[] = [];
  const duplicateGroups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = `${entry.method} ${entry.shape}`;
    duplicateGroups.set(key, [...(duplicateGroups.get(key) ?? []), entry]);
  }
  for (const group of duplicateGroups.values()) {
    if (group.length < 2) continue;
    const first = group[0] as Entry;
    conflicts.push({
      kind: 'duplicate',
      severity: 'error',
      method: first.method as Conflict['method'],
      path: first.path,
      endpointIds: group.map((e) => e.id),
      message: `${first.method} ${first.path} is defined more than once: ${group.map((e) => `${e.collection} (${e.path})`).join(', ')}.`,
    });
  }

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i] as Entry;
      const b = entries[j] as Entry;
      if (a.method !== b.method || a.shape === b.shape) continue;
      if (shadows(segments(a.path), segments(b.path))) {
        conflicts.push({
          kind: 'shadowed',
          severity: 'warning',
          method: b.method as Conflict['method'],
          path: b.path,
          endpointIds: [a.id, b.id],
          message: `${b.method} ${b.path} (${b.collection}) is shadowed by ${a.path} (${a.collection}), which is matched first. Move the specific route above the parameterized one.`,
        });
      }
    }
  }
  return conflicts;
}

export function errorConflicts(conflicts: Conflict[]): Conflict[] {
  return conflicts.filter((c) => c.severity === 'error');
}

/** Error-level conflicts that are not already present in `before`. */
export function newErrorConflicts(before: Conflict[], after: Conflict[]): Conflict[] {
  const known = new Set(errorConflicts(before).map((c) => `${c.kind}:${c.method}:${pathShape(c.path)}`));
  return errorConflicts(after).filter((c) => !known.has(`${c.kind}:${c.method}:${pathShape(c.path)}`));
}
