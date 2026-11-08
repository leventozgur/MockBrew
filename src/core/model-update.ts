import { generateValue } from '../generator/index.js';
import { validateBody } from '../schema/index.js';
import type { GenerationSettings, JsonSchema } from '../schema/types.js';

import type { ModelUpdateChange as Change } from './view.js';
export type { ModelUpdateChange as Change } from './view.js';
export interface UpdateOptions { settings?: Partial<GenerationSettings>; fillOptional?: boolean; seed?: string | number }

type Node = JsonSchema;
class RawNumber { constructor(readonly text: string) {} }

/** Merge a JSON body without converting existing number tokens back through JavaScript numbers. */
export function updateModelBody(oldSchema: JsonSchema, newSchema: JsonSchema, body: string, options: UpdateOptions = {}): { body: string; changes: Change[] } {
  const parse = JSON.parse as unknown as (text: string, reviver: (key: string, value: unknown, context: { source?: string }) => unknown) => unknown;
  const input = parse(body, (_key, value, context) => typeof value === 'number' ? new RawNumber(context.source as string) : value);
  const changes: Change[] = [];
  const resolve = (schema: Node | undefined, root: Node): Node => {
    let node = schema ?? {};
    for (let i = 0; i < 30; i++) {
      if (typeof node.$ref === 'string') {
        let target: unknown = root;
        const ref = node.$ref;
        if (ref !== '#') for (const part of ref.replace(/^#\//, '').split('/')) target = (target as Node | undefined)?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
        node = (target ?? {}) as Node;
      } else if (Array.isArray(node.anyOf) && node.anyOf.filter((n: Node) => n.type !== 'null').length === 1) {
        node = node.anyOf.find((n: Node) => n.type !== 'null') as Node;
      } else break;
    }
    return node;
  };
  const stringify = (value: unknown): string => {
    if (value instanceof RawNumber) return value.text;
    if (Array.isArray(value)) return `[${value.map(stringify).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}:${stringify(v)}`).join(',')}}`;
    return JSON.stringify(value);
  };
  /** Same as stringify, but keeps the indentation style of the original body (bodies are hand-edited files). */
  const indentUnit = /\n([ \t]+)\S/.exec(body)?.[1] ?? (body.includes('\n') ? '  ' : '');
  const pretty = (value: unknown, depth = 0): string => {
    if (!indentUnit) return stringify(value);
    const pad = indentUnit.repeat(depth + 1);
    const end = indentUnit.repeat(depth);
    if (Array.isArray(value)) return value.length ? `[\n${value.map((v) => pad + pretty(v, depth + 1)).join(',\n')}\n${end}]` : '[]';
    if (value && typeof value === 'object' && !(value instanceof RawNumber)) {
      const entries = Object.entries(value);
      return entries.length ? `{\n${entries.map(([k, v]) => `${pad}${JSON.stringify(k)}: ${pretty(v, depth + 1)}`).join(',\n')}\n${end}}` : '{}';
    }
    return stringify(value);
  };
  const valid =(schema: Node, value: unknown) => validateBody({ $defs: newSchema.$defs, allOf: [schema] }, stringify(value)).valid;
  const generate = (schema: Node, name: string, path: string): unknown => {
    const wrapper = { $defs: newSchema.$defs, type: 'object', properties: { [name || 'value']: schema }, required: [name || 'value'] };
    return (generateValue(wrapper, { variant: options.fillOptional ? 'full' : 'minimal', seed: `${String(options.seed ?? 0)}:${path}` }) as Record<string, unknown>)[name || 'value'];
  };
  const walk = (value: unknown, oldNode: Node | undefined, newNode: Node, path: string, name: string): unknown => {
    const old = resolve(oldNode, oldSchema);
    const next = resolve(newNode, newSchema);
    const type = (n: Node) => (Array.isArray(n.type) ? n.type.filter((t) => t !== 'null').join('|') : n.type ?? (n.properties ? 'object' : undefined));
    const changedType = oldNode && type(old) && type(next) && type(old) !== type(next);
    if (!changedType && value !== null && Array.isArray(value) && (type(next) === 'array' || next.items)) {
      return value.map((item, i) => walk(item, old.items as Node | undefined, (next.items ?? {}) as Node, `${path}[${i}]`, name));
    }
    if (!changedType && value !== null && typeof value === 'object' && !(value instanceof RawNumber) && !Array.isArray(value) && (type(next) === 'object' || next.properties)) {
      const props = (next.properties ?? {}) as Record<string, Node>;
      const oldProps = (old.properties ?? {}) as Record<string, Node>;
      const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const [key, child] of Object.entries(value)) {
        const childPath = `${path}.${key}`;
        const prop = Object.hasOwn(props, key) ? props[key] : typeof next.additionalProperties === 'object' && next.additionalProperties ? next.additionalProperties as Node : undefined;
        if (!prop) { changes.push({ kind: 'removed', path: childPath }); continue; }
        output[key] = walk(child, oldProps[key] ?? old.additionalProperties as Node | undefined, prop, childPath, key);
      }
      const required = new Set((next.required ?? []) as string[]);
      for (const [key, prop] of Object.entries(props)) if (!Object.hasOwn(output, key) && (required.has(key) || (options.fillOptional && !Object.hasOwn(oldProps, key)))) {
        const childPath = `${path}.${key}`;
        output[key] = generate(prop, key, childPath);
        changes.push({ kind: 'added', path: childPath });
      }
      if (valid(newNode, output)) return output;
      changes.push({ kind: 'regenerated', path });
      return generate(newNode, name, path);
    }
    if (!changedType && valid(newNode, value)) { changes.push({ kind: 'kept', path }); return value; }
    changes.push({ kind: 'regenerated', path });
    return generate(newNode, name, path);
  };
  const result = pretty(walk(input, oldSchema, newSchema, '$', 'value'));
  if (!validateBody(newSchema, result).valid) throw new Error('Cannot generate a valid body for the new schema.');
  return { body: result, changes };
}
