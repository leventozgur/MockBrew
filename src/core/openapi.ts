import type { ProjectModel } from './model.js';
import { validateBody } from '../schema/validate.js';

type Json = Record<string, unknown>;

export interface OpenApiOptions {
  title?: string;
  version?: string;
  /** Skip collections that are switched off (default true). */
  onlyActive?: boolean;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head'];

/** `/users/:id` -> `/users/{id}` */
export function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

function stripSchema(node: unknown, rename: Map<string, string>): unknown {
  if (Array.isArray(node)) return node.map((n) => stripSchema(n, rename));
  if (node && typeof node === 'object') {
    const out: Json = {};
    for (const [key, value] of Object.entries(node as Json)) {
      if (key === 'x-source' || key === '$schema' || key === '$defs') continue;
      if (key === '$ref' && typeof value === 'string' && value.startsWith('#/$defs/')) {
        const name = value.slice('#/$defs/'.length);
        out.$ref = `#/components/schemas/${rename.get(name) ?? name}`;
        continue;
      }
      out[key] = stripSchema(value, rename);
    }
    return out;
  }
  return node;
}

class SchemaRegistry {
  readonly schemas: Record<string, unknown> = {};
  private readonly originals = new Map<string, string>();

  /** Adds the definitions of one model schema and returns its root as an OpenAPI schema object. */
  add(schema: Json): unknown {
    const defs = (schema.$defs ?? {}) as Record<string, unknown>;
    const rename = new Map<string, string>();
    for (const [name, def] of Object.entries(defs)) {
      const original = JSON.stringify(def);
      let candidate = name;
      let n = 1;
      while (this.originals.has(candidate) && this.originals.get(candidate) !== original) candidate = `${name}_${++n}`;
      rename.set(name, candidate);
      this.originals.set(candidate, original);
    }
    for (const [name, def] of Object.entries(defs)) this.schemas[rename.get(name) as string] = stripSchema(def, rename);
    return stripSchema(schema, rename);
  }
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Builds an OpenAPI 3.1 document from the project: endpoints and scenarios become paths and responses,
 * linked models become component schemas. It is a contract proposal for the backend team, not a guarantee.
 */
export function buildOpenApi(project: ProjectModel, options: OpenApiOptions = {}): Json {
  const registry = new SchemaRegistry();
  const paths: Record<string, Record<string, unknown>> = {};

  for (const collection of project.collections) {
    if ((options.onlyActive ?? true) && !collection.active) continue;
    for (const endpoint of collection.endpoints) {
      const method = endpoint.method.toLowerCase();
      if (endpoint.readOnly || !METHODS.includes(method)) continue;
      const path = toOpenApiPath(endpoint.path);
      paths[path] ??= {};
      if (paths[path][method]) continue;

      const responses: Record<string, Json> = {};
      const ordered = [...endpoint.scenarios].sort((a, b) => Number(b.active) - Number(a.active));
      for (const scenario of ordered) {
        const code = String(scenario.statusCode);
        const response = (responses[code] ??= { description: scenario.name });
        const contentType = scenario.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value.split(';')[0]?.trim() ?? 'application/json';
        const parsed = scenario.body.trim() === '' ? undefined : parseJson(scenario.body);
        if (!parsed || !contentType.includes('json')) continue;
        const content = (response.content ??= {}) as Record<string, Json>;
        const media = (content['application/json'] ??= {}) as Json;
        if (parsed.ok) {
          const examples = (media.examples ??= {}) as Record<string, unknown>;
          examples[scenario.name] = { value: parsed.value };
          if (endpoint.model && scenario.statusCode >= 200 && scenario.statusCode < 300 && !media.schema && validateBody(endpoint.model.schema, scenario.body).valid) {
            media.schema = registry.add(endpoint.model.schema);
          }
        }
      }

      const params = [...endpoint.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => ({
        name: m[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }));
      const operation: Json = { tags: [collection.name], responses };
      if (endpoint.description) operation.summary = endpoint.description;
      if (params.length > 0) operation.parameters = params;
      paths[path][method] = operation;
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: options.title ?? project.name,
      version: options.version ?? '1.0.0',
      description: 'Proposed contract generated from mock scenarios and mobile models. Review it with the backend team before relying on it.',
    },
    paths,
    ...(Object.keys(registry.schemas).length > 0 ? { components: { schemas: registry.schemas } } : {}),
  };
}
