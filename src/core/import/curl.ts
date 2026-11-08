import { invalid } from '../errors.js';
import { bundle, endpoint, scenario, urlPath, type Conversion } from './common.js';
import { MAX_IMPORT_BYTES } from './bundle.js';

export function importCurl(content: string): Conversion {
  if (Buffer.byteLength(content) > MAX_IMPORT_BYTES) throw invalid('Import exceeds the 20 MB limit.');
  const tokens: string[] = []; let token = ''; let quote = ''; let started = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i]!;
    if (quote === "'") { if (c === "'") quote = ''; else token += c; started = true; continue; }
    if (c === '\\') { if (++i >= content.length) throw invalid('Invalid cURL escape.'); token += content[i]; started = true; continue; }
    if (quote) { if (c === quote) quote = ''; else token += c; started = true; continue; }
    if (c === "'" || c === '"') { quote = c; started = true; continue; }
    if (/\s/.test(c)) { if (started) { tokens.push(token); token = ''; started = false; } continue; }
    token += c; started = true;
  }
  if (quote) throw invalid('Unclosed cURL quote.'); if (started) tokens.push(token);
  if (tokens.shift() !== 'curl') throw invalid('Expected a single cURL command.');
  let method = ''; let url = ''; let data = false; const warnings: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (/^--(?:request|header|url|data(?:-raw|-binary|-urlencode|-ascii)?)=/.test(t) || /^-(?:X|H|d).+/.test(t)) {
      const split = t.startsWith('--') ? t.indexOf('=') : 2;
      tokens.splice(i, 1, t.slice(0, split), t.slice(split + (t.startsWith('--') ? 1 : 0)));
      i--; continue;
    }
    if (t === '-X' || t === '--request' || t === '-H' || t === '--header' || t === '-d' || /^--data(?:-raw|-binary|-urlencode|-ascii)?$/.test(t) || t === '--url') {
      const value = tokens[++i]; if (value === undefined) throw invalid(`Missing value for ${t}.`);
      if (/^--(?:request|header|url|data(?:-raw|-binary|-urlencode|-ascii)?)=/.test(t) || /^-(?:X|H|d).+/.test(t)) {
      const split = t.startsWith('--') ? t.indexOf('=') : 2;
      tokens.splice(i, 1, t.slice(0, split), t.slice(split + (t.startsWith('--') ? 1 : 0)));
      i--; continue;
    }
    if (t === '-X' || t === '--request') method = value; else if (t === '--url') { if (url) throw invalid('Only one URL is supported.'); url = value; } else if (t === '-H' || t === '--header') warnings.push('Request headers are not stored.'); else data = true;
    } else if (t.startsWith('-')) throw invalid(`Unsupported cURL option: ${t}.`);
    else { if (url) throw invalid('Only one URL is supported.'); url = t; }
  }
  if (!/^https?:\/\//i.test(url)) throw invalid('A single HTTP URL is required.');
  try { new URL(url); } catch { throw invalid('Invalid cURL URL.'); }
  if (data) warnings.push('Request body is not stored.');
  return { bundle: bundle([{ name: 'Imported', endpoints: [endpoint(method || (data ? 'POST' : 'GET'), urlPath(url), [scenario('Default', 200, '{}')])] }]), warnings };
}
