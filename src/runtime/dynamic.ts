import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';
import type { Header } from '../core/model.js';
import { openResponseFile, resolveResponseFile } from '../core/safe-path.js';
import type { MultipartLog, RequestLog } from '../core/view.js';
import { validateBody } from '../schema/index.js';
import { type DirectScenario, REQUEST_ID_HEADER, RESPONSE_HEADER, type RuntimeEnvironment } from './environment.js';
import type { BufferedEngineResponse, FrontContext, FrontHooks, FrontResponse } from './front.js';
import { MultipartInspector, multipartBoundary } from './multipart.js';
import { findRoute, matchPattern } from './routes.js';
import { type TokenContext, expandTokens } from './tokens.js';

/** Request and response bodies of dynamic scenarios are buffered up to this size. */
export const MAX_DYNAMIC_BYTES = 5 * 1024 * 1024;
const MAX_FILE_RESPONSE_BUFFER = 1024 * 1024;
const MAX_PENDING = 2000;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const HOP_HEADERS = new Set(['content-length', 'transfer-encoding', 'connection', 'keep-alive', RESPONSE_HEADER]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const TEXT_TYPE = /^\s*(?:text\/|application\/(?:json|xml|x-www-form-urlencoded|[\w.+-]*\+(?:json|xml)))/i;

const DEFAULT_INVALID: DirectScenario = {
  name: 'Invalid request (422)',
  status: 422,
  headers: [{ key: 'Content-Type', value: 'application/json; charset=utf-8' }],
  body: '{"errors": {{json validation.errors}}}',
  latencyMs: 0,
  dynamic: true,
};

/** Metadata the engine log entry cannot know; collected here and merged when the engine reports the request. */
export interface RequestExtras {
  multipart?: MultipartLog;
  requestValidation?: RequestLog['requestValidation'];
}

export interface DirectLog {
  method: string;
  url: string;
  status: number;
  requestHeaders: IncomingHttpHeaders;
  responseHeaders: Header[];
  requestBody?: Buffer;
  responseBody?: string;
  routeId: string;
  scenario: string;
  extras: RequestExtras;
}

export interface DynamicDeps {
  current(): RuntimeEnvironment | undefined;
  projectDir: string;
  root(): string;
  recordDirect(entry: DirectLog): void;
  warn(message: string): void;
}

function nullObject(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

function parseQuery(url: URL): Record<string, unknown> {
  const out = nullObject();
  for (const [key, value] of url.searchParams) {
    const previous = out[key];
    out[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return out;
}

function parseBody(body: Buffer | undefined, contentType: string | undefined): unknown {
  if (!body || body.length === 0) return undefined;
  const text = body.toString('utf8');
  if (/json/i.test(contentType ?? '') || /^\s*[[{]/.test(text)) {
    try { return JSON.parse(text); } catch { return undefined; }
  }
  if (/x-www-form-urlencoded/i.test(contentType ?? '')) return parseQuery(new URL(`http://localhost/?${text}`));
  return undefined;
}

/** Header values must stay on one line and within Latin-1, whatever the request contained. */
function safeHeaderValue(value: string): string {
  return value.replace(/[^\t\x20-\x7e\x80-\xff]/g, '');
}

function parsePrivate(env: RuntimeEnvironment, raw: string | string[] | undefined): { routeId: string; responseId: string } | undefined {
  if (typeof raw !== 'string') return undefined;
  let rest = raw;
  if (env.responseKey) {
    if (!rest.startsWith(`${env.responseKey}:`)) return undefined;
    rest = rest.slice(env.responseKey.length + 1);
  }
  const colon = rest.indexOf(':');
  return colon > 0 ? { routeId: rest.slice(0, colon), responseId: rest.slice(colon + 1) } : undefined;
}

/**
 * Features built on the front layer. Everything here works on already-selected engine responses or on raw
 * requests; no user content is ever handed to the engine's template parser.
 */
export class DynamicLayer {
  private nextId = 1;
  private readonly pending = new Map<number, RequestExtras>();

  constructor(private readonly deps: DynamicDeps) {}

  /** Removes and returns the metadata registered for a forwarded request. */
  take(id: string | undefined): RequestExtras | undefined {
    const key = id === undefined ? NaN : Number(id);
    const extras = this.pending.get(key);
    this.pending.delete(key);
    return extras;
  }

  readonly hooks: FrontHooks = {
    onRequest: (ctx) => this.onRequest(ctx),
    bufferLimit: (_ctx, headers) => this.bufferLimit(headers),
    onBypass: (_ctx, headers, reason) => this.onBypass(headers, reason),
    onResponse: (ctx, response) => this.onResponse(ctx, response),
  };

  private bufferLimit(headers: IncomingHttpHeaders): number {
    const env = this.deps.current();
    const found = env && parsePrivate(env, headers[RESPONSE_HEADER]);
    const meta = found && env.scenarioMeta.get(found.responseId);
    if (!meta) return 0;
    return meta.bodyFile ? MAX_FILE_RESPONSE_BUFFER : meta.dynamic ? MAX_DYNAMIC_BYTES : 0;
  }

  private onBypass(headers: IncomingHttpHeaders, reason: 'too-large' | 'unknown-length'): void {
    const env = this.deps.current();
    const found = env && parsePrivate(env, headers[RESPONSE_HEADER]);
    const meta = found && env.scenarioMeta.get(found.responseId);
    if (meta?.dynamic) this.deps.warn(`Scenario "${meta.name}" was served without filling in tokens: ${reason === 'too-large' ? 'the response is larger than 5 MB' : 'the response length is unknown'}.`);
  }

  // ---------------------------------------------------------------- requests

  private async onRequest(ctx: FrontContext): Promise<FrontResponse | undefined> {
    const env = this.deps.current();
    if (!env) return undefined;
    const req = ctx.request;
    const method = (req.method ?? 'GET').toUpperCase();
    let url: URL;
    try { url = new URL(req.url ?? '/', 'http://localhost'); } catch { return undefined; }
    const extras: RequestExtras = {};
    const boundary = multipartBoundary(req.headers['content-type']);
    if (boundary) {
      const inspector = new MultipartInspector(boundary);
      ctx.tap = { chunk: (data) => inspector.write(data), end: () => { extras.multipart = inspector.end(); } };
    }
    const match = findRoute(env.routes, method, url.pathname);
    const meta = match && env.routeMeta.get(match.entry.uuid);
    if (match && meta) {
      const validating = meta.requestModel !== undefined && WRITE_METHODS.has(method);
      if (validating || meta.hasDynamic) {
        let read: { body: Buffer; complete: boolean };
        try { read = await ctx.readBody(MAX_DYNAMIC_BYTES); } catch { return undefined; }
        ctx.state.body = read.complete ? read.body : undefined;
        if (validating && meta.requestModel) {
          const result = read.complete
            ? validateBody(meta.requestModel.schema, read.body.toString('utf8'))
            : { valid: false, errors: [{ path: '$', message: 'request body is larger than 5 MB', keyword: 'size' }] };
          if (!result.valid) {
            const errors = result.errors.slice(0, 50);
            extras.requestValidation = { model: meta.requestModel.rootType, valid: false, errors: errors.slice(0, 20) };
            return this.answerInvalid(ctx, env, meta.invalid ?? DEFAULT_INVALID, match.entry.uuid, match.params, url, errors, read.complete ? read.body : undefined, extras);
          }
          extras.requestValidation = { model: meta.requestModel.rootType, valid: true };
        }
      }
    }
    // Proxied traffic goes to the real backend: send it no private header.
    if ((extras.requestValidation || ctx.tap) && (match || !env.environment.proxyMode)) {
      const id = this.nextId++;
      this.pending.set(id, extras);
      if (this.pending.size > MAX_PENDING) this.pending.delete(this.pending.keys().next().value as number);
      ctx.upstreamHeaders.push([REQUEST_ID_HEADER, String(id)]);
    }
    return undefined;
  }

  private tokenContext(ctx: FrontContext, env: RuntimeEnvironment, params: Record<string, string>, url: URL): TokenContext {
    const body = ctx.state.body as Buffer | undefined;
    const paramBag = nullObject();
    Object.assign(paramBag, params);
    return {
      params: paramBag,
      query: parseQuery(url),
      headers: ctx.request.headers,
      body: parseBody(body, ctx.request.headers['content-type']),
      vars: env.variables,
    };
  }

  private async answerInvalid(
    ctx: FrontContext, env: RuntimeEnvironment, scenario: DirectScenario, routeId: string, params: Record<string, string>,
    url: URL, errors: unknown, requestBody: Buffer | undefined, extras: RequestExtras,
  ): Promise<FrontResponse> {
    const tokens = { ...this.tokenContext(ctx, env, params, url), validation: { errors } };
    const headers: OutgoingHttpHeaders = {};
    // Same environment-level headers (CORS) the engine would have added.
    const origin = ctx.request.headers.origin;
    for (const header of env.globalHeaders) {
      if (header.value === "{{header 'Origin'}}") { if (origin) headers[header.key.toLowerCase()] = safeHeaderValue(origin); } else if (!header.value.includes('{{') && HEADER_NAME.test(header.key)) headers[header.key.toLowerCase()] = safeHeaderValue(header.value);
    }
    for (const header of scenario.headers) {
      if (!HEADER_NAME.test(header.key)) continue;
      headers[header.key.toLowerCase()] = safeHeaderValue(scenario.dynamic ? expandTokens(header.value, tokens, false) : header.value);
    }
    const contentType = String(headers['content-type'] ?? '');
    const body = scenario.dynamic ? expandTokens(scenario.body, tokens, /json/i.test(contentType)) : scenario.body;
    headers['content-length'] = String(Buffer.byteLength(body));
    if (scenario.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, scenario.latencyMs));
    this.deps.recordDirect({
      method: (ctx.request.method ?? 'GET').toUpperCase(), url: ctx.request.url ?? '/', status: scenario.status, requestHeaders: ctx.request.headers,
      responseHeaders: Object.entries(headers).flatMap(([key, value]) => (value === undefined ? [] : (Array.isArray(value) ? value : [String(value)]).map((v) => ({ key, value: v })))),
      requestBody, responseBody: body, routeId, scenario: scenario.name, extras,
    });
    return { status: scenario.status, headers, body };
  }

  // --------------------------------------------------------------- responses

  private async onResponse(ctx: FrontContext, response: BufferedEngineResponse): Promise<FrontResponse | undefined> {
    const env = this.deps.current();
    const found = env && parsePrivate(env, response.headers[RESPONSE_HEADER]);
    const meta = found && env.scenarioMeta.get(found.responseId);
    if (!env || !found || !meta || meta.routeId !== found.routeId) return undefined;
    const kept: OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(response.headers)) if (!HOP_HEADERS.has(name)) kept[name] = value;
    if (meta.bodyFile) return this.serveFile(meta.bodyFile, meta.name, response.status, kept);
    if (!meta.dynamic) return undefined;
    if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
      this.deps.warn(`Scenario "${meta.name}" was served without filling in tokens: the response is compressed.`);
      return undefined;
    }
    let url: URL;
    try { url = new URL(ctx.request.url ?? '/', 'http://localhost'); } catch { return undefined; }
    const entry = env.routes.find((route) => route.uuid === found.routeId);
    const params = (entry && matchPattern(entry.pattern, url.pathname)) ?? {};
    const tokens = this.tokenContext(ctx, env, params, url);
    for (const [name, value] of Object.entries(kept)) {
      if (typeof value === 'string' && value.includes('{{')) kept[name] = safeHeaderValue(expandTokens(value, tokens, false));
      else if (Array.isArray(value)) kept[name] = value.map((v) => (v.includes('{{') ? safeHeaderValue(expandTokens(v, tokens, false)) : v));
    }
    const contentType = String(response.headers['content-type'] ?? '');
    let body = response.body;
    if (TEXT_TYPE.test(contentType) || contentType === '') body = Buffer.from(expandTokens(response.body.toString('utf8'), tokens, /json/i.test(contentType)), 'utf8');
    kept['content-length'] = String(body.length);
    return { status: response.status, headers: kept, body };
  }

  private async serveFile(file: string, scenario: string, status: number, headers: OutgoingHttpHeaders): Promise<FrontResponse> {
    try {
      const resolved = await resolveResponseFile(this.deps.projectDir, this.deps.root(), file);
      const handle = await openResponseFile(resolved);
      const stream = handle.createReadStream({ autoClose: true });
      for (const name of Object.keys(headers)) if (name === 'content-type') delete headers[name];
      return { status, headers: { ...headers, 'content-type': resolved.contentType, 'content-length': String(resolved.size), 'x-content-type-options': 'nosniff' }, stream };
    } catch (error) {
      this.deps.warn(`The file of scenario "${scenario}" is not available: ${(error as Error).message}`);
      const body = JSON.stringify({ error: 'file_unavailable', message: 'The response file is missing or not allowed.' });
      return { status: 500, headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(body)) }, body };
    }
  }
}
