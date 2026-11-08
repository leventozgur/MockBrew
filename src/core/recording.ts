import type { Transaction } from '@mockoon/commons';
import type { Recording } from './view.js';

const LIMIT = 1_000_000;
const OMIT = new Set(['authorization', 'cookie', 'set-cookie', 'proxy-authorization', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length', 'content-encoding']);
const SENSITIVE = /"(?:token|access_token|refresh_token|password|secret|api_key|authorization)"\s*:/i;

export function captureTransaction(transaction: Transaction, id: number): Recording {
  const headers = transaction.response.headers;
  const connection = headers.filter((h) => h.key.toLowerCase() === 'connection').flatMap((h) => h.value.toLowerCase().split(',').map((v) => v.trim()));
  const safeHeaders = headers.filter((h) => !OMIT.has(h.key.toLowerCase()) && !connection.includes(h.key.toLowerCase()));
  const type = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';
  const isText = /^(text\/|application\/(?:[\w.+-]*\+)?(?:json|xml|javascript|x-www-form-urlencoded))/.test(type);
  const raw = isText && typeof transaction.response.body === 'string' ? transaction.response.body : '';
  const bytes = Buffer.from(raw);
  const truncated = bytes.length > LIMIT;
  const body = truncated ? bytes.subarray(0, LIMIT).toString('utf8').replace(/\uFFFD$/, '') : raw;
  const warnings: string[] = [];
  if (SENSITIVE.test(body)) warnings.push('Response body contains a sensitive-looking key.');
  if (truncated) warnings.push('Response body was truncated and cannot be saved.');
  if (!isText && transaction.response.body) warnings.push('Non-text response body was omitted.');
  return { id, timestamp: new Date(transaction.timestampMs).toISOString(), method: transaction.request.method.toUpperCase(), path: transaction.request.urlPath ?? '', query: transaction.request.query ?? '', status: transaction.response.statusCode, headers: safeHeaders, body, truncated, warnings };
}
