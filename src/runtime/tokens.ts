import { randomUUID } from 'node:crypto';

/** Data available to the allowlisted response interpreter. */
export interface TokenContext {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  body?: unknown;
  vars?: Record<string, string>;
  validation?: { errors: unknown };
}

const NAME = '[A-Za-z_][A-Za-z0-9_]*';
const PATH = `(?:\\$\\.)?${NAME}(?:(?:\\.${NAME})|(?:\\[\\d+\\]))*`;
// Parameter and query names may contain hyphens even though variable names are identifiers.
const REQUEST_NAME = '[A-Za-z_][A-Za-z0-9_-]*';
const SIMPLE = new RegExp(`^(?:uuid|now(?::epoch(?:Millis)?)?|request\\.(?:params|query)\\.${REQUEST_NAME}|request\\.header\\.[A-Za-z0-9_!#$%&'*+.^\x60|~-]+|request\\.body\\.${PATH}|vars\\.${NAME}|validation\\.errors)$`);
const JSON_TOKEN = new RegExp(`^json (?:request\\.body\\.${PATH}|validation\\.errors)$`);

function isKnown(token: string): boolean {
  return SIMPLE.test(token) || JSON_TOKEN.test(token);
}

/** Unknown expressions are never evaluated; callers can show these warnings in any surface. */
export function validateTokens(value: string): string[] {
  const warnings: string[] = [];
  for (const match of value.matchAll(/\{\{\{[^{}]*\}\}\}|\{\{[^{}]*\}\}/g)) {
    const expression = match[0].slice(2, -2).trim();
    if (match[0].startsWith('{{{') || !isKnown(expression)) warnings.push(match[0]);
  }
  return [...new Set(warnings)];
}

function own(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function getPath(value: unknown, path: string): unknown {
  const normalized = path.replace(/^\$\./, '').replace(/\[(\d+)\]/g, '.$1');
  return normalized.split('.').reduce<unknown>((current, key) => own(current, key), value);
}

function resolve(token: string, context: TokenContext): unknown {
  if (token === 'uuid') return randomUUID();
  if (token === 'now') return new Date().toISOString();
  if (token === 'now:epoch') return Math.floor(Date.now() / 1000);
  if (token === 'now:epochMillis') return Date.now();
  if (token === 'validation.errors') return context.validation?.errors;
  if (token.startsWith('request.body.')) return getPath(context.body, token.slice('request.body.'.length));
  if (token.startsWith('request.header.')) {
    const key = token.slice('request.header.'.length);
    const entry = Object.entries(context.headers ?? {}).find(([name]) => name.toLowerCase() === key.toLowerCase());
    return entry?.[1];
  }
  const dot = token.lastIndexOf('.');
  const group = token.slice(0, dot);
  const key = token.slice(dot + 1);
  if (group === 'vars') return own(context.vars, key);
  if (group === 'request.params') return own(context.params, key);
  if (group === 'request.query') return own(context.query, key);
  return undefined;
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * Expand only allowlisted tokens. For JSON, ordinary tokens work inside string
 * literals and `{{json request.body.$.item}}` inserts a whole JSON value.
 * Missing values become an empty string or null, respectively. HTML and XML
 * modes entity-escape inserted values; plain text and headers remain unchanged.
 */
export function expandTokens(input: string, context: TokenContext, json: boolean | 'markup' = false): string {
  let result = '';
  let insideString = false;
  let escaped = false;
  for (let i = 0; i < input.length;) {
    if (input.startsWith('{{{', i)) {
      const end = input.indexOf('}}}', i + 3);
      if (end !== -1) {
        result += input.slice(i, end + 3);
        i = end + 3;
        continue;
      }
    }
    if (input.startsWith('{{', i)) {
      const end = input.indexOf('}}', i + 2);
      if (end !== -1) {
        const raw = input.slice(i, end + 2);
        const token = input.slice(i + 2, end).trim();
        const jsonForm = token.startsWith('json ');
        if (isKnown(token) && (json !== true || (jsonForm ? !insideString : insideString))) {
          const value = resolve(jsonForm ? token.slice(5) : token, context);
          const text = jsonForm ? JSON.stringify(value ?? null) : asText(value);
          result += json === true && !jsonForm ? JSON.stringify(text).slice(1, -1) : json === 'markup' ? text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!) : text;
        } else result += raw;
        i = end + 2;
        continue;
      }
    }
    const char = input[i]!;
    result += char;
    if (json === true) {
      if (escaped) escaped = false;
      else if (insideString && char === '\\') escaped = true;
      else if (char === '"') insideString = !insideString;
    }
    i++;
  }
  return result;
}

/** Unknown tokens in a scenario body and its header values. */
export function scenarioTokenWarnings(body: string, headers: { value: string }[]): string[] {
  return [...new Set([body, ...headers.map((h) => h.value)].flatMap((value) => (value.includes('{{') ? validateTokens(value) : [])))];
}
