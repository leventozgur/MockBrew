import { invalid } from '../errors.js';
import { MAX_IMPORT_BYTES, parseBundle } from './bundle.js';
import { importPostman } from './postman.js';
import { importOpenApi } from './openapi.js';
import { importHar } from './har.js';
import { importCurl } from './curl.js';
import type { Conversion } from './common.js';

export type ImportFormat = 'auto' | 'bundle' | 'postman' | 'openapi' | 'har' | 'curl';
export function detectFormat(content: string): Exclude<ImportFormat, 'auto'> {
  if (Buffer.byteLength(content) > MAX_IMPORT_BYTES) throw invalid('Import exceeds the 20 MB limit.');
  if (/^\s*curl(?:\s|$)/.test(content)) return 'curl';
  let value: any; try { value = JSON.parse(content); } catch { throw invalid('Unrecognized import; convert YAML to JSON first.'); }
  if (value?.format === 'mockbrew/bundle') return 'bundle';
  if (value?.info?.schema?.includes('/v2.1.0/')) return 'postman';
  if (typeof value?.openapi === 'string') return 'openapi';
  if (value?.log?.version) return 'har';
  throw invalid('Unrecognized import format.');
}
export function convertImport(content: string, format: ImportFormat = 'auto'): Conversion {
  const selected = format === 'auto' ? detectFormat(content) : format;
  switch (selected) {
    case 'bundle': return { bundle: parseBundle(content), warnings: [] };
    case 'postman': return importPostman(content);
    case 'openapi': return importOpenApi(content);
    case 'har': return importHar(content);
    case 'curl': return importCurl(content);
    default: throw invalid('Invalid import format.');
  }
}
