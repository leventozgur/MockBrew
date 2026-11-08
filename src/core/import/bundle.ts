import { z } from 'zod';
import type { ProjectModel } from '../model.js';
import { invalid } from '../errors.js';
import { expandTokens } from '../../runtime/tokens.js';
import { validateBody, validateHeaders, validateName, validatePath } from '../validation.js';

export const MAX_IMPORT_BYTES = 20_000_000;
const rule = z.object({ target: z.string().max(100), modifier: z.string().max(1024), value: z.string().max(4096), operator: z.string().max(100), invert: z.boolean() }).refine((r) => !JSON.stringify(r).includes('{{'), 'Template expressions are not allowed in rules.');
const scenario = z.object({
  name: z.string(), statusCode: z.number().int().min(100).max(599),
  headers: z.array(z.object({ key: z.string(), value: z.string() })).max(50), body: z.string(),
  latencyMs: z.number().int().min(0).max(60000), rules: z.array(rule).max(20),
  rulesOperator: z.enum(['AND', 'OR']), default: z.boolean(),
  dynamic: z.boolean().optional(), bodyFile: z.string().min(1).max(500).optional(),
});
const modelLink = z.object({ rootType: z.string().min(1).max(300), settings: z.object({ naming: z.enum(['identity', 'snake_case']), dateFormat: z.enum(['iso8601', 'epoch-seconds', 'epoch-millis']) }), sources: z.array(z.string()).max(100), schema: z.record(z.string(), z.unknown()) });
const endpoint = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']), path: z.string(),
  description: z.string().max(1000), responseMode: z.enum(['rules', 'fixed', 'sequential', 'random']),
  scenarios: z.array(scenario).min(1).max(100),
  model: modelLink.optional(), requestModel: modelLink.optional(), invalidRequestScenario: z.string().optional(),
});
export const bundleSchema = z.object({ format: z.literal('mockbrew/bundle'), version: z.literal(1), exportedAt: z.iso.datetime(), collections: z.array(z.object({ name: z.string(), endpoints: z.array(endpoint).max(1000) })).max(100), variables: z.custom<Record<string, string>>((v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).length <= 100 && Object.entries(v).every(([k, x]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof x === 'string' && Buffer.byteLength(x, 'utf8') <= 2048)).optional() });
export type Bundle = z.infer<typeof bundleSchema>;

/** Parse and fully validate before a caller attempts any project mutation. */
export function parseBundle(content: string): Bundle {
  if (Buffer.byteLength(content, 'utf8') > MAX_IMPORT_BYTES) throw invalid('Import exceeds the 20 MB limit.');
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { throw invalid('Import is not valid JSON.'); }
  const parsed = bundleSchema.safeParse(raw);
  if (!parsed.success) throw invalid('Invalid bundle.', parsed.error.issues);
  const names = new Set<string>();
  let count = 0;
  for (const collection of parsed.data.collections) {
    const name = validateName('Collection', collection.name).toLowerCase();
    if (names.has(name)) throw invalid('Duplicate collection name in bundle.');
    names.add(name);
    count += collection.endpoints.length;
    const routes = new Set<string>();
    for (const item of collection.endpoints) {
      const route = `${item.method} ${validatePath(item.path)}`;
      if (routes.has(route)) throw invalid(`Duplicate endpoint in bundle: ${route}.`);
      routes.add(route);
      if (item.scenarios.filter((s) => s.default).length !== 1) throw invalid('Each endpoint must have exactly one default scenario.');
      const scenarioNames = new Set<string>();
      for (const s of item.scenarios) {
        const key = validateName('Scenario', s.name).toLowerCase();
        if (scenarioNames.has(key)) throw invalid('Duplicate scenario name in bundle.');
        scenarioNames.add(key);
        validateBody(s.dynamic ? expandTokens(s.body, {}, true) : s.body, validateHeaders(s.headers));
      }
      if (item.invalidRequestScenario !== undefined && (!item.requestModel || !item.scenarios.some((s) => s.name === item.invalidRequestScenario))) throw invalid('Invalid request scenario reference.');
      if (item.requestModel && !['POST', 'PUT', 'PATCH'].includes(item.method)) throw invalid('A request model applies to POST, PUT and PATCH endpoints.');
    }
  }
  if (count > 5000) throw invalid('Import contains too many endpoints.');
  return parsed.data;
}

/** Portable representation: project identifiers and runtime settings are deliberately omitted. */
export function exportBundle(project: ProjectModel, selected?: string[]): Bundle {
  const collections = project.collections.filter((c) => !selected || selected.includes(c.name) || selected.includes(c.id));
  if (selected?.some((name) => !collections.some((c) => c.name === name || c.id === name))) throw invalid('Selected collection was not found.');
  return {
    format: 'mockbrew/bundle', version: 1, exportedAt: new Date().toISOString(),
    collections: collections.map((c) => ({ name: c.name, endpoints: c.endpoints.map((e) => {
      if (e.readOnly || e.responseMode === 'other') throw invalid(`Cannot export unsupported endpoint ${e.method} ${e.path}.`);
      return { method: e.method, path: e.path, description: e.description, responseMode: e.responseMode,
        scenarios: e.scenarios.map((s) => ({ name: s.name, statusCode: s.statusCode, headers: s.headers, body: s.body, latencyMs: s.latencyMs, rules: s.rules, rulesOperator: s.rulesOperator, default: s.active, ...(s.dynamic ? { dynamic: true } : {}), ...(s.bodyFile ? { bodyFile: s.bodyFile } : {}) })),
        ...(e.model ? { model: e.model } : {}),
        ...(e.requestModel ? { requestModel: e.requestModel } : {}),
        ...(e.invalidRequestScenarioId ? { invalidRequestScenario: e.scenarios.find((s) => s.id === e.invalidRequestScenarioId)?.name } : {}),
      };
    }) })),
  };
}
