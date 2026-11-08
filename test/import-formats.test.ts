import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { convertImport, detectFormat } from '../src/core/import/detect.js';
import { ProjectService } from '../src/core/service.js';

const fixture = (name: string) => fs.readFile(path.join('test/fixtures/import', name), 'utf8');
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });

describe('import formats', () => {
  it.each([['bundle.json', 'bundle'], ['postman.json', 'postman'], ['openapi.json', 'openapi'], ['har.json', 'har'], ['curl.txt', 'curl']] as const)('detects and converts %s', async (file, format) => {
    const text = await fixture(file); expect(detectFormat(text)).toBe(format); expect(convertImport(text).bundle.collections.length).toBeGreaterThan(0);
  });
  it('preserves Postman examples and reports unsupported features', async () => {
    const result = convertImport(await fixture('postman.json')); const collection = result.bundle.collections[0]!;
    expect(collection.name).toBe('A / B'); expect(collection.endpoints[0]!.path).toBe('/items/:id');
    expect(collection.endpoints[0]!.scenarios[0]!.body).toBe('{"id":1}');
    expect(result.warnings.join(' ')).toMatch(/auth.*scripts.*no saved examples/i);
  });
  it('generates OpenAPI schema and warns about non-JSON', async () => {
    const text = await fixture('openapi.json'); const result = convertImport(text);
    const ep = result.bundle.collections[0]!.endpoints[0]!; expect(ep.path).toBe('/items/:id');
    expect(JSON.parse(ep.scenarios[0]!.body)).toHaveProperty('id'); expect(ep.scenarios[1]!.body).toBe('');
    expect(result.warnings.join(' ')).toMatch(/non-JSON/); expect(convertImport(text).bundle).toEqual(result.bundle);
  });
  it('filters sensitive HAR headers and skips binary bodies', async () => {
    const result = convertImport(await fixture('har.json')); const scenarios = result.bundle.collections[0]!.endpoints[0]!.scenarios;
    expect(scenarios.map((s) => s.name)).toEqual(['200', '200 (2)']); expect(scenarios[0]!.body).toBe('{}');
    expect(scenarios[0]!.headers.some((h) => h.key === 'Set-Cookie')).toBe(false); expect(result.warnings.join(' ')).toMatch(/binary/);
  });
  it('parses cURL without executing input and reports discarded data', async () => {
    const result = convertImport(await fixture('curl.txt')); expect(result.bundle.collections[0]!.endpoints[0]).toMatchObject({ method: 'POST', path: '/items' });
    expect(result.warnings.join(' ')).toMatch(/headers.*body/i); expect(() => convertImport('curl "unterminated')).toThrow();
  });
  it.each(['skip', 'rename', 'replace'] as const)('applies %s in one mutation', async (strategy) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-convert-')); dirs.push(dir);
    const service = await ProjectService.init(dir, 'Synthetic');
    try {
      const id = await service.createCollection('Sample'); const endpointId = await service.createEndpoint(id, { method: 'GET', path: '/items', description: 'keep', scenarios: [{ name: 'Old', body: '{}' }] });
      const text = await fixture('bundle.json'); const preview = service.previewBundle(text); await service.applyBundle(text, preview.hash, strategy);
      const model = service.model();
      if (strategy === 'skip') expect(service.findEndpoint(endpointId).scenarios[0]!.name).toBe('Old');
      if (strategy === 'replace') { expect(service.findEndpoint(endpointId).scenarios[0]!.name).toBe('New'); expect(service.findEndpoint(endpointId).description).toBe('keep'); }
      if (strategy === 'rename') { expect(model.collections.find((c) => c.name === 'Sample (imported)')?.endpoints).toHaveLength(1); expect(service.findEndpoint(endpointId).scenarios[0]!.name).toBe('Old'); }
      const before = JSON.stringify(model); expect(() => convertImport('{bad')).toThrow(); expect(JSON.stringify(service.model())).toBe(before);
    } finally { await service.close(); }
  });
});
