import type { Environment, Route } from '@mockoon/commons';
import { normalizePath } from '../core/conflicts.js';

/** Routes in the order the engine registers them: root children first, folders expanded in place. */
export function orderedRoutes(environment: Environment): Route[] {
  const routes = new Map(environment.routes.map((route) => [route.uuid, route]));
  const folders = new Map(environment.folders.map((folder) => [folder.uuid, folder]));
  const out: Route[] = [];
  const seen = new Set<string>();
  const visit = (children: { type: string; uuid: string }[], depth: number): void => {
    for (const child of children) {
      if (child.type === 'route') {
        const route = routes.get(child.uuid);
        if (route && !seen.has(route.uuid)) { seen.add(route.uuid); out.push(route); }
      } else if (depth < 20) visit(folders.get(child.uuid)?.children ?? [], depth + 1);
    }
  };
  visit(environment.rootChildren, 0);
  for (const route of environment.routes) if (!seen.has(route.uuid)) out.push(route);
  return out;
}

const SIMPLE_SEGMENT = /^(?::[A-Za-z_][A-Za-z0-9_]*|[^:*{}()?+\\[\]]+)$/;

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Matches a request path against a route pattern such as `/users/:id`. Only the syntax this tool creates
 * is understood (literal and `:name` segments); engine specific wildcards never match here.
 * Matching is case-insensitive and ignores a trailing slash, like the engine's default router.
 */
export function matchPattern(pattern: string, pathname: string): Record<string, string> | undefined {
  const expected = normalizePath(pattern).split('/').slice(1);
  const actual = normalizePath(pathname).split('/').slice(1);
  if (expected.length !== actual.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < expected.length; i++) {
    const segment = expected[i]!;
    if (segment !== '' && !SIMPLE_SEGMENT.test(segment)) return undefined;
    if (segment.startsWith(':')) {
      if (actual[i] === '') return undefined;
      params[segment.slice(1)] = decode(actual[i]!);
    } else if (decode(segment).toLowerCase() !== decode(actual[i]!).toLowerCase()) return undefined;
  }
  return params;
}

export interface RouteEntry { uuid: string; method: string; pattern: string }

/** Served HTTP routes in engine order, reduced to what request matching needs. */
export function routeEntries(environment: Environment): RouteEntry[] {
  return orderedRoutes(environment)
    .filter((route) => route.type === 'http')
    .map((route) => ({ uuid: route.uuid, method: route.method, pattern: normalizePath(`${environment.endpointPrefix}/${route.endpoint}`) }));
}

export interface RouteMatch { entry: RouteEntry; params: Record<string, string> }

/** First route (engine order) that serves the method and path. */
export function findRoute(entries: RouteEntry[], method: string, pathname: string): RouteMatch | undefined {
  const wanted = method.toLowerCase();
  for (const entry of entries) {
    if (entry.method !== wanted) continue;
    const params = matchPattern(entry.pattern, pathname);
    if (params) return { entry, params };
  }
  return undefined;
}
