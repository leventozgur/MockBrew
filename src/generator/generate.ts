import type { JsonSchema } from '../schema/types.js';
import { booleanForName, humanize, numberForName, sampleInstant, stringForName, uuidFrom } from './heuristics.js';
import { type Rng, rngFor } from './prng.js';

/**
 * minimal: required properties only, one item per list.
 * full: every property, two items per list.
 * empty-list: every property, every list empty.
 */
export type Variant = 'minimal' | 'full' | 'empty-list';

export const VARIANTS: readonly Variant[] = ['minimal', 'full', 'empty-list'];

export interface GenerateOptions {
  variant?: Variant;
  seed?: string | number;
  subtype?: string;
}

const MAX_DEPTH = 12;

interface Ctx {
  root: JsonSchema;
  variant: Variant;
  seed: string;
  subtype?: string;
  /** $refs currently being expanded, used to cut recursive types. */
  active: Set<string>;
}

export function generateValue(schema: JsonSchema, options: GenerateOptions = {}): unknown {
  const ctx: Ctx = { root: schema, variant: options.variant ?? 'full', seed: String(options.seed ?? 0), subtype: options.subtype, active: new Set() };
  return gen(schema, ctx, '$', '', 0);
}

export function generateJson(schema: JsonSchema, options: GenerateOptions = {}): string {
  return JSON.stringify(generateValue(schema, options), null, 2);
}

function resolveRef(ref: string, ctx: Ctx): JsonSchema {
  if (ref === '#') return ctx.root;
  const parts = ref.replace(/^#\//, '').split('/');
  let node: unknown = ctx.root;
  for (const part of parts) {
    node = (node as Record<string, unknown> | undefined)?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return (node as JsonSchema | undefined) ?? {};
}

function gen(schema: JsonSchema, ctx: Ctx, path: string, name: string, depth: number): unknown {
  if (typeof schema.$ref === 'string') {
    const ref = schema.$ref;
    if (ctx.active.has(ref)) return {};
    ctx.active.add(ref);
    try {
      return gen(resolveRef(ref, ctx), ctx, path, name, depth);
    } finally {
      ctx.active.delete(ref);
    }
  }
  if (depth > MAX_DEPTH) return fallbackAtDepth(schema);
  if (Array.isArray(schema.anyOf)) {
    const options = (schema.anyOf as JsonSchema[]).filter((s) => s.type !== 'null');
    const first = options[0];
    if (!first || (typeof first.$ref === 'string' && ctx.active.has(first.$ref))) return null;
    return gen(first, ctx, path, name, depth);
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
    const choices = schema.oneOf as JsonSchema[];
    const selected = ctx.subtype ? choices.find((s) => s.title === ctx.subtype || (s['x-source'] as { type?: string } | undefined)?.type === ctx.subtype) : undefined;
    if (ctx.subtype && !selected) throw new Error(`Unknown subtype "${ctx.subtype}".`);
    const index = /\[(\d+)\]$/.exec(path);
    const offset = index ? rngFor(ctx.seed, path.replace(/\[\d+\]$/, '')).int(0, choices.length - 1) : 0;
    return gen(selected ?? choices[index ? (Number(index[1]) + offset) % choices.length : 0] as JsonSchema, ctx, path, name, depth);
  }
  if ('const' in schema) return schema.const;
  const rng = rngFor(ctx.seed, path);
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const values = (schema.enum as unknown[]).filter((v) => v !== null);
    return values.length > 0 ? rng.pick(values) : null;
  }
  const type = pickType(schema);
  switch (type) {
    case 'object':
      return genObject(schema, ctx, path, depth);
    case 'array':
      return genArray(schema, ctx, path, name, depth);
    case 'string':
      return genString(schema, rng, name);
    case 'integer':
      return genNumber(schema, rng, name, true);
    case 'number':
      return genNumber(schema, rng, name, false);
    case 'boolean':
      return booleanForName(name);
    case 'null':
      return null;
    default:
      return genAny(rng, name);
  }
}

function pickType(schema: JsonSchema): string | undefined {
  const t = schema.type;
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return (t as string[]).find((x) => x !== 'null') ?? 'null';
  if (schema.properties) return 'object';
  return undefined;
}

function fallbackAtDepth(schema: JsonSchema): unknown {
  const type = pickType(schema);
  if (type === 'array') return [];
  if (type === 'object') return {};
  return null;
}

function genObject(schema: JsonSchema, ctx: Ctx, path: string, depth: number): unknown {
  const out: Record<string, unknown> = {};
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema.required ?? []) as string[]);
  for (const [key, propSchema] of Object.entries(properties)) {
    if (ctx.variant === 'minimal' && !required.has(key)) continue;
    out[key] = gen(propSchema, ctx, `${path}.${key}`, key, depth + 1);
  }
  if (!schema.properties && typeof schema.additionalProperties === 'object' && schema.additionalProperties) {
    const count = ctx.variant === 'empty-list' ? 0 : ctx.variant === 'minimal' ? 1 : 2;
    for (let i = 1; i <= count; i++) {
      out[`key${i}`] = gen(schema.additionalProperties as JsonSchema, ctx, `${path}.key${i}`, 'value', depth + 1);
    }
  }
  return out;
}

function genArray(schema: JsonSchema, ctx: Ctx, path: string, name: string, depth: number): unknown[] {
  if (ctx.variant === 'empty-list') return [];
  const items = (schema.items ?? {}) as JsonSchema;
  if (typeof items.$ref === 'string' && ctx.active.has(items.$ref)) return [];
  const count = ctx.variant === 'minimal' ? 1 : 2;
  return Array.from({ length: count }, (_v, i) => gen(items, ctx, `${path}[${i}]`, singular(name), depth + 1));
}

function singular(name: string): string {
  if (name.endsWith('ies')) return `${name.slice(0, -3)}y`;
  if (name.endsWith('s') && !name.endsWith('ss')) return name.slice(0, -1);
  return name;
}

function genString(schema: JsonSchema, rng: Rng, name: string): string {
  switch (schema.format) {
    case 'date-time': {
      return sampleInstant(name, rng).toISOString().replace(/\.\d{3}Z$/, 'Z');
    }
    case 'date':
      return sampleInstant(name, rng).toISOString().slice(0, 10);
    case 'time':
      return sampleInstant(name, rng).toISOString().slice(11, 19);
    case 'uuid':
      return uuidFrom(rng);
    case 'uri':
      return stringForName(name, rng) ?? `https://example.com/${rng.int(1, 999)}`;
    default:
      break;
  }
  if (schema.contentEncoding === 'base64') return Buffer.from(`sample-${rng.int(1000, 9999)}`).toString('base64');
  const named = stringForName(name, rng);
  if (named !== undefined) return clampString(named, schema);
  return clampString(`Sample ${humanize(name)}`, schema);
}

function clampString(value: string, schema: JsonSchema): string {
  const max = typeof schema.maxLength === 'number' ? schema.maxLength : undefined;
  return max !== undefined && value.length > max ? value.slice(0, max) : value;
}

function genNumber(schema: JsonSchema, rng: Rng, name: string, integer: boolean): number {
  const epoch = schema['x-date'];
  if (epoch === 'epoch-seconds') return Math.floor(sampleInstant(name, rng).getTime() / 1000);
  if (epoch === 'epoch-millis') return sampleInstant(name, rng).getTime();

  let value = numberForName(name, rng, integer);
  if (value === undefined) {
    const isInt64 = schema.format === 'int64';
    value = integer ? rng.int(1, isInt64 ? 100000 : 1000) : Math.round(rng.next() * 100000) / 100;
  }
  const min = typeof schema.minimum === 'number' ? schema.minimum : undefined;
  const max = typeof schema.maximum === 'number' ? schema.maximum : undefined;
  if (min !== undefined && value < min) value = min;
  if (max !== undefined && value > max) value = max;
  return integer ? Math.trunc(value) : value;
}

function genAny(rng: Rng, name: string): unknown {
  return stringForName(name, rng) ?? `Sample ${humanize(name)}`;
}
