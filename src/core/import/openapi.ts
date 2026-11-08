import { generateJson } from '../../generator/index.js';
import { invalid } from '../errors.js';
import { bundle, endpoint, json, scenario, uniqueName, type Conversion, type Endpoint, type Scenario } from './common.js';

export function importOpenApi(content: string): Conversion {
  const doc = json(content); const warnings: string[] = [];
  if (!/^3\.[01]\./.test(doc?.openapi ?? '') || !doc.paths || typeof doc.paths !== 'object') throw invalid('Expected OpenAPI 3.0 or 3.1 JSON.');
  function resolve(value: any, active = new Set<string>()): any {
    if (Array.isArray(value)) return value.map((v) => resolve(v, active));
    if (!value || typeof value !== 'object') return value;
    if (typeof value.$ref === 'string') {
      const ref = value.$ref;
      if (!ref.startsWith('#/')) { warnings.push(`External reference ${ref} is unsupported.`); return {}; }
      if (active.has(ref)) { warnings.push(`Recursive reference ${ref} was truncated.`); return {}; }
      let target: any = doc;
      for (const part of ref.slice(2).split('/')) target = target?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
      if (target === undefined) throw invalid(`Unresolved reference: ${ref}.`);
      const next = new Set(active); next.add(ref); return resolve(target, next);
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, active)]));
  }
  const groups = new Map<string, Endpoint[]>();
  for (const [path, rawItem] of Object.entries(doc.paths)) {
    const item: any = resolve(rawItem);
    for (const [method, rawOp] of Object.entries(item ?? {})) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head'].includes(method)) { if (['options', 'trace'].includes(method)) warnings.push(`${method.toUpperCase()} ${path}: unsupported method.`); continue; }
      const op: any = rawOp; if (!op || typeof op !== 'object' || !op.responses || typeof op.responses !== 'object') throw invalid(`Invalid OpenAPI operation ${method} ${path}.`);
      if (op.parameters?.length || item.parameters?.length) warnings.push(`${method.toUpperCase()} ${path}: request parameters are not stored.`);
      if (op.requestBody) warnings.push(`${method.toUpperCase()} ${path}: request body is not stored.`);
      if (op.callbacks || op.webhooks) warnings.push(`${method.toUpperCase()} ${path}: callbacks are unsupported.`);
      if (op.security || doc.security) warnings.push(`${method.toUpperCase()} ${path}: auth is unsupported.`);
      const scenarios: Scenario[] = []; const used = new Set<string>();
      for (const [status, rawResponse] of Object.entries(op.responses)) {
        if (!/^[1-5]\d\d$/.test(status)) { warnings.push(`${method.toUpperCase()} ${path}: response ${status} is unsupported.`); continue; }
        const response: any = resolve(rawResponse); const media = response?.content ?? {}; const jsonType = Object.keys(media).find((s) => /^application\/(?:[^;]+\+)?json(?:;|$)/i.test(s));
        let body = ''; const headers: { key: string; value: string }[] = [];
        if (jsonType) {
          headers.push({ key: 'Content-Type', value: jsonType }); const spec = media[jsonType];
          if (Object.hasOwn(spec, 'example')) body = JSON.stringify(spec.example, null, 2);
          else if (spec.examples && Object.keys(spec.examples).length) {
            const example: any = resolve(Object.values(spec.examples)[0]);
            if (Object.hasOwn(example ?? {}, 'value')) body = JSON.stringify(example.value, null, 2);
            else { warnings.push(`${method.toUpperCase()} ${path}: external example is unsupported.`); body = '{}'; }
            if (Object.keys(spec.examples).length > 1) warnings.push(`${method.toUpperCase()} ${path}: additional examples are unsupported.`);
          } else if (spec.schema && Object.hasOwn(resolve(spec.schema), 'example')) body = JSON.stringify(resolve(spec.schema).example, null, 2);
          else if (spec.schema) body = generateJson(resolve(spec.schema), { seed: 'mockbrew-import' });
          else { body = '{}'; warnings.push(`${method.toUpperCase()} ${path}: response ${status} has no example or schema.`); }
        } else if (Object.keys(media).length) warnings.push(`${method.toUpperCase()} ${path}: non-JSON response ${status} has an empty body.`);
        scenarios.push(scenario(uniqueName(status, used), Number(status), body, headers, scenarios.length === 0));
      }
      if (!scenarios.length) { scenarios.push(scenario('Default', 200, '{}')); warnings.push(`${method.toUpperCase()} ${path}: no supported responses; added default 200 scenario.`); }
      const tags: string[] = Array.isArray(op.tags) && op.tags.length ? op.tags : ['Imported'];
      for (const tag of tags) { const list = groups.get(tag) ?? []; list.push(endpoint(method, path.replace(/\{([^}]+)\}/g, ':$1'), structuredClone(scenarios), String(op.description ?? op.summary ?? ''))); groups.set(tag, list); }
    }
  }
  return { bundle: bundle([...groups].map(([name, endpoints]) => ({ name, endpoints }))), warnings };
}
