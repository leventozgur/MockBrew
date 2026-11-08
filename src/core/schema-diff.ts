import type { SchemaChange } from './view.js';

type Json = Record<string, unknown>;

interface Shape {
  types: string[];
  nullable: boolean;
  node: Json;
}

/** Follows $ref and unwraps the nullable forms the schema builder emits. */
function shapeOf(node: Json | undefined, root: Json): { shape: Shape; key: string } {
  let current: Json = node ?? {};
  let nullable = false;
  let key = '';
  for (let i = 0; i < 20; i++) {
    if (typeof current.$ref === 'string') {
      key = current.$ref;
      current = lookup(root, current.$ref);
      continue;
    }
    if (Array.isArray(current.anyOf)) {
      const options = (current.anyOf as Json[]).filter((o) => o.type !== 'null');
      if (options.length !== (current.anyOf as Json[]).length) nullable = true;
      if (options.length === 1) {
        current = options[0] as Json;
        continue;
      }
    }
    break;
  }
  const rawType = current.type;
  const list = Array.isArray(rawType) ? (rawType as string[]) : typeof rawType === 'string' ? [rawType] : [];
  if (list.includes('null')) nullable = true;
  const types = list.filter((t) => t !== 'null');
  if (types.length === 0 && current.properties) types.push('object');
  return { shape: { types: types.sort(), nullable, node: current }, key };
}

function lookup(root: Json, ref: string): Json {
  let node: unknown = root;
  for (const part of ref.replace(/^#\//, '').split('/')) node = (node as Json | undefined)?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  return (node as Json | undefined) ?? {};
}

/**
 * Compares two schemas by the JSON they describe. Changes that would make existing bodies invalid
 * (removed or retyped properties, new required properties, narrowed enums) are marked breaking.
 */
export function diffSchemas(before: Json, after: Json): SchemaChange[] {
  const changes: SchemaChange[] = [];
  /** Pairs being compared right now; meeting one again means the type is recursive. */
  const active = new Set<string>();

  const walk = (a: Json | undefined, b: Json | undefined, path: string): void => {
    const left = shapeOf(a, before);
    const right = shapeOf(b, after);
    const pair = left.key && right.key ? `${left.key}|${right.key}` : '';
    if (pair) {
      if (active.has(pair)) return;
      active.add(pair);
    }
    compare(left.shape, right.shape, path);
    if (pair) active.delete(pair);
  };

  const compare = (x: Shape, y: Shape, path: string): void => {
    const anyLeft = x.types.length === 0;
    const anyRight = y.types.length === 0;
    if (!anyLeft && !anyRight && x.types.join('|') !== y.types.join('|')) {
      changes.push({ kind: 'type-changed', path, breaking: true, message: `${path} changed from ${x.types.join('/')} to ${y.types.join('/')}.` });
      return;
    }
    if (x.nullable !== y.nullable) {
      changes.push({
        kind: 'nullable-changed',
        path,
        breaking: x.nullable && !y.nullable,
        message: `${path} is now ${y.nullable ? 'nullable' : 'not nullable'}.`,
      });
    }
    const formatOf = (s: Shape) => (s.node.format === 'int32' || s.node.format === 'int64' ? undefined : (s.node.format as string | undefined));
    if (formatOf(x) !== formatOf(y)) {
      changes.push({ kind: 'format-changed', path, breaking: true, message: `${path} format changed from ${formatOf(x) ?? 'none'} to ${formatOf(y) ?? 'none'}.` });
    }
    const dateX = x.node['x-date'];
    const dateY = y.node['x-date'];
    if (dateX !== dateY) {
      changes.push({ kind: 'format-changed', path, breaking: true, message: `${path} date encoding changed from ${String(dateX ?? 'text')} to ${String(dateY ?? 'text')}.` });
    }

    const enumX = Array.isArray(x.node.enum) ? (x.node.enum as unknown[]).filter((v) => v !== null) : undefined;
    const enumY = Array.isArray(y.node.enum) ? (y.node.enum as unknown[]).filter((v) => v !== null) : undefined;
    if (enumX && enumY) {
      const removed = enumX.filter((v) => !enumY.includes(v));
      const added = enumY.filter((v) => !enumX.includes(v));
      if (removed.length) changes.push({ kind: 'enum-changed', path, breaking: true, message: `${path} no longer allows ${removed.map((v) => JSON.stringify(v)).join(', ')}.` });
      if (added.length) changes.push({ kind: 'enum-changed', path, breaking: false, message: `${path} now also allows ${added.map((v) => JSON.stringify(v)).join(', ')}.` });
    } else if (enumX && !enumY) {
      changes.push({ kind: 'enum-changed', path, breaking: false, message: `${path} is no longer restricted to an enum.` });
    } else if (!enumX && enumY) {
      changes.push({ kind: 'enum-changed', path, breaking: true, message: `${path} is now restricted to ${enumY.map((v) => JSON.stringify(v)).join(', ')}.` });
    }

    const propsX = (x.node.properties ?? {}) as Record<string, Json>;
    const propsY = (y.node.properties ?? {}) as Record<string, Json>;
    const requiredX = new Set((x.node.required ?? []) as string[]);
    const requiredY = new Set((y.node.required ?? []) as string[]);
    for (const name of Object.keys(propsX)) {
      const child = `${path}.${name}`;
      if (!(name in propsY)) {
        changes.push({ kind: 'property-removed', path: child, breaking: true, message: `${child} was removed.` });
        continue;
      }
      if (requiredX.has(name) !== requiredY.has(name)) {
        changes.push({
          kind: 'required-changed',
          path: child,
          breaking: requiredY.has(name),
          message: `${child} is now ${requiredY.has(name) ? 'required' : 'optional'}.`,
        });
      }
      walk(propsX[name], propsY[name], child);
    }
    for (const name of Object.keys(propsY)) {
      if (name in propsX) continue;
      const child = `${path}.${name}`;
      changes.push({
        kind: 'property-added',
        path: child,
        breaking: requiredY.has(name),
        message: `${child} was added${requiredY.has(name) ? ' and is required' : ''}.`,
      });
    }

    if (x.node.items || y.node.items) walk(x.node.items as Json | undefined, y.node.items as Json | undefined, `${path}[]`);
    const mapX = typeof x.node.additionalProperties === 'object' ? (x.node.additionalProperties as Json) : undefined;
    const mapY = typeof y.node.additionalProperties === 'object' ? (y.node.additionalProperties as Json) : undefined;
    if (mapX || mapY) walk(mapX, mapY, `${path}{}`);
  };

  walk(before, after, '$');
  return changes;
}
