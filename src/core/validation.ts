import { HTTP_METHODS, type Header, type HttpMethod } from '../core/model.js';
import { normalizePath } from '../core/conflicts.js';
import { invalid } from '../core/errors.js';

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const PATH_SEGMENT = /^(?::[A-Za-z_][A-Za-z0-9_]*|[A-Za-z0-9._~%@,;=!$&'-]+)$/;

export const MAX_BODY_BYTES = 5_000_000;
export const MAX_LATENCY_MS = 60_000;
export const DEFAULT_CONTENT_TYPE = 'application/json; charset=utf-8';

export function validateName(kind: string, value: unknown): string {
  if (typeof value !== 'string') throw invalid(`${kind} name must be a string.`);
  const name = value.trim();
  if (name.length === 0 || name.length > 100) throw invalid(`${kind} name must be 1-100 characters.`);
  if (/[\u0000-\u001f]/.test(name)) throw invalid(`${kind} name contains control characters.`);
  return name;
}

export function validateMethod(value: unknown): HttpMethod {
  const method = typeof value === 'string' ? value.toUpperCase() : '';
  if (!(HTTP_METHODS as readonly string[]).includes(method)) {
    throw invalid(`Method must be one of ${HTTP_METHODS.join(', ')}.`);
  }
  return method as HttpMethod;
}

/** Endpoint paths use `/segment/:param` syntax; engine specific characters are rejected. */
export function validatePath(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid('Path is required, e.g. /users/:id.');
  if (/[?#\s]/.test(value)) throw invalid('Path must not contain spaces, "?" or "#"; query strings are not part of the path.');
  const path = normalizePath(value);
  if (path.length > 300) throw invalid('Path is too long.');
  const segments = path.split('/').slice(1);
  for (const segment of segments) {
    if (segment === '' && path === '/') continue;
    if (!PATH_SEGMENT.test(segment)) {
      throw invalid(`Path segment "${segment}" is not valid. Use letters, digits and "-._~%@,;=!$&'", or ":name" for parameters.`);
    }
  }
  const params = segments.filter((s) => s.startsWith(':')).map((s) => s.slice(1));
  if (new Set(params).size !== params.length) throw invalid('Path parameter names must be unique.');
  return path;
}

export function validateStatus(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 100 || (value as number) > 599) {
    throw invalid('Status code must be an integer between 100 and 599.');
  }
  return value as number;
}

export function validateLatency(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > MAX_LATENCY_MS) {
    throw invalid(`Latency must be an integer between 0 and ${MAX_LATENCY_MS} ms.`);
  }
  return value as number;
}

export function validateHeaders(value: unknown): Header[] {
  if (!Array.isArray(value)) throw invalid('Headers must be a list of { key, value }.');
  if (value.length > 50) throw invalid('At most 50 headers are allowed.');
  return value.map((h) => {
    const key = typeof h?.key === 'string' ? h.key.trim() : '';
    const val = typeof h?.value === 'string' ? h.value : '';
    if (!TOKEN.test(key)) throw invalid(`Header name "${key}" is not valid.`);
    if (/[\r\n]/.test(val) || val.length > 8192) throw invalid(`Header "${key}" has an invalid value.`);
    return { key, value: val };
  });
}

export function withDefaultContentType(headers: Header[]): Header[] {
  return headers.some((h) => h.key.toLowerCase() === 'content-type')
    ? headers
    : [{ key: 'Content-Type', value: DEFAULT_CONTENT_TYPE }, ...headers];
}

function isJsonContentType(headers: Header[]): boolean {
  const type = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value.toLowerCase();
  return type === undefined || type.includes('json');
}

/** A JSON response must carry parseable JSON; empty bodies (e.g. 204) are allowed. */
export function validateBody(value: unknown, headers: Header[]): string {
  if (typeof value !== 'string') throw invalid('Body must be a string.');
  if (Buffer.byteLength(value) > MAX_BODY_BYTES) throw invalid('Body is too large.');
  if (value.trim() !== '' && isJsonContentType(headers)) {
    try {
      JSON.parse(value);
    } catch (error) {
      throw invalid(`Body is not valid JSON: ${(error as Error).message}`);
    }
  }
  return value;
}

export function validatePort(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65535) {
    throw invalid('Port must be an integer between 1 and 65535.');
  }
  return value as number;
}

export function validateHost(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9.-]+|\[?[0-9A-Fa-f:]+\]?)$/.test(value)) {
    throw invalid('Host must be an IP address or host name such as 127.0.0.1.');
  }
  return value;
}

/** Base URL of the real backend: http(s), no credentials, no query or fragment. */
export function validateProxyHost(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid('The backend address is required, e.g. https://api.example.com.');
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw invalid('The backend address must be a URL such as https://api.example.com.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid('The backend address must start with http:// or https://.');
  if (url.username || url.password) throw invalid('Do not put credentials in the backend address.');
  if (url.search || url.hash) throw invalid('The backend address must not contain a query or fragment.');
  return url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/$/, ''));
}
