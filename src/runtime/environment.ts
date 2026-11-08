import {
  BodyTypes,
  type Header,
  BuildHTTPRoute,
  BuildRouteResponse,
  type Environment,
  type Route,
  addRouteMutator,
  removeRouteMutator,
} from '@mockoon/commons';
import type { ProjectDocument } from '../store/document.js';

export interface RuntimeOverrides {
  port?: number;
  host?: string;
}

export interface RuntimeEnvironment {
  environment: Environment;
  /** Routes that answer requests nothing else matched. */
  catchAllIds: Set<string>;
  /** Scenario names by route response uuid, for request logs. */
  scenarioNames: Map<string, string>;
  /** Number of served routes (without the catch-alls). */
  routeCount: number;
  /** What safe mode switched off for this project; empty when templating is allowed or nothing was affected. */
  safeModeNotes: string[];
}

const UNSAFE_RULE_TARGETS = new Set(['templating', 'data_bucket', 'global_var']);
const OWN_REFLECT_HEADER = { key: 'access-control-allow-origin', value: "{{header 'Origin'}}" };

const neutralize = (value: string): string => value.replace(/\{\{/g, '\\{{');

function neutralizeHeaders(headers: Header[], keepOwnReflect = false): number {
  let changed = 0;
  for (const header of headers) {
    if (!header.value.includes('{{')) continue;
    if (keepOwnReflect && header.key.toLowerCase() === OWN_REFLECT_HEADER.key && header.value === OWN_REFLECT_HEADER.value) continue;
    header.value = neutralize(header.value);
    changed++;
  }
  return changed;
}

/**
 * Shared Mockoon files must not execute helper code (templating, data buckets, callbacks). Unless the project
 * allows it, those features are switched off for the running server and the file itself stays untouched.
 */
function applySafeMode(source: Environment): { environment: Environment; notes: string[] } {
  let environment = source;
  const notes: string[] = [];

  const foreign = environment.routes.filter((r) => r.type !== 'http');
  for (const route of foreign) environment = removeRouteMutator(environment, route.uuid);
  if (foreign.length > 0) notes.push(`${foreign.length} CRUD/WebSocket route(s) are not served`);

  if (environment.data.length > 0) notes.push(`${environment.data.length} data bucket(s) are ignored`);
  environment.data = [];
  if (environment.callbacks.length > 0) notes.push(`${environment.callbacks.length} callback(s) are ignored`);
  environment.callbacks = [];

  let templated = 0;
  let bucketBodies = 0;
  let droppedRules = 0;
  let headers = neutralizeHeaders(environment.headers, true) + neutralizeHeaders(environment.proxyReqHeaders) + neutralizeHeaders(environment.proxyResHeaders);
  for (const route of environment.routes) {
    for (const response of route.responses) {
      if (!response.disableTemplating && response.body.includes('{{')) templated++;
      response.disableTemplating = true;
      response.callbacks = [];
      headers += neutralizeHeaders(response.headers);
      const kept = response.rules.filter((r) => !UNSAFE_RULE_TARGETS.has(r.target));
      droppedRules += response.rules.length - kept.length;
      response.rules = kept;
      if (response.bodyType === BodyTypes.DATABUCKET) {
        bucketBodies++;
        response.bodyType = BodyTypes.INLINE;
        response.statusCode = 501;
        response.headers = [{ key: 'Content-Type', value: 'application/json; charset=utf-8' }];
        response.body = JSON.stringify({ error: 'templating_disabled', message: 'This response uses a Mockoon data bucket. Allow templating in the project settings to serve it.' });
      }
    }
  }
  if (templated > 0) notes.push(`templating is off in ${templated} response(s); their text is served as written`);
  if (headers > 0) notes.push(`${headers} header value(s) contain template syntax that is served as written`);
  if (bucketBodies > 0) notes.push(`${bucketBodies} response(s) use data buckets and answer 501`);
  if (droppedRules > 0) notes.push(`${droppedRules} response rule(s) using templating or data are ignored`);
  return { environment, notes };
}

const CATCH_ALL_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head'] as const;
const CATCH_ALL_BODY = JSON.stringify({
  error: 'no_mock_matched',
  message: 'No active mock matches this request. Check the method, the path and which collections are active.',
  method: '{{method}}',
});

function catchAllRoute(method: (typeof CATCH_ALL_METHODS)[number]): Route {
  const route = BuildHTTPRoute(false);
  route.method = method;
  route.endpoint = '{*splat}';
  route.documentation = 'Unmatched requests';
  const response = BuildRouteResponse();
  response.statusCode = 404;
  response.label = 'No mock matched';
  response.body = CATCH_ALL_BODY;
  response.bodyType = BodyTypes.INLINE;
  response.headers = [{ key: 'Content-Type', value: 'application/json; charset=utf-8' }];
  response.disableTemplating = false;
  response.default = true;
  route.responses = [response];
  return route;
}

/**
 * Derives the environment the engine serves: routes of inactive collections are left out, the listener
 * address can be overridden without touching the file, and unmatched requests get a JSON 404.
 * The catch-alls exclude OPTIONS so CORS preflight handling keeps working.
 */
export function buildRuntimeEnvironment(document: ProjectDocument, overrides: RuntimeOverrides = {}): RuntimeEnvironment {
  let environment = structuredClone(document.environment);
  for (const collection of document.snapshot().collections) {
    if (collection.active) continue;
    for (const endpoint of collection.endpoints) environment = removeRouteMutator(environment, endpoint.id);
  }
  let safeModeNotes: string[] = [];
  if (!document.studio.settings.allowTemplating) {
    const safe = applySafeMode(environment);
    environment = safe.environment;
    safeModeNotes = safe.notes;
  }
  if (overrides.port !== undefined) environment.port = overrides.port;
  if (overrides.host !== undefined) environment.hostname = overrides.host;

  const routeCount = environment.routes.length;
  const catchAllIds = new Set<string>();
  if (!environment.proxyMode && environment.endpointPrefix === '') {
    for (const method of CATCH_ALL_METHODS) {
      const route = catchAllRoute(method);
      catchAllIds.add(route.uuid);
      environment = addRouteMutator(environment, route, 'root');
    }
  }

  const scenarioNames = new Map<string, string>();
  for (const route of environment.routes) {
    for (const response of route.responses) scenarioNames.set(response.uuid, response.label);
  }
  return { environment, catchAllIds, scenarioNames, routeCount, safeModeNotes };
}
