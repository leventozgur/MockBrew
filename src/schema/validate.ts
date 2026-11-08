import { createRequire } from 'node:module';
import type { ErrorObject, ValidateFunction } from 'ajv';
import type { JsonSchema, ValidationResult } from './types.js';

// Ajv and ajv-formats are CommonJS packages whose typings do not match their ESM default export.
const require = createRequire(import.meta.url);
const Ajv2020 = (require('ajv/dist/2020.js') as { default: typeof import('ajv/dist/2020.js').default }).default;
const addFormats = (require('ajv-formats') as { default: typeof import('ajv-formats').default }).default;

const cache = new Map<string, ValidateFunction>();
const MAX_CACHE = 50;

function compile(schema: JsonSchema): ValidateFunction {
  const key = JSON.stringify(schema);
  const hit = cache.get(key);
  if (hit) return hit;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addFormat('int32', true);
  ajv.addFormat('int64', true);
  const validate = ajv.compile(schema);
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(key, validate);
  return validate;
}

function pointerToPath(pointer: string): string {
  if (!pointer) return '$';
  return `$${pointer
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((s) => (/^\d+$/.test(s) ? `[${s}]` : `.${s}`))
    .join('')}`;
}

function describe(error: ErrorObject): string {
  switch (error.keyword) {
    case 'required':
      return `missing required property "${(error.params as { missingProperty: string }).missingProperty}"`;
    case 'type':
      return `must be ${(error.params as { type: string | string[] }).type}`;
    case 'enum':
      return `must be one of ${JSON.stringify((error.params as { allowedValues: unknown[] }).allowedValues)}`;
    default:
      return error.message ?? 'is invalid';
  }
}

/** Validates an already parsed JSON value against a schema. */
export function validateValue(schema: JsonSchema, value: unknown): ValidationResult {
  const validate = compile(schema);
  if (validate(value)) return { valid: true, errors: [] };
  const errors = (validate.errors ?? [])
    .filter((e) => e.keyword !== 'anyOf' && e.keyword !== 'oneOf')
    .map((e) => ({
      path: pointerToPath(e.instancePath),
      message: describe(e),
      keyword: e.keyword,
    }));
  return { valid: false, errors };
}

/** Validates a raw JSON text; syntax errors are reported as validation errors. */
export function validateBody(schema: JsonSchema, body: string): ValidationResult {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (error) {
    return { valid: false, errors: [{ path: '$', message: `invalid JSON: ${(error as Error).message}`, keyword: 'json' }] };
  }
  return validateValue(schema, value);
}

export function checkJsonSyntax(body: string): string | undefined {
  try {
    JSON.parse(body);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}
