import type { Header } from '../core/model.js';

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token',
]);
const SENSITIVE_NAME = /(token|secret|password|passwd|api[-_]?key|session|credential|signature)/i;

export const MASK = '***';

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.toLowerCase()) || SENSITIVE_NAME.test(name);
}

export function maskHeaders(headers: Header[]): Header[] {
  return headers.map((h) => (isSensitiveHeader(h.key) ? { key: h.key, value: MASK } : h));
}

/** Masks values of sensitive query parameters (e.g. ?access_token=...). */
export function maskQuery(query: string | null | undefined): string {
  if (!query) return '';
  const raw = query.startsWith('?') ? query.slice(1) : query;
  return raw
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      const key = pair.slice(0, eq);
      let decoded = key;
      try {
        decoded = decodeURIComponent(key);
      } catch {
        // keep the raw key
      }
      return isSensitiveHeader(decoded) ? `${key}=${MASK}` : pair;
    })
    .join('&');
}
