import { invalid } from '../errors.js';
import { bundle, endpoint, json, scenario, uniqueName, urlPath, type Conversion, type Endpoint } from './common.js';

export function importPostman(content: string): Conversion {
  const doc = json(content); const warnings: string[] = [];
  if (!doc?.info?.schema?.includes('/v2.1.0/') || !Array.isArray(doc.item)) throw invalid('Expected a Postman Collection v2.1.');
  const groups = new Map<string, Endpoint[]>();
  function unsupported(obj: any, label: string) {
    if (obj?.event?.length) warnings.push(`${label}: scripts are unsupported.`);
    if (obj?.auth && obj.auth.type !== 'noauth') warnings.push(`${label}: auth is unsupported.`);
  }
  unsupported(doc, 'Collection');
  function walk(items: any[], folders: string[]) {
    for (const item of items) {
      if (!item || typeof item !== 'object') throw invalid('Invalid Postman item.');
      unsupported(item, item.name ?? 'Item');
      if (Array.isArray(item.item)) { walk(item.item, [...folders, String(item.name || 'Folder')]); continue; }
      const req = item.request; if (!req || typeof req !== 'object') { warnings.push(`${item.name ?? 'Item'}: unsupported item skipped.`); continue; }
      unsupported(req, item.name ?? 'Request');
      if (req.body) warnings.push(`${item.name ?? 'Request'}: request body is not stored.`);
      if (Array.isArray(req.header) && req.header.length) warnings.push(`${item.name ?? 'Request'}: request headers are not stored.`);
      const raw = typeof req.url === 'string' ? req.url : req.url?.raw ?? (Array.isArray(req.url?.path) ? '/' + req.url.path.join('/') : undefined);
      if (typeof raw !== 'string' || typeof req.method !== 'string') throw invalid('Invalid Postman request.');
      const responses = Array.isArray(item.response) ? item.response : []; const used = new Set<string>();
      if (!responses.length) warnings.push(`${req.method} ${raw}: no saved examples; added default 200 scenario.`);
      const scenarios = responses.length ? responses.map((r: any, i: number) => scenario(uniqueName(String(r.name || r.code || 'Response'), used), r.code, typeof r.body === 'string' ? r.body : '', (r.header ?? []).filter((h: any) => !h.disabled).map((h: any) => ({ key: h.key, value: h.value })), i === 0)) : [scenario('Default', 200, '{}')];
      const name = folders.join(' / ') || String(doc.info.name || 'Imported');
      const list = groups.get(name) ?? []; list.push(endpoint(req.method, urlPath(raw), scenarios, typeof req.description === 'string' ? req.description : '')); groups.set(name, list);
    }
  }
  walk(doc.item, []); return { bundle: bundle([...groups].map(([name, endpoints]) => ({ name, endpoints }))), warnings };
}
