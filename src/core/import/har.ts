import { invalid } from '../errors.js';
import { bundle, endpoint, json, scenario, uniqueName, type Conversion, type Endpoint } from './common.js';

export function importHar(content: string): Conversion {
  const doc = json(content); const warnings: string[] = [];
  if (doc?.log?.version !== '1.2' || !Array.isArray(doc.log.entries)) throw invalid('Expected HAR 1.2.');
  const groups = new Map<string, Map<string, Endpoint>>();
  const blocked = new Set(['authorization', 'cookie', 'set-cookie', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
  for (const [index, entry] of doc.log.entries.entries()) {
    let url: URL; try { url = new URL(entry.request.url); } catch { throw invalid(`Invalid HAR URL at entry ${index + 1}.`); }
    if (entry.request.headers?.length) warnings.push(`Entry ${index + 1}: request headers are not stored.`);
    if (entry.request.postData) warnings.push(`Entry ${index + 1}: request body is not stored.`);
    const response = entry.response; if (!response || !Number.isInteger(response.status)) throw invalid('Invalid HAR response.');
    const connection = (response.headers ?? []).filter((h: any) => String(h.name).toLowerCase() === 'connection').flatMap((h: any) => String(h.value).toLowerCase().split(',').map((s: string) => s.trim()));
    const headers = (response.headers ?? []).filter((h: any) => !blocked.has(String(h.name).toLowerCase()) && !connection.includes(String(h.name).toLowerCase())).map((h: any) => ({ key: h.name, value: h.value }));
    const data = response.content ?? {}; const mime = String(data.mimeType ?? '').toLowerCase();
    const textual = /^(text\/|application\/(?:[^;]+\+)?(?:json|xml|javascript|x-www-form-urlencoded))/.test(mime);
    if (mime && !headers.some((h: { key: string }) => h.key.toLowerCase() === 'content-type')) headers.push({ key: 'Content-Type', value: mime });
    let body = typeof data.text === 'string' ? data.text : '';
    if (body && !textual) { body = ''; warnings.push(`Entry ${index + 1}: binary or unknown response body skipped.`); }
    else if (body && data.encoding === 'base64') body = Buffer.from(body, 'base64').toString('utf8');
    else if (data.encoding && data.encoding !== 'base64') { body = ''; warnings.push(`Entry ${index + 1}: unsupported response encoding.`); }
    const group = groups.get(url.host) ?? new Map<string, Endpoint>(); const key = `${entry.request.method} ${url.pathname}`;
    let ep = group.get(key); if (!ep) { ep = endpoint(entry.request.method, url.pathname, []); group.set(key, ep); }
    const names = new Set(ep.scenarios.map((s) => s.name.toLowerCase()));
    ep.scenarios.push(scenario(uniqueName(String(response.status), names), response.status, body, headers, ep.scenarios.length === 0)); groups.set(url.host, group);
  }
  return { bundle: bundle([...groups].map(([name, items]) => ({ name, endpoints: [...items.values()] }))), warnings };
}
