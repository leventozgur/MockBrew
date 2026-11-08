import { invalid } from '../errors.js';
import { validateMethod } from '../validation.js';
import { MAX_IMPORT_BYTES, parseBundle, type Bundle } from './bundle.js';

export type Endpoint = Bundle['collections'][number]['endpoints'][number];
export type Scenario = Endpoint['scenarios'][number];
export type Conversion = { bundle: Bundle; warnings: string[] };
export function json(content: string): any {
  if (Buffer.byteLength(content) > MAX_IMPORT_BYTES) throw invalid('Import exceeds the 20 MB limit.');
  try { return JSON.parse(content); } catch { throw invalid('Import is not valid JSON; convert YAML to JSON first.'); }
}
export function bundle(collections: Bundle['collections']): Bundle {
  return parseBundle(JSON.stringify({ format: 'mockbrew/bundle', version: 1, exportedAt: '1970-01-01T00:00:00.000Z', collections }));
}
export function scenario(name: string, statusCode: number, body: string, headers: { key: string; value: string }[] = [], first = true): Scenario {
  return { name, statusCode, body, headers, latencyMs: 0, rules: [], rulesOperator: 'AND', default: first };
}
export function endpoint(method: string, path: string, scenarios: Scenario[], description = ''): Endpoint {
  return { method: validateMethod(method), path, description: description.slice(0, 1000), responseMode: 'rules', scenarios };
}
export function urlPath(raw: string): string {
  let s = raw.trim().replace(/^\{\{[^}]+\}\}/, '').replace(/^https?:\/\/[^/\?#]+/i, '');
  s = s.split(/[?#]/)[0] || '/';
  return s.startsWith('/') ? s : `/${s}`;
}
export function uniqueName(name: string, used: Set<string>): string {
  let result = name.slice(0, 90) || 'Response'; let n = 2;
  while (used.has(result.toLowerCase())) result = `${name.slice(0, 90)} (${n++})`;
  used.add(result.toLowerCase()); return result;
}
